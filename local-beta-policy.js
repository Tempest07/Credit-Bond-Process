// Only the server-injected marker on a loopback host enables the isolated Beta.
// URL parameters, UI preferences and persisted watchlist settings are not inputs.
export function readLocalBetaPolicy(hostname, marker) {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)
    || !marker || marker.manualQuotesOnly !== true
    || typeof marker.id !== "string" || !marker.id.trim()
    || typeof marker.snapshotAt !== "string" || !marker.snapshotAt.trim()) return null;
  return Object.freeze({ id: marker.id, snapshotAt: marker.snapshotAt, manualQuotesOnly: true });
}

export function localBetaSyncText(text, policy) {
  if (!policy) return text;
  return String(text).replace(/(?:Cloudflare D1|本地 D1)\s*|云端/g, "本地副本");
}

export function localBetaManualHeaders(policy, manual) {
  return policy && manual === true ? { "X-Beta-Manual-Refresh": "1" } : {};
}
