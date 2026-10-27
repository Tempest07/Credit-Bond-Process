import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../project-ofr-ui.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const project = (id = 'p1', extra = {}) => ({ id, shortName: `26${id}MTN001`,
  tranches: [{ id: 't1', shortName: `26${id}MTN001`, initialMarketValuation: 1.6 }], ...extra });
const confirmation = (requiredFields = ['valuation'], extra = {}) => Object.assign(new Error('请核对建项资料'), {
  code: 'confirmation_required', requiredFields, branches: ['广州分行', '上海分行'], ...extra,
});

// Keep DOM behavior limited to the controller's event and input contract. An
// innerHTML redraw deliberately destroys input nodes, as the browser does.
class Container {
  constructor() { this.hidden = false; this.rows = []; this.listeners = new Map(); this.html = ''; this.stopped = 0; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  replaceChildren() { this.innerHTML = ''; }
  set innerHTML(value) {
    this.html = value;
    const starts = [...value.matchAll(/<div class="project-ofr-item" data-ofr-tranche="([^"]*)">/g)];
    this.rows = starts.map((match, index) => {
      const html = value.slice(match.index, starts[index + 1]?.index);
      const inputs = new Map();
      const row = { dataset: { ofrTranche: match[1] }, html, querySelector: selector => inputs.get(selector) || null };
      for (const name of ['valuation', 'branch']) {
        const selector = `[data-ofr-${name}]`;
        if (!html.includes(`data-ofr-${name}`)) continue;
        let initial = '';
        if (name === 'valuation') initial = html.match(/<input[^>]*data-ofr-valuation[^>]*\bvalue="([^"]*)"/)?.[1] || '';
        if (name === 'branch') initial = html.match(/<option value="([^"]*)"[^>]*\bselected/)?.[1] || '';
        inputs.set(selector, { value: initial, matches: target => target === selector,
          closest: target => target === '[data-ofr-tranche]' ? row : null });
      }
      if (html.includes('data-ofr-preview')) inputs.set('[data-ofr-preview]', { textContent: '' });
      return row;
    });
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) { return selector === '[data-ofr-tranche]' ? this.rows : []; }
  row(id = 't1') { return this.rows.find(row => row.dataset.ofrTranche === id); }
  click(action, id = 't1') {
    const row = this.row(id);
    assert.ok(row, `row ${id} exists`);
    const selector = `[data-ofr-${action}]`;
    const target = { closest: target => target === '[data-ofr-tranche]' ? row : target === selector ? target : null };
    this.listeners.get('click')({ target });
  }
  input(name, value, id = 't1') {
    const input = this.row(id)?.querySelector(`[data-ofr-${name}]`);
    assert.ok(input, `${name} input exists`);
    input.value = value;
    this.listeners.get('input')?.({ target: input, stopPropagation: () => { this.stopped++; } });
  }
}

function harness(options = {}) {
  const container = new Container(), adds = [], loads = [], befores = [], toasts = [];
  let current = options.project || project();
  const context = vm.createContext({ Map, Set,
    projectOfrCandidates: value => value.id && value.eligible !== false ? value.tranches.map(tranche => ({ tranche })) : [],
    ofrYieldFromValuation: value => Number.isFinite(value) && value > .05 && value <= 100 ? Number((value - .05).toFixed(4)) : null,
  });
  vm.runInContext(source.replace(/^import[^\n]*\n/, '').replace('export function createProjectOfrActions', 'function createProjectOfrActions'), context);
  const controller = context.createProjectOfrActions({ container,
    getProject: () => current,
    loadOffers: () => { loads.push(true); return options.loadOffers?.() || Promise.resolve({ transfers: [] }); },
    beforeAdd: () => { befores.push(true); return options.beforeAdd?.() || Promise.resolve(); },
    addOffer: value => { adds.push(plain(value)); return options.addOffer?.(value) || Promise.resolve({
      transfer: { projectId: value.projectId, trancheId: value.trancheId, ofrYield: 1.55 },
    }); },
    onToast: value => toasts.push(value),
  });
  return { controller, container, adds, loads, befores, toasts, current: () => current,
    select(value) { current = value; controller.render(value); } };
}

