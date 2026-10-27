import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeBondList } from '../bond-list-editor.js';

const ids = ['save-state', 'save-dot', 'branches', 'fill', 'auto', 'export', 'copy', 'recovery-box',
  'recovery-download', 'login-link', 'hide-empty', 'counts', 'notice', 'preview', 'copy-hint', 'retry', 'coupons-refresh',
  'tab-results', 'tab-editor', 'results-panel', 'editor-panel', 'types-options', 'types-label', 'coupon-op', 'coupon-min', 'coupon-max',
  'coupon-max-wrap', 'missing', 'side-all', 'side-ofr', 'side-bid', 'filters-clear', 'filter-error', 'results-counts', 'metadata-status',
  'results-body', 'results-empty', 'result-preview', 'result-copy-hint'];
const clone = value => JSON.parse(JSON.stringify(value));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const offer = (extra = {}) => ({ id: 'offer-1', projectId: 'p1', trancheId: 't1', branchTitle: '广东（广州）', securityCode: '102600001.IB',
  shortName: '26测试MTN001', rawLine: '102600001.IB，26测试MTN001，1.55*ofr', baseValuation: 1.6, ofrYield: 1.55,
  createdAt: '2026-10-27T08:00:00Z', seenAt: null, present: true, ...extra });

class Element {
  constructor(tag, owner) {
    Object.assign(this, { tagName: tag, owner, children: [], dataset: {}, listeners: {}, attributes: {}, className: '', id: '', textContent: '',
      value: '', checked: false, disabled: false, hidden: false, scrollHeight: 60 });
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = { toggle: (name, yes) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (yes) set.add(name); else set.delete(name); this.className = [...set].join(' '); } };
  }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  insertBefore(child, before) { child.parent = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  emit(name, data = {}) { return Promise.all((this.listeners[name] || []).map(fn => fn({ target: this, ...data }))); }
  click() { return this.emit('click'); }
  focus() { this.owner.activeElement = this; }
  scrollIntoView(options) { this.scrolled = true; this.scrollOptions = options; }
  querySelector(selector) {
    const matches = e => selector.startsWith('#') ? e.id === selector.slice(1) : selector.startsWith('.') ? e.className.split(/\s+/).includes(selector.slice(1)) : selector === '[data-composing]' && 'composing' in e.dataset;
    for (const child of this.children) { if (matches(child)) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
}

async function fixture(options, work) {
  const globals = ['document', 'window', 'location', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'Date'];
  const original = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const documentListeners = {};
  const document = { activeElement: null, hidden: false, addEventListener(name, fn) { (documentListeners[name] ||= []).push(fn); } }, root = new Element('section', document);
  document.body = new Element('body', document); document.body.append(root);
  document.querySelector = selector => selector === '.view[data-view="bond-list"]' ? root : null;
  document.createElement = tag => new Element(tag, document);
  const elements = Object.fromEntries(ids.map(id => { const e = new Element('div', document); e.id = 'bondList-' + id; root.append(e); return [id, e]; }));
  elements.retry.hidden = true; elements['recovery-box'].hidden = true; elements['login-link'].hidden = true;
  elements['coupon-op'].value = 'any'; elements.missing.value = 'all';
  const transfers = clone(options.transfers ?? [offer()]);
  const state = clone(options.state || { sections: [{ title: '广东（广州）', text: offer().rawLine }], revision: 1, userId: 'admin' });
  const requests = [], storage = new Map(), timers = new Map(), frames = []; let time = 0, timerId = 0;
  const RealDate = Date;
  const values = {
    Date: class extends RealDate { constructor(...args) { super(...(args.length ? args : [1_800_000_000_000 + time])); } static now() { return 1_800_000_000_000 + time; } },
    document, window: { addEventListener() {} }, location: new URL('http://127.0.0.1:8838/'),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, v) => storage.set(key, v), removeItem: key => storage.delete(key) },
    setTimeout(fn, delay = 0) { const id = ++timerId; timers.set(id, { fn, at: time + delay }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame(fn) { if (options.deferFrames) frames.push(fn); else fn(time); return 0; },
    async fetch(url, init = {}) {
      const req = { url, init, body: init.body ? JSON.parse(init.body) : undefined }; requests.push(req);
      const custom = await options.fetch?.(req, state, transfers); if (custom) return custom;
      if (url.endsWith('/state')) {
        if (!req.body) return json(state);
        assert.equal(req.body.revision, state.revision); state.sections = clone(req.body.sections); state.revision++;
        return json({ revision: state.revision });
      }
      if (url.endsWith('/project-offers')) {
        if (!req.body) return json({ transfers, branches: state.sections.map(s => s.title) });
        if (req.body.action === 'seen') { for (const t of transfers) if (req.body.ids.includes(t.id)) t.seenAt = 'seen'; return json({ ok: true }); }
        if (req.body.action === 'add') { const t = offer(); state.sections[0].text += (state.sections[0].text ? '\n' : '') + t.rawLine; state.revision++; transfers.push(t); return json({ added: true, transfer: t, revision: state.revision }); }
      }
      if (url.endsWith('/coupons') || url.endsWith('/valuations')) return json({ results: Object.fromEntries(req.body.codes.map(code => [code, { status: 'missing' }])) });
      throw Error('Unexpected request ' + url);
    },
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const env = { root, elements, requests, state, transfers, storage, document,
    rows: () => elements['results-body'].children,
    notice: () => root.querySelector('.bond-list-project-offer-notice'),
    offers: action => requests.filter(r => r.url.endsWith('/project-offers') && (action ? r.body?.action === action : !r.body)),
    async edit(text) { const e = root.querySelector('#bondList-text-0'); e.value = text; await e.emit('input'); },
    async emitDocument(name) { await Promise.all((documentListeners[name] || []).map(fn => fn())); },
    async flushFrames() { for (const fn of frames.splice(0)) fn(time); await settle(); },
    async advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } await settle(); },
  };
  try { await work(env); } finally { for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('project-offer prompts load only on active entry, highlight once, acknowledge, and expire without changing quotes', async () => {
  await fixture({}, async env => {
    const editor = initializeBondList({ projectOffers: true }), before = clone(env.state.sections);
    assert.equal(env.requests.length, 0); await editor.setActive(false); assert.equal(env.requests.length, 0);
    await editor.setActive(true); await settle();
    assert.equal(env.offers().length, 1); assert.equal(env.offers('seen').length, 1);
    assert.match(env.rows()[0].className, /bond-list-project-offer-new/);
    assert.equal(env.rows()[0].scrolled, true); assert.match(env.notice().children[0].textContent, /新增挂卖 1 只/);
    await editor.setActive(true); assert.equal(env.offers().length, 1);
    await env.advance(2000);
    assert.equal(env.rows()[0].style['--project-offer-animation-delay'], '-2000ms', 'metadata redraw continues the original highlight timeline');
    await env.advance(4000); assert.doesNotMatch(env.rows()[0].className, /bond-list-project-offer-new/);
    await editor.setActive(false); await editor.setActive(true); await settle();
    assert.equal(env.offers().length, 2); assert.equal(env.offers('seen').length, 1);
    assert.equal(env.notice().hidden, true); assert.doesNotMatch(env.rows()[0].className, /bond-list-project-offer-new/);
    assert.deepEqual(env.state.sections, before);
  });
});

test('hidden new quotes are not acknowledged until viewed, and the original filters are retained', async () => {
  const old = '102600002.IB，26旧券MTN002，1.7*bid';
  await fixture({ state: { sections: [{ title: '广东（广州）', text: old + '\n' + offer().rawLine }], revision: 4, userId: 'admin' } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await env.elements['side-bid'].click();
    await editor.setActive(true); await settle();
    assert.equal(env.offers('seen').length, 0); assert.equal(env.rows().length, 1);
    assert.match(env.notice().children[0].textContent, /1 只未显示/); assert.equal(env.notice().children[1].textContent, '查看新增');
    await env.notice().children[1].click(); await settle();
    assert.equal(env.rows().length, 1); assert.equal(env.rows()[0].children[0].children[0].textContent, '26测试MTN001');
    assert.equal(env.offers('seen').length, 1); assert.equal(env.elements['side-bid'].attributes['aria-pressed'], 'true');
    await env.notice().children[1].click();
    assert.equal(env.rows()[0].children[0].children[0].textContent, '26旧券MTN002');
    await editor.setActive(false); await editor.setActive(true);
    assert.equal(env.rows()[0].children[0].children[0].textContent, '26旧券MTN002');
  });
});

test('editor mode does not consume a prompt for rows hidden in another tab', async () => {
  await fixture({}, async env => {
    const editor = initializeBondList({ projectOffers: true }); await env.elements['tab-editor'].click(); await editor.setActive(true);
    assert.equal(env.offers('seen').length, 0);
    await env.elements['tab-results'].click(); await settle();
    assert.equal(env.offers('seen').length, 1); assert.match(env.rows()[0].className, /bond-list-project-offer-new/);
  });
});

test('matching uses stable bond identity instead of a saved line number, including later code completion', async () => {
  await fixture({ transfers: [offer({ securityCode: '', shortName: '２６ 测试 MTN001', lineIndex: 0 })],
    state: { sections: [{ title: '广东（广州）', text: '102600002.IB，26旧券MTN002，1.7*bid\n\n' + offer().rawLine }], revision: 4, userId: 'admin' } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await settle();
    assert.doesNotMatch(env.rows()[0].className, /bond-list-project-offer-new/); assert.match(env.rows()[1].className, /bond-list-project-offer-new/);
    assert.deepEqual(env.offers('seen')[0].body.ids, ['offer-1']);
  });
});

test('removed lines and old seen records never create a new prompt', async () => {
  await fixture({ transfers: [offer({ present: false }), offer({ id: 'seen', seenAt: 'yesterday' })] }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true);
    assert.equal(env.offers('seen').length, 0); assert.equal(env.notice().hidden, true);
  });
});

test('an explicit append waits for draft saving, preserves old quotes and only prompts on the next entry', async () => {
  const pending = deferred();
  await fixture({ transfers: [], state: { sections: [{ title: '广东（广州）', text: '' }], revision: 2, userId: 'admin' },
    fetch(req, state) { if (req.url.endsWith('/state') && req.body) { state.sections = clone(req.body.sections); state.revision++; return pending.promise; } } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await editor.setActive(false);
    const old = '102600002.IB，26旧券MTN002，1.7*bid'; await env.edit(old);
    const adding = editor.addProjectOffer({ projectId: 'p1', trancheId: 't1' }); await settle();
    assert.equal(env.offers('add').length, 0);
    pending.resolve(json({ revision: 3 })); assert.equal((await adding).added, true);
    assert.equal(env.offers('add').length, 1); assert.equal(env.offers('seen').length, 0);
    assert.ok(env.state.sections[0].text.startsWith(old + '\n')); assert.equal(editor.hasPendingChanges(), false);
    await editor.setActive(true); await settle();
    assert.equal(env.offers('seen').length, 1); assert.equal(env.rows().length, 2);
  });
});

test('append failures retain the saved draft and expose structured confirmation requirements', async () => {
  await fixture({ fetch(req) { if (req.body?.action === 'add') return json({ error: '请确认建项估值', code: 'confirmation_required', requiredFields: ['valuation'], branches: ['广东（广州）'] }, 422); } }, async env => {
    const editor = initializeBondList({ projectOffers: true });
    await assert.rejects(editor.addProjectOffer({ projectId: 'p1', trancheId: 't1' }), error => {
      assert.equal(error.code, 'confirmation_required'); assert.deepEqual(error.requiredFields, ['valuation']); assert.deepEqual(error.branches, ['广东（广州）']); return true;
    });
    assert.equal(env.offers('seen').length, 0); assert.equal(env.rows().length, 0); assert.equal(env.state.sections[0].text, offer().rawLine);
  });
});

test('a save conflict stops append without discarding the local draft', async () => {
  await fixture({ fetch(req) { if (req.body && req.url.endsWith('/state')) return json({ error: '保存冲突' }, 409); } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await editor.setActive(false);
    await env.edit('26手工，1.9*ofr');
    await assert.rejects(editor.addProjectOffer({ projectId: 'p1', trancheId: 't1' }), /还有未保存/);
    assert.equal(env.offers('add').length, 0); assert.equal(env.root.querySelector('#bondList-text-0').value, '26手工，1.9*ofr');
    assert.equal(editor.hasPendingChanges(), true);
  });
});

test('duplicate append clicks share one request and read-only project queries do not consume prompts', async () => {
  const pending = deferred();
  await fixture({ fetch(req) { if (req.body?.action === 'add') return pending.promise; } }, async env => {
    const editor = initializeBondList({ projectOffers: true });
    await editor.getProjectOffers(); assert.equal(env.offers('seen').length, 0);
    const one = editor.addProjectOffer({ projectId: 'p1', trancheId: 't1' }), two = editor.addProjectOffer({ projectId: 'p1', trancheId: 't1' }); await settle();
    assert.equal(env.offers('add').length, 1);
    pending.resolve(json({ added: true, transfer: offer(), revision: 2 })); await Promise.all([one, two]);
    assert.equal(env.offers('seen').length, 0);
  });
});

test('a failed prompt read keeps the normal list and retry does not overwrite another business notice', async () => {
  let failed = true;
  await fixture({ fetch(req) { if (req.url.endsWith('/project-offers') && !req.body && failed) return json({ error: '提示服务暂不可用' }, 503); } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true);
    assert.equal(env.rows().length, 1); assert.match(env.notice().children[0].textContent, /清单仍可正常使用/);
    env.elements.notice.textContent = '已有业务消息'; failed = false;
    await env.notice().children[2].click(); await settle();
    assert.equal(env.offers('seen').length, 1); assert.equal(env.elements.notice.textContent, '已有业务消息');
  });
});

