import {InventoryError,inventoryExportSheets} from './inventory-workbook.mjs';
import {exportData} from './inventory-store.mjs';
import {tradeExportSheets} from './trade-store.mjs';
import {exportTradeWorkbook} from './trade-workbook.mjs';
import {portfolioMetrics} from './portfolio-metrics.mjs';
import {buildProfile} from './inventory-profile.mjs';
import {exportMemberReport} from './inventory-member-analysis.mjs';
import {holdingRowsReport} from './inventory-row-report.mjs';

export async function jointExcel(resources,question,answer,tradeIds,chosen,portfolio={}){
  const toYuan=n=>Number.isSafeInteger(n)?n/100:'';
  const steps=chosen?answer.steps.filter(s=>s.id===chosen):answer.steps;
  if(!steps?.length)throw new InventoryError('没有可下载的查询步骤。',404);
  const info=[['问题',question],['口径','余额取快照时点持仓，增减持取交易日期间流水。金额单位见各表列名。']];
  const sheets=[{name:'问答口径',headers:['项目','内容'],rows:info}];
  const reportSheet=report=>({
    name:'分析核对表',headers:report.columns.map(c=>c.label+(c.unit?'（'+c.unit+'）':'')),
    rows:report.rows.map(r=>report.columns.map(c=>r[c.key]??'')),
  });
  if(!chosen && answer.ledgerReport){
    const report=answer.ledgerReport;
    info.push(['分析结果',report.summary],['来源',report.source],['说明',report.note||'']);
    if(!steps.some(s=>s.data?.profileSpec||s.data?.memberReportSpec||s.data?.holdingRowReport))sheets.push(reportSheet(report));
  }
  if(!chosen){
    for(const note of answer.methodNotes||[])info.push(['指标口径',note]);
    const sets=answer.memberSets;
    if(sets){
      for(const [i,label] of sets.labels.entries())info.push(['范围 '+(i+1),label]);
      if(sets.note)info.push(['名单说明',sets.note]);
      else{
        info.push(['两边都有',sets.both.length],['仅范围 1',sets.leftOnly.length],['仅范围 2',sets.rightOnly.length],['并集',sets.total]);
        sheets.push({name:'完整名单',headers:[sets.field,'归属范围'],rows:[
          ...sets.both.map(name=>[name,'两边都有']),...sets.leftOnly.map(name=>[name,'仅范围 1']),...sets.rightOnly.map(name=>[name,'仅范围 2'])]});
      }
    }
  }
  if((!chosen || answer.steps.length===1) && answer.arithmetic?.rows?.length){
    const calculations=answer.arithmetic.rows;
    const showDirection=calculations.some(row=>row.flowDirection);
    sheets.push({
      name:'派生计算',
      headers:['指标','结果','单位','运算','依据',...(showDirection?['交易净流向']:[])],
      rows:calculations.map(row=>[row.label,row.value??'',row.unit,row.op,
        row.inputs.map(input=>input.label+' '+input.value+' '+input.unit).join('；'),
        ...(showDirection?[row.flowDirection||'']:[])]),
    });
  }
  if(!chosen && answer.comparison){
    const c=answer.comparison;
    for(const [key,label] of [['openingCents','期初余额'],['closingCents','期末余额'],['changeCents','余额变化'],['netCents','期间净增持'],['gapCents','余额变化减净增持']]){
      if(Number.isSafeInteger(c[key]))info.push([label+'（元）',toYuan(c[key])]);
    }
    if(c.note)info.push(['说明',c.note]);
  }
  if(!chosen && answer.alignment?.columns?.length){
    const a=answer.alignment;
    sheets.push({name:'分组对照',headers:[a.field,...a.columns.map(col=>col.label+'（元）')],rows:a.rows.map(r=>[r.name,...r.values.map(toYuan)])});
    if(a.note)info.push(['分组说明',a.note]);
  }
  for(const [i,s] of steps.entries()){
    info.push([{inventory:'库存',trade:'交易',portfolio:'组合指标'}[s.source],s.question]);
    if(s.data?.clarification)info.push(['核对说明',s.data.clarification]);
    let sheetNumber=0;
    const add=(specs,section='')=>{
      for(const spec of specs){
        const rows=spec.total?(function*(){yield* spec.rows;yield spec.total;})():spec.rows;
        // The unique numeric prefix survives Excel's worksheet-name length limit.
        const name=((i+1)+'-'+(++sheetNumber)+' '+(section?section+' ':'')+spec.name).slice(0,31);
        sheets.push({...spec,name,rows});
      }
    };
    if(s.source==='portfolio'&&s.data?.headline){
      const data=await portfolioMetrics(resources,{...s.spec,marketPins:portfolio.marketPins},portfolio.snapshots,{details:true});
      info.push(['组合指标',s.data.headline],...(s.data.notes||[]).map(n=>['计算口径',n]));
      add([{name:'指标汇总',headers:s.data.columns,rows:s.data.rows},...(data.detailSheets||[])]);
    }else if(s.source==='inventory'){
      if(s.data?.memberReportSpec)add([reportSheet(await exportMemberReport(resources.db,s.data))]);
      const items=s.data?.overview||[{result:s.data}];
      for(const {role,title,result:v} of items){
        if(title)info.push([title,v?.clarification||v?.summary||'']);
        if(!v?.resultId)continue;
        const {result,rows}=await exportData(resources.db,v.resultId);
        if(v.profileSpec)add([reportSheet(buildProfile(v.profileSpec,rows,result.snapshot))]);
        if(v.holdingRowReport)add([reportSheet(holdingRowsReport(rows,result.snapshot))]);
        const section={issuer:'自发债',enhancement:'增信ABS',union:'去重合计'}[role]||
          (title==='自己发行的债券'?'自发债':title==='占用其授信的 ABS'?'增信ABS':'');
        add(inventoryExportSheets(result,rows),section);
      }
    }else if(s.data?.flowPlans){
      for(const plan of s.data.flowPlans)add(await tradeExportSheets(resources,plan,tradeIds));
    }else if(s.data?.result && s.data.plan){
      const selection=s.appliedSelection;
      const field=selection&&{issuer:'发行人全称',branch:'联动分行',code:'券码',account:'会计分类'}[selection.field];
      add(await tradeExportSheets(resources,s.data.plan,tradeIds,field?{field,names:selection.names}:undefined));
    }
  }
  if(sheets.length===1)throw new InventoryError('这轮仅有澄清信息，没有可导出的数据。');
  return exportTradeWorkbook(sheets);
}
