import { apiHeaders, json, requireUser } from "../_auth.js";

const DEFAULT_MAILER_URL = "https://credit-bond-mailer.weiqian-yu.workers.dev";

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;

  const password = String(context.env.MAILER_APP_PASSWORD || context.env.ADMIN_PASSWORD || context.env.APP_PASSWORD || "").trim();
  if (!password) return json({ ok: false, error: "Mailer Secret APP_PASSWORD 尚未配置" }, 503);

  const source = new URL(context.request.url);
  const mailerUrl = String(context.env.MAILER_URL || DEFAULT_MAILER_URL).replace(/\/+$/, "");
  const target = new URL(`${mailerUrl}/send-secondary-ledger`);
  const date = source.searchParams.get("date");
  if (date) target.searchParams.set("date", date);

  try {
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${password}` },
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...apiHeaders(),
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return json({
      ok: false,
      error: error.message || "Mailer Worker 请求失败",
      hint: "请确认 credit-bond-mailer Worker 已部署，且 Pages Secret 中保留 APP_PASSWORD。",
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
