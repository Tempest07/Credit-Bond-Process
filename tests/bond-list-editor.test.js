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
    this.tagName = tag; this.owner = owner; this.children = []; this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
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
  const globals = ['document', 'window', 'location', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'Date'];
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
  const RealDate = Date;
  let wallTime = options.now === undefined ? RealDate.now() : new RealDate(options.now).getTime();
  const listeners = {};
  document.addEventListener = (name, callback) => { (listeners[name] ||= []).push(callback); };
  const values = {
    Date: class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [wallTime])); }
      static now() { return wallTime; }
    },
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
      wallTime += duration;
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
    assert.equal(values[0], '0.00%（待确认）'); assert.equal(values[1], '未返回'); assert.equal(values[2], '2.504%'); assert.equal(values[41], '0.00%（待确认）');
    assert.equal(env.elements.preview.textContent, preview);
    assert.equal(env.textarea(0).value, text);
    assert.equal(env.elements.copy.disabled, false);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.revision, 3);
    assert.equal(env.requests.filter(request => request.body && request.url.endsWith('/state')).length, 0);
  });
});

test('successful static fields are reused and valuations refresh once per Beijing calendar day', async () => {
  const code = '102600001.IB';
  await fixture({ now: '2026-10-23T15:59:00Z',
    state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 3, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      return json({ source: 'QB', fetchedAt: new Date().toISOString(), results: { [code]: {
        ...(request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
          : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-22' }),
        checkedAt: new Date().toISOString(),
      } } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    const reads = path => env.requests.filter(request => request.url.endsWith('/' + path));
    assert.equal(reads('coupons').length, 1); assert.equal(reads('valuations').length, 1);
    await editor.setActive(false); await editor.setActive(true); await env.advance(350);
    await env.elements['coupons-refresh'].click();
    assert.equal(reads('coupons').length, 1); assert.equal(reads('valuations').length, 1);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    await env.advance(60000); // 00:00 Beijing while the UTC calendar day is unchanged.
    await editor.setActive(false); await editor.setActive(true); await env.advance(350);
    assert.equal(reads('coupons').length, 1); assert.equal(reads('valuations').length, 2);
    await env.elements['coupons-refresh'].click();
    assert.equal(reads('valuations').length, 2);
    assert.equal([...env.storage.keys()].some(key => /coupon|valuation|metadata/i.test(key)), false);
  });
});

test('partial static fields retry on manual refresh or reentry without losing cached coupons or looping', async () => {
  const code = '102600001.IB';
  for (const missing of ['name', 'bondType', 'rateType']) {
    for (const refresh of ['manual', 'reentry']) {
      let reads = 0;
      const text = `${code}，测试，1.60*ofr`;
      await fixture({ now: '2026-10-24T02:00:00Z',
        state: { sections: [{ title: '北京', text }], revision: 3, userId: 'admin' },
        fetch(request) {
          if (request.url.endsWith('/valuations')) return json({ source: 'QB', results: { [code]: {
            status: 'matched', yield: 1.6, institution: '中债', basis: '到期', date: '2026-10-23', checkedAt: new Date().toISOString(),
          } } });
          if (!request.url.endsWith('/coupons')) return;
          reads++;
          const result = { status: 'matched', couponRate: reads === 1 ? 1.54 : 9, name: '26测试MTN001', bondType: '其他', rateType: '固定利率', attributes: [], typeDescription: '' };
          if (reads === 1) result[missing] = missing === 'bondType' ? '未知' : '';
          return json({ source: reads === 1 ? 'DM' : 'QB', fetchedAt: reads === 1 ? '2026-10-23T01:00:00Z' : '2026-10-24T02:00:00Z', results: { [code]: result } });
        },
      }, async env => {
        const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
        await env.advance(5000); assert.equal(reads, 1, 'partial success must not start a retry loop');
        if (refresh === 'manual') await env.elements['coupons-refresh'].click();
        else { await editor.setActive(false); await editor.setActive(true); await env.advance(350); }
        assert.equal(reads, 2, `${missing}: ${refresh}`);
        const row = env.resultRow(0), coupon = row.querySelector('.bond-list-coupon-value');
        assert.equal(coupon.textContent, '1.54%', 'known positive coupon must survive a different returned coupon');
        assert.match(coupon.title, /DM 查询于/, 'retained coupon must not be attributed to QB');
        assert.match(coupon.title, /2026\/10\/23|2026-10-23/);
        assert.equal(row.children[1].children[0].textContent, '其他');
        assert.match(coupon.title, /固定利率/);
        await env.elements['coupons-refresh'].click();
        await editor.setActive(false); await editor.setActive(true); await env.advance(350);
        assert.equal(reads, 2, 'complete data with empty optional attributes stays cached');
        assert.equal(env.textarea(0).value, text);
        assert.equal(env.state.revision, 3);
        assert.equal(env.requests.filter(request => request.url.endsWith('/state') && request.body).length, 0);
      });
    }
  }
});

test('metadata-only responses fill missing fields without erasing known names, types or coupons', async () => {
  const code = '102600001.IB'; let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons')) return;
      reads++;
      return json({ source: 'DM', results: { [code]: reads === 1
        ? { status: 'matched', couponRate: 1.54, name: '26测试MTN001', bondType: 'MTN', rateType: '' }
        : { status: 'missing', reason: 'coupon_unavailable', couponRate: null, name: '', bondType: '未知', rateType: '固定利率' },
      } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    await env.elements['coupons-refresh'].click();
    assert.equal(reads, 2);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    assert.equal(env.resultRow(0).children[1].children[0].textContent, 'MTN');
    assert.match(env.resultRow(0).querySelector('.bond-list-coupon-value').title, /固定利率/);
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 2);
  });
});

test('partial static metadata respects a retained-value rate-limit cooldown and recovers on manual retry', async () => {
  const code = '102600001.IB'; let reads = 0;
  await fixture({ now: '2026-10-24T02:00:00Z',
    state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons')) return;
      reads++;
      return json({ source: 'DM', ...(reads === 2 ? { rateLimited: true, retryAfter: 8 } : {}), results: { [code]: {
        status: 'matched', couponRate: 1.54, name: '26测试MTN001', bondType: 'MTN', rateType: reads >= 3 ? '固定利率' : '',
        ...(reads === 2 ? { refreshFailed: true, reason: 'rate_limited', nextCheckAt: new Date(Date.now() + 8000).toISOString() } : { refreshFailed: false }),
      } } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 2);
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 2);
    await env.advance(8000); assert.equal(reads, 2, 'no automatic retry at cooldown expiry');
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 3);
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 3, 'successful supplement clears prior failure flags');
    assert.match(env.resultRow(0).querySelector('.bond-list-coupon-value').title, /固定利率/);
  });
});

