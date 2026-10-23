import { isQbStopError } from './client.js';

const MARKET = '/dm-quant-func-service/api/v1/bond/market-data/date';
const COMPANY = '/dm-quant-func-service/api/v1/company/basic-info/info';
const PRIMARY = '/dm-quant-func-service/api/v1/bond/primary/data';
const codePattern = /^\d{6,12}\.(IB|SH|SZ|BJ)$/;
const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const number = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const list = value => (Array.isArray(value) ? value : value ? [value] : []).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean);
const fullCode = value => { const text = compact(value); return codePattern.test(text) ? text : ''; };
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
function date(value) {
  if (typeof value === 'number' && Number.isInteger(value)) value=String(value);
  if (typeof value !== 'string') return '';
  if (/^\d{8}$/.test(value)) value=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { try { return validDate(value) ? value : ''; } catch { return ''; } }
  if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return '';
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Date(parsed.getTime()+8*3600000).toISOString().slice(0,10) : '';
}
function shift(day, amount) { const value=new Date(day+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10); }
function meta(client, apiNames, day, fieldMap) {
  const units={};
  for(const field of Object.keys(fieldMap)){
    if(/^(?:cb|cs)Yt[me]$/.test(field)||field==='couponRate'||field==='subscribeRate')units[field]='%';
    if(/^(?:cb|cs)Npt[me]$/.test(field))units[field]='元';
  }
  return { apiNames, date:day, fetchedAt:client.fetchedAt, fieldMap, units };
}

export async function marketFallback(path, input, client) {
  if (path === MARKET) return valuations(input, client);
  if (path === COMPANY) {
    const names=list(input.comFullNameList || input.comChiNameList).slice(0,5), rows=[];
    for (const name of names) {
      const found=await client.query('issuerInfo',{issuer_name:name});
      for(const item of found.filter(row=>compact(row.issuer_name)===compact(name))) rows.push({comFullName:item.issuer_name,
        comChiName:item.issuer_name,comName:item.issuer_name,comProvice:item.province,comCity:item.city,
        province:item.province,city:item.city,actualController:item.actual_controller_name,
        _qb:meta(client,['issuerInfo'],'',{comFullName:'issuer_name',comChiName:'issuer_name',province:'province',city:'city'})});
    }
    return rows;
  }
  if(path===PRIMARY) return primary(input,client);
  // No verified QB current two-sided quote or implied default-rate API is available.
  return null;
}

