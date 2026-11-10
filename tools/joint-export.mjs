import {InventoryError,inventoryExportSheets} from './inventory-workbook.mjs';
import {exportData} from './inventory-store.mjs';
import {tradeExportSheets} from './trade-store.mjs';
import {exportTradeWorkbook} from './trade-workbook.mjs';
import {portfolioMetrics} from './portfolio-metrics.mjs';

export async function jointExcel(resources,question,answer,tradeIds,chosen,portfolio={}){
  const toYuan=n=>Number.isSafeInteger(n)?n/100:'';
  const steps=chosen?answer.steps.filter(s=>s.id===chosen):answer.steps;
  if(!steps?.length)throw new InventoryError('没有可下载的查询步骤。',404);
  const info=[['问题',question],['口径','余额取快照时点持仓，增减持取交易日期间流水。金额单位见各表列名。']];
  const sheets=[{name:'问答口径',headers:['项目','内容'],rows:info}];
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
    const add=specs=>{
      for(const spec of specs){
        const rows=spec.total?(function*(){yield* spec.rows;yield spec.total;})():spec.rows;
        sheets.push({...spec,name:(i+1)+'-'+(++sheetNumber)+' '+spec.name,rows});
      }
    };
    if(s.source==='portfolio'&&s.data?.headline){
      const data=await portfolioMetrics(resources,{...s.spec,marketPins:portfolio.marketPins},portfolio.snapshots,{details:true});
      info.push(['组合指标',s.data.headline],...(s.data.notes||[]).map(n=>['计算口径',n]));
      add([{name:'指标汇总',headers:s.data.columns,rows:s.data.rows},...(data.detailSheets||[])]);
    }else if(s.source==='inventory'){
      const values=s.data?.overview?.map(item=>item.result)||[s.data];
      for(const v of values){if(!v?.resultId)continue;
        const {result,rows}=await exportData(resources.db,v.resultId);
        add(inventoryExportSheets(result,rows));
      }
    }else if(s.data?.result && s.data.plan){add(await tradeExportSheets(resources,s.data.plan,tradeIds));}
  }
  if(sheets.length===1)throw new InventoryError('这轮仅有澄清信息，没有可导出的数据。');
  return exportTradeWorkbook(sheets);
}