test('classification-first metadata survives a failed attempt and is combined with a later coupon', async () => {
  const code = '102600001.IB'; let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons')) return;
      reads++;
      if (reads === 2) return json({ error: 'failed' }, 502);
      return json({ source: 'DM', results: { [code]: reads === 1
        ? { status: 'missing', reason: 'coupon_unavailable', couponRate: null, name: '26测试MTN001', bondType: 'MTN', rateType: '固定利率' }
        : { status: 'matched', couponRate: 1.54, name: '', bondType: '未知', rateType: '' },
      } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).children[1].children[0].textContent, 'MTN');
    await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    assert.match(env.resultRow(0).querySelector('.bond-list-coupon-value').title, /固定利率/);
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 3);
  });
});

test('zero coupons require an explicit session confirmation before screening or comparison', async () => {
  const code = '102600001.IB'; let mode = 'dm', reads = 0;
  await fixture({ now: '2026-10-24T02:00:00Z',
    state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 3, userId: 'admin' },
    fetch(request) {
      if (request.url.endsWith('/coupons')) { reads++; return json({ source: 'DM', fetchedAt: '2026-10-23T01:00:00Z', results: { [code]: {
        status: 'matched', couponRate: 0, name: '26测试MTN001', bondType: 'MTN', rateType: '零息',
      } } }); }
      if (request.url.endsWith('/valuations')) return json({ source: 'DM', fetchedAt: new Date().toISOString(), results: { [code]: {
        status: 'matched', yield: 0.03, institution: '中债', basis: '到期', date: '2026-10-23', checkedAt: new Date().toISOString(),
      } } });
    },
  }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => mode }); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.00%（待确认）');
    assert.equal(env.resultRow(0).querySelector('.near'), null);
    await env.filter('coupon-min', '0', 'input'); await env.filter('coupon-op', 'lte');
    assert.equal(env.rows().length, 0, 'unconfirmed zero is excluded from numeric coupon screening');
    await env.filter('coupon-op', 'any'); await env.filter('missing', 'coupon');
    assert.equal(env.rows().length, 1, 'unconfirmed zero participates in missing-coupon review');
    const before = env.requests.length;
    await env.resultRow(0).querySelector('.bond-list-zero-confirm').click();
    assert.equal(env.requests.length, before, 'confirmation must not write business state or shared metadata');
    await env.filter('missing', 'all');
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.00%');
    assert.ok(env.resultRow(0).querySelector('.near'));
    await env.filter('coupon-op', 'lte'); assert.equal(env.rows().length, 1);
    await env.filter('coupon-op', 'any');
    await editor.setActive(false); await editor.setActive(true); await env.advance(350);
    assert.equal(reads, 1, 'ordinary navigation retains the current-page confirmation');
    mode = 'qb'; editor.resetDataSource(); await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.00%（待确认）');
    await env.resultRow(0).querySelector('.bond-list-zero-confirm').click();
    editor.clearAccess(); await editor.setActive(false); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.00%（待确认）');
    assert.equal(env.state.revision, 3);
    assert.equal(env.requests.filter(request => request.body && request.url.endsWith('/state')).length, 0);
    assert.ok(env.requests.filter(request => request.body?.codes).every(request => !JSON.stringify(request.body).includes('confirm')));
  });
});

