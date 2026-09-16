import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet, __test__} from "../functions/api/dm/lookup.js";

const base = "26青岛地铁MTN002";
const cases = [
  {query:`${base}A/B`, names:[`${base}A`,`${base}B`]},
  {query:`${base}A ／ B`, names:[`${base}A`,`${base}B`]},
  {query:`${base}A/${base}B`, names:[`${base}A`,`${base}B`]},
  {query:`${base}A/B(绿色)`, names:[`${base}A(绿色)`,`${base}B(绿色)`]},
  {query:"26测试07/08", names:["26测试07","26测试08"]},
];
for (const {query,names} of cases) test(`DM accepts combined input ${query} in one basic-info request`, async()=>{
  const originalFetch=globalThis.fetch, secret="1234567890abcdef";
  const calls=[];
  const rows=names.map((name,i)=>({security_id:`10269000${i+1}.IB`,sec_short_name:name,issuer_name:"青岛地铁集团有限公司",bond_matu:i?"5Y":"3Y",subject_rating:"AAA",rating_agency:"中诚信国际",implied_rating:"AA+"}));
  globalThis.fetch=async(url,init)=>{
    const request=JSON.parse(__test__.sm4DecryptFromBase64Url(init.body,secret));
    let data={list:[]};
    if(url.includes('/bond/basic-info/info')) {
      calls.push(request);
      data=[...rows.filter(row=>request.secShortNameList?.includes(row.sec_short_name)),
        {sec_short_name:"26无关主体MTN002A",issuer_name:"无关主体有限公司",bond_matu:"10Y"},
        {sec_short_name:"26青岛地铁MTN003A",issuer_name:"青岛地铁集团有限公司",bond_matu:"10Y"}];
    } else if(url.includes('/company/basic-info/info')) data=[{com_full_name:"青岛地铁集团有限公司"}];
    const encrypted=__test__.sm4EncryptToBase64Url(JSON.stringify({code:0,data}),secret);
    return Response.json({data:encrypted});
  };
  try {
    const response=await onRequestGet({env:{APP_PASSWORD:"pw",INNO_APP_KEY:"app",INNO_APP_SECRET:secret},request:new Request(`http://127.0.0.1/api/dm/lookup?${new URLSearchParams({shortName:query})}`,{headers:{Authorization:"Bearer pw"}})});
    const payload=await response.json();
    assert.equal(response.status,200);
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0].secShortNameList,names);
    assert.equal(payload.ok,true);
    assert.equal(payload.query.shortName,query);
    assert.deepEqual(payload.issueGroup.tranches.map(t=>t.shortName),names);
    assert.deepEqual(payload.issueGroup.tranches.map(t=>t.tenor),["3Y","5Y"]);
  } finally {globalThis.fetch=originalFetch;}
});
