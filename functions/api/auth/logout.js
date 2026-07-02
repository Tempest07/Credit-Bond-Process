import { apiHeaders, bearerToken, json, logoutUser } from "../_auth.js";

export async function onRequestPost(context) {
  await logoutUser(context.env.DB, bearerToken(context.request));
  return json({ status: "ok" });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