test('an unconfirmed zero can be corrected by a later positive coupon without confirmation', async () => {
  const code = '102600001.IB'; let reads = 0;
  await fixture({ state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons')) return;
      reads++;
      return json({ source: 'DM', results: { [code]: { status: 'matched', couponRate: reads === 1 ? 0 : 1.54,
        name: '26测试MTN001', bondType: 'MTN', rateType: '固定利率' } } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    await env.elements['coupons-refresh'].click();
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    assert.equal(env.resultRow(0).querySelector('.bond-list-zero-confirm'), null);
    await env.elements['coupons-refresh'].click(); assert.equal(reads, 2);
  });
});

test('staying on the page across Beijing midnight lets a newly-added quote also refresh old valuations', async () => {
  const first = '102600001.IB', added = '102600002.IB';
  await fixture({ now: '2026-10-23T15:59:00Z',
    state: { sections: [{ title: '北京', text: `${first}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      return json({ source: 'QB', fetchedAt: new Date().toISOString(), results: Object.fromEntries(request.body.codes.map(code => [code,
        request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
          : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-22' },
      ])) });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    await env.advance(60000);
    await env.edit(0, `${first}，测试，1.60*ofr\n${added}，新券，1.70*ofr`); await env.advance(350);
    assert.deepEqual(env.requests.filter(request => request.url.endsWith('/coupons')).map(request => request.body.codes), [[first], [added]]);
    assert.deepEqual(env.requests.filter(request => request.url.endsWith('/valuations')).map(request => request.body.codes), [[first], [first, added]]);
    await env.advance(20000);
    assert.equal(env.requests.filter(request => request.body?.codes).length, 4);
  });
});

test('same-day cloud hits use each value successful check time instead of the valuation date or envelope time', async () => {
  const code = '102600001.IB';
  await fixture({ now: '2026-10-24T02:00:00Z',
    state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 3, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      return json({ source: 'QB', fetchedAt: '2026-10-23T01:00:00Z', results: { [code]: {
        ...(request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
          : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-22' }),
        checkedAt: '2026-10-23T17:00:00Z', fetchedAt: '2026-10-23T17:00:00Z', cached: true,
      } } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    const before = env.requests.filter(request => request.body?.codes).length;
    await editor.setActive(false); await editor.setActive(true); await env.advance(350);
    await env.elements['coupons-refresh'].click();
    assert.equal(env.requests.filter(request => request.body?.codes).length, before);
    assert.match(env.resultRow(0).querySelector('.bond-list-valuation-meta').title, /查询于/);
  });
});

test('adding a quote queries only new codes and failures retry on the next external refresh without a timer loop', async () => {
  const first = '102600001.IB', added = '102600002.IB'; let failed = true;
  await fixture({ now: '2026-10-24T02:00:00Z',
    state: { sections: [{ title: '北京', text: `${first}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      return json({ source: 'QB', fetchedAt: new Date().toISOString(), results: Object.fromEntries(request.body.codes.map(code => [code,
        failed && code === added ? { status: 'missing', reason: 'not_found' }
          : request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
            : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-23' },
      ])) });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    await env.edit(0, `${first}，测试，1.60*ofr\n${added}，新券，1.70*ofr`); await env.advance(350);
    const requests = () => env.requests.filter(request => request.body?.codes);
    assert.deepEqual(requests().slice(2).map(request => request.body.codes), [[added], [added]]);
    await env.advance(20000); assert.equal(requests().length, 4);
    failed = false; await env.elements['coupons-refresh'].click();
    assert.deepEqual(requests().slice(4).map(request => request.body.codes), [[added], [added]]);
    await env.advance(20000); assert.equal(requests().length, 6);
    await editor.setActive(false); await editor.setActive(true); await env.advance(350);
    assert.equal(requests().length, 6);
  });
});

test('cloud refresh leases remain pending until an external retry and never become successful daily checks', async () => {
  const code = '102600001.IB'; let pending = true;
  await fixture({ now: '2026-10-24T02:00:00Z',
    state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      return json({ source: 'QB', fetchedAt: new Date().toISOString(), results: { [code]: pending
        ? { status: 'loading', refreshStatus: 'loading', nextCheckAt: '2026-10-24T02:01:00Z' }
        : request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
          : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-23' },
      } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '查询中…');
    await env.advance(20000); assert.equal(env.requests.filter(request => request.body?.codes).length, 2);
    pending = false; await env.elements['coupons-refresh'].click();
    assert.equal(env.requests.filter(request => request.body?.codes).length, 4);
    await env.elements['coupons-refresh'].click();
    assert.equal(env.requests.filter(request => request.body?.codes).length, 4);
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
    assert.equal(env.rows().length, 3); assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '0.00%（待确认）');
    await env.resultRow(0).querySelector('.bond-list-zero-confirm').click();
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

test('gradient rows respect the lower 10 bp boundary, count both directions and preserve saved quote text', async () => {
  const gaps = [0.07, 1, 10, 30, -9.99, -10, -20];
  const text = gaps.map(bp => `102600001.IB，26测试MTN001，${(1.6 + bp / 100).toFixed(4)}*ofr`).join('\n');
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 17, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons')) return json({ source: 'QB', results: {
      '102600001.IB': { status: 'matched', couponRate: 1.6, bondType: 'MTN' },
    } });
    if (request.url.endsWith('/valuations')) return json({ source: 'QB', results: {
      '102600001.IB': { status: 'matched', institution: '中债', yield: 1.6, netPrice: 100, basis: '到期', date: '2026-10-22' },
    } });
  } }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    const progress = index => parseFloat(env.resultRow(index).style['--quote-color-progress']);
    for (let index = 0; index < 4; index++) {
      assert.equal(env.resultRow(index).dataset.valuationTone, 'above');
      if (index) assert.ok(progress(index) > progress(index - 1));
    }
    assert.equal(env.resultRow(4).querySelector('.warning'), null);
    assert.equal(env.resultRow(4).className.includes('bond-list-quote-warning'), false);
    assert.equal(env.resultRow(4).style['--quote-row-weight'], undefined);
    assert.equal(env.resultRow(5).querySelector('.warning').textContent, '低于估值 -10bp');
    assert.match(env.resultRow(5).querySelector('.warning').title, /低于 10bp 起提示/);
    assert.equal(env.resultRow(5).dataset.valuationTone, 'below');
    assert.equal(env.resultRow(6).dataset.valuationTone, 'below');
    assert.ok(progress(6) > progress(5));
    assert.match(env.elements['results-counts'].textContent, /6 条报价提示/);
    assert.match(env.elements['results-counts'].textContent, /7 条票面接近估值/);
    assert.equal(env.elements['result-preview'].textContent, 'OFR/BID\n\n北京\n' + text);
    assert.equal(env.state.sections[0].text, text);
    assert.equal(env.state.revision, 17);
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
    assert.equal(env.elements['metadata-status'].textContent, '');
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
      '102600001.IB': { status: 'matched', couponRate: provider === 'QB' ? 2.03 : 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' },
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
    const previousReads = env.requests.length;
    const oldRefresh = env.elements['coupons-refresh'].click(); await settle();
    const oldRequests = env.requests.slice(previousReads);
    assert.equal(oldRequests.length, 1); // The successful static coupon no longer needs refreshing.
    provider = 'QB'; editor.resetDataSource();
    assert.ok(oldRequests.every(request => request.init.signal.aborted));
    assert.equal(env.textarea(0).value, '102600001.IB，测试，1.70*ofr');
    assert.equal(editor.hasPendingChanges(), true);
    assert.equal(env.rows().length, 0);
    await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '2.03%');
    assert.equal(env.elements['metadata-status'].textContent, '');
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

test('empty, loading and failed metadata use neutral business status for every request mode', async () => {
  for (const selectedMode of ['qb', 'dm', 'auto']) {
    const response = deferred();
    await fixture({ state: { sections: [{ title: '北京', text: '102600001.IB，测试，1.60*ofr' }], revision: 6, userId: 'admin' }, fetch(request) {
      if (request.url.endsWith('/coupons') || request.url.endsWith('/valuations')) return response.promise;
    } }, async env => {
      const editor = initializeBondList({ getDataSourceMode: () => selectedMode });
      await editor.setActive(true);
      assert.equal(env.elements['metadata-status'].textContent, '1 条资料读取中');
      await env.advance(350);
      assert.match(env.elements['metadata-status'].textContent, /资料读取中/);
      assert.doesNotMatch(env.elements['metadata-status'].textContent, /DM|QB|自动/);
      response.resolve(json({ error: '上游暂不可用' }, 502)); await settle(); await settle();
      assert.doesNotMatch(env.elements['metadata-status'].textContent, /DM|QB|自动/);
      assert.match(env.elements['metadata-status'].textContent, /1 条查询失败/);
      assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '查询失败');
      assert.equal(env.state.revision, 6);
    });
  }
});

test('switching mode preserves neutral failure, loading and missing-data status', async () => {
  let selectedMode = 'dm', fail = true;
  await fixture({ state: { sections: [{ title: '北京', text: '102600001.IB，测试，1.60*ofr' }], revision: 6, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/coupons') || request.url.endsWith('/valuations')) return fail
      ? json({ error: '暂不可用' }, 502)
      : json({ source: 'DM', results: { '102600001.IB': { status: 'missing' } } });
  } }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => selectedMode });
    await editor.setActive(true); await env.advance(350);
    assert.equal(env.elements['metadata-status'].textContent, '1 条查询失败');
    selectedMode = 'qb'; editor.resetDataSource();
    assert.equal(env.elements['metadata-status'].textContent, '1 条资料读取中');
    await env.advance(350);
    assert.equal(env.elements['metadata-status'].textContent, '1 条查询失败');
    fail = false; await env.elements['coupons-refresh'].click();
    assert.match(env.elements['metadata-status'].textContent, /票面缺失 1/);
    assert.match(env.elements['metadata-status'].textContent, /估值缺失 1/);
    assert.doesNotMatch(env.elements['metadata-status'].textContent, /DM|QB|自动/);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.revision, 6);
  });
});

test('a QB refresh failure keeps successful DM data labelled DM with its original date', async () => {
  let selectedMode = 'dm', fail = false;
  await fixture({ state: { sections: [{ title: '北京', text: '102600001.IB，测试，1.60*ofr' }], revision: 6, userId: 'admin' }, fetch(request) {
    if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
    if (fail) return json({ error: 'QB 暂不可用' }, 502);
    return json({ source: 'DM', fetchedAt: '2026-10-22T01:00:00Z', results: { '102600001.IB': request.url.endsWith('/coupons')
      ? { status: 'matched', couponRate: 1.54, bondType: 'MTN' }
      : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-21' } } });
  } }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => selectedMode });
    await editor.setActive(true); await env.advance(350);
    selectedMode = 'qb'; fail = true; await env.elements['coupons-refresh'].click();
    assert.match(env.elements['metadata-status'].textContent, /^1 条刷新未完成，保留上次资料/);
    const valuation = env.resultRow(0).querySelector('.bond-list-valuation-meta');
    assert.match(valuation.textContent, /^中债.*10-21/);
    assert.match(valuation.title, /2026-10-21 · DM 查询于/);
    assert.match(valuation.title, /保留上次资料/);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.state.revision, 6);
  });
});

