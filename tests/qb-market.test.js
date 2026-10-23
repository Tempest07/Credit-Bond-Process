import test from 'node:test';
import assert from 'node:assert/strict';
import { marketFallback, __test__ } from '../functions/api/qb/market.js';

const MARKET='/dm-quant-func-service/api/v1/bond/market-data/date';
const PRIMARY='/dm-quant-func-service/api/v1/bond/primary/data';
const today='2026-10-22',code='012682405.IB';
function client(handler,basic=[]){
  const calls=[];
  return {calls,today,fetchedAt:'2026-10-22T05:00:00.000Z',
    scope:{names:new Set(),basicByCode:new Map(basic)},
    query:async(api,params)=>{calls.push({api,params});return handler(api,params);}};
}
const cdc=(more={})=>({sec_code:code,sec_short_name:'26测试SCP001',valuate_date:today,
  listed_market:'CIB',val_type:'1',val_yield:1.6,val_clean_price:99.8,optionflag:'到期',credibility:'推荐',...more});
const csi=(more={})=>({shh_code:'246018',valuate_date:today,val_type:'1',yld_to_maturity:1.9,
  clean_price_maturity:99.5,yld_to_exercise:null,clean_price_exercise:null,...more});
const request=(more={})=>({securityIdList:[code],startDate:today,endDate:today,fieldNames:['cbYtm','cbYte','cbNptm','cbNpte'],...more});

test('QB market adapter declines unrelated APIs and never relabels Shanghai Clearing yield as ChinaBond',async()=>{
  const qb=client(()=>{throw new Error('must not query');});
  assert.equal(await marketFallback('/unsupported',{},qb),null);
  assert.deepEqual(await marketFallback(MARKET,request({fieldNames:['spiderYield']}),qb),[]);
  assert.equal(qb.calls.length,0);
});

test('QB CDC unlabelled ordinary valuation requires verified NON classification, fetched if absent',async()=>{
  const qb=client(api=>api==='bondDimInfo'?[{ss_sec_code:code,opt_typ_code:'NON',sec_trm:'270D',is_perpetual_bond:'N',embeddedopt:'N'}]:[cdc({optionflag:null})]);
  const [row]=await marketFallback(MARKET,request(),qb);
  assert.equal(row.cbYtm,1.6);assert.equal(row.cbNptm,99.8);assert.equal(row.cbYte,undefined);
  assert.equal(qb.scope.basicByCode.get(code).qbOptionTypeCode,'NON');
  assert.equal(qb.calls[0].api,'bondDimInfo');assert.equal(qb.calls[0].params.ss_sec_code,code);
  assert.deepEqual(row._qb.apiNames,['cdcBondValuation']);assert.equal(row._qb.date,today);
});

test('QB missing, conflicting, perpetual or exercised classification cannot turn a blank optionflag into maturity',async()=>{
  for(const dimensions of [[],[{ss_sec_code:code,opt_typ_code:'PUT'}],
    [{ss_sec_code:code,opt_typ_code:'NON',is_perpetual_bond:'Y'}],
    [{ss_sec_code:code,opt_typ_code:'NON',trm_strc:'3+N'}],
    [{ss_sec_code:code,opt_typ_code:'NON'},{ss_sec_code:code,opt_typ_code:'ETS'}]]){
    const qb=client(api=>api==='bondDimInfo'?dimensions:[cdc({optionflag:null})]);
    assert.deepEqual(await marketFallback(MARKET,request(),qb),[]);
  }
  const qb=client(()=>[cdc({optionflag:null})],[[code,{qbOptionTypeCode:'NON',nextOptionDate:'2027-01-01'}]]);
  assert.deepEqual(await marketFallback(MARKET,request(),qb),[]);
});

test('QB CDC maturity and exercise yields keep their matching clean price and preserve recommendation evidence',async()=>{
  const qb=client(()=>[cdc({val_yield:1.9,val_clean_price:98.8}),cdc({optionflag:'行权',val_yield:1.5,val_clean_price:100.2})],[[code,{qbOptionTypeCode:'PUT'}]]);
  const [row]=await marketFallback(MARKET,request(),qb);
  assert.deepEqual([row.cbYtm,row.cbNptm,row.cbYte,row.cbNpte],[1.9,98.8,1.5,100.2]);
  assert.equal(row._qb.fieldMap.cbYte,'val_yield(optionflag=行权)');
  const conflict=client(()=>[cdc(),cdc({val_clean_price:100.8})],[[code,{qbOptionTypeCode:'NON'}]]);
  assert.deepEqual(await marketFallback(MARKET,request(),conflict),[],'same-rank conflicting price cannot be selected arbitrarily');
});

