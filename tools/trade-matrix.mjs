import {runTradeQuery} from './trade-store.mjs';

const metricLabels={buy:'买入本金',sell:'卖出本金',net:'净买入本金',rows:'交易笔数'};
const units=k=>k==='rows'?'笔':'亿元';
const number=(key,label,unit)=>({key,label,unit,kind:'number'});
const dimension=(key,label)=>({key,label,kind:'category'});
const display=(x,k)=>x===null?null:k==='rows'?x:x/1e10;
const format=(x,k)=>x===null?'待核':display(x,k).toLocaleString('zh-CN',{maximumFractionDigits:6})+' '+units(k);
function monthRange(a,b){
  const start=new Date(a.slice(0,7)+'-01T00:00:00Z'),out=[];
  for(;start.toISOString().slice(0,10)<=b;start.setUTCMonth(start.getUTCMonth()+1)){
    const month=start.toISOString().slice(0,7);
    const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).toISOString().slice(0,10);
    out.push({month,start:a>month+'-01'?a:month+'-01',end:b<end?b:end});
  }
  return out;
}
function add(values){return values.every(Number.isSafeInteger)?values.reduce((a,b)=>a+b,0):null;}
function difference(a,b){return Number.isSafeInteger(a)&&Number.isSafeInteger(b)?a-b:null;}
async function readSeries(resources,series,step,ids,query,branchCache){
  const months=monthRange(series.start,series.end),directions=step.direction==='both'?['buy','sell']:[step.direction];
  const components=await Promise.all(directions.map(async side=>{
    let filters=series.filters;
    const plan={direction:side,start:series.start,end:series.end,metric:side,filters,groupBy:['交易月份']};
    try{
      const branch=filters.find(f=>f.field==='联动分行');
      if(branch&&!branch.value.endsWith('分行')){
        const key=JSON.stringify([side,series.start,series.end]);
        if(!branchCache.has(key))branchCache.set(key,query(resources,{...plan,filters:[],groupBy:['联动分行']},ids,{collectMembers:true}));
        const found=await branchCache.get(key),names=found.memberNames||found.groups.map(g=>g.values[0]);
        const canonical=names.includes(branch.value)?branch.value:names.find(n=>n===branch.value+'分行');
        if(canonical)plan.filters=filters.map(f=>f===branch?{...f,value:canonical}:f);
      }
      const hit=await query(resources,plan,ids);
      const grouped=new Map(hit.groups.map(g=>[g.values[0],g]));
      const values=months.map(m=>{
        const source=hit.versions.find(v=>v.year===Number(m.start.slice(0,4))&&v.direction===side);
        if(!source||source.asOf<m.end)return null;
        const g=grouped.get(m.month);return {cents:g?.[side+'Cents']??0,rows:g?.rows??0};
      });
      return {side,values,plan:hit.plan,sources:hit.versions.map(v=>v.filename),notes:hit.warnings||[]};
    }catch(e){
      if(![400,409,422].includes(e?.status))throw e;
      return {side,values:months.map(()=>null),sources:[],notes:[e.message]};
    }
  }));
  const bySide=Object.fromEntries(components.map(x=>[x.side,x.values]));
  const cells=months.map((m,index)=>{
    const buy=bySide.buy?.[index]?.cents??null,sell=bySide.sell?.[index]?.cents??null;
    return {...m,buy,sell,net:difference(buy,sell),rows:add(components.map(x=>x.values[index]?.rows??null))};
  });
  return {...series,cells,plans:components.map(x=>x.plan).filter(Boolean),sources:components.flatMap(x=>x.sources),
    notes:components.flatMap(x=>x.notes),total:Object.fromEntries(step.metrics.map(k=>[k,add(cells.map(c=>c[k]))]))};
}
export function buildTradeMatrix(spec,series){
  const {metrics,layout,shares,compare}=spec,rows=[],columns=[];
  const max=Math.max(...series.map(s=>s.cells.length));
  const aligned=i=>{
    const dates=series.map(s=>s.cells[i]?.month).filter(Boolean);
    return new Set(dates).size===1?dates[0]:new Set(dates.map(v=>v.slice(-2))).size===1?Number(dates[0].slice(-2))+'月':'第 '+(i+1)+' 月';
  };
  const headers=(prefix,label)=>{
    for(const k of metrics){columns.push(number(prefix+k,label+metricLabels[k],units(k)));
      if(shares)columns.push(number(prefix+k+'Share',label+metricLabels[k]+'占本组期间合计','%'));}
  };
  const write=(r,prefix,values,total)=>{
    for(const k of metrics){const v=values?.[k]??null;r[prefix+k]=display(v,k);
      if(shares)r[prefix+k+'Share']=v!==null&&Number.isSafeInteger(total[k])&&total[k]!==0?100*v/total[k]:null;}
  };
  const deltas=(r,left,right)=>{
    if(compare==='none')return;
    for(const k of metrics){
      const a=left?.[k],b=right?.[k],delta=difference(a,b);
      r['diff'+k]=display(delta,k);
      if(compare==='growth')r['growth'+k]=delta!==null&&b!==0?100*delta/b:null;
    }
  };
  if(layout==='periodRows'||layout==='seriesRows'){
    columns.push(dimension('name','查询范围'));
    if(layout==='seriesRows')for(let i=0;i<max;i++)headers('m'+i,aligned(i)+' ');
    headers('total',layout==='seriesRows'?'期间合计 ':'');
    for(const s of series){const r={name:s.label};
      if(layout==='seriesRows')for(let i=0;i<max;i++)write(r,'m'+i,s.cells[i],s.total);
      write(r,'total',s.total,s.total);rows.push(r);}
  }else{
    columns.push(dimension('month','月份'));
    series.forEach((s,j)=>headers('s'+j,s.label+' '));
    if(compare!=='none'){
      const order=series[0].label+'减'+series[1].label;
      for(const k of metrics){columns.push(number('diff'+k,order+' '+metricLabels[k]+'差额',units(k)));
        if(compare==='growth')columns.push(number('growth'+k,metricLabels[k]+'增幅','%'));}
    }
    for(let i=0;i<=max;i++){
      const r={month:i===max?'期间合计':aligned(i)};
      const values=series.map(s=>i===max?s.total:s.cells[i]);
      series.forEach((s,j)=>write(r,'s'+j,values[j],s.total));
      deltas(r,values[0],values[1]);rows.push(r);
    }
  }
  let summary=series.map(s=>s.label+'（'+s.start+' 至 '+s.end+'）'+metrics.map(k=>metricLabels[k]+' '+format(s.total[k],k)).join('、')).join('；')+'。';
  if(compare!=='none'){
    const [a,b]=series;
    for(const k of metrics){
      const diff=difference(a.total[k],b.total[k]);
      summary+=a.label+'减'+b.label+'的'+metricLabels[k]+'差额 '+format(diff,k)+'。';
      if(compare==='growth'&&diff!==null&&b.total[k]!==0)summary+='合并期间增幅 '+(100*diff/b.total[k]).toFixed(4)+'%，以对照期间合计为分母。各月基数有别，不能直接平均月度增幅。';
      if(layout==='monthsRows'){const negative=rows.slice(0,-1).filter(r=>r['diff'+k]<0).map(r=>r.month);
        summary+='差额为负的月份'+(negative.length?'为 '+negative.join('、'):'没有')+'。';}
    }
  }
  return {title:'交易流水对照表',summary,columns,rows,source:[...new Set(series.flatMap(s=>s.sources))].join('、'),
    note:['按原始成交日归期。覆盖完整且无匹配成交记为 0，缺台账或超过累计截止日的单元格留空。',...new Set(series.flatMap(s=>s.notes))].join(' ')};
}
export async function tradeMatrix(resources,step,ctx,query=runTradeQuery){
  const ids=ctx.ledgers.map(v=>v.id),cache=new Map();
  const series=await Promise.all(step.series.map(s=>readSeries(resources,s,step,ids,query,cache)));
  return {flowPlans:series.flatMap(s=>s.plans),flowMatrixSpec:{layout:step.layout,metrics:step.metrics,direction:step.direction,series:step.series,shares:step.shares,compare:step.compare},
    ledgerReport:buildTradeMatrix(step,series)};
}
