const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function onRequestGet(context) {
  const denied = authorize(context);
  if (denied) return denied;
  try {
    await ensureSchema(context.env.DB);
    const row = await context.env.DB.prepare("SELECT data, updated_at FROM app_state WHERE id = 1").first();
    return json({
      data: row?.data ? JSON.parse(row.data) : { version: 3, issuers: [], projects: [], protocolTransfers: [], secondaryTrades: [], updatedAt: null },
      updatedAt: row?.updated_at || null,
    });
  } catch (error) {
    return json({ error: error.message || "读取资料库失败" }, 500);
  }
}

export async function onRequestPut(context) {
  const denied = authorize(context);
  if (denied) return denied;
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

    await ensureSchema(context.env.DB);
    await context.env.DB.prepare(`
      INSERT INTO app_state (id, data, updated_at)
      VALUES (1, ?1, ?2)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).bind(JSON.stringify(data), updatedAt).run();

    return json({ status: "ok", updatedAt });
  } catch (error) {
    return json({ error: error.message || "保存资料库失败" }, 400);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function ensureSchema(db) {
  if (!db) throw new Error("Cloudflare D1 binding DB 尚未配置");
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
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
  if (data.secondaryTrades !== undefined && !Array.isArray(data.secondaryTrades)) throw new Error("二级交易台账必须为 secondaryTrades 数组");
  if ((data.secondaryTrades || []).length > 10000) throw new Error("二级交易记录数量不能超过10000");
  return {
    version: 3,
    issuers: data.issuers,
    projects: data.projects || [],
    protocolTransfers: data.protocolTransfers || [],
    secondaryTrades: data.secondaryTrades || [],
    ftpCurve: data.ftpCurve || {},
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

function authorize(context) {
  const password = context.env.APP_PASSWORD;
  if (!password) return json({ error: "Pages Secret APP_PASSWORD 尚未配置" }, 503);
  const authorization = context.request.headers.get("Authorization") || "";
  if (authorization !== `Bearer ${password}`) return json({ error: "Unauthorized" }, 401);
  return null;
}

function apiHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders() });
}
