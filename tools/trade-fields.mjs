import {accountLabel} from './inventory-account.mjs';
import {InventoryError} from './inventory-workbook.mjs';

export const periodFields=['交易年份','交易月份','交易季度'];
export function validTradeDateRange(field,value){
  if(!['交易日期','交易交割日'].includes(field)||!Array.isArray(value)||value.length!==2||value[0]>value[1])return false;
  return value.every(day=>{
    if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
    const time=Date.parse(day+'T00:00:00Z');
    return Number.isFinite(time)&&new Date(time).toISOString().startsWith(day);
  });
}
export const bondCodeFields=['券码','债券代码','债券标准代码'];
export function literalTradeCodeField(question,field){
  const raw=String(question||'');
  const standard=raw.includes('债券标准代码')&&!/(?:不要|不用|排除|别用|不按)[^，。；]{0,5}债券标准代码/.test(raw);
  const primary=/(?:原表|原始|精确匹配)[^，。；]{0,5}债券代码|债券代码(?:列|字段)/.test(raw);
  if(standard&&primary)return ['债券代码','债券标准代码'].includes(field)?field:null;
  return standard?'债券标准代码':primary?'债券代码':null;
}
const codeText=value=>String(value??'').trim().normalize('NFKC').toUpperCase();
export function mentionsTradeCode(text,code){
 const wanted=codeText(code);
 return !!wanted&&codeText(text).split(/[^A-Z0-9.\-]+/).includes(wanted);
}
const codeBase=value=>value.replace(/\.[A-Z]{2,6}$/,'');
export function groupedTradeCode(raw,standard){
  const codes=[raw,standard].map(codeText).filter(Boolean);
  return codes.find(code=>codeBase(code)!==code)||codes[0]||'';
}
// Validate unresolved bare identifiers across all books in this execution.
// A qualified request must never broaden to a different exchange.
export function tradeCodeLookup(filters){
  const requested=filters.map(f=>({op:f.op,ids:[].concat(f.value).map(codeText)}));
  const bare=new Map(),unqualified=new Set(),labels=new Map();
  return {
    test(raw,standard){
      const codes=[...new Set([raw,standard].map(codeText).filter(Boolean))];
      return requested.every(({op,ids})=>{
        if(op==='notEmpty')return !!codes.length;
        if(op==='contains')return codes.some(code=>code.includes(ids[0]));
        let hit=false;
        for(const id of ids){
          const base=codeBase(id),related=codes.filter(code=>codeBase(code)===base);
          const markets=related.filter(code=>codeBase(code)!==code);
          const equal=related.includes(id)||base===id&&related.length>0;
          if(equal){
            const fields=labels.get(id)||new Map();
            for(const [field,code] of [['券码',groupedTradeCode(raw,standard)],['债券代码',raw],['债券标准代码',standard]]){
              const values=fields.get(field)||new Set();values.add(codeText(code)||'（未填）');fields.set(field,values);
            }
            labels.set(id,fields);
          }
          if(base===id&&related.length){
            const options=bare.get(id)||new Set();for(const code of markets)options.add(code);
            bare.set(id,options);hit=true;
          }else if(base!==id){
            if(related.includes(id))hit=true;
            if(related.length&&!markets.length)unqualified.add(id);
          }
        }
        return hit;
      });
    },
    groupLabels(id,field){
      // Keep a zero with the requested identifier if no qualifying security was observed.
      return labels.get(codeText(id))?.get(field)||new Set([codeText(id)]);
    },
    verify(){
      for(const [id,options] of bare)if(options.size>1)throw new InventoryError('券码 '+id+' 在所选范围对应多个市场代码，请选 '+[...options].sort().join('、')+'。',422);
      if(unqualified.size)throw new InventoryError('部分匹配流水仅列无市场后缀代码，无法核实是否属于 '+[...unqualified].join('、')+'。请核对原表代码或明确按不分市场的基础代码查询。',422);
    }
  };
}
export function periodLabel(field,date){
  if(field==='交易年份')return date.slice(0,4);
  if(field==='交易月份')return date.slice(0,7);
  return date.slice(0,4)+'Q'+Math.ceil(Number(date.slice(5,7))/3);
}
function calendarValue(field,value){
  const raw=value.normalize('NFKC').replace(/\s/g,'');
  if(field==='交易季度'){
    const quarter=/^(?:(\d{4})[年-]?)?(?:第|Q)?([1-4一二三四])(?:季度|季)?$/i.exec(raw);
    if(quarter)return (quarter[1]||'')+'Q'+(Number(quarter[2])||'一二三四'.indexOf(quarter[2])+1);
  }else if(field==='交易月份'){
    const month=/^(?:(\d{4})[-年])?(0?[1-9]|1[0-2])月?$/.exec(raw);
    if(month)return (month[1]?month[1]+'-':'M')+month[2].padStart(2,'0');
    if(/^M(?:0[1-9]|1[0-2])$/.test(raw))return raw;
  }else if(/^\d{4}年?$/.test(raw))return raw.slice(0,4);
  throw new InventoryError('请使用真实交易期间。年份如 2025，年月如 2025-03，季度如 2025Q1；跨年同季可使用 Q1。',422);
}
export function normalizeTradeFilter(filter,question=''){
  const {field,op,value}=filter;
  if(op==='notEmpty')return {field,op,value:''};
  const values=op==='in'?value:[value];
  if(bondCodeFields.includes(field)){
    return {...filter,field:literalTradeCodeField(question,field)||'券码'};
  }
  // A fund mandate is an accounting class; “委外” alone is still an on/off-book scope.
  if(['表内/委外','会计科目','会计分类'].includes(field)&&
      values.every(v=>['AFS','Receivable','Trading','委外（公募）','委外（专户）'].includes(accountLabel(v)))){
    const cleaned=values.map(v=>accountLabel(v));
    return {field:'会计分类',op:op==='contains'?'eq':op,value:op==='in'?cleaned:cleaned[0]};
  }
  if(!periodFields.includes(field))return filter;
  const cleaned=values.map(v=>calendarValue(field,v));
  return {field,op:op==='contains'?'eq':op,value:op==='in'?cleaned:cleaned[0]};
}
export function periodMatches(field,label,value){
  if(field==='交易季度'&&/^Q[1-4]$/.test(value))return label.endsWith(value);
  if(field==='交易月份'&&/^M\d\d$/.test(value))return label.endsWith('-'+value.slice(1));
  return label===value;
}
