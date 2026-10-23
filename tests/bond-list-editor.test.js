import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeBondList } from '../bond-list-editor.js';

const ids = ['save-state', 'save-dot', 'branches', 'fill', 'auto', 'export', 'copy', 'recovery-box',
  'recovery-download', 'login-link', 'hide-empty', 'counts', 'notice', 'preview', 'copy-hint', 'retry', 'coupons-refresh',
  'tab-results', 'tab-editor', 'results-panel', 'editor-panel', 'types-options', 'types-label', 'coupon-op', 'coupon-min', 'coupon-max',
  'coupon-max-wrap', 'missing', 'side-all', 'side-ofr', 'side-bid', 'filters-clear', 'filter-error', 'results-counts', 'metadata-status',
  'results-body', 'results-empty', 'result-preview', 'result-copy-hint'];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag, owner) {
    this.tagName = tag; this.owner = owner; this.children = []; this.dataset = {}; this.style = {};
    this.listeners = {}; this.attributes = {}; this.className = ''; this.id = ''; this.textContent = '';
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.selectionStart = 0; this.selectionEnd = 0; this.scrollHeight = 60;
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
  }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  emit(name, details = {}) { return Promise.all((this.listeners[name] || []).map(callback => callback({ target: this, ...details }))); }
  click() { return this.emit('click'); }
  focus() { this.owner.activeElement = this; }
  select() { this.focus(); this.setSelectionRange(0, this.value.length); }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector(selector) {
    const matches = element => selector.startsWith('#') ? element.id === selector.slice(1)
      : selector.startsWith('.') ? element.className.split(/\s+/).includes(selector.slice(1))
      : selector === '[data-composing]' ? 'composing' in element.dataset : false;
    for (const child of this.children) {
      if (matches(child)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
}

async function fixture(options, work) {
  const globals = ['document', 'window', 'location', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'requestAnimationFrame'];
  const originals = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const document = { activeElement: null };
  document.body = new Element('body', document);
  const root = new Element('section', document); document.body.append(root);
  document.querySelector = selector => selector === '.view[data-view="bond-list"]' ? root : null;
  document.createElement = tag => new Element(tag, document);
  document.execCommand = () => true;
  const elements = Object.fromEntries(ids.map(id => {
    const element = new Element('div', document); element.id = 'bondList-' + id; root.append(element);
    return [id, element];
  }));
  elements.retry.hidden = true; elements['recovery-box'].hidden = true; elements['login-link'].hidden = true;
  elements.export.disabled = true; elements.auto.checked = options.auto ?? false;
  elements['coupon-op'].value = 'any'; elements.missing.value = 'all';
  const storage = options.storage || new Map();
  const state = clone(options.state || { sections: [{ title: '北京/上海', text: '' }], revision: 0, userId: 'admin' });
  const requests = [], timers = new Map(); let time = 0, nextTimer = 1;
  const listeners = {};
  document.addEventListener = (name, callback) => { (listeners[name] ||= []).push(callback); };
  const values = {
    document,
    window: { addEventListener(name, callback) { (listeners[name] ||= []).push(callback); } },
    location: new URL(options.url || 'http://127.0.0.1:8814/'),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { callback, due: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { callback(time); return 0; },
    fetch: async (url, init = {}) => {
      const request = { url, body: init.body ? JSON.parse(init.body) : undefined, init };
      requests.push(request);
      if (options.fetch) {
        const result = await options.fetch(request, state); if (result) return result;
      }
      if (url.endsWith('/state')) {
        if (!request.body) return json(state);
        assert.equal(request.body.revision, state.revision);
        state.sections = clone(request.body.sections); state.revision++;
        return json({ revision: state.revision });
      }
      if (url.endsWith('/lookup')) {
        return json({ results: Object.fromEntries(request.body.names.map(name => [name, {
          status: options.match ? 'matched' : 'missing',
          matches: options.match ? [{ code: '102600001.IB', name, market: '银行间' }] : []
        }])) });
      }
      if (url.endsWith('/coupons')) {
        return json({ source: 'DM', results: Object.fromEntries(request.body.codes.map(code => [code, { status: 'missing', couponRate: null }])) });
      }
      if (url.endsWith('/valuations')) {
        return json({ source: 'DM', results: Object.fromEntries(request.body.codes.map(code => [code, { status: 'missing', institution: code.endsWith('.IB') ? '中债' : '中证', yield: null, netPrice: null }])) });
      }
      throw new Error('unexpected URL ' + url);
    }
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const environment = {
    root, elements, storage, requests, state, document,
    textarea: index => root.querySelector('#bondList-text-' + index),
    rows: () => elements['results-body'].children,
    resultRow: index => elements['results-body'].children[index],
    async chooseType(type, checked = true) {
      const input = elements['types-options'].children.map(label => label.children[0]).find(input => input.attributes['aria-label'] === type);
      input.checked = checked; await input.emit('change');
    },
    async filter(id, value, event = 'change') { elements[id].value = value; await elements[id].emit(event); },
    async edit(index, text) { const area = this.textarea(index); area.value = text; await area.emit('input'); },
    async advance(duration) {
      time += duration;
      for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); timer.callback(); }
      await settle();
    }
  };
  try { await work(environment); }
  finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
}

test('editor loads lazily, keeps edits across internal navigation and saves through its own API', async () => {
  await fixture({}, async env => {
    const editor = initializeBondList();
    assert.equal(env.requests.length, 0);
    await editor.setActive(false); assert.equal(env.requests.length, 0);
    await editor.setActive(true);
    assert.equal(env.requests[0].url, '/api/bond-list/state');
    await env.edit(0, '123456.SH，测试，净价100*ofr');
    await editor.setActive(false); await editor.setActive(true);
    assert.equal(env.requests.filter(request => !request.body).length, 1);
    assert.equal(env.textarea(0).value, '123456.SH，测试，净价100*ofr');
    assert.equal(await editor.flushSave(), true);
    assert.equal(env.elements['save-state'].textContent, '本地已保存');
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.elements.preview.textContent, 'OFR/BID\n\n北京/上海\n123456.SH，测试，净价100*ofr');
    assert.equal(env.requests[1].init.headers['X-Bond-List'], '1');
  });
});

test('DM lookup uses batches of 20 and keeps quote text unchanged when inserting codes', async () => {
  const text = Array.from({ length: 41 }, (_, index) => '26测试' + index + '，净价100+0.2*ofr 5000').join('\n');
  await fixture({ state: { sections: [{ title: '浙江（杭州）', text }], revision: 0, userId: 'admin' }, match: true }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    assert.equal(env.elements.copy.disabled, true);
    await env.elements.fill.click();
    assert.deepEqual(env.requests.filter(request => request.url.endsWith('/lookup')).map(request => request.body.names.length), [20, 20, 1]);
    assert.equal(env.textarea(0).value, text.split('\n').map(line => '102600001.IB，' + line).join('\n'));
    assert.equal(env.elements.copy.disabled, false);
    assert.equal(await editor.flushSave(), true);
  });
});

