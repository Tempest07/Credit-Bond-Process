import PizZip from 'pizzip';
import {Zip,ZipDeflate} from 'fflate';
import {InventoryError,relationships,workbookInfo,sharedStrings,readPart,dateOf,amount,metadata,rowXml,columnName,maxPartBytes,maxWorkbookBytes} from './inventory-workbook.mjs';

const fail=msg=>{throw new InventoryError(msg)};
const baseHeaders=['交易日期','交易交割日','名义本金','债券代码','发行人全称','债券简称','合同号'];
const txt=v=>String(v??'').trim();
export function parseTradeWorkbook(bytes,filename,{compact=false}={}){
  const tag=/([增减])持.*?(\d{2}|20\d{2})(01)\s*[-~至－—]\s*(\d{2}|20\d{2})(0[1-9]|1[0-2])(?:[^\d]|$)/u.exec(filename);
  if(!tag || tag[2].slice(-2)!==tag[4].slice(-2))fail('文件名应标明增持或减持，以及同一年度从 01 月开始的累计范围，例如“信用债增持台账报表2601-2610.xlsx”。');
  const direction=tag[1]==='增'?'buy':'sell', year=2000+Number(tag[2].slice(-2)), month=Number(tag[5]);
  const declaredEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  if(bytes.byteLength>16*1024*1024)fail('单份交易台账不得超过 16 MB。');
  try{
    const zip=new PizZip(bytes), entries=Object.values(zip.files);
    if(entries.length>3000 || entries.reduce((s,e)=>s+(e._data?.uncompressedSize||0),0)>maxWorkbookBytes ||
      entries.some(e=>e._data?.uncompressedSize>maxPartBytes || /vbaProject\.bin$/i.test(e.name)))fail('工作簿内容过大或含宏。');
    const parts=relationships(zip),{sheets,epoch1904}=workbookInfo(zip,parts),strings=sharedStrings(zip,parts);
    let result=null;
    for(const sheet of sheets){
      let headers,index,dayCol,amtCol,codeCol,settleCol,reportCol,sourceRow=0,col=-1,cellType='',capture=false,inCell=false,val='',cells=[],phonetic=false;
      let start='',end='',reportDate='',totalCents=0,outOfPeriodRows=0,outOfPeriodCents=0,inPeriod=0;
      let pending=[],rowCount=0;
      const chunks=[], skipped=Symbol('skip');
      function flush(){
        if(!pending.length)return;
        const dates=pending.map(r=>r[dayCol]).sort();
        chunks.push({range:[dates[0],dates.at(-1)],bytes:new TextEncoder().encode(JSON.stringify(pending))});pending=[];
      }
      function closeRow(){
        if(!headers){
          const names=Array.from(cells,txt);
          if(!baseHeaders.every(h=>names.includes(h)))return;
          if(result)fail('存在多个可识别的交易明细表，请每份文件只保留一张明细表。');
          if(names.length>128 || names.some(h=>!h || h.length>100) || new Set(names).size!==names.length)fail('交易表头存在空白、过长或重复列，请核对。');
          const buy=names.includes('买入收益率'),sell=names.includes('卖出收益率');
          if(buy===sell || buy!==(direction==='buy'))fail('交易方向与原表买入/卖出收益率列不一致。');
          headers=names;index=Object.fromEntries(names.map((h,i)=>[h,i]));
          dayCol=index['交易日期'];amtCol=index['名义本金'];codeCol=index['债券代码'];settleCol=index['交易交割日'];reportCol=index['数据业务日期'];return;
        }
        if(!cells.some(v=>txt(v)))return;
        if(!txt(cells[codeCol]) && !txt(cells[dayCol]) && cells.some(v=>/^(?:合计|小计|总计)$/.test(txt(v))))return;
        if(rowCount>=60000)fail('单份交易台账超过 60,000 笔。');
        if(!txt(cells[codeCol]))fail('交易明细第 '+sourceRow+' 行缺少券码。');
        for(let i=0;i<cells.length;i++){
          if(cells[i]!=null && /日期$|到期日$|起息日$|交割日$/.test(headers[i])){
            const d=dateOf(cells[i],epoch1904);if(d)cells[i]=d;
          }
        }
        const day=dateOf(cells[dayCol],epoch1904), settlement=dateOf(cells[settleCol],epoch1904);
        if(!day)fail('交易明细第 '+sourceRow+' 行交易日期无效。');
        const contained=d=>d>=year+'-01-01' && d<=declaredEnd;
        if(!contained(day) && !contained(settlement))fail('第 '+sourceRow+' 行交易日和交割日均不属于文件声明的累计期间。');
        if(contained(day))inPeriod++;else outOfPeriodRows++;
        const cents=amount(cells[amtCol],sourceRow);
        if(cents<0)fail('第 '+sourceRow+' 行名义本金为负，无法确认原表对冲/冲正口径。');
        if(!contained(day))outOfPeriodCents+=cents;
        cells[amtCol]=cents;
        totalCents+=cents;if(!Number.isSafeInteger(totalCents))fail('交易金额累计超过精确统计范围。');
        if(!start || day<start)start=day;if(day>end)end=day;
        const report=dateOf(cells[reportCol],epoch1904);
        if(report>reportDate)reportDate=report;
        cells.length=headers.length;cells.push(sourceRow);pending.push(cells);rowCount++;if(compact && pending.length>=1600)flush();
      }
      try{readPart(zip,sheet.path,{
        open(n,a){
          if(n==='row'){
            const next=a.r?Number(a.r):sourceRow+1;
            if(!Number.isSafeInteger(next)||next<=sourceRow)fail('无效的交易原表行号。');
            sourceRow=next;if(!headers && sourceRow>24)throw skipped;
            col=-1;cells=[];
          }else if(n==='c'){
            const ref=a.r?/^([A-Z]{1,3})(\d+)$/.exec(a.r):null;
            if(a.r && (!ref||Number(ref[2])!==sourceRow))fail('无效的交易原表单元格。');
            col=ref?Array.from(ref[1]).reduce((s,k)=>s*26+k.charCodeAt(0)-64,0)-1:col+1;
            inCell=true;capture=false;cellType=a.t||'n';val='';
          }else if(inCell){if(n==='rPh')phonetic=true;if(n==='v'||(n==='t' && cellType==='inlineStr' && !phonetic))capture=true;}
        },
        text(s){if(capture){val+=s;if(val.length>32767)fail('单元格内容超过限制。');}},
        close(n){
          if(n==='v'||n==='t')capture=false;
          if(n==='rPh')phonetic=false;
          if(n==='c'){inCell=false;if(!val)return;
            if(col>127)fail('交易明细超过 128 列。');
            if(cellType==='s'){if(!/^\d+$/.test(val)||Number(val)>=strings.length)fail('无效的工作簿字符串引用。');cells[col]=strings[Number(val)];}
            else if(cellType==='n'){const k=Number(val);if(!Number.isFinite(k))fail('原表存在无效数字。');cells[col]=k;}
            else if(cellType!=='e'){cells[col]=cellType==='d'?val.slice(0,10):val;}
          }
          if(n==='row')closeRow();
        }
      });}catch(e){if(e===skipped)continue;throw e;}
      if(headers){
        if(!rowCount || !inPeriod)fail('声明的累计期间没有可验证的交易明细。');
        const asOf=(reportDate||end)<declaredEnd?(reportDate||end):declaredEnd;
        if(asOf<start)fail('数据业务日期早于交易期间。');
        if(compact)flush();
        result={year,direction,filename,sheet:sheet.name,headers,start,end,asOf,declaredEnd,reportDate,rowCount,totalCents,outOfPeriodRows,outOfPeriodCents,...(compact?{chunks}:{rows:pending})};
      }
    }
    if(!result)fail('未找到包含交易日期、交易交割日、合同号、名义本金、券码和发行人的交易表。');
    return result;
  }catch(e){if(e instanceof InventoryError)throw e;throw new InventoryError('无法读取此 .xlsx 交易台账。');}
}

// Workbook rows are written a chunk at a time (detail rows may be fetched from
// multiple immutable R2 objects); never build a second in-memory worksheet DOM.
export async function exportTradeWorkbook(sheets){
  const parts=[],enc=new TextEncoder();let len=0;
  const zip=new Zip((err,chunk)=>{if(err)throw err;parts.push(chunk);len+=chunk.length;});
  const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  metadata((path,content)=>{const entry=new ZipDeflate(path,{level:1});zip.add(entry);entry.push(enc.encode(xml+content),true);},sheets.map(s=>s.name));
  for(const [i,s] of sheets.entries()){
    const entry=new ZipDeflate('xl/worksheets/sheet'+(i+1)+'.xml',{level:1});zip.add(entry);
    let str=xml+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>'+rowXml(1,s.headers),n=1;
    for await(const row of s.rows){str+=rowXml(++n,row);if(str.length>=32000){entry.push(enc.encode(str),false);str='';}}
    entry.push(enc.encode(str+'</sheetData><autoFilter ref="A1:'+columnName(s.headers.length-1)+n+'"/></worksheet>'),true);
  }
  zip.end();const out=new Uint8Array(len);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}