async function valuations(input, client) {
  const codes=[...new Set(list(input.securityIdList).map(fullCode).filter(Boolean))];
  if(codes.length>20)return [];
  if(!codes.length)return [];
  if(input.endDate&&!date(input.endDate)||input.startDate&&!date(input.startDate))return [];
  const end=date(input.endDate||input.startDate)||client.today;
  const start=date(input.startDate)||end;
  if(end>client.today || start>end)return [];
  const fields=list(input.fieldNames);
  const wantsCb=!fields.length||fields.some(field=>/^cb(?:[A-Z_]|$)/.test(field));
  const wantsCs=!fields.length||fields.some(field=>/^cs(?:[A-Z_]|$)/.test(field));
  if(!wantsCb&&!wantsCs)return [];
  client.scope ||= {};
  client.scope.basicByCode ||= new Map();
  if(wantsCb)await fillOptionClassification(codes,client);
  // Each institution and date is an independent observation. Joining an older
  // CSI record onto a newer CDC record would mislabel one institution's date.
  const collected=new Map(), cbDone=new Set(), csDone=new Set(), failures=new Map();
  const observation=(code,day)=>{
    const key=code+'@'+day;
    if(!collected.has(key))collected.set(key,{securityId:code,issueDate:day,valuationDate:day});
    return collected.get(key);
  };
  for(let offset=0;offset<8;offset++) {
    const day=shift(end,-offset);if(day<start)break;
    const tasks=[], institutions=[];
    const addTask=(institution,task)=>{institutions.push(institution);tasks.push(task);};
    const cbCodes=codes.filter(code=>!cbDone.has(code));
    if(wantsCb&&!failures.has('CDC')&&cbCodes.length)addTask('CDC',(async()=>{
      const rows=await client.query('cdcBondValuation',{bond_code_par:cbCodes.join(','),date:day});
      const grouped=new Map();
      for(const row of rows){const code=fullCode(row.sec_code);if(!cbCodes.includes(code)||date(row.valuate_date)!==day)continue;
        const venue={IB:'CIB',SH:'SSE',SZ:'SZE',BJ:'BSE'}[code.split('.')[1]];
        if(row.listed_market&&row.listed_market!==venue)continue;
        if(String(row.val_type??'')!=='1')continue;
        if(!grouped.has(code))grouped.set(code,[]);grouped.get(code).push(row);}
      for(const [code,values]of grouped){
        const basic=client.scope.basicByCode.get(code)||{};
        const ordinary=basic.qbOptionTypeCode==='NON'
          && basic.qbIsPerpetualBond!=='Y' && basic.qbEmbeddedOption!=='Y'
          && !basic.nextOptionDate
          && !/[+]|永续|回售|赎回|含权|可续期/.test([basic.bondMatu,basic.qbTermStructure,basic.specialItem].filter(Boolean).join(' '));
        const maturity=pickCdc(values.filter(row=>row.optionflag==='到期'||(!row.optionflag&&ordinary)));
        const exercise=pickCdc(values.filter(row=>row.optionflag==='行权'));
        if(!maturity&&!exercise)continue;
        const row=observation(code,day);
        row.secShortName=values[0].sec_short_name;
        if(maturity){row.cbYtm=number(maturity.val_yield);row.cbNptm=number(maturity.val_clean_price);}
        if(exercise){row.cbYte=number(exercise.val_yield);row.cbNpte=number(exercise.val_clean_price);}
        row.cbReliability=(exercise||maturity).credibility||'';
        const fieldMap={};
        if(maturity){fieldMap.cbYtm='val_yield(optionflag=到期或已确认无含权)';fieldMap.cbNptm='val_clean_price(optionflag=到期或已确认无含权)';}
        if(exercise){fieldMap.cbYte='val_yield(optionflag=行权)';fieldMap.cbNpte='val_clean_price(optionflag=行权)';}
        row._qb=mergeMeta(row._qb,meta(client,['cdcBondValuation'],day,fieldMap));
        cbDone.add(code);
      }
    })());
    if(wantsCs&&!failures.has('CSI'))for(const venue of ['IB','SH','SZ']){
      const group=codes.filter(code=>code.endsWith('.'+venue)&&!csDone.has(code));if(!group.length)continue;
      addTask('CSI',(async()=>{
        const field={IB:'interbank_code',SH:'shh_code',SZ:'shz_code'}[venue];
        const rows=await client.query('csiBondValuation',{valuate_date_start:day,valuate_date_end:day,[field]:group.map(code=>code.split('.')[0]).join(','),val_type:'1',page:1,pageSize:Math.min(100,group.length*3)});
        for(const code of group){
          const candidates=rows.filter(row=>String(row[field]||'')===code.split('.')[0]&&date(row.valuate_date)===day&&String(row.val_type??'')==='1');
          if(!candidates.length)continue;
          const pairFields=['yld_to_maturity','yld_to_exercise','clean_price_maturity','clean_price_exercise','recommendation'];
          if(candidates.some(row=>pairFields.some(field=>number(row[field])!==number(candidates[0][field]))))continue;
          const source=candidates[0],ytm=number(source.yld_to_maturity),yte=number(source.yld_to_exercise);
          if(ytm===null&&yte===null)continue;
          const row=observation(code,day);
          if(ytm!==null){row.csYtm=ytm;row.csNptm=number(source.clean_price_maturity);}
          if(yte!==null){row.csYte=yte;row.csNpte=number(source.clean_price_exercise);}
          row.csReliability=source.recommendation==='1'||source.recommendation===1?'推荐行权':source.recommendation==='2'||source.recommendation===2?'推荐到期':'';
          const fieldMap={};
          if(ytm!==null){fieldMap.csYtm='yld_to_maturity';fieldMap.csNptm='clean_price_maturity';}
          if(yte!==null){fieldMap.csYte='yld_to_exercise';fieldMap.csNpte='clean_price_exercise';}
          row._qb=mergeMeta(row._qb,meta(client,['csiBondValuation'],day,fieldMap));
          csDone.add(code);
        }
      })());
    }
    const settled = await Promise.allSettled(tasks);
    const stopped=settled.find(result=>result.status==='rejected'&&result.reason?.status===429)
      ||settled.find(result=>result.status==='rejected'&&isQbStopError(result.reason));
    if(stopped)throw stopped.reason;
    for(let index=0;index<settled.length;index++){
      if(settled[index].status!=='rejected'||failures.has(institutions[index]))continue;
      failures.set(institutions[index],{error:settled[index].reason,date:day});
    }
    if((!wantsCb||failures.has('CDC')||codes.every(code=>cbDone.has(code)))
      &&(!wantsCs||failures.has('CSI')||codes.filter(code=>!code.endsWith('.BJ')).every(code=>csDone.has(code))))break;
  }
  if(!collected.size&&failures.size)throw failures.values().next().value.error;
  const failedInstitutions=[...failures].map(([institution,failure])=>({
    institution,apiName:institution==='CDC'?'cdcBondValuation':'csiBondValuation',date:failure.date,
    errorCode:'qb_upstream_failed',securityIdList:codes.filter(code=>!(institution==='CDC'?cbDone:csDone).has(code)
      &&(institution!=='CSI'||!code.endsWith('.BJ'))),
  })).filter(failure=>failure.securityIdList.length);
  const output=[...collected.values()];
  if(failedInstitutions.length)for(const row of output)row._qb={...row._qb,failedInstitutions};
  return output;
}