test('DM response preserves a section changed while the request runs and fills untouched sections', async () => {
  const pending = deferred();
  await fixture({ state: { sections: [{ title: '北京/上海', text: '26测试，2.0*ofr' }, { title: '杭州', text: '26测试，净价100*bid' }], revision: 0, userId: 'admin' },
    fetch: request => request.url.endsWith('/lookup') ? pending.promise : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const filling = env.elements.fill.click(); await settle();
    await env.edit(0, '26测试，2.2*ofr');
    pending.resolve(json({ results: { '26测试': { status: 'matched', matches: [{ code: '102600001.IB', market: '银行间' }] } } }));
    await filling;
    assert.equal(env.textarea(0).value, '26测试，2.2*ofr');
    assert.equal(env.textarea(1).value, '102600001.IB，26测试，净价100*bid');
    assert.equal(await editor.flushSave(), true);
  });
});

test('flushSave waits for an in-flight write and every later edit with the returned revision', async () => {
  const first = deferred(), second = deferred(); let writes = 0;
  await fixture({ fetch: request => request.body && request.url.endsWith('/state') ? (++writes === 1 ? first.promise : second.promise) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await env.edit(0, '123456.SH，测试，1.5*bid'); await env.advance(450);
    assert.equal(writes, 1);
    await env.edit(0, '123456.SH，测试，1.7*bid');
    let flushed = false;
    const flush = editor.flushSave().then(result => { flushed = true; return result; });
    await settle(); assert.equal(flushed, false);
    first.resolve(json({ revision: 1 })); await settle();
    assert.equal(writes, 2); assert.equal(flushed, false);
    assert.deepEqual(env.requests.filter(request => request.body && request.url.endsWith('/state')).map(request => request.body.revision), [0, 1]);
    assert.equal(env.requests.at(-1).body.sections[0].text, '123456.SH，测试，1.7*bid');
    second.resolve(json({ revision: 2 }));
    assert.equal(await flush, true);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.storage.has('bond-list-cloud-draft-v1:admin'), false);
  });
});

test('a stale write blocks flush and retries while retaining the account draft and export', async () => {
  await fixture({ fetch: request => request.body && request.url.endsWith('/state') ? json({ error: '其他窗口已保存，请导出后刷新' }, 409) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await env.edit(0, '123456.SH，测试，2.0*ofr');
    assert.equal(await editor.flushSave(), false);
    assert.equal(await editor.flushSave(), false);
    assert.equal(env.requests.filter(request => request.body && request.url.endsWith('/state')).length, 1);
    assert.equal(env.textarea(0).value, '123456.SH，测试，2.0*ofr');
    assert.equal(env.elements.retry.disabled, true);
    assert.equal(env.elements.export.disabled, false);
    assert.equal(editor.hasPendingChanges(), true);
    assert.equal(JSON.parse(env.storage.get('bond-list-cloud-draft-v1:admin')).sections[0].text, env.textarea(0).value);
  });
});

test('read and non-conflict save failures can be retried without losing input', async () => {
  let reads = 0, writes = 0;
  await fixture({ fetch: request => {
    if (!request.body) return ++reads === 1 ? json({ error: '暂不可用' }, 503) : null;
    if (request.url.endsWith('/state')) return ++writes === 1 ? json({ error: '保存暂不可用' }, 503) : null;
    return null;
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    assert.equal(env.elements.retry.hidden, false);
    await env.elements.retry.click();
    assert.equal(reads, 2); assert.equal(env.elements.retry.hidden, true);
    assert.equal(env.elements.notice.hidden, true);
    await env.edit(0, '123456.SH，测试，2.1*ofr');
    assert.equal(await editor.flushSave(), false); assert.equal(env.elements.retry.disabled, false);
    await env.elements.retry.click();
    assert.equal(writes, 2); assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.sections[0].text, '123456.SH，测试，2.1*ofr');
    assert.equal(env.elements.notice.hidden, true);
  });
});

