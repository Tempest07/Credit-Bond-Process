import { apiHeaders, clearSessionCookie, json, logoutUser, requestToken } from "../_auth.js";

export async function onRequestPost(context) {
  await logoutUser(context.env.DB, requestToken(context.request));
  return json({ status: "ok" }, 200, {
    "Set-Cookie": clearSessionCookie(context.request),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
