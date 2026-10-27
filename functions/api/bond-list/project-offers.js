import { apiHeaders, json, readUserAppState, requireUser } from '../_auth.js';
import { checkWriteRequest, readBody, validateSections } from './_shared.js';
import { quoteRows } from '../../../bond-list-filter.js';
import { formatOfrQuote, ofrYieldFromValuation, projectOfrCandidates, resolveOfrBranch, sameProjectOfrRow } from '../../../project-ofr.js';
import { appendProjectOffer, ensureProjectOffersSchema, readOfrDraft, readProjectOffers } from './_project-offers.js';

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: '挂卖清单存储暂不可用' }, 503);
  try {
    await ensureProjectOffersSchema(context.env.DB);
    const draft = await readOfrDraft(context.env.DB, auth.user.id);
    return json({ transfers: await readProjectOffers(context.env.DB, auth.user.id, draft.sections),
      branches: draft.sections.map(section => section.title) });
  } catch { return json({ error: '读取项目挂卖记录失败，请稍后重试' }, 503); }
}

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const denied = checkWriteRequest(context.request);
  if (denied) return denied;
  if (!context.env.DB) return json({ error: '挂卖清单存储暂不可用' }, 503);
  let body;
  try {
    body = await readBody(context.request, 4096);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['add', 'seen'].includes(body.action)) throw Error('action');
    if (body.action === 'add' && (!validId(body.projectId) || !validId(body.trancheId))) throw Error('id');
    if (body.action === 'seen' && (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 50 || !body.ids.every(validId))) throw Error('ids');
  } catch { return json({ error: '挂卖操作格式无效' }, 400); }
  try {
    await ensureProjectOffersSchema(context.env.DB);
    if (body.action === 'seen') return await markSeen(context.env.DB, auth.user.id, body.ids);
    return await addOffer(context.env.DB, auth.user.id, body);
  } catch (error) {
    if (error.status) return json({ error: error.message, code: error.code || 'invalid_offer' }, error.status);
    return json({ error: '加入挂卖清单失败，原有清单仍保留，请稍后重试' }, 503);
  }
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: apiHeaders() }); }

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\r\n\u0000-\u001f]/.test(value);

async function addOffer(db, owner, body) {
  // Retry a bounded CAS conflict from another writer without ever replacing its new content.
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readUserAppState(db, owner);
    const project = state.data.projects?.find(value => value.id === body.projectId);
    if (!project) throw failure(404, '项目不存在或无权操作');
    const candidate = projectOfrCandidates(project).find(value => value.trancheId === body.trancheId);
    if (!candidate) throw failure(422, '该品种尚未确认本行表内中标，或已取消、全额回拨，请先核对项目结果');
    const draft = await readOfrDraft(db, owner);
    const branches = draft.sections.map(section => section.title);
    const prior = await readProjectOffers(db, owner, draft.sections, body.projectId, body.trancheId);
    const existingSource = prior.find(offer => offer.present);
    if (existingSource) return json({ added: false, alreadyExists: true, transfer: existingSource, revision: draft.revision });
    const branchTitle = typeof body.branchTitle === 'string' && branches.includes(body.branchTitle)
      ? body.branchTitle : body.branchTitle === undefined ? resolveOfrBranch(candidate.branch, branches) : '';
    const matchingRow = branchTitle && quoteRows(draft.sections).find(row => sameProjectOfrRow({ ...candidate, branchTitle }, row));
    if (matchingRow) return json({ added: false, alreadyExists: true, transfer: null, revision: draft.revision,
      existing: { branchTitle, securityCode: matchingRow.code, shortName: matchingRow.name, rawLine: matchingRow.raw } });
    const snapshot = candidate.initialMarketValuation;
    const manual = candidate.needsValuationConfirmation;
    const baseValuation = manual ? body.confirmedValuation : snapshot;
    const requiredFields = [];
    if (manual && (typeof body.confirmedValuation !== 'number' || !Number.isFinite(body.confirmedValuation))) requiredFields.push('valuation');
    if (!branchTitle) requiredFields.push('branch');
    if (requiredFields.length) return json({ error: requiredFields.includes('valuation')
      ? '该品种未保留建项估值，请核对并确认建项时估值后加入' : '联动分行无法唯一对应，请选择挂卖分行',
      code: 'confirmation_required', requiredFields, branches }, 422);
    const ofrYield = ofrYieldFromValuation(baseValuation);
    if (ofrYield === null) throw failure(422, '建项估值须大于0.05%且不超过100%，减5bp后须为有效正收益率', 'invalid_valuation');
    const now = new Date().toISOString();
    const transfer = { id: crypto.randomUUID(), projectId: body.projectId, trancheId: body.trancheId,
      branchTitle, securityCode: candidate.securityCode, shortName: candidate.shortName,
      baseValuation, ofrYield, rawLine: formatOfrQuote({ ...candidate, ofrYield }),
      valuationSource: manual ? 'manual-confirmed-entry' : 'project-entry',
      valuationAt: manual ? now : candidate.initialMarketValuationAt, createdAt: now, seenAt: null, present: true };
    const sections = validateSections(draft.sections.map(section => section.title === branchTitle
      ? { ...section, text: section.text + (section.text && !section.text.endsWith('\n') ? '\n' : '') + transfer.rawLine }
      : section));
    if (new TextEncoder().encode(JSON.stringify({ revision: draft.revision + 1, sections })).byteLength > 400000) {
      throw failure(413, '清单内容已达到保存上限，请整理后再加入');
    }
    if (await appendProjectOffer(db, owner, draft, state.revision, sections, transfer)) {
      return json({ added: true, alreadyExists: false, transfer, revision: draft.revision + 1 });
    }
  }
  return json({ error: '清单或项目刚被其他窗口更新，原有内容已保留，请稍后重试', code: 'offer_conflict' }, 409);
}

async function markSeen(db, owner, ids) {
  const unique = [...new Set(ids)], now = new Date().toISOString();
  await db.prepare(`UPDATE bond_list_project_offers SET seen_at = ?1
    WHERE user_id = ?2 AND seen_at IS NULL AND id IN (${unique.map((_, index) => '?' + (index + 3)).join(',')})`)
    .bind(now, owner, ...unique).run();
  return json({ ok: true });
}

function failure(status, message, code = '') { return Object.assign(new Error(message), { status, code }); }
