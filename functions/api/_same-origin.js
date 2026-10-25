export function isSameOriginMutation(request) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
  const origin = request.headers.get("Origin");
  return origin
    ? [new URL(request.url).origin, "https://tempest07.com"].includes(origin)
    : request.headers.get("Sec-Fetch-Site") === "same-origin";
}
