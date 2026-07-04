import { apiHeaders, json } from "../_auth.js";

export async function onRequestPost() {
  return json({
    error: "Bond Centre login has moved to https://tempest07.com/login/",
  }, 410);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