test('failed acknowledgement is explicit and metadata redraws do not repeatedly submit or replay it', async () => {
  let fail = true;
  await fixture({ fetch(req) { if (req.body?.action === 'seen' && fail) return json({ error: '暂不可用' }, 503); } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await settle();
    assert.equal(env.offers('seen').length, 1); assert.match(env.notice().children[0].textContent, /提示状态待保存/);
    await env.elements['side-ofr'].click(); await env.advance(6000);
    assert.equal(env.offers('seen').length, 1); assert.doesNotMatch(env.rows()[0].className, /bond-list-project-offer-new/);
    fail = false; await env.notice().children[2].click(); await settle();
    assert.equal(env.offers('seen').length, 2); assert.equal(env.transfers[0].seenAt, 'seen');
    await editor.setActive(false); await editor.setActive(true); assert.equal(env.notice().hidden, true);
  });
});

test('logout aborts prompt loading and late responses cannot restore another account prompt', async () => {
  const pending = deferred();
  await fixture({ fetch(req) { if (req.url.endsWith('/project-offers') && !req.body) return pending.promise; } }, async env => {
    const editor = initializeBondList({ projectOffers: true }), entering = editor.setActive(true); await settle();
    editor.clearAccess(); pending.resolve(json({ transfers: [offer()] })); await entering; await settle();
    assert.equal(editor.hasAccess(), false); assert.equal(env.offers('seen').length, 0); assert.equal(env.notice().hidden, true);
  });
});

