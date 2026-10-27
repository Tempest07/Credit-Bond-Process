import { requireUser,json } from '../_auth.js';
import { isSameOriginMutation } from '../_same-origin.js';
import { runDeepseekText } from '../_deepseek-text.js';
import { PROJECT_INTAKE_REVISION,projectIntakeInput,projectIntakeMessages,validateProjectIntake } from '../../../project-intake-ai.js';

export async function onRequestPost(context) {
  const auth=await requireUser(context); if(auth.response)return auth.response;
  if(!isSameOriginMutation(context.request))return json({error:'请求来源不受信任。'},403);
  try {
    const body=await boundedRequest(context.request); const text=projectIntakeInput(body.text);
    if(!context.env.DB)return json({error:'项目资料库尚未配置。'},503);
    const db=context.env.DB;
    await db.prepare(`CREATE TABLE IF NOT EXISTS ai_task_cache (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,purpose TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
    const id=await fingerprint(`${auth.user.id}|${PROJECT_INTAKE_REVISION}|${text}`);
    const cached=await db.prepare('SELECT result_json FROM ai_task_cache WHERE id=?1 AND user_id=?2 AND purpose=?3').bind(id,auth.user.id,'project-intake').first();
    if(cached){let value;try{value=JSON.parse(cached.result_json);}catch{}if(value?.projects)return json({ok:true,...value,cached:true});}
    const result=await runDeepseekText(context.env,{purpose:'project-intake',messages:projectIntakeMessages(text),maxTokens:8192},{fetchImpl:context.fetchImpl,signal:context.request.signal});
    const draft={...validateProjectIntake(text,result.output),model:result.model,provider:result.provider};
    await db.prepare('INSERT OR REPLACE INTO ai_task_cache (id,user_id,purpose,result_json,created_at) VALUES (?1,?2,?3,?4,?5)').bind(id,auth.user.id,'project-intake',JSON.stringify(draft),new Date().toISOString()).run();
    await db.prepare(`DELETE FROM ai_task_cache WHERE user_id=?1 AND purpose='project-intake' AND id NOT IN (SELECT id FROM ai_task_cache WHERE user_id=?1 AND purpose='project-intake' ORDER BY created_at DESC LIMIT 30)`).bind(auth.user.id).run();
    return json({ok:true,...draft,cached:false});
  }catch(error){return json({error:error.publicMessage||'项目材料识别暂时不可用。',...(error.code?{code:error.code}:{})},error.httpStatus||502);}
}
async function boundedRequest(request){
  const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('empty'),{httpStatus:400,publicMessage:'请填写项目材料。'});
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>100000){await reader.cancel();throw Object.assign(new Error('large'),{httpStatus:413,publicMessage:'项目材料过长。'});}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Object.assign(new Error('json'),{httpStatus:400,publicMessage:'项目材料格式无效。'});}
}
async function fingerprint(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