test('QB throttling stops the remaining metadata batches and leaves skipped quotes incomplete until manual retry', async () => {
  const codes = Array.from({ length: 49 }, (_, index) => `${102600001 + index}.IB`);
  const text = codes.map(code => `${code}，测试，1.60*ofr`).join('\n');
  let limited = true;
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 6, userId: 'admin' }, fetch(request) {
    if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
    if (limited && request.url.endsWith('/coupons')) return json({ error: 'upstream failure', code: 'qb_rate_limited', retryAfter: 30 }, 429);
    return json({ source: 'QB', fetchedAt: '2026-10-23T01:00:00Z', results: Object.fromEntries(request.body.codes.map(code => [code,
      request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
        : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-22' }])) });
  } }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => 'qb' });
    await editor.setActive(true); await env.advance(350);
    const requests = () => env.requests.filter(request => request.url.endsWith('/coupons') || request.url.endsWith('/valuations'));
    assert.equal(requests().length, 2);
    assert.ok(requests().every(request => request.body.codes.length === 20));
    assert.equal(env.elements.notice.textContent, '查询过于频繁，请稍后重试。建议至少等待 30 秒后手动刷新。');
    assert.equal(env.elements.notice.hidden, false);
    assert.match(env.elements['metadata-status'].textContent, /^20 条查询失败 · 29 条未完成/);
    assert.doesNotMatch(env.elements['metadata-status'].textContent, /票面缺失|估值缺失/);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '查询失败');
    assert.equal(env.resultRow(20).querySelector('.bond-list-coupon-value').textContent, '未完成');
    assert.equal(env.resultRow(48).querySelector('.bond-list-valuation-value').textContent, '未完成');
    assert.equal(env.elements.copy.disabled, false);
    assert.equal(env.elements['coupons-refresh'].disabled, false);
    await env.advance(60000); assert.equal(requests().length, 2);
    limited = false; await env.elements['coupons-refresh'].click();
    assert.equal(requests().length, 8);
    assert.equal(env.elements.notice.hidden, true);
    assert.equal(env.resultRow(48).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    assert.equal(env.resultRow(48).querySelector('.bond-list-valuation-value').textContent, '1.51%');
    assert.equal(env.state.sections[0].text, text); assert.equal(env.state.revision, 6);
    assert.equal(editor.hasPendingChanges(), false);
    assert.equal(env.requests.filter(request => request.url.endsWith('/state') && request.body).length, 0);
  });
});

