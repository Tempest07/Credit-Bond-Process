import { dataProviderLabel } from './market-data-source.js?v=20261025release5351r2';

const CODE = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/;
const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const nextDay = time => (Math.floor((time + 8 * 3600_000) / 86400_000) + 1) * 86400_000 - 8 * 3600_000;
const RETRY_MS = 60_000;

export function createPaymentTodoCodes({ lookup, onChange, now = Date.now, getDataSourceMode = () => 'auto' }) {
  // Durable daily caching belongs to the API's D1 table, never browser storage.
  const cache = new Map(), queued = new Set(), forced = new Set(), waiters = new Set();
  let running = null, scheduled = false, generation = 0;

  function ensure(names, { force = false } = {}) {
    for (const value of names) {
      const name = String(value || '').trim(), key = nameKey(name);
      if (!key || name.length > 120) continue;
      const existing = cache.get(key);
      if (existing?.refreshing) {
        // An ordinary in-flight request may only return a daily cloud hit.
        // Follow it with one real forced check; join an already forced check.
        if (force && !(running?.force && running.keys?.has(key))) {
          queued.add(key); forced.add(key);
        }
        continue;
      }
      if (!force && existing?.expiresAt > now()) continue;
      cache.set(key, { ...(existing?.code ? existing : { status: 'loading', code: '' }),
        name, refreshing: true, requestMode: getDataSourceMode(), expiresAt: Infinity });
      queued.add(key);
      if (force) forced.add(key);
    }
    if (queued.size && !running && !scheduled) {
      scheduled = true;
      const scheduledGeneration = generation;
      queueMicrotask(() => {
        if (scheduledGeneration !== generation) return;
        scheduled = false; void load();
      });
    }
  }

  async function load() {
    if (running) return;
    const request = { generation, controller: new AbortController() };
    running = request;
    const current = () => request.generation === generation && running === request && !request.controller.signal.aborted;
    try {
      while (queued.size && current()) {
        const force = forced.has(queued.values().next().value);
        const keys = [...queued].filter(key => forced.has(key) === force).slice(0, 20);
        keys.forEach(key => { queued.delete(key); forced.delete(key); });
        request.keys = new Set(keys);
        request.force = force;
        keys.forEach(key => cache.set(key, { ...cache.get(key), refreshing: true, expiresAt: Infinity }));
        const names = keys.map(key => cache.get(key).name);
        const requestMode = getDataSourceMode();
        try {
          const payload = await lookup(names, { signal: request.controller.signal, force });
          if (!current()) return;
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i], name = names[i], result = payload?.results?.[name];
            const match = result?.status === 'matched' && result.matches?.length === 1 ? result.matches[0] : null;
            const provider = dataProviderLabel(match?.provider || payload, '');
            const verified = Boolean(provider) && match && nameKey(match.name) === key && CODE.test(match.code);
            const status = verified ? 'matched' : ['missing', 'ambiguous', 'loading'].includes(result?.status) ? result.status : 'error';
            const refreshStatus = status === 'error' ? 'error' : ['matched', 'missing', 'ambiguous', 'loading', 'error'].includes(result?.refreshStatus)
              ? result.refreshStatus : status;
            const time = now();
            const fallbackExpiry = verified && refreshStatus === 'matched' ? nextDay(time) : time + RETRY_MS;
            const cloudExpiry = Date.parse(result?.nextCheckAt);
            const expiresAt = Number.isFinite(cloudExpiry) && cloudExpiry > time ? Math.min(cloudExpiry, fallbackExpiry) : fallbackExpiry;
            const previous = cache.get(key);
            // A failed daily check must not make a previously verified code disappear.
            cache.set(key, !verified && previous?.code ? {
              ...previous, refreshing: false, refreshStatus, expiresAt,
            } : {
              status, name, code: verified ? match.code : '', source: verified ? provider : '', requestMode,
              ...(match?.providerInfo ? { providerInfo: match.providerInfo } : {}),
              fetchedAt: result?.fetchedAt || payload?.fetchedAt || new Date(time).toISOString(),
              checkedAt: result?.checkedAt || (verified ? new Date(time).toISOString() : ''),
              refreshStatus, refreshing: false, expiresAt,
            });
          }
        } catch {
          if (!current()) return;
          keys.forEach((key, index) => {
            const previous = cache.get(key);
            cache.set(key, { ...(previous?.code ? previous : { status: 'error', name: names[index], code: '', requestMode }),
              refreshing: false, refreshStatus: 'error', expiresAt: now() + RETRY_MS });
          });
        }
        onChange();
      }
    } finally {
      if (running === request) { running = null; settle(); }
    }
  }

  function settle() {
    for (const resolve of waiters) resolve();
    waiters.clear();
  }

  async function refresh(names) {
    const requestedGeneration = generation;
    const keys = [...new Set(names.map(nameKey).filter(Boolean))];
    ensure(names, { force: true });
    if (queued.size || running || scheduled) await new Promise(resolve => waiters.add(resolve));
    if (requestedGeneration !== generation) return { cancelled: true };
    return { total: keys.length,
      failed: keys.filter(key => cache.get(key)?.refreshStatus !== 'matched').length };
  }

  function resetDataSource() {
    generation++;
    running?.controller.abort();
    running = null; scheduled = false;
    cache.clear(); queued.clear(); forced.clear(); settle();
    onChange();
  }

  return { ensure, get: name => cache.get(nameKey(name)), refresh, resetDataSource };
}
