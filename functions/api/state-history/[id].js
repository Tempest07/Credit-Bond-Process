import { apiHeaders, ensureAuthSchema, isLocalRequest, json, requireUser } from "../_auth.js";
import {
  ensureStateVersionSchema,
  readStateSnapshot,
  saveStateVersion,
} from "../_state-versioning.js";
import { validateState } from "../state.js";

const MAX_ACTION_BODY_BYTES = 50_000;

function snapshotIdFromParams(params) {
  const rawId = String(params?.id || "");
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    await ensureStateVersionSchema(context.env.DB);
    const snapshot = await readStateSnapshot(context.env.DB, auth.user.id, snapshotIdFromParams(context.params));
    return snapshot ? json({ snapshot, user: auth.user }) : json({ error: "未找到该版本快照" }, 404);
  } catch (error) {
    return json({ error: error.message || "读取版本快照失败" }, 500);
  }
}

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  let body;
  try {
    const text = await context.request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ACTION_BODY_BYTES) {
      return json({ error: "提交的数据过大" }, 413);
    }
    body = JSON.parse(text || "{}");
  } catch {
    return json({ error: "请求格式无效" }, 400);
  }
  if (body.action !== "revert") return json({ error: "不支持的版本操作" }, 400);
  if (body.expectedRevision === undefined || body.expectedRevision === null || !Number.isInteger(Number(body.expectedRevision))) {
    return json({ error: "回溯前必须先读取云端 revision", code: "revision_required" }, 428);
  }

  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    await ensureStateVersionSchema(context.env.DB);
    const snapshot = await readStateSnapshot(context.env.DB, auth.user.id, snapshotIdFromParams(context.params));
    if (!snapshot) return json({ error: "未找到该版本快照" }, 404);

    const data = validateState(snapshot.data);
    const result = await saveStateVersion(context.env.DB, auth.user.id, {
      data,
      expectedRevision: Number(body.expectedRevision),
      meta: { ...body.meta, source: "revert" },
      restoredFromSnapshotId: snapshot.id,
      preserveConflict: false,
      mirrorLegacy: auth.user.id === "admin",
    });
    if (result.status === "conflict") {
      return json({
        error: "回溯前云端版本已变化，请刷新版本历史后重试",
        code: "state_conflict",
        revision: result.revision,
        updatedAt: result.updatedAt,
      }, 409);
    }
    return json({
      status: result.status,
      data: result.data,
      updatedAt: result.updatedAt,
      revision: result.revision,
      snapshot: result.snapshot,
      user: auth.user,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "state_revert_failed",
      userId: auth.user.id,
      snapshotId: snapshotIdFromParams(context.params).slice(0, 160),
      message: error.message || "unknown",
    }));
    return json({ error: error.message || "回溯版本失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
