const accounts = {AFS: 'OCI', Receivable: 'AC'};

// The saved lists already encode the intersection and both differences.
// Only use date/account shorthand when it describes the full saved scope.
export function memberListViews(sets, steps) {
  if (!sets || sets.note || !sets.field || steps.length !== 2 || !Array.isArray(sets.labels) || sets.labels.length !== 2) return [];
  const groups = [sets.both, sets.leftOnly, sets.rightOnly];
  if (!groups.every(g => Array.isArray(g) && g.every(name => typeof name === 'string' && name.trim()))) return [];
  const names = groups.flat();
  if (names.length !== sets.total || new Set(names).size !== names.length) return [];
  const data = steps.map(s => s.source === 'inventory' && s.data);
  const simple = data.every(d => d?.snapshot?.date && d.plan?.filters && Object.keys(d.plan.filters).length === 1 &&
    Object.hasOwn(accounts, d.plan.filters.account) && !d.scopedToPrevious && !d.plan.analysis && !d.roleEvidence);
  const dates = data.map(d => d?.snapshot?.date);
  const sameDate = dates[0] === dates[1];
  const accountsOnly = simple && sameDate && data[0].plan.filters.account !== data[1].plan.filters.account;
  const datesOnly = simple && dates[0] < dates[1] && data[0].plan.filters.account === data[1].plan.filters.account;
  const scopes = accountsOnly ? data.map(d => accounts[d.plan.filters.account]) : datesOnly ? dates : ['范围 1', '范围 2'];
  const unit = sets.dimension === 'issuer' ? '家' : sets.dimension === 'code' ? '只' : '个';
  const [both, left, right] = groups.map(g => g.length);
  const labels = datesOnly ? ['两期均有', '退出', '新增'] : ['共同持有', '仅'+scopes[0], '仅'+scopes[1]];
  const counts = datesOnly ? [[labels[2], right], [labels[1], left], [labels[0], both]] :
    [[scopes[0], left+both], [scopes[1], right+both], [labels[0], both], ['合并去重', sets.total]];
  const title = accountsOnly ? dates[0]+' · '+scopes.join(' 与 ') : datesOnly ?
    accounts[data[0].plan.filters.account]+' · '+dates.join(' 至 ') : sets.field+'名单对照';
  const source = sets.labels.join('\n');
  const column = {key:'member', label:sets.field, kind:'category'};
  const order = datesOnly ? [right ? 2 : left ? 1 : 0, 2, 1, 0] : [0, 1, 2];
  return [...new Set(order)].map(i => ({
    shortTitle:labels[i]+'（'+groups[i].length+'）', source,
    answer:counts.map(([label, n]) => label+' '+n+' '+unit).join('，')+'。',
    displayLead:{title, metrics:counts.map(([label, value]) => ({label, value, unit})),
      showOriginal:false, notes:[...(!accountsOnly && !datesOnly ? sets.labels : []), ...(!groups[i].length ? ['本组没有匹配成员。'] : [])]},
    result:{dimensions:[column], measures:[], columns:[column], rows:groups[i].map(member => ({member})), coverage:'complete', defaultTable:true},
  }));
}