test('editing during append preserves the draft and cannot overwrite the newer appended server list', async () => {
  const pending = deferred();
  await fixture({ transfers: [], fetch(req, state) {
    if (req.body?.action === 'add') return pending.promise;
    if (req.url.endsWith('/state') && req.body && req.body.revision !== state.revision) return json({ error: '其他窗口已有更新' }, 409);
  } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true);
    const adding = editor.addProjectOffer({ projectId: 'p2', trancheId: 't2' }); await settle();
    await env.edit('26手工新券，1.95*ofr');
    env.state.sections[0].text += '\n102600002.IB，26另只MTN002，1.6*ofr'; env.state.revision++;
    pending.resolve(json({ added: true, revision: env.state.revision })); await adding;
    assert.equal(env.root.querySelector('#bondList-text-0').value, '26手工新券，1.95*ofr');
    assert.equal(editor.hasPendingChanges(), true);
    await env.advance(450);
    assert.match(env.state.sections[0].text, /26另只MTN002/);
    assert.equal(env.root.querySelector('#bondList-text-0').value, '26手工新券，1.95*ofr');
    assert.equal(editor.hasPendingChanges(), true); assert.equal(env.elements.retry.disabled, true);
  });
});

test('a late acknowledgement from a logged-out account does not block a new account prompt', async () => {
  const pending = deferred(); let seen = 0;
  await fixture({ fetch(req) { if (req.body?.action === 'seen' && ++seen === 1) return pending.promise; } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await settle();
    assert.equal(env.offers('seen').length, 1);
    editor.clearAccess(); await editor.setActive(false);
    env.state.userId = 'second'; env.transfers.splice(0, env.transfers.length, offer({ id: 'second-offer' }));
    await editor.setActive(true); await settle();
    assert.equal(env.offers('seen').length, 2); assert.deepEqual(env.offers('seen')[1].body.ids, ['second-offer']);
    pending.resolve(json({ ok: true })); await settle();
    assert.equal(editor.hasAccess(), true); assert.match(env.notice().children[0].textContent, /新增挂卖 1 只/);
  });
});

