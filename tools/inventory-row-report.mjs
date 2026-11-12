import {exportData} from './inventory-store.mjs';
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
