export const DATA_SOURCE_COOKIE = 'bond_centre_data_source';
const modes = new Set(['auto', 'dm', 'qb']);
export function normalizeDataSourceMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return modes.has(mode) ? mode : '';
}
export function defaultDataSourceMode(env = {}) {
  // Temporary outage policy: configured installations start directly on QB.
  // An explicit server setting can restore auto without changing user choices.
  return normalizeDataSourceMode(env.BOND_DATA_SOURCE_MODE) || (env.QB_ACCESS_KEY ? 'qb' : 'auto');
}
export function resolveDataSourceMode(env = {}, request) {
  const header = normalizeDataSourceMode(request?.headers?.get('X-Bond-Data-Source'));
  if (header) return header;
  for (const entry of (request?.headers?.get('Cookie') || '').split(';')) {
    const [name, ...parts] = entry.trim().split('=');
    if (name !== DATA_SOURCE_COOKIE) continue;
    try { const mode = normalizeDataSourceMode(decodeURIComponent(parts.join('='))); if (mode) return mode; } catch { /* Invalid preference falls back to the server default. */ }
  }
  return defaultDataSourceMode(env);
}
export function dataSourceStatus(env, request) {
  return { mode: resolveDataSourceMode(env, request), defaultMode: defaultDataSourceMode(env),
    configured: { dm: Boolean(env.INNO_APP_KEY && (env.INNO_APP_SECRET || env.INNO_SM4_KEY)), qb: Boolean(env.QB_ACCESS_KEY) } };
}
