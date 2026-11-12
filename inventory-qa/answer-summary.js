// Project only verified values of the saved answer. The complete narrative,
// operands and all returned rows remain available in the answer view.
const centsPerUnit = {元:100, 万元:1e6, 亿元:1e10};
const metric = (measure, value, label=measure.label) => ({
  label, value, unit:measure.unit, ...(measure.digits == null ? {} : {digits:measure.digits}),
});
const period = p => [p.start, p.end !== p.start && p.end].filter(Boolean).join(' 至 ');

function weeklyLead(r, data) {
  if (data?.spec?.metric !== 'weeklyMean' || r.cadence !== 'weekly' || !Number.isFinite(r.headline?.value)) return;
  const m = r.measures.find(item => item.key === r.headline.measureKey);
  if (!m || !Array.isArray(data.rows) || r.rows.length !== data.rows.length) return;
  const gaps = data.rows.filter(row => row[1] === '缺台账').map(row => row[0]);
  const covered = r.rows.length - gaps.length;
  if (!covered || r.rows.filter(row => Number.isFinite(row[m.key])).length !== covered) return;
  const scope = [data.spec.branch, data.spec.account, period(data.spec)].filter(Boolean).join(' · ');
  return {
    title:scope, metrics:[metric(m,r.headline.value,'周均在账本金')],
    notes:[covered+' 周计入均值，每周取最后一个有台账的业务日。'+(gaps.length ?
      '缺台账 '+gaps.length+' 周（'+gaps.join('、')+'），计为空缺。' : '期间各周均有台账。')],
  };
}

function scopeComparison(model, data, question) {
  const r=model.result, m=r.measures[0], parts=data?.overview;
  if(r.dimensions[0]?.key!=='scope' || m?.key!=='principal' || !Array.isArray(parts) ||
    parts.length!==r.rows.length || parts.length>2 || !parts.length || data.codeUnion || data.codeComparisons?.length)return;
  const snapshots=parts.map(p=>p.result);
  if(snapshots.some(d=>d?.plan?.group!=='none' || d.plan.metric!=='principal' || !d.snapshot?.date ||
     d.plan.analysis?.length || d.scopedToPrevious || d.roleEvidence || d.measure || !Number.isSafeInteger(d.totalCents)))return;
  const day=snapshots[0].snapshot.date;
  if(!centsPerUnit[m.unit] || snapshots.some((d,i)=>d.snapshot.date!==day ||
    Math.abs(d.totalCents/centsPerUnit[m.unit]-r.rows[i][m.key])>0.5/centsPerUnit[m.unit]))return;
  // Use only the narrow, recognized same-day balances. A saved clarification
  // may additionally explain names, source substitutions or verification gaps.
  const lines=data.clarification?.trim().split(/\r?\n/u);
  if(!lines || !snapshots.every((d,i)=>lines[i]?.startsWith(parts[i].title+'：') &&
    /^[\d.,\- ]+亿元。$/u.test(lines[i].slice((parts[i].title+'：').length))))return;
  const title=day+' · 在账本金', metrics=r.rows.map(row=>metric(m,row[m.key],row.scope));
  if(lines.length===parts.length)return {title,metrics};
  if(parts.length!==2 || lines.length!==3 || !/占.*%/u.test(lines[2]) || !/占|比例|比重/u.test(question))return;
  const filters=snapshots.map(d=>Object.entries(d.plan.filters||{}));
  const i=filters[0].length>filters[1].length?0:1, j=1-i;
  if(filters[i].length===filters[j].length || !filters[j].every(([k,v])=>snapshots[i].plan.filters?.[k]===v) ||
    snapshots[j].totalCents<=0 || snapshots[i].totalCents<0 || snapshots[i].totalCents>snapshots[j].totalCents)return;
  const ratio=100*snapshots[i].totalCents/snapshots[j].totalCents;
  const percent=lines[2].match(/([\d.]+)%[。\s]*$/u);
  if(!percent || Math.abs(ratio-Number(percent[1]))>0.5*10**(-(percent[1].split('.')[1]?.length||0))+1e-10)return;
  return {title,metrics:[...metrics,{label:'占'+r.rows[j].scope+'的比例',unit:'%',value:ratio}]};
}