test('existing online backup keys restore only the signed-in account and archive stale revisions', async () => {
  const storage = new Map([
    ['bond-list-cloud-draft-v1:admin', JSON.stringify({ revision: 0, sections: [{ title: '北京/上海', text: '123456.SH，账户A，2.0*ofr' }] })],
    ['bond-list-cloud-draft-v1:second-user', JSON.stringify({ revision: 0, sections: [{ title: '杭州', text: '654321.SZ，账户B，净价100*bid' }] })]
  ]);
  await fixture({ storage, url: 'https://tempest07.com/bond/' }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await editor.flushSave();
    assert.equal(env.textarea(0).value, '123456.SH，账户A，2.0*ofr');
    assert.equal(env.requests[0].url, '/bond/api/bond-list/state');
    assert.equal(env.elements['save-state'].textContent, '云端已保存');
    assert.equal(storage.has('bond-list-cloud-draft-v1:second-user'), true);
  });
  await fixture({ storage, state: { sections: [{ title: '杭州', text: '' }], revision: 1, userId: 'second-user' } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    assert.equal(env.textarea(0).value, '');
    assert.equal(env.elements['recovery-box'].hidden, false);
    assert.equal(storage.has('bond-list-cloud-draft-v1:second-user'), false);
    assert.equal(JSON.parse(storage.get('bond-list-cloud-recovery-v1:second-user'))[0].sections[0].text, '654321.SZ，账户B，净价100*bid');
    assert.equal(env.requests.filter(request => request.body && request.url.endsWith('/state')).length, 0);
  });
});

test('hidden views pause lookup, and input method composition waits until completed', async () => {
  await fixture({ auto: true, match: true }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await env.edit(0, '26测试，2.0*ofr');
    await editor.setActive(false); await env.advance(1200);
    assert.equal(env.requests.filter(request => request.url.endsWith('/lookup')).length, 0);
    await editor.setActive(true); await env.textarea(0).emit('compositionstart'); await env.advance(1200);
    assert.equal(env.requests.filter(request => request.url.endsWith('/lookup')).length, 0);
    await env.textarea(0).emit('compositionend'); await env.advance(1200);
    assert.equal(env.requests.filter(request => request.url.endsWith('/lookup')).length, 1);
    assert.equal(env.textarea(0).value, '102600001.IB，26测试，2.0*ofr');
    await editor.flushSave();
  });
});

test('flush waits for first load and any restored unsaved backup before permitting exit', async () => {
  const reading = deferred(), writing = deferred();
  const storage = new Map([['bond-list-cloud-draft-v1:admin', JSON.stringify({ revision: 0, sections: [{ title: '北京/上海', text: '123456.SH，恢复报价，2.0*bid' }] })]]);
  await fixture({ storage, fetch: request => request.url.endsWith('/state') ? (request.body ? writing.promise : reading.promise) : null }, async env => {
    const editor = initializeBondList(); const entering = editor.setActive(true);
    let flushed = false;
    const flush = editor.flushSave().then(result => { flushed = true; return result; });
    await settle(); assert.equal(flushed, false);
    reading.resolve(json({ sections: [{ title: '北京/上海', text: '' }], revision: 0, userId: 'admin' }));
    await entering; await settle(); assert.equal(flushed, false);
    assert.equal(env.requests[1].body.sections[0].text, '123456.SH，恢复报价，2.0*bid');
    writing.resolve(json({ revision: 1 })); assert.equal(await flush, true);
    assert.equal(editor.hasPendingChanges(), false);
  });
});

test('reentering a clean module refreshes another device update, but repeating the active view does not', async () => {
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2.0*ofr' }], revision: 0, userId: 'admin' } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    env.state.sections[0].text = '123456.SH，测试，2.2*ofr'; env.state.revision++;
    await editor.setActive(false); await editor.setActive(true);
    assert.equal(env.textarea(0).value, env.state.sections[0].text);
    assert.equal(env.requests.filter(request => !request.body).length, 2);
    await editor.setActive(true);
    assert.equal(env.requests.filter(request => !request.body).length, 2);
    await env.edit(0, '123456.SH，测试，2.3*ofr');
    await editor.flushSave();
    assert.equal(env.requests.at(-1).body.revision, 1);
  });
});

test('a failed refresh retains the current list and its retry reads the server again', async () => {
  let reads = 0;
  await fixture({ fetch: request => !request.body && ++reads === 2 ? json({ error: '网络暂不可用' }, 503) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const area = env.textarea(0);
    await editor.setActive(false); await editor.setActive(true);
    assert.equal(env.textarea(0), area);
    assert.equal(env.elements.retry.hidden, false);
    env.state.sections[0].text = '123456.SH，测试，2.0*bid'; env.state.revision++;
    await env.elements.retry.click();
    assert.equal(reads, 3);
    assert.equal(env.textarea(0).value, env.state.sections[0].text);
    assert.equal(env.elements.retry.hidden, true);
  });
});

test('refresh cannot replace an edit made while its response was pending', async () => {
  const pending = deferred(); let reads = 0;
  await fixture({ fetch: request => !request.body && ++reads === 2 ? pending.promise : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await editor.setActive(false); const entering = editor.setActive(true); await settle();
    await env.edit(0, '123456.SH，刚刚输入，2.5*ofr');
    pending.resolve(json({ sections: [{ title: '北京/上海', text: '' }], revision: 0, userId: 'admin' }));
    await entering;
    assert.equal(env.textarea(0).value, '123456.SH，刚刚输入，2.5*ofr');
    assert.equal(editor.hasPendingChanges(), true);
    assert.equal(await editor.flushSave(), true);
    assert.equal(env.state.sections[0].text, env.textarea(0).value);
  });
});

test('only successful own API responses grant access and 401 revokes it without losing a draft', async () => {
  let unauthorized = true;
  await fixture({ fetch: request => request.body && unauthorized ? json({ error: '请登录' }, 401) : null }, async env => {
    const changes = [];
    const editor = initializeBondList({ onAccessChange: () => changes.push(editor.hasAccess()) });
    assert.equal(editor.hasAccess(), false);
    await editor.setActive(true); assert.deepEqual(changes, [true]);
    await env.edit(0, '123456.SH，测试，2.0*ofr');
    assert.equal(await editor.flushSave(), false);
    assert.equal(editor.hasAccess(), false);
    assert.equal(env.elements['login-link'].hidden, false);
    assert.equal(env.textarea(0).value, '123456.SH，测试，2.0*ofr');
    unauthorized = false; await env.elements.retry.click();
    assert.equal(editor.hasAccess(), true);
    editor.clearAccess(); assert.equal(editor.hasAccess(), false);
    assert.deepEqual(changes, [true, false, true, false]);
  });
});

