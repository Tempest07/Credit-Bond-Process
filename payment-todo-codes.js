import { dataProviderLabel } from './market-data-source.js?v=20261022release53';

const CODE = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/;
const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();

export function createPaymentTodoCodes({ lookup, onChange, now = Date.now }) {
  const cache = new Map(), queued = new Set();
  let running = false, scheduled = false;

  function ensure(names) {
    for (const value of names) {
      const name = String(value || '').trim(), key = nameKey(name);
      if (!key || name.length > 120) continue;
      const existing = cache.get(key);
      if (existing && (existing.status === 'loading' || existing.expiresAt > now())) continue;
      cache.set(key, { status: 'loading', name, code: '', expiresAt: Infinity });
      queued.add(key);
    }
    if (queued.size && !running && !scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; void load(); });
    }
  }

  async function load() {
    if (running) return;
    running = true;
    try {
      while (queued.size) {
        const keys = [...queued].slice(0, 20);
        keys.forEach(key => queued.delete(key));
        const names = keys.map(key => cache.get(key).name);
        try {
          const payload = await lookup(names);
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i], name = names[i], result = payload?.results?.[name];
            const match = result?.status === 'matched' && result.matches?.length === 1 ? result.matches[0] : null;
            const provider = dataProviderLabel(match?.provider || payload, '');
            const verified = Boolean(provider) && match && nameKey(match.name) === key && CODE.test(match.code);
            const status = verified ? 'matched' : ['missing', 'ambiguous'].includes(result?.status) ? result.status : 'error';
            cache.set(key, {
              status, name, code: verified ? match.code : '', source: provider,
              ...(match?.providerInfo ? { providerInfo: match.providerInfo } : {}),
              fetchedAt: payload?.fetchedAt || new Date(now()).toISOString(),
              expiresAt: now() + (verified ? 15 * 60_000 : 60_000),
            });
          }
        } catch {
          keys.forEach((key, index) => cache.set(key, { status: 'error', name: names[index], code: '', expiresAt: now() + 60_000 }));
        }
        onChange();
      }
    } finally { running = false; }
  }

  return { ensure, get: name => cache.get(nameKey(name)) };
}
