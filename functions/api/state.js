import {
  EMPTY_APP_STATE,
  apiHeaders,
  ensureAuthSchema,
  isLocalRequest,
  json,
  readUserAppState,
  requireUser,
  writeUserAppState,
} from "./_auth.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);
  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    const result = await readUserAppState(context.env.DB, auth.user.id);
    return json({
      data: result.data,
      updatedAt: result.updatedAt,
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

  try {
    const text = await context.request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ error: "提交的数据过大" }, 413);
    }

    const body = JSON.parse(text);
    const data = validateState(body?.data);
    const updatedAt = new Date().toISOString();
    data.updatedAt = updatedAt;

    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    await writeUserAppState(context.env.DB, auth.user.id, data, updatedAt);
    if (auth.user.id === "admin") await writeLegacyAppState(context.env.DB, data, updatedAt);

    return json({ status: "ok", updatedAt, user: auth.user });
  } catch (error) {
    return json({ error: error.message || "保存资料库失败" }, 400);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

function validateState(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.issuers)) {
    throw new Error("资料库必须包含 issuers 数组");
  }
  if (data.issuers.length > 10000) throw new Error("主体数量不能超过10000");
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
    version: 4,
    issuers: data.issuers,
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

async function writeLegacyAppState(db, data, updatedAt) {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();
    await db.prepare(`
      INSERT INTO app_state (id, data, updated_at)
      VALUES (1, ?1, ?2)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).bind(JSON.stringify(data), updatedAt).run();
  } catch {
    // user_app_state is the source of truth; legacy app_state is only for older mailer deployments.
  }
}