test('a late refresh failure cannot replace the retry for a newer failed save', async () => {
  const reading = deferred(); let reads = 0, writes = 0;
  await fixture({ fetch: request => {
    if (!request.body) return ++reads === 2 ? reading.promise : null;
    if (request.url.endsWith('/state')) return ++writes === 1 ? json({ error: '保存失败，请重试' }, 503) : null;
    return null;
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await editor.setActive(false); const entering = editor.setActive(true); await settle();
    await env.edit(0, '123456.SH，等待保存，2.6*ofr'); await env.advance(450);
    assert.equal(env.elements.retry.textContent, '重试保存');
    reading.resolve(json({ error: '较早的刷新失败' }, 503)); await entering;
    assert.equal(env.elements.retry.textContent, '重试保存');
    assert.equal(env.elements.notice.textContent, '保存失败，请重试');
    await env.elements.retry.click();
    assert.equal(writes, 2); assert.equal(reads, 2);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.sections[0].text, '123456.SH，等待保存，2.6*ofr');
  });
});

test('a response started before shared logout cannot restore the revoked access marker', async () => {
  const oldRead = deferred(); let reads = 0;
  await fixture({ fetch: request => !request.body && ++reads === 1 ? oldRead.promise : null }, async env => {
    const editor = initializeBondList(); const entering = editor.setActive(true); await settle();
    editor.clearAccess();
    oldRead.resolve(json({ sections: [{ title: '北京/上海', text: '' }], revision: 0, userId: 'admin' }));
    await entering; assert.equal(editor.hasAccess(), false);
    await editor.setActive(false); await editor.setActive(true);
    assert.equal(editor.hasAccess(), true);
  });
});

test('idle flush suspends lookups until a stopped logout explicitly resumes the editor', async () => {
  await fixture({ auto: true, match: true, state: { sections: [{ title: '北京', text: '26测试，2.0*ofr' }], revision: 0, userId: 'admin' } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await editor.flushSave();
    await env.advance(1200);
    assert.equal(env.requests.filter(request => request.url.endsWith('/lookup')).length, 0);
    editor.resume(); await env.advance(1200);
    assert.equal(env.requests.filter(request => request.url.endsWith('/lookup')).length, 1);
    assert.equal(env.textarea(0).value, '102600001.IB，26测试，2.0*ofr');
    await editor.flushSave();
  });
});

test('copy omits empty branches while the downloaded draft preserves all branches, BOM and CRLF', async () => {
  await fixture({ state: { sections: [{ title: '北京', text: ' 123456.SH，测试A，2.0*ofr\n654321.SZ，测试B，净价100*bid ' }, { title: '杭州', text: '' }], revision: 0, userId: 'admin' } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    let copied, blob, anchor, revoked;
    env.document.execCommand = () => { copied = env.document.activeElement.value; return true; };
    await env.elements.copy.click();
    assert.equal(copied, 'OFR/BID\n\n北京\n123456.SH，测试A，2.0*ofr\n654321.SZ，测试B，净价100*bid');
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    const createElement = env.document.createElement;
    env.document.createElement = tag => { const element = createElement(tag); if (tag === 'a') { anchor = element; element.click = () => {}; } return element; };
    try {
      URL.createObjectURL = value => { blob = value; return 'blob:test-draft'; };
      URL.revokeObjectURL = value => { revoked = value; };
      await env.elements.export.click();
      assert.equal(anchor.download, 'OFR-BID-草稿.txt');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
      assert.equal(Buffer.from(bytes).toString('utf8'), '\ufeffOFR/BID\r\n\r\n北京\r\n123456.SH，测试A，2.0*ofr\r\n654321.SZ，测试B，净价100*bid\r\n\r\n杭州\r\n');
      await env.advance(1000); assert.equal(revoked, 'blob:test-draft');
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });
});

test('leaving and immediately returning cannot apply a late lookup to a different bond', async () => {
  const old = deferred(); let lookups = 0;
  await fixture({ auto: true, match: true, state: { sections: [{ title: '北京', text: '26旧券，2.0*ofr' }], revision: 0, userId: 'admin' },
    fetch: request => request.url.endsWith('/lookup') && ++lookups === 1 ? old.promise : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const filling = env.elements.fill.click(); await settle();
    await editor.setActive(false); await editor.setActive(true); await env.edit(0, '26新券，2.2*ofr');
    assert.equal(env.requests.find(request => request.url.endsWith('/lookup')).init.signal.aborted, true);
    old.resolve(json({ results: { '26旧券': { status: 'matched', matches: [{ code: '102600009.IB', market: '银行间' }] } } }));
    await filling;
    assert.equal(env.textarea(0).value, '26新券，2.2*ofr');
    await env.advance(1200);
    assert.equal(lookups, 2);
    assert.equal(env.textarea(0).value, '102600001.IB，26新券，2.2*ofr');
    await editor.flushSave();
  });
});

test('coupon display batches unique full codes and keeps zero, missing values and sending text separate', async () => {
  const codes = Array.from({ length: 41 }, (_, index) => String(600000 + index) + '.SH');
  codes[40] = '256800002.SH';
  const text = [...codes, codes[0]].map((code, index) => code + '，测试' + index + '，2.0*ofr').join('\n');
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 3, userId: 'admin' }, fetch: request => {
    if (!request.url.endsWith('/coupons')) return null;
    return json({ source: 'DM', results: Object.fromEntries([...request.body.codes].reverse().map(code => [code,
      code === codes[1] ? { status: 'missing', couponRate: null }
        : { status: 'matched', couponRate: code === codes[0] ? 0 : 2.504, rateType: '固定利率' }
    ])) });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const preview = env.elements.preview.textContent;
    await env.elements['coupons-refresh'].click();
    assert.deepEqual(env.requests.filter(request => request.url.endsWith('/coupons')).map(request => request.body.codes.length), [20, 20, 1]);
    const values = env.rows().map(row => row.querySelector('.bond-list-coupon-value').textContent);
    assert.equal(values[0], '0.00%'); assert.equal(values[1], '未返回'); assert.equal(values[2], '2.504%'); assert.equal(values[41], '0.00%');
    assert.equal(env.elements.preview.textContent, preview);
    assert.equal(env.textarea(0).value, text);
    assert.equal(env.elements.copy.disabled, false);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.revision, 3);
    assert.equal(env.requests.filter(request => request.body && request.url.endsWith('/state')).length, 0);
  });
});