test('QB cross-market securities and unsupported valuation types / dates never match by bare numeric code',async()=>{
  const qb=client(()=>[cdc({sec_code:'012682405.SH',listed_market:'SSE'}),cdc({listed_market:'SSE'}),
    cdc({valuate_date:'2026-10-23'}),cdc({valuate_date:'2026-10-21'}),cdc({val_type:'2'})],[[code,{qbOptionTypeCode:'NON'}]]);
  assert.deepEqual(await marketFallback(MARKET,request(),qb),[]);
  const exchange=client(()=>[csi({shh_code:null,interbank_code:'246018'})]);
  assert.deepEqual(await marketFallback(MARKET,request({securityIdList:['246018.SH'],fieldNames:['csYtm']}),exchange),[]);
  assert.equal(exchange.calls[0].params.shh_code,'246018');
  assert.equal(exchange.calls[0].params.interbank_code,undefined);
});

test('QB institutions from different valuation dates remain distinct observations independent of completion order',async()=>{
  const qb=client(async(api,params)=>{
    if(api==='bondDimInfo')return [{ss_sec_code:code,opt_typ_code:'NON'}];
    if(api==='cdcBondValuation'){await new Promise(resolve=>setTimeout(resolve,2));return params.date===today?[cdc()]:[];}
    return params.valuate_date_start==='2026-10-21'?[csi({shh_code:null,interbank_code:'012682405',valuate_date:'2026-10-21'})]:[];
  });
  const rows=await marketFallback(MARKET,request({startDate:'2026-10-21',fieldNames:[]}),qb);
  assert.equal(rows.length,2);
  const cb=rows.find(row=>row.cbYtm!==undefined),cs=rows.find(row=>row.csYtm!==undefined);
  assert.equal(cb.issueDate,today);assert.equal(cs.issueDate,'2026-10-21');
  assert.equal(cb.csYtm,undefined);assert.equal(cs.cbYtm,undefined);
  assert.equal(cb._qb.date,today);assert.equal(cs._qb.date,'2026-10-21');
});

test('QB CSI explicit basis pairs cannot borrow generic yield / clean price or conflict on a duplicate price',async()=>{
  const qb=client(()=>[csi({yld_to_exercise:1.7,clean_price_exercise:100.3,yield_to_maturity:99,clean_price:50})]);
  const [row]=await marketFallback(MARKET,request({securityIdList:['246018.SH'],fieldNames:['csYtm','csYte']}),qb);
  assert.deepEqual([row.csYtm,row.csNptm,row.csYte,row.csNpte],[1.9,99.5,1.7,100.3]);
  const conflict=client(()=>[csi(),csi({clean_price_maturity:100.3})]);
  assert.deepEqual(await marketFallback(MARKET,request({securityIdList:['246018.SH'],fieldNames:['csYtm']}),conflict),[]);
  const missing=client(()=>[csi({yld_to_maturity:null,clean_price_maturity:null,yield_to_maturity:1.9,clean_price:99.5})]);
  assert.deepEqual(await marketFallback(MARKET,request({securityIdList:['246018.SH'],fieldNames:['csYtm']}),missing),[]);
});

test('QB failed secondary institution stops its history while preserving valid primary data with explicit diagnostics',async()=>{
  const failure=new Error('unavailable');
  const qb=client(api=>{if(api==='csiBondValuation')throw failure;return [cdc({val_yield:0,val_clean_price:null})];},[[code,{qbOptionTypeCode:'NON'}]]);
  const [row]=await marketFallback(MARKET,request({startDate:'2026-10-15',fieldNames:[]}),qb);
  assert.equal(row.cbYtm,0);assert.equal(row.cbNptm,null);assert.equal(row.csYtm,undefined);
  assert.deepEqual(row._qb.failedInstitutions,[{institution:'CSI',apiName:'csiBondValuation',date:today,
    errorCode:'qb_upstream_failed',securityIdList:[code]}]);
  assert.equal(qb.calls.filter(call=>call.api==='csiBondValuation').length,1);
  assert.equal(JSON.stringify(row).includes('unavailable'),false);
});

