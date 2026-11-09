import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeAnalysis,runAnalysis} from '../tools/inventory-analysis.mjs';

const rows = [
  {sourceRow:5,cents:50,code:'1',issuer:'甲',account:'AFS',portfolio:'P',branch:'京',maturity:'2030-01-01'},
  {sourceRow:3,cents:70,code:'1',issuer:'甲',account:'RECEIVABLE',portfolio:'P',branch:'京',maturity:'2031-01-01'},
  {sourceRow:7,cents:80,code:'3',issuer:'丙',account:'专户',portfolio:'Q',branch:'京',maturity:''},
  {sourceRow:4,cents:1000,code:'4',issuer:'丁',account:'AFS',portfolio:'Q',branch:'沪',maturity:''},
  {sourceRow:2,cents:90,code:'2',issuer:'乙',account:'公募',portfolio:'P',branch:'京',maturity:'2031-03-01'},
  {sourceRow:6,cents:10,code:'5',issuer:'乙',account:'AFS',portfolio:'P',branch:'京',maturity:'2029-01-01'},
];
const group = (...fields)=>({op:'group',fields});
const filter = (field,operator,value)=>({op:'filter',field,operator,value});
const having = (metric,operator,value)=>({op:'having',metric,operator,value});
const sort = (metric,descending=true)=>({op:'sort',metric,descending});
const take = limit=>({op:'take',limit});
const expand = {op:'expand'};