function unverifiedDuration(model,data,unit) {
  const d=data?.values?.[0];
  if(data?.spec?.metric!=='modifiedDuration' || data.values?.length!==1 || model.result.coverage!=='missing' ||
    d?.value!==null || d.covered!==0 || !Number.isSafeInteger(d.unknown) || !Number.isSafeInteger(d.gross) ||
    d.unknown!==d.gross || !Number.isSafeInteger(d.unknownCount) || !/没有锁定已核验的同日逐券市场资料/u.test(data.headline))return;
  return {title:[d.date,data.spec.account,data.spec.branch].filter(Boolean).join(' · '),
    metrics:[{label:'修正久期',value:'待核'},{label:'待核本金',value:d.unknown/centsPerUnit[unit],unit}],
    notes:['缺少已核验的同日逐券资料，'+d.unknownCount+' 只在账券待核，已覆盖本金为 0 '+unit+'。']};
}

function tradeRanking(r, data, question) {
  const p=data.plan, source=data.result, dim=r.dimensions[0];
  if (!r.orderedBy || !Array.isArray(source.groups) || r.dimensions.length!==1 || !Number.isInteger(p.limit) ||
      p.limit<1 || dim.kind==='date' || source.groups.length!==r.rows.length || !r.rows.length) return;
  const m=r.measures.find(v=>v.key===r.orderedBy.key), first=r.rows[0];
  if (!m || !Number.isFinite(first[m.key]) || r.rows.some((row,i)=>row[dim.key]!==source.groups[i].values?.[0])) return;
  const side=p.direction==='buy'?'买入':p.direction==='sell'?'卖出':'交易';
  const range=Number.isInteger(source.groupCount)?'，列出 '+r.rows.length+' / '+source.groupCount+' 组':'';
  const notes=[(p.minGroupRows ? '每组至少 '+p.minGroupRows+' 笔'+side+'，' : '')+
    '按'+m.label+(r.orderedBy.direction==='asc'?'升序':'降序')+range+'。'];
  const metrics=[metric(m,first[m.key],first[dim.key])];
  if (/(?:合计|总额|总和|总计)/u.test(question) && centsPerUnit[m.unit] && ['buy','sell','gross','net'].includes(m.key)) {
    const raw=source.groups.map(g=>g[m.key+'Cents']);
    if(raw.every(Number.isSafeInteger)){
      const sum=Number(raw.reduce((total,n)=>total+BigInt(n),0n));
      if(Number.isSafeInteger(sum))metrics.unshift(metric(m,sum/centsPerUnit[m.unit],'榜内'+m.label+'合计'));
    }
  }
  return {title:period(p),metrics,notes};
}

function signedTradeLead(r, data) {
  const m=r.measures.find(v=>v.key===r.netComposition?.key), raw=data.result;
  if(!m || !centsPerUnit[m.unit] || !Array.isArray(raw.groups) || !Number.isSafeInteger(raw.totals?.netCents) ||
    raw.groups.length!==raw.groupCount || !raw.groups.every(g=>Number.isSafeInteger(g.netCents)))return;
  let positive=0n, negative=0n;
  for(const group of raw.groups){
    if(group.netCents<0)negative+=BigInt(group.netCents);
    else positive+=BigInt(group.netCents);
  }
  if(positive+negative!==BigInt(raw.totals.netCents) || ![positive,negative].every(n=>Number.isSafeInteger(Number(n))))return;
  const asMetric=(n,label)=>metric(m,Number(n)/centsPerUnit[m.unit],label);
  const notes=[r.note].filter(Boolean);
  if(r.netComposition.blankIndex>=0)notes.push('未填写'+r.dimensions[0].label+'的交易已计入合计。');
  return {title:period(data.plan),metrics:[asMetric(raw.totals.netCents,'合计净额'),asMetric(positive,'净买入组合计'),asMetric(negative,'净卖出组合计')],notes};
}

function monthlyLead(r, data, question) {
  const d=r.dimensions[0], m=r.measures.find(v=>v.key==='net');
  if(!m || d?.label!=='交易月份' || !/(?:净卖出|净买入)(?:金额)?(?:最多|最大|最高)/u.test(question))return;
  const order=question.match(/(净卖出|净买入)(?:金额)?(?:最多|最大|最高)/u);
  if(!order || data.plan.limit || data.result.groups?.length!==data.result.groupCount || r.rows.some(row=>!Number.isFinite(row[m.key])))return;
  const count=question.match(/哪([一二两三1-3])个月|(?:最多|最大|最高)的?([一二两三1-3])个月/u);
  const size=count?.[1]||count?.[2]||'一', requested=({一:1,二:2,两:2,三:3})[size]||Number(size);
  const sign=order[1]==='净卖出'?-1:1;
  const candidates=r.rows.filter(row=>sign*row[m.key]>0).sort((a,b)=>sign*(b[m.key]-a[m.key]));
  const selected=candidates.slice(0,requested);
  if(!selected.length || selected.at(-1)[m.key]===candidates[requested]?.[m.key])return;
  return {title:order[1]+'最多的月份',metrics:selected.map(row=>metric(m,Math.abs(row[m.key]),row[d.key]+' '+order[1]))};
}