test('render and re-render never add an offer; only a click adds and successful import is marked', async () => {
  const h = harness();
  h.controller.render(h.current()); await settle();
  h.controller.render(h.current()); await settle();
  assert.equal(h.adds.length, 0);
  assert.equal(h.befores.length, 0);
  assert.equal(h.loads.length, 1);
  assert.match(h.container.innerHTML, /1\.55% OFR/);
  h.container.click('add'); await settle();
  assert.deepEqual(h.adds, [{ projectId: 'p1', trancheId: 't1' }]);
  assert.equal(h.befores.length, 1);
  assert.match(h.container.innerHTML, /已加入 OFR/);
  assert.equal(h.toasts.length, 1);
  h.container.click('add'); await settle();
  assert.equal(h.adds.length, 1);
});

test('ineligible or empty projects hide actions without loading or adding', async () => {
  const h = harness();
  h.select(project('p1', { eligible: false })); await settle();
  assert.equal(h.container.hidden, true);
  assert.equal(h.loads.length, 0);
  assert.equal(h.adds.length, 0);
  h.controller.render(null);
  assert.equal(h.container.innerHTML, '');
});

test('concurrent clicks are single-flight while saving and adding', async () => {
  const saving = deferred(), adding = deferred();
  const h = harness({ beforeAdd: () => saving.promise, addOffer: () => adding.promise });
  h.select(h.current()); await settle();
  h.container.click('add'); h.container.click('add'); await settle();
  assert.equal(h.befores.length, 1);
  assert.equal(h.adds.length, 0);
  assert.match(h.container.innerHTML, /正在加入/);
  saving.resolve(); await settle();
  h.container.click('add'); await settle();
  assert.equal(h.adds.length, 1);
  adding.resolve({ transfer: { projectId: 'p1', trancheId: 't1', ofrYield: 1.55 } }); await settle();
  assert.match(h.container.innerHTML, /已加入 OFR/);
});

test('historical valuation confirmation rejects blank and invalid values, then sends explicit valid valuation', async () => {
  let first = true;
  const h = harness({ project: project('p1', { tranches: [{ id: 't1', shortName: '26测试MTN001' }] }),
    addOffer: () => { if (first) { first = false; return Promise.reject(confirmation()); }
      return Promise.resolve({ transfer: { projectId: 'p1', trancheId: 't1', ofrYield: 1.55 } }); } });
  h.select(h.current()); await settle();
  h.container.click('add'); await settle();
  assert.match(h.container.innerHTML, /data-ofr-valuation/);
  assert.match(h.container.innerHTML, /确认并加入 OFR/);
  for (const invalid of ['', ' ', '0', '0.05', '-1', '101', 'Infinity', 'NaN', 'not a yield']) {
    h.container.input('valuation', invalid);
    h.container.click('confirm'); await settle();
    assert.equal(h.adds.length, 1, `must not submit ${JSON.stringify(invalid)}`);
  }
  h.container.input('valuation', '1.6000');
  h.container.click('confirm'); await settle();
  assert.deepEqual(h.adds[1], { projectId: 'p1', trancheId: 't1', confirmedValuation: 1.6 });
  assert.match(h.container.innerHTML, /已加入 OFR/);
});

test('confirmation drafts survive validation errors and ordinary redraws', async () => {
  const h = harness({ addOffer: () => Promise.reject(confirmation(['valuation', 'branch'])) });
  h.select(h.current()); await settle();
  h.container.click('add'); await settle();
  h.container.input('valuation', '1.72');
  h.container.click('confirm'); await settle();
  assert.equal(h.adds.length, 1, 'missing branch must not send a second request');
  assert.equal(h.container.row().querySelector('[data-ofr-valuation]').value, '1.72');
  h.container.input('branch', '广州分行');
  assert.equal(h.container.stopped, 2, 'OFR confirmation inputs must not bubble into the project autosave form');
  h.controller.render(h.current());
  assert.equal(h.container.row().querySelector('[data-ofr-valuation]').value, '1.72');
  assert.equal(h.container.row().querySelector('[data-ofr-branch]').value, '广州分行');
});

test('cancel closes the confirmation without any additional submission', async () => {
  const h = harness({ addOffer: () => Promise.reject(confirmation()) });
  h.select(h.current()); await settle();
  h.container.click('add'); await settle();
  h.container.click('cancel'); await settle();
  assert.doesNotMatch(h.container.innerHTML, /data-ofr-confirm|data-ofr-valuation/);
  assert.equal(h.adds.length, 1);
});

