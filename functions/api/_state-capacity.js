// D1 limits a complete row to 2,000,000 bytes, including snapshot metadata.
export const MAX_STATE_BYTES = 1_900_000;
export const MAX_STATE_BODY_BYTES = 1_950_000;
const MAX_ROW_BYTES = 1_990_000;
const ROW_OVERHEAD_BYTES = 4096;
const encoder = new TextEncoder();

export function stateCapacityPayload() {
  return {
    error: "资料库超过当前安全保存容量，请导出备份并联系管理员扩展存储",
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
