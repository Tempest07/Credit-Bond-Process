import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dataSourceCookiePath,
  dataSourceModeCookie,
  initDataSourceControl,
  readDataSourceMode,
} from '../data-source-control.js';

class Element extends EventTarget {
  constructor(dataset = {}) { super(); this.dataset = dataset; this.attributes = {}; this.disabled = false; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
}

function workspace({ cookie = '', baseUrl = 'https://tempest07.com/bond-centre/', blocked = false, fetchImpl } = {}) {
  const buttons = ['auto', 'dm', 'qb'].map(sourceMode => new Element({ sourceMode }));
  const root = new Element();
  const status = new Element();
  const description = new Element();
  const sourceCopy = new Element({ sourceTemplate: '请求来源：{source}' });
  const liveStatus = new Element();
  liveStatus.textContent = 'QB · 已读取 3 条';
  root.querySelectorAll = () => buttons;
  root.querySelector = selector => selector === '[data-source-status]' ? status : description;
  const writes = [];
  let cookieValue = cookie;
  const document = {
    baseURI: baseUrl,
    querySelector: () => root,
    querySelectorAll: selector => selector === '[data-source-template]' ? [sourceCopy] : [],
    get cookie() { return cookieValue; },
    set cookie(value) { writes.push(value); if (!blocked) cookieValue = value.split(';')[0]; },
  };
  const window = new EventTarget();
  window.CustomEvent = class extends Event { constructor(type, options) { super(type); this.detail = options.detail; } };
  window.location = { href: baseUrl };
  const changes = [];
  window.addEventListener('bond-data-source-change', event => changes.push(event.detail));
  const calls = [];
  const control = initDataSourceControl({ document, window, fetchImpl: (...args) => {
    calls.push(args);
    return (fetchImpl || (async () => ({ ok: true, json: async () => ({ mode: readDataSourceMode(cookieValue) || 'qb', defaultMode: 'qb', configured: { dm: true, qb: true } }) })))(...args);
  } });
  return { control, root, status, description, sourceCopy, liveStatus, buttons, document, writes, changes, calls };
}

test('only valid exact source cookies are accepted', () => {
  assert.equal(readDataSourceMode('other=1; bond_centre_data_source=auto; session=unchanged'), 'auto');
  assert.equal(readDataSourceMode('bond_centre_data_source=DM'), '');
  assert.equal(readDataSourceMode('prefix_bond_centre_data_source=dm'), '');
  assert.equal(readDataSourceMode('bond_centre_data_source=%E0%A4'), '');
});

test('source cookies stay inside the product path and use Secure only on HTTPS', () => {
  assert.equal(dataSourceCookiePath('https://tempest07.com/bond-centre/'), '/bond-centre');
  assert.equal(dataSourceCookiePath('https://tempest07.com/bond-centre/index.html'), '/bond-centre');
  assert.equal(dataSourceCookiePath('https://tempest07.com/bond-centre'), '/bond-centre');
  assert.equal(dataSourceCookiePath('http://127.0.0.1:8815/'), '/');
  assert.equal(dataSourceModeCookie('qb', 'https://tempest07.com/bond-centre/'), 'bond_centre_data_source=qb; Path=/bond-centre; Max-Age=31536000; SameSite=Lax; Secure');
  assert.equal(dataSourceModeCookie('dm', 'http://127.0.0.1:8815/'), 'bond_centre_data_source=dm; Path=/; Max-Age=31536000; SameSite=Lax');
  assert.throws(() => dataSourceModeCookie('qb; injected=1', 'https://tempest07.com/'), TypeError);
});

test('initialization reflects the server mode without changing cookies or invalidating data', async () => {
  const ui = workspace({ fetchImpl: async () => ({ ok: true, json: async () => ({ mode: 'auto', defaultMode: 'qb', configured: { dm: true, qb: true } }) }) });
  assert.equal(ui.sourceCopy.textContent, '请求来源：QB');
  await ui.control.ready;
  assert.equal(ui.control.getMode(), 'auto');
  assert.deepEqual(ui.buttons.map(button => button.attributes['aria-pressed']), ['true', 'false', 'false']);
  assert.equal(ui.root.attributes['aria-busy'], 'false');
  assert.equal(ui.status.textContent, '后续来源：DM → QB');
  assert.equal(ui.description.textContent, '优先 DM，失败或缺数时使用 QB。');
  assert.equal(ui.calls[0][0], 'https://tempest07.com/bond-centre/api/data-source');
  assert.equal(ui.calls[0][1].cache, 'no-store');
  assert.equal(ui.calls[0][1].credentials, 'same-origin');
  assert.deepEqual(ui.writes, []);
  assert.deepEqual(ui.changes, []);
  assert.equal(ui.sourceCopy.textContent, '请求来源：自动（DM→QB）');
  assert.equal(ui.liveStatus.textContent, 'QB · 已读取 3 条');
});

test('switching modes persists only the cookie and dispatches the exact change for cache invalidation', async () => {
  const ui = workspace();
  await ui.control.ready;
  ui.buttons[1].dispatchEvent(new Event('click'));
  assert.equal(ui.control.getMode(), 'dm');
  assert.equal(readDataSourceMode(ui.document.cookie), 'dm');
  assert.deepEqual(ui.changes, [{ mode: 'dm', previousMode: 'qb', defaultMode: 'qb' }]);
  assert.equal(ui.status.textContent, '后续来源：DM');
  assert.equal(ui.description.textContent, '仅使用 DM；切换后从下次请求生效。');
  assert.equal(ui.sourceCopy.textContent, '请求来源：DM');
  assert.equal(ui.liveStatus.textContent, 'QB · 已读取 3 条');
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.control.setMode('invalid'), false);
  assert.equal(ui.control.getMode(), 'dm');
  assert.equal(ui.changes.length, 1);
  ui.control.setMode('dm');
  assert.equal(ui.changes.length, 1);
});

