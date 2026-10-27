import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryReviewPages,parseBoundaryReview,mergeBoundaryReviewDraft,runBoundaryReview } from '../payment-receipt-boundary-review.js';

const row=(pageNumber,classification='receipt_start',extra={})=>({pageNumber,classification,confidence:.99,recognizedText:'缴款通知书\n26测试MTN001',textEvidence:'缴款通知书',visualReason:'本页有完整通知标题',uncertainties:[],...extra});
const proposal=(rows,count=6)=>parseBoundaryReview({pages:rows},rows.map(x=>x.pageNumber),count);
test('joint boundary pages must be exactly two or three adjacent original pages',()=>{
  assert.deepEqual(boundaryReviewPages([3,2],6),[2,3]);
  for(const pages of [[1],[1,2,3,4],[1,3],[1,1],[0,1],[5,6,7],['1',2]])assert.throws(()=>boundaryReviewPages(pages,6));
});
test('model pages cannot be omitted, duplicated or borrowed from another selection',()=>{
  for(const rows of [[row(1)],[row(1),row(1)],[row(1),row(3)]])assert.throws(()=>parseBoundaryReview({pages:rows},[1,2],3));
});
test('unsupported, ungrounded and low-confidence classifications stay uncertain',()=>{
  for(const change of [{classification:'delete'},{confidence:.5},{textEvidence:'不存在的文字'},{visualReason:''},{uncertainties:['看不清代码']}]){
    const result=proposal([row(1),row(2,'continuation',change)]);
    assert.equal(result.pages[1].classification,'uncertain');assert.equal(result.canApply,false);
  }
  assert.equal(proposal([row(1,'continuation'),row(2)]).canApply,false);
});
test('a page containing business text cannot be silently treated as blank',()=>{
  assert.equal(proposal([row(1),row(2,'blank')]).pages[1].classification,'uncertain');
  const blank=row(2,'blank',{recognizedText:'',textEvidence:'',visualReason:'整页无文字、印章或附件内容'});
  assert.equal(proposal([row(1),blank]).canApply,true);
  assert.equal(proposal([row(1),{...blank,confidence:.97}]).canApply,false);
});
test('filling draft splits and joins only the selected boundaries with every page preserved',()=>{
  const draft={groups:[[1,2,3,4],[5,6]],blankPages:[]},before=structuredClone(draft);
  assert.deepEqual(mergeBoundaryReviewDraft(draft,proposal([row(2),row(3,'continuation')]),6),{groups:[[1],[2,3,4],[5,6]],blankPages:[]});
  assert.deepEqual(draft,before);
  const join=mergeBoundaryReviewDraft({groups:[[1,2],[3,4],[5,6]],blankPages:[]},proposal([row(2,'continuation'),row(3,'continuation')]),6);
  assert.deepEqual(join,{groups:[[1,2,3,4],[5,6]],blankPages:[]});
});
test('a leading continuation preserves the unseen preceding boundary and blank pages remain explicit',()=>{
  const draft={groups:[[1],[2,3,4],[6]],blankPages:[5]};
  assert.deepEqual(mergeBoundaryReviewDraft(draft,proposal([row(2,'continuation'),row(3,'continuation')]),6),draft);
  const blank=row(3,'blank',{recognizedText:'',textEvidence:'',visualReason:'确认无业务内容'});
  const merged=mergeBoundaryReviewDraft(draft,proposal([row(2),blank]),6);
  assert.deepEqual(merged,{groups:[[1],[2,4],[6]],blankPages:[3,5]});
});
test('selection changes retain unrelated group boundaries and a newly blank first page cannot absorb its outside remainder',()=>{
  const draft={groups:[[1],[2,3],[4],[5,6]],blankPages:[]};
  const blank=row(3,'blank',{recognizedText:'',textEvidence:'',visualReason:'无业务内容'});
  assert.deepEqual(mergeBoundaryReviewDraft(draft,proposal([row(2,'continuation'),blank]),6),{groups:[[1],[2],[4],[5,6]],blankPages:[3]});
  const blankStart=row(3,'blank',{recognizedText:'',textEvidence:'',visualReason:'无业务内容'});
  assert.deepEqual(mergeBoundaryReviewDraft({groups:[[1,2],[3,4],[5,6]],blankPages:[]},proposal([row(2,'continuation'),blankStart]),6),{groups:[[1,2],[4],[5,6]],blankPages:[3]});
});
test('uncertain proposals or already interleaved manual groups cannot overwrite a draft',()=>{
  assert.throws(()=>mergeBoundaryReviewDraft({groups:[[1,2,3,4,5,6]],blankPages:[]},proposal([row(2),row(3,'uncertain')]),6),/不确定/);
  assert.throws(()=>mergeBoundaryReviewDraft({groups:[[1,4],[2,3],[5,6]],blankPages:[]},proposal([row(2),row(3)]),6),/交错/);
});
test('joint review sends only bounded inline images and original page labels in one model call',async()=>{
  let calls=0;
  const images=[1,2,3].map(pageNumber=>({pageNumber,mimeType:'image/jpeg',bytes:new Uint8Array([1,2,3])}));
  const result=await runBoundaryReview({model:'deepseek-flash',async run(model,input){calls++;assert.equal(model,'deepseek-flash');assert.equal(input.messages[0].content.filter(x=>x.type==='image_url').length,3);assert.match(input.messages[0].content[1].text,/第 1 页/);return{response:JSON.stringify({pages:[row(1),row(2,'continuation'),row(3)]})};}},images,3);
  assert.equal(calls,1);assert.equal(result.canApply,true);
});