test('changing a code immediately drops its old coupon row and a late response cannot move the rate to the new bond', async () => {
  const old = deferred(); let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，旧券，2*ofr' }], revision: 0, userId: 'admin' }, fetch: request => {
    if (!request.url.endsWith('/coupons')) return null;
    return ++reads === 1 ? old.promise : json({ results: { '654321.SZ': { status: 'matched', couponRate: 1.7 } } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const reading = env.elements['coupons-refresh'].click(); await settle();
    await env.edit(0, '654321.SZ，新券，2.1*ofr');
    assert.equal(env.resultRow(0).querySelector('.bond-list-result-code').textContent, '654321.SZ');
    old.resolve(json({ results: { '123456.SH': { status: 'matched', couponRate: 9.5 } } })); await reading;
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '待查询');
    await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.70%');
    await env.edit(0, ''); assert.equal(env.rows().length, 0); assert.equal(env.elements['results-empty'].hidden, false);
    assert.equal(await editor.flushSave(), true);
  });
});

test('leaving cancels coupon queries and their late unauthorized response cannot revoke a newer active session', async () => {
  const old = deferred(); let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2*ofr' }], revision: 0, userId: 'admin' }, fetch: request => {
    if (!request.url.endsWith('/coupons')) return null;
    return ++reads === 1 ? old.promise : json({ results: { '123456.SH': { status: 'matched', couponRate: 2.3 } } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const reading = env.elements['coupons-refresh'].click(); await settle();
    await editor.setActive(false);
    assert.equal(env.requests.find(request => request.url.endsWith('/coupons')).init.signal.aborted, true);
    await env.advance(1200); assert.equal(reads, 1);
    await editor.setActive(true); await env.elements['coupons-refresh'].click();
    old.resolve(json({ error: '旧会话已结束' }, 401)); await reading;
    assert.equal(editor.hasAccess(), true);
    assert.equal(env.elements['login-link'].hidden, true);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '2.30%');
  });
});

test('logout flush never waits for coupon metadata and only resume restarts canceled reads', async () => {
  const pending = deferred(); let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2*ofr' }], revision: 0, userId: 'admin' }, fetch: request => {
    if (!request.url.endsWith('/coupons')) return null;
    return ++reads === 1 ? pending.promise : json({ results: { '123456.SH': { status: 'matched', couponRate: 0.3 } } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const reading = env.elements['coupons-refresh'].click(); await settle();
    let flushed = false;
    const flushing = editor.flushSave().then(result => { flushed = true; return result; });
    await settle(); assert.equal(flushed, true); assert.equal(await flushing, true);
    await env.advance(1200); assert.equal(reads, 1);
    pending.resolve(json({ results: { '123456.SH': { status: 'matched', couponRate: 99 } } })); await reading;
    editor.resume(); await env.advance(350);
    assert.equal(reads, 2);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.30%');
  });
});

test('clearing account access removes coupon metadata and ignores an in-flight success', async () => {
  const pending = deferred(); let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2*ofr' }], revision: 0, userId: 'admin' }, fetch: request => {
    if (!request.url.endsWith('/coupons')) return null;
    return ++reads === 1 ? json({ results: { '123456.SH': { status: 'matched', couponRate: 2.5 } } }) : pending.promise;
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '2.50%');
    const reading = env.elements['coupons-refresh'].click(); await settle();
    editor.clearAccess();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '请登录');
    pending.resolve(json({ results: { '123456.SH': { status: 'matched', couponRate: 8 } } })); await reading;
    assert.equal(editor.hasAccess(), false);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '请登录');
  });
});

test('coupon failures remain local to the display and refresh retries without changing quotes or save errors', async () => {
  let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，净价100*ofr' }], revision: 0, userId: 'admin' }, fetch: request => {
    if (!request.url.endsWith('/coupons')) return null;
    return ++reads === 1 ? json({ error: 'DM 暂不可用' }, 502) : json({ results: { '123456.SH': { status: 'matched', couponRate: 2.5, rateType: '浮动利率' } } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    env.elements.notice.textContent = '保存失败，请重试';
    await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '查询失败');
    assert.equal(env.elements.copy.disabled, false);
    assert.equal(env.elements.notice.textContent, '保存失败，请重试');
    await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '2.50%');
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-type').textContent, '浮动');
    assert.equal(env.elements.preview.textContent, 'OFR/BID\n\n北京\n123456.SH，测试，净价100*ofr');
    assert.equal(await editor.flushSave(), true);
  });
});

test('coupon lookup waits for input composition and resumes for newly completed full codes', async () => {
  await fixture({}, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await env.textarea(0).emit('compositionstart');
    await env.edit(0, '123456.SH，测试，2*ofr'); await env.advance(400);
    assert.equal(env.requests.filter(request => request.url.endsWith('/coupons')).length, 0);
    await env.textarea(0).emit('compositionend'); await env.advance(350);
    assert.equal(env.requests.filter(request => request.url.endsWith('/coupons')).length, 1);
    assert.equal(await editor.flushSave(), true);
  });
});

