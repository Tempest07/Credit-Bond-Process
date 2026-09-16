// Emergency suspension requested 2026-09-16. This applies only to the live
// quotes panel's two endpoints; all other DM routes continue unchanged.
const SUSPENDED_ROUTES = new Set(["realtime-quotes", "realtime-valuations"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function onRequest(context) {
  const url = new URL(context.request.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").at(-1);
  if (!LOOPBACK_HOSTS.has(url.hostname) && SUSPENDED_ROUTES.has(route)) {
    return Response.json({
      ok: false,
      code: "DM_REALTIME_SUSPENDED",
      error: "实时行情的DM访问已暂停，其他DM功能不受影响。",
    }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return context.next();
}