test('selects top issuers, regroups their original rows by two columns and preserves source drilldowns',()=>{
  const result = runAnalysis(rows,[filter('branch','eq','京'),group('issuer'),take(2),expand,group('issuer','account')]);
  assert.deepEqual(result.dimensions,['issuer','account']);
  assert.deepEqual(result.rows,[rows[4],rows[1],rows[0],rows[5]]);
  assert.deepEqual(result.groups.map(g=>[g.labels,g.principalCents,g.sourceRows]),[
    [['甲','Receivable'],70,[3]],[['甲','AFS'],50,[5]],[['乙','委外（公募）'],90,[2]],[['乙','AFS'],10,[6]],
  ]);
  assert.ok(result.groups.every(g=>g.name===JSON.stringify(g.labels) && g.value===g.principalCents));
});
test('can select a cohort by distinct bonds, expand, take smallest account, expand again and inspect maturity',()=>{
  const result = runAnalysis(rows,[filter('branch','eq','京'),group('issuer'),having('securityCount','gte','2'),expand,
    group('account'),sort('principalCents',false),take(1),expand,group('maturity'),sort('rowCount')]);
  assert.equal(result.metric,'rowCount');
  assert.deepEqual(result.groups,[{name:'["2029-01-01"]',labels:['2029-01-01'],principalCents:10,
    rowCount:1,securityCount:1,sourceRows:[6],value:1}]);
});
test('sort ties are stable on group labels and totals deduplicate securities across groups',()=>{
  const stage = [group('issuer'),sort('rowCount'),take(1)];
  assert.deepEqual(runAnalysis(rows,stage).groups.map(g=>g.labels),[['乙']]);
  assert.deepEqual(runAnalysis([...rows].reverse(),stage),runAnalysis(rows,stage));
  const [all] = runAnalysis(rows,[group()]).groups;
  assert.equal(all.rowCount,6);
  assert.equal(all.securityCount,5);
  assert.equal(all.principalCents,1300);
  assert.deepEqual(all.sourceRows,[2,3,4,5,6,7]);
});
test('applies typed inclusive ranges, null date rules, negative amounts and normalized business labels',()=>{
  const enriched = rows.map(r=>({...r,queryMarketType:'中期票据'}));
  const result = runAnalysis(enriched,[filter('maturity','gte','2031-01-01'),filter('marketType','eq','中期票据'),
    filter('cents','lt','90'),filter('account','eq','Receivable'),group()]);
  assert.deepEqual(result.groups[0].sourceRows,[3]);
  assert.equal(runAnalysis([{...rows[0],cents:-1}],[filter('cents','lt',0),group()]).groups[0].value,-1);
  assert.equal(runAnalysis(rows,[filter('maturity','eq','未填写'),group()]).groups[0].rowCount,2);
  const absent = runAnalysis(rows,[filter('branch','contains','无此分行'),group()]);
  assert.deepEqual(absent.groups[0].sourceRows,[]);
  assert.equal(absent.groups[0].value,0);
  assert.deepEqual(runAnalysis(rows,[filter('branch','contains','无此分行'),group('issuer')]).groups,[]);
});
test('dynamic source columns support text, decimal and ISO-date filters without lexicographic numeric comparison',()=>{
  const input = rows.slice(0,4).map((r,i)=>({...r,'原表:久期':['9.5',10,'N/A',''][i],
    '原表:评级': ['AaA','A','A','AaA'][i], '原表:下次行权日':['','2031-05-12','未知','2030-02-21'][i]}));
  assert.deepEqual(runAnalysis(input,[filter('原表:久期','gte','9.9'),group('原表:评级')]).rows,[input[1]]);
  assert.deepEqual(runAnalysis(input,[filter('原表:评级','contains','aa'),filter('原表:下次行权日','lt','2031-01-01'),group()]).rows,[input[3]]);
  assert.throws(()=>normalizeAnalysis([filter('原表:久期','gt','评级A'),group()]),/数字或/);
  assert.throws(()=>normalizeAnalysis([group('原表:\nabc')]),/台账维度/);
});
const measureGroup = (fn,field,...fields)=>({op:'group',fields,measure:{fn,field}});
test('generic numeric aggregates operate on populated decimals and recompute the overall measure from surviving holdings',()=>{
  const input=rows.slice(0,4).map((r,i)=>({...r,'原表:久期':['2.5','5.5','N/A','11'][i]}));
  for (const [fn,expected] of [['sum',19],['min',2.5],['max',11],['avg',19/3],
    ['weightedAvg',(50*2.5+70*5.5+1000*11)/1120]]) {
    const result=runAnalysis(input,[measureGroup(fn,'原表:久期','issuer')]);
    assert.equal(result.measureTotal,expected);
    assert.deepEqual(result.measure,{fn,field:'原表:久期'});
    assert.equal(result.metric,'measure');
    assert.equal(result.groups.at(-1).measureValue,null);
  }
  const top=runAnalysis(input,[measureGroup('avg','原表:久期','issuer'),having('measure','gt','4.05')]);
  assert.equal(top.measureTotal,11);
  assert.deepEqual(top.rows,[input[3]]);
  const bottom=runAnalysis(input,[measureGroup('avg','原表:久期','issuer'),sort('measure',false)]);
  assert.deepEqual(bottom.groups.map(g=>g.measureValue),[4,11,null]);
  assert.deepEqual(runAnalysis(input,[measureGroup('avg','原表:久期','issuer'),having('measure','neq',11)]).rows,[input[1],input[0]]);
  const cancel=input.slice(0,2).map((row,i)=>({...row,cents:i ? 50 : -50}));
  assert.equal(runAnalysis(cancel,[measureGroup('weightedAvg','原表:久期')]).measureTotal,null);
});
test('principal shares keep their group-input denominator after selection and reset on regrouping',()=>{
  const first=[filter('branch','eq','京'),measureGroup('principalShare',null,'issuer'),having('measure','gt',33.5)];
  const selected=runAnalysis(rows,first);
  assert.deepEqual(selected.groups.map(g=>g.labels),[['甲']]);
  assert.equal(selected.groups[0].measureValue,40);
  assert.equal(selected.measureTotal,40);
  assert.equal(runAnalysis(rows,[...first,expand,measureGroup('principalShare',null,'account')]).measureTotal,100);
  assert.equal(runAnalysis([{...rows[0],cents:0}],[measureGroup('principalShare',null)]).measureTotal,null);
});
test('distinct aggregates cover known/dynamic dimensions and deduplicate from the retained source rows',()=>{
  const input=rows.map((r,i)=>({...r,'原表:等级':['AAA','AA+','','AAA','AAA','AA+'][i]}));
  assert.equal(runAnalysis(input,[measureGroup('distinct','原表:等级','account')]).measureTotal,2);
  assert.equal(runAnalysis(input,[measureGroup('distinct','issuer','account')]).measureTotal,4);
  const transit=[measureGroup('distinct','issuer','account'),having('measure','gte',2),expand,group('branch')];
  assert.equal(runAnalysis(input,transit).rows.length,3);
  const intermediate=runAnalysis(input,transit);
  assert.ok(!('measure' in intermediate) && intermediate.groups.every(g=>!('measureValue' in g)));
  for (const steps of [[group(),sort('measure')],[measureGroup('sum','issuer')],[measureGroup('distinct','cents')],
    [measureGroup('avg','原表:等级'),expand,group(),having('measure','gt',3)]]) assert.throws(()=>normalizeAnalysis(steps));
});
test('round trips strict model placeholder fields; rejects invalid state transitions, unknown fields and precision loss',()=>{
  const input = [{op:'group',fields:['branch'],field:null,operator:null,value:null,metric:null,descending:null,limit:null}];
  assert.deepEqual(normalizeAnalysis(input),[group('branch')]);
  assert.deepEqual(normalizeAnalysis(normalizeAnalysis(input)),normalizeAnalysis(input));
  for (const invalid of [[expand],[group('branch'),group('issuer')],[take(2)],[filter('version','eq','other'),group()],
    [group('branch','branch')],[group('cents')],[group(),take(0)],[group(),sort('not-a-metric')],
    [filter('maturity','gt','2030-02-30'),group()],[group(),{op:'sql',value:'select 1'}],
    [filter('issuer','eq','甲'),group()],[filter('attribution','contains','电网'),group()],[filter('code','eq','1'),group()],
    [filter('cents','gt','1e100'),group()],[filter('branch','contains',''),group()],[group(),expand],
    [group(),...Array(33).fill(take(1))]]) {
    assert.throws(()=>normalizeAnalysis(invalid),e=>e.status===400);
  }
  assert.throws(()=>runAnalysis([rows[0],rows[0]],[group()]),e=>e.status===422);
  assert.throws(()=>runAnalysis([{...rows[0],cents:Number.MAX_SAFE_INTEGER},rows[1]],[group()]),e=>e.status===422);
});

test('a breakdown keeps the chosen member order even when the largest individual cell belongs to another member',()=>{
  const rows=[[1,'甲','AFS',60],[2,'甲','Trading',50],[3,'乙','AFS',100]].map(([sourceRow,issuer,account,cents])=>({sourceRow,issuer,account,cents,code:String(sourceRow)}));
  const steps=[{op:'group',fields:['issuer']},{op:'take',limit:2},{op:'expand'},{op:'group',fields:['issuer','account']}];
  assert.deepEqual(runAnalysis(rows,steps).groups.map(g=>g.labels[0]),['甲','甲','乙']);
  assert.equal(runAnalysis(rows,[...steps,{op:'sort',metric:'principalCents',descending:true}]).groups[0].labels[0],'乙');
});