test('combined filters use type OR and cross-field AND, then copy the matching original quotes by branch', async () => {
  const sections = [
    { title: '北京', text: '123456.SH，甲券，1.9*ofr\n654321.SZ，乙券，2.1*bid\n111111.SH，丙券，净价100*ofr' },
    { title: '杭州', text: '123456.SH，甲券，2.0*ofr\n222222.SH，丁券，OFR估值-2*' },
  ];
  const metadata = { '123456.SH': { couponRate: 2.1, bondType: 'MTN' }, '654321.SZ': { couponRate: 2.5, bondType: 'SCP' },
    '111111.SH': { couponRate: 1.5, bondType: 'SCP' }, '222222.SH': { couponRate: 3.2, bondType: '公司债' } };
  await fixture({ state: { sections, revision: 4, userId: 'admin' }, fetch: request => request.url.endsWith('/coupons')
    ? json({ results: Object.fromEntries(request.body.codes.map(code => [code, { status: 'matched', ...metadata[code] }])) }) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.elements['coupons-refresh'].click();
    assert.equal(env.rows().length, 5);
    await env.chooseType('MTN'); await env.chooseType('SCP');
    await env.filter('coupon-op', 'gte'); await env.filter('coupon-min', '2', 'input'); await env.elements['side-ofr'].click();
    assert.equal(env.rows().length, 2);
    assert.match(env.elements['results-counts'].textContent, /符合 2 \/ 共 5 条报价 · 2 个分行/);
    assert.equal(env.elements.copy.textContent, '复制筛选结果（2 条）');
    const expected = 'OFR/BID\n\n北京\n123456.SH，甲券，1.9*ofr\n\n杭州\n123456.SH，甲券，2.0*ofr';
    assert.equal(env.elements['result-preview'].textContent, expected);
    let copied; env.document.execCommand = () => { copied = env.document.activeElement.value; return true; };
    await env.elements.copy.click(); assert.equal(copied, expected);
    assert.deepEqual(env.state.sections, sections); assert.equal(env.state.revision, 4);
    assert.equal(editor.hasPendingChanges(), false);
    await env.elements['filters-clear'].click();
    assert.equal(env.rows().length, 5); assert.equal(env.elements.copy.textContent, '复制发送版');
    assert.equal(env.elements['coupon-min'].disabled, true);
    assert.equal(env.elements['coupon-max-wrap'].hidden, true);
  });
});

test('metadata-dependent filters wait for the whole lookup before enabling copy', async () => {
  const pending = deferred();
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2*ofr' }], revision: 0, userId: 'admin' },
    fetch: request => request.url.endsWith('/coupons') ? pending.promise : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    await env.chooseType('MTN');
    const reading = env.elements['coupons-refresh'].click(); await settle();
    assert.equal(env.elements.copy.disabled, true); assert.equal(env.rows().length, 0);
    pending.resolve(json({ results: { '123456.SH': { status: 'matched', couponRate: 2.5, bondType: 'MTN' } } })); await reading;
    assert.equal(env.rows().length, 1); assert.equal(env.elements.copy.disabled, false);
    assert.equal(editor.hasPendingChanges(), false);
  });
});

test('range inputs enable the upper bound and invalid ranges block copy without hiding save failures', async () => {
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2*ofr' }], revision: 0, userId: 'admin' },
    fetch: request => request.url.endsWith('/coupons') ? json({ results: { '123456.SH': { status: 'matched', couponRate: 2.5, bondType: 'MTN' } } }) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.elements['coupons-refresh'].click();
    env.elements.notice.textContent = '保存失败，请重试';
    await env.filter('coupon-op', 'between');
    assert.equal(env.elements['coupon-max-wrap'].hidden, false); assert.equal(env.elements['coupon-max'].disabled, false);
    await env.filter('coupon-min', '3', 'input'); await env.filter('coupon-max', '2', 'input');
    assert.equal(env.elements['filter-error'].hidden, false); assert.match(env.elements['filter-error'].textContent, /下限不能大于上限/);
    assert.equal(env.elements.copy.disabled, true); assert.equal(env.rows().length, 0);
    assert.equal(env.elements.notice.textContent, '保存失败，请重试');
    await env.filter('coupon-min', '2.5', 'input'); await env.filter('coupon-max', '2.5', 'input');
    assert.equal(env.rows().length, 1); assert.equal(env.elements['filter-error'].hidden, true); assert.equal(env.elements.copy.disabled, false);
  });
});

test('missing-data views distinguish zero coupon, missing coupon and unknown side while preserving all by default', async () => {
  const sections = [{ title: '北京', text: '123456.SH，零息，1.5bid\n654321.SZ，缺票面，2*ofr\n111111.SH，待核对，观望' }];
  await fixture({ state: { sections, revision: 0, userId: 'admin' }, fetch: request => request.url.endsWith('/coupons') ? json({ results: {
    '123456.SH': { status: 'matched', couponRate: 0, bondType: '公司债' },
    '654321.SZ': { status: 'missing', couponRate: null, bondType: 'MTN' },
    '111111.SH': { status: 'missing', couponRate: null, bondType: '未知' },
  } }) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.elements['coupons-refresh'].click();
    assert.equal(env.rows().length, 3); assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.00%');
    await env.filter('missing', 'coupon'); assert.equal(env.rows().length, 2);
    await env.filter('missing', 'type'); assert.equal(env.rows().length, 1);
    await env.filter('missing', 'side'); assert.equal(env.rows().length, 1);
    assert.equal(env.resultRow(0).querySelector('.bond-list-result-code').textContent, '111111.SH');
    await env.elements['filters-clear'].click(); await env.filter('coupon-op', 'gte'); await env.filter('coupon-min', '0', 'input');
    assert.equal(env.rows().length, 1);
    assert.equal(env.resultRow(0).querySelector('.bond-list-result-code').textContent, '123456.SH');
  });
});

