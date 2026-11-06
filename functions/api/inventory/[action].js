import {gatewayUserFromRequest, json} from '../_auth.js';
import {inventoryHttp} from '../../../tools/inventory-http.mjs';
import {initInventory} from '../../../tools/inventory-store.mjs';

export async function onRequest(context) {
  const user=await gatewayUserFromRequest(context.request,context.env);
  if(!user)return json({error:'请先登录 Bond Centre。'},401);
  if(user.role!=='admin')return json({error:'需要管理员权限。'},403);
  const {request,params,env}=context;
  return inventoryHttp(request,params.action,async()=>{
    const db=env.INVENTORY_DB, bucket=env.INVENTORY_FILES;
    if(!db || !bucket)throw Error('inventory bindings unavailable');
    // Refuse to read or initialize unrelated databases if a binding is misconfigured.
    const identity='bond-centre-inventory-qa-beta';
    const row=await db.prepare('SELECT scope FROM inventory_cloud_identity WHERE scope=?').bind(identity).first();
    if(row?.scope!==identity)throw Error('inventory database mismatch');
    if(params.action==='upload'){
      const marker=await bucket.get('system/cloud-identity.txt');
      if(await marker?.text()!==identity)throw Error('inventory bucket mismatch');
      await initInventory(db);
    }
    return {db,bucket,apiKey:env.INVENTORY_OPENAI_API_KEY||''};
  },['https://tempest07.com','https://www.tempest07.com']);
}
