import {
  ensureAuthSchema,
  isLocalRequest,
  json,
  readUserAppState,
  requireUser,
} from "./_auth.js";
import { buildUnifiedReminders } from "../../reminders.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: isLocalRequest(context.request) });
    const result = await readUserAppState(context.env.DB, auth.user.id);
    const referenceDate = referenceDateFromRequest(context.request);
    const reminders = buildUnifiedReminders(result.data, referenceDate).map(reminderPayload);
    return json({
      ok: true,
      generatedAt: referenceDate.toISOString(),
      updatedAt: result.updatedAt,
      user: auth.user,
      count: reminders.length,
      reminders,
    });
  } catch (error) {
    return json({ error: error.message || "读取待办提醒失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function referenceDateFromRequest(request) {
  const value = new URL(request.url).searchParams.get("now");
  if (!isLocalRequest(request) || !value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function reminderPayload(item) {
  return {
    id: item.id,
    kind: item.kind,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    moduleLabel: item.moduleLabel,
    subject: item.subject,
    title: item.title,
    detail: item.detail,
    severity: item.severity,
    timing: item.timing,
    pushPolicy: item.pushPolicy,
    dueAt: item.dueAt,
    actionLabel: item.actionLabel,
    route: item.route,
    priority: item.priority,
  };
}
