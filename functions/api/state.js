import {
  EMPTY_APP_STATE,
  apiHeaders,
  ensureAuthSchema,
  isLocalRequest,
  json,
  readUserAppState,
  requireUser,
} from "./_auth.js";
import { ensureStateVersionSchema, saveStateVersion } from "./_state-versioning.js";

const MAX_BODY_BYTES = 1_900_000;
const MAX_STATE_BYTES = 1_800_000;

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);
  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    await ensureStateVersionSchema(context.env.DB);
    const result = await readUserAppState(context.env.DB, auth.user.id);
    return json({
      data: result.data,
      updatedAt: result.updatedAt,
      revision: result.revision,
      user: auth.user,
    });
  } catch (error) {
    return json({ error: error.message || "读取资料库失败" }, 500);
  }
}

export async function onRequestPut(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);
  const declaredLength = Number(context.request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "提交的数据过大" }, 413);

  let body;
  let data;
  try {
    const text = await context.request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return stateTooLargeResponse();
    body = JSON.parse(text);
    if (body?.expectedRevision === undefined || body?.expectedRevision === null || !Number.isInteger(Number(body.expectedRevision))) {
      return json({ error: "保存前必须先读取云端 revision", code: "revision_required" }, 428);
    }
    data = validateState(body?.data);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_STATE_BYTES) return stateTooLargeResponse();
  } catch (error) {
    return json({ error: error.message || "资料库格式无效" }, 400);
  }

  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    await ensureStateVersionSchema(context.env.DB);
    const result = await saveStateVersion(context.env.DB, auth.user.id, {
      data,
      expectedRevision: Number(body.expectedRevision),
      meta: body.meta,
      mirrorLegacy: auth.user.id === "admin",
    });
    if (result.status === "conflict") {
      return json({
        error: "云端已有其他来源保存的新版本；本次内容已保留为冲突快照",
        code: "state_conflict",
        revision: result.revision,
        updatedAt: result.updatedAt,
        conflictSnapshot: result.snapshot,
      }, 409);
    }

    return json({
      status: result.status,
      updatedAt: result.updatedAt,
      revision: result.revision,
      snapshot: result.snapshot,
      user: auth.user,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "state_save_failed",
      userId: auth.user.id,
      message: error.message || "unknown",
    }));
    return json({ error: error.message || "保存资料库失败", code: "state_save_failed" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

export function validateState(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.issuers)) {
    throw new Error("资料库必须包含 issuers 数组");
  }
  if (data.issuers.length > 10000) throw new Error("主体数量不能超过10000");
  if (data.absCreditApprovals !== undefined && !Array.isArray(data.absCreditApprovals)) throw new Error("ABS 50217 批单必须为 absCreditApprovals 数组");
  if ((data.absCreditApprovals || []).length > 10000) throw new Error("ABS 50217 批单数量不能超过10000");
  if ((data.absCreditApprovals || []).some((approval) => approval?.businessCode !== "50217")) {
    throw new Error("ABS 授信库只能保存业务代码 50217");
  }
  if (data.projects !== undefined && !Array.isArray(data.projects)) throw new Error("项目台账必须为 projects 数组");
  if ((data.projects || []).length > 10000) throw new Error("项目数量不能超过10000");
  if (data.protocolTransfers !== undefined && !Array.isArray(data.protocolTransfers)) throw new Error("协议转让台账必须为 protocolTransfers 数组");
  if ((data.protocolTransfers || []).length > 10000) throw new Error("协议转让记录数量不能超过10000");
  if (data.secondaryInventoryPositions !== undefined && !Array.isArray(data.secondaryInventoryPositions)) throw new Error("二级库存快照必须为 secondaryInventoryPositions 数组");
  if ((data.secondaryInventoryPositions || []).length > 20000) throw new Error("二级库存快照数量不能超过20000");
  if (data.secondaryOrders !== undefined && !Array.isArray(data.secondaryOrders)) throw new Error("二级挂单必须为 secondaryOrders 数组");
  if ((data.secondaryOrders || []).length > 20000) throw new Error("二级挂单数量不能超过20000");
  if (data.secondaryTrades !== undefined && !Array.isArray(data.secondaryTrades)) throw new Error("二级成交流水必须为 secondaryTrades 数组");
  if ((data.secondaryTrades || []).length > 20000) throw new Error("二级成交流水数量不能超过20000");
  return {
    ...EMPTY_APP_STATE,
    version: 5,
    issuers: data.issuers,
    absCreditApprovals: data.absCreditApprovals || [],
    projects: data.projects || [],
    protocolTransfers: data.protocolTransfers || [],
    secondaryInventoryPositions: data.secondaryInventoryPositions || [],
    secondaryOrders: data.secondaryOrders || [],
    secondaryTrades: data.secondaryTrades || [],
    ftpCurve: data.ftpCurve || {},
    reminderState: data.reminderState && typeof data.reminderState === "object" ? data.reminderState : {},
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

function stateTooLargeResponse() {
  return json({
    error: "资料库已接近 Cloudflare D1 单行容量上限，请先导出备份并联系管理员拆分数据",
    code: "state_too_large",
    maxBytes: MAX_STATE_BYTES,
  }, 413);
}