test('a rate-limited refresh preserves all previous providers, values and valuation dates while stopping later batches', async () => {
  const codes = Array.from({ length: 49 }, (_, index) => `${102600001 + index}.IB`);
  let limited = false;
  await fixture({ state: { sections: [{ title: '北京', text: codes.map(code => `${code}，测试，1.60*ofr`).join('\n') }], revision: 6, userId: 'admin' }, fetch(request) {
    if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
    if (limited) return json({ error: 'upstream failure', code: 'qb_rate_limited', retryAfter: -1 }, 429);
    return json({ source: 'DM', fetchedAt: '2026-10-22T01:00:00Z', results: Object.fromEntries(request.body.codes.map(code => [code,
      request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
        : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-21' }])) });
  } }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => 'qb' });
    await editor.setActive(true); await env.advance(350); await settle(); await settle();
    const before = env.requests.filter(request => request.body?.codes).length;
    assert.equal(before, 6);
    limited = true; await env.elements['coupons-refresh'].click();
    assert.equal(env.requests.filter(request => request.body?.codes).length, before + 1);
    assert.equal(env.elements.notice.textContent, '查询过于频繁，请稍后重试。');
    assert.match(env.elements['metadata-status'].textContent, /^49 条刷新未完成，保留上次资料/);
    for (const index of [0, 20, 48]) {
      assert.equal(env.resultRow(index).querySelector('.bond-list-coupon-value').textContent, '1.54%');
      const valuation = env.resultRow(index).querySelector('.bond-list-valuation-meta');
      assert.match(valuation.title, /2026-10-21 · DM 查询于/);
      assert.match(valuation.title, /保留上次资料/);
    }
    assert.equal(editor.hasPendingChanges(), false); assert.equal(env.state.revision, 6);
  });
});

test('a mixed cached-success and rate-limit response stops later batches and respects the retry window', async () => {
  const codes = Array.from({ length: 21 }, (_, index) => `${102600001 + index}.IB`);
  let limited = true;
  await fixture({ now: '2026-10-24T02:00:00Z',
    state: { sections: [{ title: '北京', text: codes.map(code => `${code}，测试，1.60*ofr`).join('\n') }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      return json({ source: 'QB', fetchedAt: new Date().toISOString(), rateLimited: limited, retryAfter: limited ? 30 : undefined,
        results: Object.fromEntries(request.body.codes.map(code => [code,
          limited && code !== codes[0] ? { status: 'error', reason: 'rate_limited', nextCheckAt: '2026-10-24T02:00:30Z' }
            : request.url.endsWith('/coupons') ? { status: 'matched', couponRate: 1.54, bondType: 'MTN', name: '26测试MTN001', rateType: '固定利率' }
              : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-23' },
        ])) });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    const requests = () => env.requests.filter(request => request.body?.codes);
    assert.equal(requests().length, 2);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    assert.equal(env.resultRow(20).querySelector('.bond-list-coupon-value').textContent, '未完成');
    assert.match(env.elements.notice.textContent, /30 秒/);
    await env.elements['coupons-refresh'].click(); assert.equal(requests().length, 2);
    assert.match(env.elements.notice.textContent, /30 秒/);
    await env.advance(31000); assert.equal(requests().length, 2);
    limited = false; await env.elements['coupons-refresh'].click();
    assert.equal(requests().length, 4);
    assert.ok(requests().slice(2).every(request => !request.body.codes.includes(codes[0])));
    assert.equal(env.resultRow(20).querySelector('.bond-list-coupon-value').textContent, '1.54%');
  });
});

test('a current unauthorized metadata response discards prior metadata and cancels its sibling query', async () => {
  const code = '102600001.IB'; let deny = false;
  await fixture({ now: '2026-10-23T15:59:00Z',
    state: { sections: [{ title: '北京', text: `${code}，测试，1.60*ofr` }], revision: 0, userId: 'admin' },
    fetch(request) {
      if (!request.url.endsWith('/coupons') && !request.url.endsWith('/valuations')) return;
      if (deny) return json({ error: '请登录' }, 401);
      return json({ source: 'QB', fetchedAt: new Date().toISOString(), results: { [code]: request.url.endsWith('/coupons')
        ? { status: 'matched', couponRate: 1.54 }
        : { status: 'matched', institution: '中债', yield: 1.51, basis: '到期', date: '2026-10-22' },
      } });
    },
  }, async env => {
    const editor = initializeBondList(); await editor.setActive(true); await env.advance(350);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '1.54%');
    await env.advance(60000); deny = true;
    await env.elements['coupons-refresh'].click();
    assert.equal(editor.hasAccess(), false);
    assert.equal(env.elements['login-link'].hidden, false);
    assert.equal(env.resultRow(0).querySelector('.bond-list-coupon-value').textContent, '请登录');
    assert.equal(env.resultRow(0).querySelector('.bond-list-valuation-value').textContent, '请登录');
  });
});

test('rate-limited code lookup stops later batches and gives a safe neutral retry notice', async () => {
  const text = Array.from({ length: 49 }, (_, index) => `26测试${index}，1.60*ofr`).join('\n');
  await fixture({ state: { sections: [{ title: '北京', text }], revision: 6, userId: 'admin' }, fetch(request) {
    if (request.url.endsWith('/lookup')) return json({ error: 'unsafe upstream message', code: 'qb_rate_limited', retryAfter: 'Infinity' }, 429);
  } }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => 'qb' });
    await editor.setActive(true); await env.elements.fill.click();
    assert.equal(env.requests.filter(request => request.url.endsWith('/lookup')).length, 1);
    assert.equal(env.elements.notice.textContent, '查询过于频繁，请稍后重试。');
    assert.equal(env.textarea(0).value, text);
    assert.equal(editor.hasPendingChanges(), false); assert.equal(env.state.revision, 6);
  });
});

