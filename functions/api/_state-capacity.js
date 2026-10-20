// D1 limits a complete row to 2,000,000 bytes, including snapshot metadata.
export const MAX_STATE_BYTES = 10_000_000;
export const MAX_STATE_BODY_BYTES = 10_100_000;
const MAX_ROW_BYTES = 1_990_000;
const ROW_OVERHEAD_BYTES = 4096;
const encoder = new TextEncoder();

export function stateCapacityPayload() {
  return {
    error: "资料库超过单次同步的安全容量，请保留本机副本并导出备份后联系管理员",
    code: "state_too_large",
    maxBytes: MAX_STATE_BYTES,
  };
}

export class StateCapacityError extends Error {
  constructor() {
    super(stateCapacityPayload().error);
    this.name = "StateCapacityError";
  }
}

export function assertStateCapacity(serialized, rows) {
  const byteSize = encoder.encode(serialized).byteLength;
  if (byteSize > MAX_STATE_BYTES) throw new StateCapacityError();
  for (const columns of rows) {
    const rowBytes = columns.reduce((total, value) => total + (
      typeof value === "string" ? encoder.encode(value).byteLength : 8
    ), ROW_OVERHEAD_BYTES);
    if (rowBytes > MAX_ROW_BYTES) throw new StateCapacityError();
  }
  return byteSize;
}

export async function readStateBodyText(request) {
  if (Number(request.headers.get("Content-Length") || 0) > MAX_STATE_BODY_BYTES) throw new StateCapacityError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_STATE_BODY_BYTES) { await reader.cancel(); throw new StateCapacityError(); }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally { reader.releaseLock(); }
}
