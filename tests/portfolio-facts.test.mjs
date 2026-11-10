import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {prepareFacts,syncFacts} from '../tools/import-portfolio-facts.mjs';
import {getPortfolioMarketPins,readPortfolioFacts,factsObjectKey} from '../tools/portfolio-facts.mjs';

test('private facts pin immutable market versions and keep later observations separate',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bond-portfolio-facts-test-'));
  t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
  const configPath=path.join(dir,'wrangler.json');
  await writeFile(configPath,JSON.stringify({name:'test-portfolio',compatibility_date:'2026-01-01',r2_buckets:[{binding:'INVENTORY_FILES',bucket_name:'test-portfolios'}]}));
  const proxy=await getPlatformProxy({configPath,persist:false,remoteBindings:false});
  try{
    const resources={bucket:proxy.env.INVENTORY_FILES};
    const {bucket}=resources;
    const snapshot={date:'2025-01-09'},absent={date:'2025-01-10'};
    const duration={date:snapshot.date,code:'001000.IB',principal:'1000000',duration:'1.25',src:'中债',
      decision:'行权',api:'cdcBondValuation',field:'val_modified_duration',time:'2026-01-01T09:01:00+08:00'};
    const rating={date:snapshot.date,code:duration.code,principal:duration.principal,included:true,
      grade:'AA(2)',cdc:'',csi:'AA2',api:'csiBondValuation',cite:'中证补缺',timestamp:duration.time};
    const files=['duration.json','rating.json','later.json'].map(name=>path.join(dir,name));
    await writeFile(files[1],JSON.stringify({rows:[rating]}));
    await writeFile(files[2],JSON.stringify([{code:rating.code,date:'2025-01-13',grade:'AA',checked:duration.time}]));
    const dest=path.join(dir,'staged');
    async function stage(){
      await writeFile(files[0],JSON.stringify({rows:[duration]}));
      await prepareFacts(files[0],files[1],dest,files[2]);
    }
    await stage();
    await assert.rejects(syncFacts(bucket,dest,{publish:true}),/身份校验失败/);
    await bucket.put('system/cloud-identity.txt','bond-centre-inventory-qa-beta');
    const protectedKey='system/cloud-identity.txt';
    const blocked=await bucket.put(protectedKey,'unexpected',{onlyIf:{etagDoesNotMatch:'*'}});
    assert.equal(blocked,null,'R2 must enforce create-only visibility under a race');
    await assert.rejects(syncFacts(bucket,dest),/远端不可变对象缺失/);
    assert.deepEqual(await getPortfolioMarketPins(resources,[snapshot]),{});
    const first=await syncFacts(bucket,dest,{publish:true});
    assert.deepEqual(await syncFacts(bucket,dest),first);
    const pins=await getPortfolioMarketPins(resources,[snapshot,absent]);
    assert.deepEqual(pins,first);
    const key=factsObjectKey(snapshot.date,pins[snapshot.date]);
    const stored=await readFile(path.join(dest,key),'utf8');
    assert(!stored.includes('principal'));
    const row=(await readPortfolioFacts(resources,snapshot,pins)).byCode.get(duration.code);
    assert.equal(row.duration,1.25); assert.equal(row.rating,'AA(2)');assert.equal(row.subsequentRating,'AA');
    assert.equal(row.ratingSource,'中证补缺');assert.equal(row.ratingRaw,'AA2');
    assert.equal((await readPortfolioFacts(resources,absent,pins)).byCode.size,0);
    assert.equal((await readPortfolioFacts(resources,snapshot,{})).byCode.size,0);
    duration.duration='1.33';await stage();
    const second=await syncFacts(bucket,dest,{publish:true});assert.notDeepEqual(first,second);
    assert.deepEqual(await syncFacts(bucket,dest,{publish:true}),second);
    assert.equal((await readPortfolioFacts(resources,snapshot,pins)).byCode.get(duration.code).duration,1.25);
    assert.equal((await readPortfolioFacts(resources,snapshot,second)).byCode.get(duration.code).duration,1.33);
    await bucket.put(key,'{}');
    await assert.rejects(readPortfolioFacts(resources,snapshot,pins),/校验信息异常/);
    await bucket.delete(key);
    await assert.rejects(readPortfolioFacts(resources,snapshot,pins),/暂时无法读取/);
  }finally{await proxy.dispose();}
});