test('unmatched branch names retain the business message after source changes', async () => {
  let mode = 'dm';
  await fixture({ state: { sections: [{ title: '北京', text: '26测试，1.60*ofr' }], revision: 6, userId: 'admin' } }, async env => {
    const editor = initializeBondList({ getDataSourceMode: () => mode });
    await editor.setActive(true); await env.elements.fill.click();
    const issue = () => env.root.querySelector('.bond-list-issue').children[0].textContent;
    assert.equal(issue(), '未找到债券：26测试');
    mode = 'qb'; editor.resetDataSource();
    await env.elements.fill.click();
    assert.equal(issue(), '未找到债券：26测试');
    mode = 'auto'; editor.resetDataSource();
    await env.elements.fill.click();
    assert.equal(issue(), '未找到债券：26测试');
    assert.equal(env.state.revision, 6);
    assert.equal(editor.hasPendingChanges(), false);
  });
});

test('code completion reports the completed count without vendor or routing labels', async () => {
  for (const provider of ['DM', 'QB', '']) {
    await fixture({ match: true, state: { sections: [{ title: '北京', text: '26测试，1.60*ofr' }], revision: 6, userId: 'admin' }, fetch(request) {
      if (!request.url.endsWith('/lookup')) return;
      return json({ source: provider, results: { '26测试': { status: 'matched', matches: [{ code: '102600001.IB', name: '26测试', market: '银行间' }] } } });
    } }, async env => {
      const editor = initializeBondList({ getDataSourceMode: () => 'qb' });
      await editor.setActive(true); await env.elements.fill.click();
      assert.equal(env.elements.notice.textContent, '已补齐 1 条报价，价格与分行保持原样。');
      assert.equal(env.textarea(0).value, '102600001.IB，26测试，1.60*ofr');
    });
  }
});