function calculatedLead(r, arithmetic, question) {
  const m=r.measures[0], raw=arithmetic?.rows;
  if(!Array.isArray(raw) || r.dimensions[0]?.key!=='item' || m?.key!=='value' ||
     raw.length!==r.rows.length || r.rows.some((row,i)=>!Number.isFinite(row.value) ||
       row.item!==[raw[i].label,raw[i].flowDirection].filter(Boolean).join(' · ')))return;
  const derivatives=r.rows.filter((_,i)=>raw[i].op!=='value');
  const narrowed=/(?:收窄|缩小)/u.test(question) ? r.rows.filter((row,i)=>raw[i].op==='difference' && row.value<0 && /差距|差额/u.test(row.item)) : [];
  const rows=narrowed.length?narrowed:r.rows.length<=3?r.rows:derivatives.length?derivatives:r.rows;
  if(rows.length>3)return;
  return {metrics:rows.map(row=>metric({...m,unit:row.unit||m.unit},row.value,row.item))};
}

function groupedInventory(r, data, question) {
  const {plan}=data, dim=r.dimensions[0], m=r.measures[0];
  if(!plan || !m || r.dimensions.length!==1 || !r.rows.length || !data.groups?.length)return;
  if(r.whole && r.rows.length<=12 && /(?:哪些|名单|名称)/u.test(question) && !/占比|占多少/u.test(question)){
    return {title:r.rows.map(row=>row[dim.key]).join('、')};
  }
  if(r.whole?.measureKey===m.key && r.whole.value>0 && /(?:占多少|占比|比重|分布)/u.test(question)){
    const top=r.rows.reduce((best,row)=>row[m.key]>best[m.key]?row:best);
    return {title:'占比最大的'+dim.label+' · '+top[dim.key],
      metrics:[metric(m,top[m.key]),{label:'占本次范围本金',value:100*top[m.key]/r.whole.value,unit:'%'}]};
  }
  const ops=Array.isArray(plan.analysis)?plan.analysis:[];
  if(!ops.some(op=>op.op==='take') || !r.orderedBy || /差|占比|比重/u.test(question))return;
  const ordered=r.measures.find(v=>v.key===r.orderedBy.key), first=r.rows[0];
  if(!ordered || !Number.isFinite(first[ordered.key]))return;
  const title='按'+ordered.label+(r.orderedBy.direction==='desc'?'降序':'升序')+' · '+r.rows.length+' 组';
  const notes=ops.filter(op=>op.op==='having' && op.metric==='securityCount' && op.operator==='gte')
    .map(op=>'每组至少 '+op.value+' 只不同券。');
  return {title,metrics:[metric(ordered,first[ordered.key],first[dim.key])],notes};
}

function monthlyTotals(r, data, arithmetic) {
  const m=r.measures[0], d=r.dimensions[0], totals=data.result.totals;
  if(d?.label!=='交易月份' || !totals || data.plan.limit || r.rows.length<2 ||
    data.result.groupCount!==r.rows.length || arithmetic?.rows?.some(row=>row.op!=='value' || /第[一二三\d]|最/u.test(row.label)))return;
  const moneys=centsPerUnit[m.unit.replace('/笔','')];
  const raw=m.key==='rows'?totals.rows:totals[m.key+'Cents'];
  if(!Number.isFinite(raw) || (m.key!=='average' && !Number.isSafeInteger(raw)) || (m.key!=='rows' && !moneys))return;
  return {title:period(data.plan),metrics:[metric(m,m.key==='rows'?raw:raw/moneys,'期间'+m.label)]};
}

