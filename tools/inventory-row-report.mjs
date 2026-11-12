import {answerDetails,exportData,newInventoryAnswer} from './inventory-store.mjs';
import {InventoryError} from './inventory-workbook.mjs';
import {accountLabel} from './inventory-account.mjs';

export function holdingRowsReport(rows,snapshot) {
  const columns=[['sourceRow','原表行号','number'],['code','债券代码'],['name','债券简称'],['issuer','发行人'],
    ['account','会计科目'],['branch','联动分行'],['principal','名义本金','number','元']]
    .map(([key,label,kind='category',unit])=>({key,label,kind,...(unit?{unit}:{})}));
  const codes=[...new Set(rows.map(r=>r.code).filter(Boolean))];
  const total=rows.reduce((sum,r)=>sum+r.cents,0);
  return {title:'原表持仓行',source:snapshot.date+' 余额台账 · '+snapshot.filename,
    summary:'原表匹配 '+rows.length+' 条持仓、'+codes.length+' 只券，合计 '+(total/100).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 元。'+
      (codes.length===1?'券码为 '+codes[0]+'。':''),
    note:'原表行号与本次对话锁定的台账文件对应，同一券码在不同持仓行分别列出。',
    columns,rows:rows.map(r=>({sourceRow:r.sourceRow,code:r.code,name:r.name,issuer:r.issuer,account:accountLabel(r.account),branch:r.branch||'未填写',principal:r.cents/100}))};
}
export async function describeHoldingRows(db,data) {
  if(!data?.resultId)return data;
  const {rows,result}=await exportData(db,data.resultId);
  const report=holdingRowsReport(rows,result.snapshot);
  const ledgerReport=report.rows.length<=100?report:{...report,rows:report.rows.slice(0,100),note:report.note+' 页面列出前100行，下载可核全部持仓。'};
  return {...data,holdingRowReport:true,ledgerReport};
}
export async function snapshotEvidence({db,bucket},step,ctx){
  const snapshot=ctx.snapshots.find(s=>s.date===step.snapshotDate);
  if(!snapshot)throw new InventoryError('这一天没有已导入的余额台账。',422);
  let group=step.group;
  if(step.request==='source' && group==='none'){
    const match=/(?:按|分)[照各]?(?:联动)?(分行|会计科目|账户)(?:列|来列|分别|汇总|分组|展示|统计)/u.exec(ctx.question||'');
    if(match)group=match[1]==='分行'?'branch':'account';
  }
  const data=await newInventoryAnswer(db,snapshot,{date:snapshot.date,group,metric:'principal',filters:step.filters},bucket);
  if(!data.resultId)return data;
  const current=await db.prepare('SELECT version FROM inventory_current WHERE date=?').bind(snapshot.date).first();
  const object=typeof bucket?.head==='function'?await bucket.head('inventory/'+snapshot.date+'/'+snapshot.id+'.xlsx'):null;
  const uploadedBy=object?.customMetadata?.uploadedBy||null;
  const sourceEvidence={date:snapshot.date,id:snapshot.id,file:snapshot.filename,sheet:snapshot.sheet,uploadedBy,active:current?.version===snapshot.id};
  const version='本对话锁定 '+snapshot.date+' 的《'+snapshot.filename+'》，工作表“'+snapshot.sheet+'”，快照版本 '+snapshot.id+'。'+
    (sourceEvidence.active?'此版本仍为该日已发布版本。':'该日已发布了其他版本，旧对话和下载继续使用此处锁定的版本。');
  const identity='同一台账空间使用共同发布的版本。'+(uploadedBy?'该版本上传账号为 '+uploadedBy+'。':'该版本未保留可核对的上传账号。');
  const count='原表共 '+snapshot.rowCount+' 条持仓；本次筛选有 '+data.rowCount+' 条，本金 '+(data.totalCents/1e10).toLocaleString('zh-CN',{maximumFractionDigits:10})+' 亿元。';
  let report;
  if(step.request==='positiveMinimum'){
    const {rows}=await exportData(db,data.resultId);
    const min=rows.reduce((v,r)=>r.cents>0&&(v===null||r.cents<v)?r.cents:v,null);
    const hits=min===null?[]:rows.filter(r=>r.cents===min);
    report=holdingRowsReport(hits.slice(0,step.examples||1),snapshot);
    report.title='最小正本金持仓';
    report.summary=min===null?'筛选范围没有正本金持仓。':'最小正本金是 '+(min/1e10).toLocaleString('zh-CN',{maximumFractionDigits:10})+
      ' 亿元，即 '+(min/100).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 元，共 '+hits.length+' 行同额。';
  }else if(group!=='none'){
    report={title:'台账来源与分组本金',summary:count,source:version,note:'',columns:[
      {key:'name',label:group==='branch'?'联动分行':'会计科目',kind:'category'},
      {key:'principal',label:'持仓本金',unit:'亿元',kind:'number'},{key:'count',label:'持仓行数',unit:'条',kind:'number'}],
      rows:[...data.groups.map(g=>({name:g.name||'未填写',principal:g.cents/1e10,count:g.count})),{name:'合计',principal:data.totalCents/1e10,count:data.rowCount}]};
  }else{
    const rows=step.examples?(await answerDetails(db,data.resultId,{limit:step.examples})).rows:[];
    report=holdingRowsReport(rows,snapshot);
    report.title=step.examples?'来源与原表持仓样例':'余额台账版本';report.summary=count;
    if(!step.examples){
      report.columns=[{key:'date',label:'业务日期',kind:'date'},{key:'file',label:'来源文件',kind:'category'},{key:'id',label:'快照版本',kind:'category'}];
      report.rows=[sourceEvidence];
    }
  }
  report.summary+=' '+version;
  report.note=[report.note,identity,'下载中的“来源与口径”记录同一文件、业务日和快照版本。'].filter(Boolean).join(' ');
  return {...data,sourceEvidence,ledgerReport:report};
}
