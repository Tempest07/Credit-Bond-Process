import { requireUser, json } from '../_auth.js';
import { DEFAULT_BRANCHES, checkWriteRequest, readBody, validateSections, ensureSchema } from './_shared.js';

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const db = context.env.DB;
  if (!db) return json({error:'云端清单存储暂不可用'}, 503);
  try {
    await ensureSchema(db);
    const empty = DEFAULT_BRANCHES.map(title => ({title, text:''}));
    await db.prepare('INSERT INTO bond_list_drafts (user_id, sections, revision, updated_at) VALUES (?1, ?2, 0, ?3) ON CONFLICT(user_id) DO NOTHING')
      .bind(auth.user.id, JSON.stringify(empty), new Date().toISOString()).run();
    const row = await db.prepare('SELECT sections, revision, updated_at FROM bond_list_drafts WHERE user_id = ?1').bind(auth.user.id).first();
    return json({sections:JSON.parse(row.sections), revision:row.revision, updatedAt:row.updated_at, userId:auth.user.id});
  } catch { return json({error:'读取云端清单失败，请稍后重试'}, 503); }
}

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const rejected = checkWriteRequest(context.request);
  if (rejected) return rejected;
  if (!context.env.DB) return json({error:'云端清单存储暂不可用'}, 503);
  let body, sections;
  try {
    body = await readBody(context.request);
    if (!Number.isSafeInteger(body?.revision) || body.revision < 0) throw new Error('revision');
    sections = validateSections(body.sections);
  } catch { return json({error:'清单格式无效或内容超过 400 KB'}, 400); }
  try {
    await ensureSchema(context.env.DB);
    const updatedAt = new Date().toISOString();
    const saved = await context.env.DB.prepare('UPDATE bond_list_drafts SET sections = ?1, revision = revision + 1, updated_at = ?2 WHERE user_id = ?3 AND revision = ?4')
      .bind(JSON.stringify(sections), updatedAt, auth.user.id, body.revision).run();
    if (saved.meta.changes !== 1) return json({error:'其他窗口或设备已保存新内容。当前输入仍保留，请先导出草稿，再刷新核对。'}, 409);
    return json({revision:body.revision + 1, updatedAt});
  } catch { return json({error:'云端保存失败，当前输入仍保留，请导出草稿或稍后重试'}, 503); }
}