test('QB primary institution failure is explicit and never replaced by a secondary institution yield',async()=>{
  const failure=new Error('CDC HTTP 500');
  const qb=client((api,params)=>{
    if(api==='cdcBondValuation')throw failure;
    return params.valuate_date_start==='2026-10-21'?[csi({shh_code:undefined,interbank_code:'012682405',valuate_date:'2026-10-21'})]:[];
  },[[code,{qbOptionTypeCode:'NON'}]]);
  const [row]=await marketFallback(MARKET,request({startDate:'2026-10-15',fieldNames:[]}),qb);
  assert.equal(row.cbYtm,undefined);assert.equal(row.csYtm,1.9);assert.equal(row.valuationDate,'2026-10-21');
  assert.equal(row._qb.date,'2026-10-21','data retains its own date rather than the failure date');
  assert.deepEqual(row._qb.failedInstitutions,[{institution:'CDC',apiName:'cdcBondValuation',date:today,
    errorCode:'qb_upstream_failed',securityIdList:[code]}]);
  assert.equal(qb.calls.filter(call=>call.api==='cdcBondValuation').length,1);
  assert.deepEqual(qb.calls.filter(call=>call.api==='csiBondValuation').map(call=>call.params.valuate_date_start),[today,'2026-10-21']);
});

test('QB partial-batch diagnostics identify unpriced failed codes without fabricating observation rows',async()=>{
  const other='012682406.IB',failure=new Error('CDC HTTP 500');
  const qb=client((api,params)=>{
    if(api==='cdcBondValuation')throw failure;
    return [csi({shh_code:undefined,interbank_code:'012682405'})];
  },[[code,{qbOptionTypeCode:'NON'}],[other,{qbOptionTypeCode:'NON'}]]);
  const rows=await marketFallback(MARKET,request({securityIdList:[code,other],startDate:'2026-10-21',fieldNames:[]}),qb);
  assert.equal(rows.length,1);assert.equal(rows[0].securityId,code);
  assert.deepEqual(rows[0]._qb.failedInstitutions[0].securityIdList,[code,other]);
  assert.equal(rows.some(row=>row.securityId===other),false);
});

test('QB missing data plus any failed requested institution rejects instead of becoming real missing data',async()=>{
  const failure=new Error('CDC HTTP 500');
  for(const fieldNames of [['cbYtm'],[]]){
    const qb=client(api=>{if(api==='cdcBondValuation')throw failure;return [];},[[code,{qbOptionTypeCode:'NON'}]]);
    await assert.rejects(marketFallback(MARKET,request({startDate:'2026-10-21',fieldNames}),qb),error=>error===failure);
    assert.equal(qb.calls.filter(call=>call.api==='cdcBondValuation').length,1);
  }
  const both=client(()=>{throw failure;},[[code,{qbOptionTypeCode:'NON'}]]);
  await assert.rejects(marketFallback(MARKET,request({fieldNames:[]}),both),error=>error===failure);
});

test('QB rate limit, abort and timeout stop valuation history immediately rather than becoming missing data',async()=>{
  for(const failure of [Object.assign(new Error('rate limit'),{status:429,code:'qb_rate_limited'}),
    new DOMException('cancelled','AbortError'),new DOMException('deadline','TimeoutError')]){
    const qb=client(()=>{throw failure;},[[code,{qbOptionTypeCode:'NON'}]]);
    await assert.rejects(marketFallback(MARKET,request({startDate:'2026-10-15'}),qb),error=>error===failure);
    assert.equal(qb.calls.length,1);assert.equal(qb.calls[0].params.date,today);
    const classification=client(()=>{throw failure;});
    await assert.rejects(marketFallback(MARKET,request({startDate:'2026-10-15'}),classification),error=>error===failure);
    assert.equal(classification.calls.length,1);assert.equal(classification.calls[0].api,'bondDimInfo');
  }
});

test('QB real empty valuation results still look back to the first usable date',async()=>{
  const qb=client((api,params)=>params.date===today?[]:[cdc({valuate_date:'2026-10-21'})],[[code,{qbOptionTypeCode:'NON'}]]);
  const rows=await marketFallback(MARKET,request({startDate:'2026-10-15'}),qb);
  assert.equal(rows.length,1);assert.equal(rows[0].valuationDate,'2026-10-21');
  assert.deepEqual(qb.calls.map(call=>call.params.date),[today,'2026-10-21']);
});

