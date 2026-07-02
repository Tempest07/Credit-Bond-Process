import { apiHeaders, isLocalRequest, json, loginUser } from "../_auth.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    if (!username || !password) return json({ error: "请输入用户名和密码" }, 400);

    const result = await loginUser(context.env.DB, context.env, { username, password }, {
      allowDefaultPassword: isLocalRequest(context.request),
    });
    if (!result) return json({ error: "用户名或密码错误" }, 401);
    return json({
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
    });
  } catch (error) {
    const status = /D1 binding DB/.test(error.message || "") ? 503 : 400;
    return json({ error: error.message || "登录失败" }, status);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
