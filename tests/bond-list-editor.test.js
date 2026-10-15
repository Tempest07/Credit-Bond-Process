import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeBondList } from '../bond-list-editor.js';

const ids = ['save-state', 'save-dot', 'branches', 'fill', 'auto', 'export', 'copy', 'recovery-box',
  'recovery-download', 'login-link', 'hide-empty', 'counts', 'notice', 'preview', 'copy-hint', 'retry'];
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
  emit(name) { return Promise.all((this.listeners[name] || []).map(callback => callback({ target: this }))); }
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
      throw new Error('unexpected URL ' + url);
    }
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const environment = {
    root, elements, storage, requests, state, document,
    textarea: index => root.querySelector('#bondList-text-' + index),
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
    assert.deepEqual(env.requests.filter(request => request.body).map(request => request.body.revision), [0, 1]);
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
    assert.equal(env.requests.filter(request => request.body).length, 1);
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
    assert.equal(env.requests.filter(request => request.body).length, 0);
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
  await fixture({ storage, fetch: request => request.body ? writing.promise : reading.promise }, async env => {
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