test('more than fifty visible new offers acknowledge in bounded sequential batches', async () => {
  const transfers = Array.from({ length: 51 }, (_, i) => offer({ id: `offer-${i}`, securityCode: `${102600001 + i}.IB`,
    shortName: `26测试MTN${String(i + 1).padStart(3, '0')}`, rawLine: `${102600001 + i}.IB，26测试MTN${String(i + 1).padStart(3, '0')}，1.55*ofr` }));
  await fixture({ transfers, state: { sections: [{ title: '广东（广州）', text: transfers.map(t => t.rawLine).join('\n') }], revision: 1, userId: 'admin' } }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await settle();
    assert.deepEqual(env.offers('seen').map(req => req.body.ids.length), [50, 1]);
    assert.equal(new Set(env.offers('seen').flatMap(req => req.body.ids)).size, 51);
    assert.ok(env.transfers.every(t => t.seenAt === 'seen'));
  });
});

test('a background browser tab does not consume the prompt until it becomes visible', async () => {
  await fixture({}, async env => {
    env.document.hidden = true;
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true); await settle();
    assert.equal(env.offers('seen').length, 0); assert.doesNotMatch(env.rows()[0].className, /bond-list-project-offer-new/);
    env.document.hidden = false; await env.emitDocument('visibilitychange'); await settle();
    assert.equal(env.offers().length, 1, 'visibility changes do not re-fetch metadata');
    assert.equal(env.offers('seen').length, 1); assert.match(env.rows()[0].className, /bond-list-project-offer-new/);
  });
});

