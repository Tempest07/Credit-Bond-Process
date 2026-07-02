import { apiHeaders, json, requireUser } from "../_auth.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  return json({ user: auth.user });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