test('QB valuation never substitutes coupon or issuance yield and refuses future / unbounded requests',async()=>{
  const qb=client(api=>api==='bondDimInfo'?[{ss_sec_code:code,opt_typ_code:'NON',coupon_rt_cur:2.5}]:[]);
  assert.deepEqual(await marketFallback(MARKET,request(),qb),[]);
  assert.equal(qb.calls.some(call=>call.api==='creditBondIssueInfo'),false);
  const noQuery=client(()=>{throw new Error('must not query');});
  for(const input of [request({endDate:'2026-10-23'}),request({startDate:'bad'}),request({securityIdList:['012682405']}),
    request({securityIdList:Array.from({length:21},(_,i)=>`${100000+i}.SH`)})])assert.deepEqual(await marketFallback(MARKET,input,noQuery),[]);
  assert.equal(noQuery.calls.length,0);
});

test('QB primary rows satisfy existing DM creation field names, numeric dates and explicitly converted amounts',async()=>{
  const qb=client(()=>[{sec_shrt_nm:'26测试SCP001',sec_full_nm:'测试2026第一期',ss_sec_code:code,
    inst_nm:'测试有限公司',iss_strt_dt:20261020,iss_end_dt:20261021,pay_dt:20261022,listing_dt:20261023,
    maturity_dt:20270722,sec_trm:'270D',sts:'已截标',ofr_type:'公募',bookrunner:'兴业银行',
    bid_low_lim:1.3,bid_upr_lim:1.6,coupon_rt:1.38,pln_iss_sz:'5亿',tot_actl_iss_amt:4.5}]);
  qb.scope.names.add('26测试SCP001');
  const [row]=await marketFallback(PRIMARY,{startDate:'2026-10-01',endDate:today},qb);
  assert.equal(row.planIssueAmount,50000);assert.equal(row.actuIssueAmount,45000);
  assert.equal(row.undeName,'兴业银行');assert.equal(row.subscribeRate,'1.3-1.6');
  assert.equal(row.issueStartDate,'2026-10-20');assert.equal(row.issueEndDate,'2026-10-21');
  assert.equal(row.payDate,today);assert.equal(row.publicOfferingStatus,'公募');
  assert.equal(row.bondIssueTenor,'270D');assert.equal(row.couponRate,1.38);
  assert.equal(row.planIssAmut,undefined);assert.equal(row.cbYtm,undefined);
  assert.match(row._qb.fieldMap.actuIssueAmount,/亿元/);
  const {__test__:dm}=await import('../functions/api/dm/lookup.js');
  const normalized=dm.normalizeDmLookup({shortName:'26测试SCP001',securityId:code,
    basic:{rows:[]},primary:{rows:[row]},company:{rows:[]}});
  assert.equal(normalized.issueScaleYi,5);assert.equal(normalized.leadUnderwriter,'兴业银行');
  assert.equal(normalized.inquiryRange,'1.3-1.6');assert.equal(normalized.paymentDate,today);
  assert.equal(normalized.offeringType,'公募');assert.equal(normalized.issueStartDate,'2026-10-20');
});

test('QB primary exact issuer, tranche, date and unit boundaries preserve failed issue status',async()=>{
  const base={sec_shrt_nm:'26测试MTN001A',ss_sec_code:code,inst_nm:'测试有限公司',iss_strt_dt:20261020,
    sts:'发行失败',pln_iss_sz:50000,tot_actl_iss_amt:null};
  const qb=client(()=>[base,{...base,sec_shrt_nm:'26测试MTN001B'},{...base,inst_nm:'测试控股有限公司'},
    {...base,iss_strt_dt:20261023},{...base,ss_sec_code:'012682405'}]);
  const rows=await marketFallback(PRIMARY,{secShortNameList:['26测试MTN001A'],issuerFullName:'测试有限公司',startDate:'2026-10-01',endDate:today},qb);
  assert.equal(rows.length,1);assert.equal(rows[0].issueStatusDesc,'发行失败');
  assert.equal(rows[0].planIssueAmount,undefined,'a number without a documented unit is not an amount in 亿元');
  assert.equal(rows[0].actuIssueAmount,undefined);
});

test('QB date normalization handles Shanghai midnight and rejects ambiguous / invalid dates',()=>{
  assert.equal(__test__.date(20261022),today);
  assert.equal(__test__.date('2026-10-21T16:00:00Z'),today);
  assert.equal(__test__.date('2026-02-30'),'');assert.equal(__test__.date('10/22/2026'),'');
});
