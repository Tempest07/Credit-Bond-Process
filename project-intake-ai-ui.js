import { parseProjectBrief,splitProjectBriefs } from './core.js?v=20261028v540';
import { PROJECT_INTAKE_LABELS } from './project-intake-ai.js?v=20261028v540';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function createProjectIntakeController({container,getHeaders=()=>({}),onApply,onNotice=()=>{},fetchImpl=fetch}) {
  if(!container)return null;
  const input=container.querySelector('[data-intake-material]'),button=container.querySelector('[data-intake-recognize]'),results=container.querySelector('[data-intake-results]');
  let request=null,drafts=[],revision=0,source='';
  input.addEventListener('input',invalidate);
  button.addEventListener('click',run);
  results.addEventListener('click',async event=>{
    const target=event.target.closest('[data-intake-apply]');if(!target)return;
    const draft=drafts[Number(target.dataset.intakeApply)];
    if(!draft?.patch?.shortName || input.value.trim()!==source){onNotice('材料已变化，请重新识别。');return;}
    await onApply?.(structuredClone(draft));
  });
  async function run(){
    request?.abort();const controller=new AbortController();request=controller;
    const current=++revision,text=input.value.trim();source=text;drafts=[];
    if(text.length<8||text.length>18000){results.innerHTML='<p role="alert">请粘贴 8–18000 字的项目材料。</p>';return;}
    button.disabled=true;button.textContent='正在识别…';results.innerHTML='';
    try{
      const parsed=parseProjectBrief(text);
      const isComplete=/^\d{2}[^\s]+$/.test(parsed.shortName)&&parsed.durationDays>0&&parsed.issueScale>0
        &&parsed.inquiryLow!=null&&parsed.inquiryHigh!=null&&parsed.venue&&parsed.leadUnderwriter&&splitProjectBriefs(text).length===1;
      let data;
      if(isComplete)data={projects:[{id:'rules',patch:parsed,sourceText:text,fields:{},tranches:[],warnings:parsed.warnings||[]}],warnings:[]};
      else{
        const response=await fetchImpl('./api/project-intake/recognize',{method:'POST',credentials:'same-origin',headers:{...getHeaders(),'Content-Type':'application/json'},
          body:JSON.stringify({text}),signal:controller.signal});
        data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'项目材料识别失败。');
      }
      if(current!==revision||input.value.trim()!==text)return;
      drafts=Array.isArray(data.projects)?data.projects:[];
      results.innerHTML=(data.warnings||[]).map(warning=>`<p class="ai-review-warning">${escape(warning)}</p>`).join('')
        +(drafts.length?drafts.map(renderDraft).join(''):'<p>未识别到可建项的债券，请补充发行材料。</p>');
    }catch(error){if(current===revision&&error.name!=='AbortError')results.innerHTML=`<p role="alert">${escape(error.message||'识别暂时不可用。')}</p>`;}
    finally{if(current===revision){request=null;button.disabled=false;button.textContent='识别材料';}}
  }
  function renderDraft(draft,index){
    const values=draft.patch||{};
    const rows=[['债券简称',values.shortName],['发行人',values.issuerName],['联动分行',values.branch],['期限',values.durationText],
      ['发行规模',values.issueScale!=null?`${values.issueScale} 亿`:null],['询价区间',(values.inquiryRanges||[]).filter(range=>range.low!=null||range.high!=null).map(range=>`${range.low??'—'}–${range.high??'—'}%`).join(' / ')],
      ['发行场所',values.venue],['发行方式',values.offeringType],['主承销商',values.leadUnderwriter],['截标时间',values.cutoffAt]];
    const evidence=Object.entries(draft.fields||{}).filter(([,field])=>field?.raw).map(([key,field])=>`<dt>${escape(PROJECT_INTAKE_LABELS[key]||key)}</dt><dd>${escape(field.evidence)}</dd>`).join('');
    return `<article class="project-intake-draft"><header><strong>${escape(values.shortName||`项目 ${index+1}`)}</strong><button type="button" class="button subtle" data-intake-apply="${index}" ${values.shortName?'':'disabled'}>载入草稿</button></header>
      <dl class="ai-review-fields">${rows.filter(([,value])=>value!=null&&value!=='').map(([label,value])=>`<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
      ${(draft.warnings||[]).map(warning=>`<p class="ai-review-warning">${escape(warning)}</p>`).join('')}
      <details><summary>查看原文依据</summary>${evidence?`<dl class="ai-review-fields">${evidence}</dl>`:''}<pre>${escape(draft.sourceText||source)}</pre></details></article>`;
  }
  function invalidate(){revision++;request?.abort();request=null;drafts=[];source='';results.innerHTML='';button.disabled=false;button.textContent='识别材料';}
  return {run,reset(){invalidate();input.value='';},dispose(){invalidate();input.value='';input.removeEventListener('input',invalidate);button.removeEventListener('click',run);}};
}
