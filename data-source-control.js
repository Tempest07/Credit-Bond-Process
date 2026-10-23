const COOKIE_NAME = 'bond_centre_data_source';
const MODES = new Set(['auto', 'dm', 'qb']);
const LABELS = { auto: '自动', dm: 'DM', qb: 'QB' };

function validMode(value) {
  return MODES.has(value) ? value : '';
}

export function readDataSourceMode(cookie = '') {
  const part = String(cookie).split(';').map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`));
  try { return validMode(decodeURIComponent(part?.slice(COOKIE_NAME.length + 1) || '')); }
  catch { return ''; }
}

export function dataSourceCookiePath(baseUrl) {
  const url = new URL(baseUrl);
  if (url.pathname === '/bond-centre') return '/bond-centre';
  return new URL('./', url).pathname.replace(/\/$/, '') || '/';
}

export function dataSourceModeCookie(mode, baseUrl) {
  if (!validMode(mode)) throw new TypeError('Invalid data source mode');
  const url = new URL(baseUrl);
  return `${COOKIE_NAME}=${mode}; Path=${dataSourceCookiePath(baseUrl)}; Max-Age=31536000; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`;
}

/** A browser preference only. Market-data APIs read the same cookie. */
export function initDataSourceControl(options = {}) {
  const doc = options.document || globalThis.document;
  const win = options.window || globalThis.window;
  const root = options.root || doc?.querySelector('#dataSourceControl');
  if (!root) return { ready: Promise.resolve(), getMode: () => 'qb', setMode: () => false, destroy() {} };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = doc.baseURI || win.location.href;
  const buttons = [...root.querySelectorAll('[data-source-mode]')];
  const status = root.querySelector('[data-source-status]');
  const description = root.querySelector('[data-source-description]');
  let mode = readDataSourceMode(doc.cookie) || 'qb';
  let defaultMode = 'qb';
  let configured = {};
  let ready = false;
  let destroyed = false;
  let selectionRevision = 0;
  let warning = '';
  const abort = new AbortController();

  function render() {
    if (destroyed) return;
    root.setAttribute('aria-busy', String(!ready));
    root.dataset.mode = mode;
    for (const button of buttons) {
      const value = button.dataset.sourceMode;
      button.setAttribute('aria-pressed', String(value === mode));
      button.disabled = configured[value] === false;
      button.title = configured[value] === false ? `${LABELS[value]} 尚未配置` : '';
    }
    if (status) status.textContent = warning || (!ready ? '正在确认数据源…' : `后续来源：${mode === 'auto' ? 'DM → QB' : LABELS[mode]}`);
    if (description) description.textContent = mode === 'auto'
      ? '优先 DM，失败或缺数时使用 QB。'
      : `仅使用 ${LABELS[mode]}；切换后从下次请求生效。`;
  }

  function setMode(nextMode) {
    if (destroyed || !validMode(nextMode) || configured[nextMode] === false) return false;
    if (nextMode === mode && readDataSourceMode(doc.cookie) === nextMode) return true;
    const previousMode = mode;
    try {
      doc.cookie = dataSourceModeCookie(nextMode, baseUrl);
      if (readDataSourceMode(doc.cookie) !== nextMode) throw new Error('Cookie unavailable');
    } catch {
      warning = '未能保存切换，请允许本站 Cookie 后重试。';
      render();
      return false;
    }
    mode = nextMode;
    ready = true;
    warning = '';
    selectionRevision += 1;
    render();
    win.dispatchEvent(new win.CustomEvent('bond-data-source-change', { detail: { mode, previousMode, defaultMode } }));
    return true;
  }

  const listeners = buttons.map(button => {
    const onClick = () => setMode(button.dataset.sourceMode);
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  });
  const onKeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const enabled = buttons.filter(button => !button.disabled);
    const current = enabled.indexOf(event.target);
    if (current < 0) return;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    event.preventDefault();
    enabled[index].focus();
    setMode(enabled[index].dataset.sourceMode);
  };
  root.addEventListener('keydown', onKeydown);
  render();
  const initialRevision = selectionRevision;
  const initialized = Promise.resolve().then(async () => {
    try {
      const response = await fetchImpl(new URL('./api/data-source', baseUrl).href, {
        credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
      });
      if (!response.ok) throw new Error('Source status unavailable');
      const payload = await response.json();
      if (!validMode(payload?.mode) || !validMode(payload?.defaultMode)) throw new Error('Invalid source status');
      if (destroyed) return;
      defaultMode = payload.defaultMode;
      configured = payload.configured && typeof payload.configured === 'object' ? payload.configured : {};
      if (selectionRevision === initialRevision) mode = payload.mode;
      warning = '';
    } catch {
      if (destroyed) return;
      if (selectionRevision === initialRevision) warning = `来源状态暂不可用 · 本机模式 ${LABELS[mode]}`;
    } finally {
      ready = true;
      render();
    }
  });

  return {
    ready: initialized,
    getMode: () => mode,
    setMode,
    destroy() {
      destroyed = true;
      abort.abort();
      listeners.forEach(remove => remove());
      root.removeEventListener('keydown', onKeydown);
    },
  };
}
