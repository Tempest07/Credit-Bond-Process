import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/dm/_middleware.js";

test("production live quotes and its valuations are denied before reaching any DM handler", async () => {
  for (const host of ["tempest07.com", "credit-bond-process.pages.dev"]) {
    for (const route of ["realtime-quotes", "realtime-valuations"]) {
      for (const suffix of ["", "/?beta=1"]) {
        const response = await onRequest({request:new Request(`https://${host}/api/dm/${route}${suffix}`,{method:"POST"}),next:()=>{throw Error("must not call DM handler");}});
        assert.equal(response.status,403);
        assert.equal((await response.json()).code,"DM_REALTIME_SUSPENDED");
        assert.equal(response.headers.get("Cache-Control"),"no-store");
      }
    }
  }
});

test("lookup, valuation assistant, curve, trade records and local Beta are unaffected", async () => {
  for (const route of ["lookup", "valuation", "curve", "trade-records"]) {
    const response=await onRequest({request:new Request(`https://credit-bond-process.pages.dev/api/dm/${route}`),next:()=>new Response("allowed")});
    assert.equal(await response.text(),"allowed");
  }
  for(const host of ["localhost","127.0.0.1","[::1]"]) {
    const response=await onRequest({request:new Request(`http://${host}/api/dm/realtime-quotes`),next:()=>new Response("local")});
    assert.equal(await response.text(),"local");
  }
});
