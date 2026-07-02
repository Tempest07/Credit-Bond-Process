import { apiHeaders, json, requireUser } from "../_auth.js";

const DEFAULT_MAILER_URL = "https://credit-bond-mailer.weiqian-yu.workers.dev";

export async function onRequestGet(context) {
  return proxyMailer(context, "preview");
}

export async function onRequestPost(context) {
  return proxyMailer(context, "send");
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function proxyMailer(context, fallbackAction) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;

  const url = new URL(context.request.url);
  const action = (url.searchParams.get("action") || fallbackAction || "preview").toLowerCase();
  const isSend = action === "send";
  const password = String(context.env.MAILER_APP_PASSWORD || context.env.ADMIN_PASSWORD || context.env.APP_PASSWORD || "").trim();
  if (!password) return json({ ok: false, error: "Mailer Secret APP_PASSWORD 尚未配置" }, 503);

  const mailerUrl = String(context.env.MAILER_URL || DEFAULT_MAILER_URL).replace(/\/+$/, "");
  const target = new URL(`${mailerUrl}/${isSend ? "send-today" : "preview-today"}`);
  const date = url.searchParams.get("date");
  if (date) target.searchParams.set("date", date);

  try {
    const upstream = await fetch(target.toString(), {
      method: isSend ? "POST" : "GET",
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