test('reset during beforeAdd prevents a deferred write after logout', async () => {
  const saving = deferred();
  const h = harness({ beforeAdd: () => saving.promise });
  h.select(h.current()); await settle();
  h.container.click('add'); await settle();
  h.controller.reset();
  saving.resolve(); await settle();
  assert.equal(h.adds.length, 0);
  assert.equal(h.container.hidden, true);
  assert.equal(h.container.innerHTML, '');
  assert.equal(h.toasts.length, 0);
});

test('late add responses cannot replace another project or resurrect UI after reset', async () => {
  for (const reset of [false, true]) {
    const adding = deferred(), h = harness({ addOffer: () => adding.promise });
    h.select(h.current()); await settle();
    h.container.click('add'); await settle();
    if (reset) h.controller.reset(); else h.select(project('p2'));
    await settle();
    const html = h.container.innerHTML;
    adding.resolve({ transfer: { projectId: 'p1', trancheId: 't1', ofrYield: 1.55 } }); await settle();
    assert.equal(h.container.innerHTML, html);
    if (reset) assert.equal(h.toasts.length, 0);
    else { assert.match(html, /26p2MTN001/); assert.doesNotMatch(html, /已加入 OFR/); }
  }
});

test('a pending saved-offer read cannot repopulate state after reset', async () => {
  const loading = deferred(), h = harness({ loadOffers: () => loading.promise });
  h.select(h.current());
  h.controller.reset();
  loading.resolve({ transfers: [{ projectId: 'p1', trancheId: 't1', ofrYield: 1.55, present: true }] }); await settle();
  assert.equal(h.container.innerHTML, '');
  assert.equal(h.container.hidden, true);
  assert.equal(h.adds.length, 0);
});

test('a stale saved-offer response cannot erase an add that completed after its request started', async () => {
  const loading = deferred(), h = harness({ loadOffers: () => loading.promise });
  h.select(h.current());
  h.container.click('add'); await settle();
  assert.equal(h.adds.length, 1);
  assert.match(h.container.innerHTML, /已加入 OFR/);
  loading.resolve({ transfers: [] }); await settle();
  assert.match(h.container.innerHTML, /已加入 OFR/);
  h.container.click('add'); await settle();
  assert.equal(h.adds.length, 1);
});

test('a different project\'s late status read cannot overwrite a locally completed offer', async () => {
  const reads = [deferred(), deferred(), deferred()];
  let readIndex = 0;
  const h = harness({ loadOffers: () => reads[readIndex++].promise });
  h.select(h.current());
  h.container.click('add'); await settle();
  h.select(project('p2'));
  reads[0].resolve({ transfers: [] });
  reads[1].resolve({ transfers: [{ projectId: 'p1', trancheId: 't1', ofrYield: 9.9, present: true }] });
  await settle();
  h.select(project('p1'));
  assert.match(h.container.innerHTML, /1\.55% OFR/);
  assert.doesNotMatch(h.container.innerHTML, /9\.9% OFR/);
  reads[2].resolve({ transfers: [{ projectId: 'p1', trancheId: 't1', ofrYield: 1.55, present: true }] });
  await settle();
});

test('explicit invalidation rechecks removed transfers and allows adding them again', async () => {
  let present = true;
  const h = harness({ loadOffers: () => Promise.resolve({ transfers: [{ projectId: 'p1', trancheId: 't1', ofrYield: 1.55, present }] }) });
  h.select(h.current()); await settle();
  assert.match(h.container.innerHTML, /已加入 OFR/);
  present = false;
  h.controller.invalidate(); h.controller.render(h.current()); await settle();
  assert.doesNotMatch(h.container.innerHTML, /已加入 OFR/);
  h.container.click('add'); await settle();
  assert.equal(h.adds.length, 1);
  assert.match(h.container.innerHTML, /已加入 OFR/);
});

test('failed beforeAdd unlocks the action without calling the add endpoint', async () => {
  const h = harness({ beforeAdd: () => Promise.reject(new Error('项目同步失败')) });
  h.select(h.current()); await settle();
  h.container.click('add'); await settle();
  assert.equal(h.adds.length, 0);
  assert.match(h.container.innerHTML, /项目同步失败/);
  assert.doesNotMatch(h.container.innerHTML, /正在加入/);
});