test('valuation hints show institution, coupon proximity and the requested warning direction without editing quotes', async () => {
  const text = '102600001.IB，26测试MTN001，1.50*ofr\n102600001.IB，26测试MTN001，1.60*ofr\n123456.SH，26测试01，净价100*ofr';
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 8, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return json({ source: 'DM', fetchedAt: '2026-10-22T01:00:00Z', results: {
      '102600001.IB': { status: 'matched', couponRate: 1.54, bondType: 'MTN' },
      '123456.SH': { status: 'matched', couponRate: 2, bondType: '公司债' },
    } });
    if (request.url.endsWith('/valuations')) return json({ source: 'DM', fetchedAt: '2026-10-22T01:00:00Z', results: {
      '102600001.IB': { status: 'matched', institution: '中债', yield: 1.51, netPrice: 100.1, basis: '到期', date: '2026-10-21' },
      '123456.SH': { status: 'matched', institution: '中证', yield: 2.02, netPrice: 100.25, basis: '行权', date: '2026-10-21' },
    } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.equal(env.rows().length, 3);
    assert.match(env.resultRow(0).children[2].querySelector('.bond-list-comparison-badge').title, /3bp/);
    assert.equal(env.resultRow(0).querySelector('.warning'), null);
    assert.match(env.resultRow(0).children[3].querySelector('.bond-list-valuation-meta').textContent, /中债.*到期.*10-21/);
    assert.equal(env.resultRow(1).querySelector('.warning').textContent, '高于估值 +9bp');
    assert.match(env.resultRow(2).querySelector('.warning').textContent, /净价低于估值 -0\.25/);
    assert.match(env.resultRow(2).children[3].querySelector('.bond-list-valuation-meta').textContent, /中证.*行权/);
    assert.equal(env.state.sections[0].text, text); assert.equal(env.state.revision, 8);
    assert.equal(env.elements['result-preview'].textContent, 'OFR/BID\n\n北京\n' + text);
    assert.equal(env.requests.filter(request => request.url.endsWith('/state') && request.body).length, 0);
  });
});

test('a failed valuation cannot turn into zero, erase coupon data or prevent copying valid filtered quotes', async () => {
  await fixture({ state: { sections: [{ title: '北京', text: '102600001.IB，测试，1.60*ofr' }], revision: 1, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return json({ source: 'DM', results: { '102600001.IB': { status: 'matched', couponRate: 1.54, bondType: 'MTN' } } });
    if (request.url.endsWith('/valuations')) return json({ error: '暂时失败' }, 502);
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).children[2].children[0].textContent, '1.54%');
    assert.equal(env.resultRow(0).children[3].children[0].textContent, '查询失败');
    assert.equal(env.resultRow(0).querySelector('.warning'), null);
    await env.filter('coupon-op', 'gte'); await env.filter('coupon-min', '1.5', 'input');
    assert.equal(env.rows().length, 1); assert.equal(env.elements.copy.disabled, false);
    assert.equal(env.state.revision, 1);
  });
});

test('valuation access rejection is visible without asserting the service is unsubscribed; coupon and copy remain available', async () => {
  await fixture({ state: { sections: [{ title: '北京', text: '102600001.IB，测试，1.60*ofr' }], revision: 1, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return json({ source: 'DM', results: { '102600001.IB': { status: 'matched', couponRate: 1.54, bondType: 'MTN' } } });
    if (request.url.endsWith('/valuations')) return json({ code: 'dm_valuation_access_denied', error: 'DM 当前估值请求被拒绝。' }, 503);
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).children[2].children[0].textContent, '1.54%');
    assert.equal(env.resultRow(0).children[3].children[0].textContent, '权限待核对');
    assert.match(env.elements['metadata-status'].textContent, /估值接口权限待核对/);
    assert.match(env.resultRow(0).children[3].children[0].title, /GW-000-4006/);
    assert.equal(env.resultRow(0).querySelector('.warning'), null);
    assert.equal(env.elements.copy.disabled, false);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.revision, 1);
  });
});

test('QB valuation fallback shows the actual provider and institution without modifying the quote', async () => {
  const text = '102600001.IB，测试，1.60*ofr';
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 7, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return json({ source: 'DM', results: { '102600001.IB': { status: 'matched', couponRate: 1.54, bondType: 'MTN' } } });
    if (request.url.endsWith('/valuations')) return json({ source: 'QB', fetchedAt: '2026-10-22T01:00:00Z', results: {
      '102600001.IB': { status: 'matched', provider: 'QB', institution: '中债', yield: 1.51, netPrice: 100.1, basis: '到期', date: '2026-10-21' },
    } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.match(env.elements['metadata-status'].textContent, /^DM\+QB/);
    const source = env.resultRow(0).children[3].querySelector('.bond-list-valuation-meta');
    assert.match(source.textContent, /^QB \/ 中债/);
    assert.match(source.title, /QB 查询于/);
    assert.equal(env.resultRow(0).querySelector('.warning').textContent, '高于估值 +9bp');
    assert.equal(env.elements['result-preview'].textContent, 'OFR/BID\n\n北京\n' + text);
    assert.equal(env.state.revision, 7);
    assert.equal(editor.hasPendingChanges(), false);
  });
});