test('initial positioning resolves the current row after a redraw before the display frame', async () => {
  await fixture({ deferFrames: true }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true);
    const detached = env.rows()[0];
    assert.equal(env.offers('seen').length, 0, 'not acknowledged before the positioning frame');
    await env.elements['side-ofr'].click();
    const live = env.rows()[0]; assert.notEqual(live, detached);
    await env.flushFrames();
    assert.equal(detached.scrolled, undefined); assert.equal(live.scrolled, true);
    assert.deepEqual(live.scrollOptions, { behavior: 'auto', block: 'center' });
    assert.equal(env.offers('seen').length, 1);
    await env.advance(2000); await env.elements['side-all'].click(); await env.flushFrames();
    assert.equal(env.rows()[0].style['--project-offer-animation-delay'], '-2000ms');
    assert.equal(env.rows()[0].scrolled, undefined, 'metadata redraw does not replay initial positioning');
    await env.advance(4000); assert.doesNotMatch(env.rows()[0].className, /bond-list-project-offer-new/);
  });
});

test('leaving before the positioning frame keeps the prompt available for the next real entry', async () => {
  await fixture({ deferFrames: true }, async env => {
    const editor = initializeBondList({ projectOffers: true }); await editor.setActive(true);
    await editor.setActive(false); await env.flushFrames();
    assert.equal(env.offers('seen').length, 0); assert.equal(env.transfers[0].seenAt, null);
    await editor.setActive(true); assert.match(env.rows()[0].className, /bond-list-project-offer-new/);
    await env.flushFrames(); assert.equal(env.offers('seen').length, 1); assert.equal(env.rows()[0].scrolled, true);
  });
});