test('a default-mode click still persists the explicit preference', async () => {
  const ui = workspace();
  await ui.control.ready;
  assert.equal(ui.control.setMode('qb'), true);
  assert.equal(readDataSourceMode(ui.document.cookie), 'qb');
  assert.equal(ui.writes.length, 1);
  assert.deepEqual(ui.changes[0], { mode: 'qb', previousMode: 'qb', defaultMode: 'qb' });
});

test('a pending initialization cannot override a new user selection', async () => {
  let respond;
  const ui = workspace({ fetchImpl: () => new Promise(resolve => { respond = resolve; }) });
  await Promise.resolve();
  ui.control.setMode('dm');
  respond({ ok: true, json: async () => ({ mode: 'qb', defaultMode: 'qb', configured: { dm: true, qb: true } }) });
  await ui.control.ready;
  assert.equal(ui.control.getMode(), 'dm');
  assert.equal(readDataSourceMode(ui.document.cookie), 'dm');
  assert.equal(ui.status.textContent, '后续来源：DM');
  assert.equal(ui.sourceCopy.textContent, '请求来源：DM');
  assert.equal(ui.changes.length, 1);
});

test('blocked cookies leave the mode unchanged and never claim a successful switch', async () => {
  const ui = workspace({ blocked: true });
  await ui.control.ready;
  assert.equal(ui.control.setMode('dm'), false);
  assert.equal(ui.control.getMode(), 'qb');
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.status.textContent, '未能保存切换，请允许本站 Cookie 后重试。');
  assert.equal(ui.sourceCopy.textContent, '请求来源：QB');
});

test('failed initialization keeps a valid preference and does not expose upstream details', async () => {
  const ui = workspace({ cookie: 'bond_centre_data_source=auto', fetchImpl: async () => { throw new Error('secret response'); } });
  await ui.control.ready;
  assert.equal(ui.control.getMode(), 'auto');
  assert.equal(ui.status.textContent, '来源状态暂不可用 · 本机模式 自动');
  assert.equal(ui.status.textContent.includes('secret'), false);
  assert.deepEqual(ui.writes, []);
  assert.equal(ui.control.setMode('qb'), true);
  assert.equal(ui.status.textContent, '后续来源：QB');
});

test('unconfigured fixed sources cannot be selected', async () => {
  const ui = workspace({ fetchImpl: async () => ({ ok: true, json: async () => ({ mode: 'qb', defaultMode: 'qb', configured: { dm: false, qb: true } }) }) });
  await ui.control.ready;
  assert.equal(ui.buttons[1].disabled, true);
  assert.equal(ui.control.setMode('dm'), false);
  assert.equal(ui.control.getMode(), 'qb');
  assert.equal(ui.changes.length, 0);
});

test('keyboard navigation changes the mode and cleanup cancels initialization and listeners', async () => {
  const ui = workspace();
  await ui.control.ready;
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, { key: { value: 'ArrowRight' }, target: { value: ui.buttons[2] } });
  ui.root.dispatchEvent(event);
  assert.equal(ui.control.getMode(), 'auto');
  assert.equal(ui.buttons[0].focused, true);
  assert.equal(event.defaultPrevented, true);
  ui.control.destroy();
  assert.equal(ui.calls[0][1].signal.aborted, true);
  ui.buttons[1].dispatchEvent(new Event('click'));
  assert.equal(ui.control.getMode(), 'auto');
  assert.equal(ui.control.setMode('qb'), false);
});