function scalarLead(model, data, explanation) {
  const r=model.result, m=r.measures[0], row=r.rows[0];
  if(r.rows.length!==1 || r.measures.length!==1 || !Number.isFinite(row[m.key]) || data?.overview ||
     data?.roleEvidence || data?.alignment || data?.plan?.analysis?.length || r.whole)return;
  const scope=r.dimensions.map(d=>row[d.key]).filter(Boolean);
  const spec=data?.spec;
  const notes=explanation?[explanation]:[];
  if(spec?.metric==='impliedRatingShare')notes.push('分母为有效评级本金。');
  const title=[model.source,...scope.filter(tag=>!model.source?.includes(tag))].filter(Boolean).join(' · ');
  // A scoped reference may contain a whole roster. Preserve it in the
  // original answer and sources rather than making it the new title.
  if(title.length>95)return;
  const label=model.directionalMagnitude?'净卖出本金':m.label;
  return {title,metrics:[metric(m,model.directionalMagnitude?Math.abs(row[m.key]):row[m.key],label)],notes};
}

function ordinaryDisplayLead(models, answer, question, explanation, moneyUnit) {
  const model=models[0];
  if(!model || model.balanceChange || answer.ledgerReport || answer.alignment || answer.comparison || model.result.columns)return;
  const r=model.result, steps=answer.steps;
  const data=Array.isArray(steps)?steps.length===1 && steps[0].data:answer;
  const missing=unverifiedDuration(model,data,moneyUnit);
  if(missing)return missing;
  if(data?.spec?.metric==='weeklyMean' && !explanation)return weeklyLead(r,data);
  if(r.coverage!=='complete' || answer.arithmetic?.missing)return;
  if(steps?.length===1 && steps[0].source==='trade' && data?.plan && data.result?.completeCoverage===true && !explanation){
    const lead=signedTradeLead(r,data)||tradeRanking(r,data,question)||monthlyLead(r,data,question)||monthlyTotals(r,data,answer.arithmetic);
    if(lead)return lead;
  }
  if(!explanation){
    const computed=models.map(m=>calculatedLead(m.result,answer.arithmetic,question)).find(Boolean);
    if(computed)return computed;
    const scopes=scopeComparison(model,data,question);
    if(scopes)return scopes;
    if(data?.resultId){
      const lead=groupedInventory(r,data,question);
      if(lead)return lead;
    }
  }
  if(data)return scalarLead(model,data,explanation);
}

function contributions(model, arithmetic, question) {
  const r=model.result, raw=arithmetic?.rows;
  if(!/(?:贡献|抵消)/u.test(question) || !Array.isArray(raw) || r.rows.length!==2 || r.dimensions[0]?.kind!=='date' ||
    r.measures.length<2 || raw.length!==r.measures.length+1 || !raw.every(row=>row.op==='difference'))return;
  const m=r.measures[0], dates=r.dimensions[0].key, [first,last]=r.rows;
  if(first[dates]>=last[dates] || !centsPerUnit[m.unit] || r.measures.some(col=>col.unit!==m.unit) ||
    raw.some(row=>!Number.isFinite(row.value) || row.unit!==m.unit))return;
  const close=(a,b)=>Math.abs(a-b)<1/centsPerUnit[m.unit];
  const items=r.measures.map((col,i)=>({scope:col.label.replace(/\s*在账本金$/u,''),delta:raw[i].value}));
  if(r.measures.some((col,i)=>!Number.isFinite(first[col.key]) || !Number.isFinite(last[col.key]) ||
    !raw[i].label.includes(items[i].scope) || !close(last[col.key]-first[col.key],items[i].delta)))return;
  const total=raw.at(-1);
  if(!/(?:全账|全部|合计|总)/u.test(total.label) || !close(items.reduce((n,row)=>n+row.delta,0),total.value))return;
  return {...model,shortTitle:'分项本金变化',displayLead:{title:first[dates]+' 至 '+last[dates],metrics:[metric(m,total.value,total.label)]},
    result:{dimensions:[{key:'scope',label:'分项',kind:'category'}],measures:[{...m,key:'delta',label:'本金变化',signed:true,additive:false}],
      rows:items,coverage:r.coverage,note:r.note,defaultTable:r.defaultTable}};
}

export function ordinaryPresentation(models,answer,question,explanation,moneyUnit='亿元'){
  const model=models[0];
  if(model.balanceChange || answer.ledgerReport || model.displayLead)return models;
  const contribution=!explanation && contributions(model,answer.arithmetic,question);
  if(contribution)return [contribution,...models];
  const displayLead=ordinaryDisplayLead(models,answer,question,explanation,moneyUnit);
  return displayLead?[{...model,displayLead},...models.slice(1)]:models;
}
