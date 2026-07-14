const WIND_ANALYTICS_ENDPOINT = "https://mcp.wind.com.cn/vserver_analytics_data/mcp/";
const WIND_TOOL_NAME = "get_financial_data";
const WIND_CLIENT_VERSION = "1.9.6";
const MAX_RESPONSE_BYTES = 2_000_000;

export function windImpliedRatingEnabled(env = {}) {
  return Boolean(String(env.WIND_API_KEY || "").trim());
}

export async function lookupWindImpliedRating(env = {}, {
  securityId = "",
  shortName = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const apiKey = String(env.WIND_API_KEY || "").trim();
  const target = String(securityId || shortName || "").replace(/\s+/g, "").trim();
  if (!apiKey) return emptyWindResult("not_configured", target);
  if (!target) return emptyWindResult("no_target", target);

  try {
    await windMcpRequest(apiKey, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "credit-bond-process",
        version: WIND_CLIENT_VERSION,
      },
    }, { fetchImpl, timeoutMs: 30_000 });

    const result = await windMcpRequest(apiKey, "tools/call", {
      name: WIND_TOOL_NAME,
      arguments: { question: `${target}中债隐含评级` },
      _meta: { clientVersion: WIND_CLIENT_VERSION },
    }, { fetchImpl, timeoutMs: 60_000 });

    const rows = windRowsFromMcpResult(result);
    const matched = bestWindImpliedRatingRow(rows, { securityId, shortName });
    if (!matched?.rating) {
      return {
        ...emptyWindResult("no_result", target),
        rowCount: rows.length,
      };
    }
    return {
      status: "ok",
      source: "wind-analytics",
      target,
      rating: matched.rating,
      windCode: matched.windCode,
      shortName: matched.shortName,
      asOf: matched.asOf,
      rowCount: rows.length,
    };
  } catch (error) {
    return {
      ...emptyWindResult("error", target),
      errorCode: String(error?.code || "WIND_MCP_ERROR"),
      error: publicWindErrorMessage(error),
    };
  }
}