function pickCdc(rows){
  const sorted=rows.filter(row=>number(row.val_yield)!==null).sort((a,b)=>(b.credibility==='推荐')-(a.credibility==='推荐'));
  if(!sorted.length)return null;
  const first=sorted[0],rank=first.credibility==='推荐';
  if(sorted.some(row=>(row.credibility==='推荐')===rank&&(number(row.val_yield)!==number(first.val_yield)||number(row.val_clean_price)!==number(first.val_clean_price))))return null;
  return first;
}
function mergeMeta(a,b){return {...b,apiNames:[...new Set([...(a?.apiNames||[]),...b.apiNames])],fieldMap:{...a?.fieldMap,...b.fieldMap},units:{...a?.units,...b.units}};}

async function fillOptionClassification(codes,client){
  const missing=codes.filter(code=>!client.scope.basicByCode.get(code)?.qbOptionTypeCode);
  if(!missing.length)return;
  const rows=await client.query('bondDimInfo',{ss_sec_code:missing.join(','),page:1,pageSize:20}).catch(error=>{
    if(isQbStopError(error))throw error;
    return [];
  });
  const grouped=new Map();
  for(const raw of rows){
    const code=fullCode(raw.ss_sec_code);if(!missing.includes(code))continue;
    const snapshot=date(raw.trade_dt);if(snapshot&&snapshot>client.today)continue;
    if(!grouped.has(code))grouped.set(code,[]);grouped.get(code).push(raw);
  }
  for(const [code,values]of grouped){
    const evidence=['opt_typ_code','is_perpetual_bond','embeddedopt','trm_strc','sec_trm','nxt_strike_dt'];
    if(values.some(raw=>evidence.some(field=>String(raw[field]??'')!==String(values[0][field]??''))))continue;
    const raw=values[0];
    const existing=client.scope.basicByCode.get(code)||{};
    const supplemental={qbOptionTypeCode:typeof raw.opt_typ_code==='string'?raw.opt_typ_code:'',
      qbIsPerpetualBond:raw.is_perpetual_bond,qbEmbeddedOption:raw.embeddedopt,
      qbTermStructure:raw.trm_strc,bondMatu:raw.trm_strc||raw.sec_trm,nextOptionDate:date(raw.nxt_strike_dt)};
    // Never discard DM / previously validated fields when adding QB evidence.
    client.scope.basicByCode.set(code,{...supplemental,...existing,
      qbOptionTypeCode:existing.qbOptionTypeCode||supplemental.qbOptionTypeCode});
  }
}