test('a failed refresh preserves earlier verified data with its provider and actual valuation date', async () => {
  let fail = false;
  await fixture({ state: { sections: [{ title: '北京', text: '102600001.IB，测试，1.60*ofr' }], revision: 4, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return fail ? json({ error: '两源暂不可用' }, 502) : json({ source: 'DM', results: { '102600001.IB': { status: 'matched', couponRate: 1.54, bondType: 'MTN' } } });
    if (request.url.endsWith('/valuations')) return fail ? json({ source: 'QB', results: { '102600001.IB': { status: 'missing' } } }) : json({ source: 'QB', fetchedAt: '2026-10-22T01:00:00Z', results: {
      '102600001.IB': { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-21' },
    } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    fail = true; await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    const source = env.resultRow(0).children[3].querySelector('.bond-list-valuation-meta');
    assert.match(source.textContent, /^QB \/ 中债.*10-21/);
    assert.match(source.title, /保留上次资料/);
    assert.match(env.elements['metadata-status'].textContent, /保留上次资料/);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.revision, 4);
  });
});

test('switching editor tabs preserves filters and draft, with keyboard tab navigation', async () => {
  await fixture({ state: { sections: [{ title: '北京', text: '123456.SH，测试，2*ofr' }], revision: 0, userId: 'admin' } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    assert.equal(env.elements['results-panel'].hidden, false); assert.equal(env.elements['editor-panel'].hidden, true);
    await env.elements['side-ofr'].click(); await env.elements['tab-editor'].click();
    assert.equal(env.elements['results-panel'].hidden, true); assert.equal(env.elements['editor-panel'].hidden, false);
    assert.equal(env.elements['tab-editor'].attributes['aria-selected'], 'true');
    let prevented = false;
    await env.elements['tab-editor'].emit('keydown', { key: 'ArrowLeft', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); assert.equal(env.elements['results-panel'].hidden, false);
    assert.equal(env.document.activeElement, env.elements['tab-results']);
    assert.match(env.elements.copy.textContent, /筛选结果/);
    assert.equal(env.elements['side-ofr'].attributes['aria-pressed'], 'true');
    assert.equal(editor.hasPendingChanges(), false); assert.equal(env.state.revision, 0);
  });
});

test('source reset clears metadata, rejects old responses and preserves draft, filter and save revision', async () => {
  const oldCoupons = deferred(), oldValuations = deferred();
  let provider = 'DM', hold = false;
  const text = '102600001.IB，测试，1.60*ofr';
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 9, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return hold && provider === 'DM' ? oldCoupons.promise : json({ source: provider, results: {
      '102600001.IB': { status: 'matched', couponRate: provider === 'QB' ? 2.03 : 1.54, bondType: 'MTN' },
    } });
    if (request.url.endsWith('/valuations')) return hold && provider === 'DM' ? oldValuations.promise : json({ source: provider, fetchedAt: '2026-10-23T01:00:00Z', results: {
      '102600001.IB': { status: 'matched', institution: '中债', yield: provider === 'QB' ? 2.01 : 1.51, basis: '到期', date: '2026-10-22' },
    } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    await env.chooseType('MTN');
    await env.edit(0, '102600001.IB，测试，1.70*ofr');
    hold = true;
    const oldRefresh = env.elements['coupons-refresh'].click(); await settle();
    const oldRequests = env.requests.slice(-2);
    provider = 'QB'; editor.resetDataSource();
    assert.ok(oldRequests.every(request => request.init.signal.aborted));
    assert.equal(env.textarea(0).value, '102600001.IB，测试，1.70*ofr');
    assert.equal(editor.hasPendingChanges(), true);
    assert.equal(env.rows().length, 0);
    await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '2.03%');
    assert.match(env.elements['metadata-status'].textContent, /^QB/);
    oldCoupons.resolve(json({ source: 'DM', results: { '102600001.IB': { status: 'matched', couponRate: 1.54, bondType: 'MTN' } } }));
    oldValuations.resolve(json({ source: 'DM', results: { '102600001.IB': { status: 'matched', yield: 1.51 } } }));
    await oldRefresh;
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '2.03%');
    assert.equal(env.resultRow(0).children[3].querySelector('.bond-list-valuation-value').textContent, '2.01%');
    assert.equal(env.state.revision, 9);
    assert.equal(env.requests.filter(request => request.url.endsWith('/state')).length, 1);
    assert.equal(editor.hasPendingChanges(), true);
  });
});

test('an old source lookup cannot insert codes or clear the new lookup busy state', async () => {
  const old = deferred(), next = deferred(); let calls = 0;
  await fixture({ state: { sections: [{ title: '北京', text: '26测试，1.60*ofr' }], revision: 5, userId: 'admin' },
    fetch: request => request.url.endsWith('/lookup') ? (++calls === 1 ? old.promise : next.promise) : null }, async env => {
    const editor = initializeBondList(); await editor.setActive(true);
    const first = env.elements.fill.click(); await settle();
    editor.resetDataSource();
    const second = env.elements.fill.click(); await settle();
    old.resolve(json({ source: 'DM', results: { '26测试': { status: 'matched', matches: [{ code: '102600001.IB' }] } } }));
    await first;
    assert.equal(env.textarea(0).value, '26测试，1.60*ofr');
    assert.equal(env.elements.fill.disabled, true);
    next.resolve(json({ source: 'QB', results: { '26测试': { status: 'matched', matches: [{ code: '102600002.IB' }] } } }));
    await second;
    assert.equal(env.textarea(0).value, '102600002.IB，26测试，1.60*ofr');
    assert.equal(env.elements.fill.textContent, '补齐代码');
    assert.equal(env.state.revision, 5);
  });
});

test('source reset clears failed name suppression while keeping an existing save conflict intact', async () => {
  let lookups = 0;
  await fixture({ auto: true, state: { sections: [{ title: '北京', text: '26测试，1.60*ofr' }], revision: 3, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/lookup')) { lookups++; return json({ results: { '26测试': { status: 'missing', matches: [] } } }); }
    if (request.url.endsWith('/state') && request.body) return json({ error: '保存冲突，请导出' }, 409);
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(1200);
    assert.equal(lookups, 1);
    editor.resetDataSource(); await env.advance(1200);
    assert.equal(lookups, 2);
    await env.edit(0, '26测试，1.70*ofr');
    assert.equal(await editor.flushSave(), false);
    editor.resetDataSource();
    assert.equal(env.textarea(0).value, '26测试，1.70*ofr');
    assert.equal(env.elements.retry.disabled, true);
    assert.equal(editor.hasPendingChanges(), true);
    assert.equal(await editor.flushSave(), false);
    assert.equal(env.state.revision, 3);
  });
});
