import { apiHeaders, ensureAuthSchema, isLocalRequest, json, requireUser } from "./_auth.js";
import { ensureStateVersionSchema, listStateSnapshots } from "./_state-versioning.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    await ensureStateVersionSchema(context.env.DB);
    const url = new URL(context.request.url);
    const snapshots = await listStateSnapshots(context.env.DB, auth.user.id, url.searchParams.get("limit"));
    return json({ snapshots, user: auth.user });
  } catch (error) {
    return json({ error: error.message || "读取版本历史失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