async function primary(input,client){
  const names=[...new Set([...list(input.secShortNameList),...(client.scope?.names||[])])].slice(0,20),rows=[];
  if(!names.length)return [];
  const start=date(input.startDate),end=date(input.endDate)||client.today;
  for(const name of names){
    const found=await client.query('creditBondIssueInfo',{sec_shrt_nm:name});
    for(const item of found){
      if(compact(item.sec_shrt_nm)!==compact(name))continue;
      if(input.issuerFullName&&compact(item.inst_nm)!==compact(input.issuerFullName))continue;
      const issued=date(item.iss_strt_dt);if(!issued||(start&&issued<start)||issued>end||issued>client.today)continue;
      const code=fullCode(item.ss_sec_code);if(!code)continue;
      const row={securityId:code,secShortName:item.sec_shrt_nm,secFullName:item.sec_full_nm,issuerFullName:item.inst_nm,
        issueDate:issued,issueStartDate:issued,issueEndDate:date(item.iss_end_dt),payDate:date(item.pay_dt),
        listDate:date(item.listing_dt),matuPayDate:date(item.maturity_dt),bondIssueTenor:item.sec_trm,
        issueStatusDesc:item.sts,publicOfferingStatus:item.ofr_type,undeName:item.bookrunner,
        couponRate:number(item.coupon_rt),bondTypeDesc:item.bond_subtyp||item.bond_typ,
        issuerRating:item.issuer_rating,bondRating:item.bond_rating,
        _qb:meta(client,['creditBondIssueInfo'],issued,{securityId:'ss_sec_code',secShortName:'sec_shrt_nm',
          secFullName:'sec_full_nm',issuerFullName:'inst_nm',issueStartDate:'iss_strt_dt',issueEndDate:'iss_end_dt',
          payDate:'pay_dt',listDate:'listing_dt',matuPayDate:'maturity_dt',bondIssueTenor:'sec_trm',
          issueStatusDesc:'sts',publicOfferingStatus:'ofr_type',undeName:'bookrunner',couponRate:'coupon_rt',
          bondTypeDesc:item.bond_subtyp?'bond_subtyp':'bond_typ',issuerRating:'issuer_rating',bondRating:'bond_rating'})};
      const lower=number(item.bid_low_lim),upper=number(item.bid_upr_lim);
      if(lower!==null&&upper!==null&&lower<=upper){row.subscribeRate=`${lower}-${upper}`;row._qb.fieldMap.subscribeRate='bid_low_lim,bid_upr_lim';row._qb.units.subscribeRate='%';}
      const amount=number(item.tot_actl_iss_amt);if(amount!==null&&amount>=0){row.actuIssueAmount=amount*10000;row._qb.fieldMap.actuIssueAmount='tot_actl_iss_amt(亿元×10000→万元)';row._qb.units.actuIssueAmount='万元';}
      const planned=typeof item.pln_iss_sz==='string'?item.pln_iss_sz.match(/^\s*(\d+(?:\.\d+)?)\s*亿\s*$/):null;
      if(planned){row.planIssueAmount=Number(planned[1])*10000;row._qb.fieldMap.planIssueAmount='pln_iss_sz(明确亿单位×10000→万元)';row._qb.units.planIssueAmount='万元';}
      rows.push(row);
    }
  }
  return rows;
}

export const __test__={date,pickCdc};