async function windMcpRequest(apiKey, method, params, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(WIND_ANALYTICS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw windError("WIND_RESPONSE_TOO_LARGE", `Wind 响应过大：${declaredLength} bytes`);
  }
  const text = await readBoundedResponseText(response);
  if (!response.ok) {
    throw windError("WIND_HTTP_ERROR", `Wind HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = parseWindMcpEnvelope(text);
  if (payload?.error) {
    throw windError("WIND_RPC_ERROR", String(payload.error.message || JSON.stringify(payload.error)).slice(0, 500));
  }
  if (payload?.result?.isError) {
    const detail = payload.result.content?.[0]?.text || JSON.stringify(payload.result);
    throw windError("WIND_TOOL_ERROR", String(detail).slice(0, 500));
  }
  return payload?.result;
}

function parseWindMcpEnvelope(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw windError("WIND_EMPTY_RESPONSE", "Wind MCP 返回空响应");
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to SSE parsing because some gateways prepend non-payload JSON lines.
    }
  }
  const dataLines = trimmed.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(dataLines[index]);
    } catch {
      // Try the previous SSE data line.
    }
  }
  throw windError("WIND_RESPONSE_FORMAT_ERROR", `无法识别 Wind MCP 响应：${trimmed.slice(0, 200)}`);
}

function windRowsFromMcpResult(result) {
  const contentText = result?.content?.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (!contentText) return [];
  let inner;
  try {
    inner = JSON.parse(contentText);
  } catch {
    return [];
  }
  if (inner?.error) {
    const detail = inner.error.message || inner.error.code || JSON.stringify(inner.error);
    throw windError("WIND_BUSINESS_ERROR", String(detail).slice(0, 500));
  }

  const blocks = Array.isArray(inner?.data?.data)
    ? inner.data.data
    : Array.isArray(inner?.data)
      ? inner.data
      : [];
  return blocks.flatMap(windRowsFromBlock);
}

function windRowsFromBlock(block = {}) {
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const columns = Array.isArray(block.columns)
    ? block.columns.map((column) => String(column?.name || column || ""))
    : [];
  return rows.map((row) => {
    if (row && !Array.isArray(row) && typeof row === "object") return row;
    if (!Array.isArray(row)) return {};
    return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  });
}

function bestWindImpliedRatingRow(rows, { securityId = "", shortName = "" } = {}) {
  const codeTarget = normalizeWindCode(securityId);
  const nameTarget = normalizeWindName(shortName);
  const candidates = (rows || []).map((row) => ({
    row,
    rating: windImpliedRatingFromRow(row),
    windCode: windCodeFromRow(row),
    shortName: windShortNameFromRow(row),
    asOf: windAsOfFromRow(row),
  })).filter((item) => item.rating);
  const codeMatch = candidates.find((item) => codeTarget && normalizeWindCode(item.windCode) === codeTarget);
  if (codeMatch) return codeMatch;
  const nameMatch = candidates.find((item) => nameTarget && normalizeWindName(item.shortName) === nameTarget);
  if (nameMatch) return nameMatch;

  // Wind sometimes returns one scalar rating without repeating the queried code.
  // Accept that shape only when the row is anonymous; never select an identified,
  // non-matching bond merely because it is the first result.
  if (candidates.length === 1 && !candidates[0].windCode && !candidates[0].shortName) {
    return candidates[0];
  }
  if (!codeTarget && !nameTarget && candidates.length === 1) return candidates[0];
  return null;
}

async function readBoundedResponseText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw windError("WIND_RESPONSE_TOO_LARGE", `Wind 响应超过 ${MAX_RESPONSE_BYTES} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw windError("WIND_RESPONSE_TOO_LARGE", `Wind 响应超过 ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function windImpliedRatingFromRow(row = {}) {
  for (const [key, value] of Object.entries(row)) {
    if (!/(?:隐含评级.*中债|中债.*隐含评级|cbc.*rating|implied.*rating)/i.test(String(key))) continue;
    const rating = normalizeWindImpliedRating(value);
    if (rating) return rating;
  }
  return "";
}

function windCodeFromRow(row = {}) {
  return pickWindValue(row, [/^Wind代码$/i, /^wind_?code$/i, /证券代码/i]);
}

function windShortNameFromRow(row = {}) {
  return pickWindValue(row, [/^证券简称$/i, /short.*name/i, /债券简称/i]);
}

function windAsOfFromRow(row = {}) {
  return pickWindValue(row, [/数据日期/i, /交易日期/i, /^日期$/i, /trade.*date/i, /as.*of/i]);
}

function pickWindValue(row, patterns) {
  for (const [key, value] of Object.entries(row || {})) {
    if (patterns.some((pattern) => pattern.test(String(key))) && String(value ?? "").trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeWindImpliedRating(value = "") {
  const text = String(value || "").replace(/\s+/g, "").toUpperCase();
  const match = text.match(/^(AAA[+-]?|AA(?:\(\d+\)|[+-])?|A(?:\(\d+\)|[+-])?|BBB[+-]?|BB[+-]?|B[+-]?)$/);
  return match?.[1] || "";
}

function normalizeWindCode(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function normalizeWindName(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function emptyWindResult(status, target) {
  return {
    status,
    source: "wind-analytics",
    target,
    rating: "",
    windCode: "",
    shortName: "",
    asOf: "",
    rowCount: 0,
  };
}

function windError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicWindErrorMessage(error) {
  const code = String(error?.code || "WIND_MCP_ERROR");
  if (code === "WIND_RESPONSE_TOO_LARGE") return "Wind 响应过大，已终止读取";
  if (code === "WIND_HTTP_ERROR") return "Wind 服务请求失败";
  if (code === "WIND_RPC_ERROR" || code === "WIND_TOOL_ERROR" || code === "WIND_BUSINESS_ERROR") {
    return "Wind 未返回可用的中债隐含评级";
  }
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "Wind 查询超时";
  return "Wind 中债隐含评级查询失败";
}

export const __test__ = {
  parseWindMcpEnvelope,
  windRowsFromMcpResult,
  bestWindImpliedRatingRow,
  normalizeWindImpliedRating,
};
