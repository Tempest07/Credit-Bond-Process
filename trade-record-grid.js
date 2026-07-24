import {
  TRADE_RECORD_COLUMNS,
  normalizeTradeRecord,
} from "./trade-record-converter.js";

export const TRADE_RECORD_DM_COLUMNS = ["债券简称", "债券类型", "估值收益率"];
const TRADE_RECORD_DATE_COLUMNS = new Set(["谈判日", "交易日"]);
const TRADE_RECORD_NUMBER_COLUMNS = new Set([
  "净价",
  "收益率(%)",
  "估值收益率",
  "面值（万元）",
  "成本",
  "价差",
]);

export function createTradeRecordDraftRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    key: tradeRecordDraftKey(row),
    record: normalizeTradeRecord(row.record || {}),
    fieldSources: normalizeFieldSources(row.fieldSources),
    dmLookup: normalizeDmLookup(row.dmLookup),
    changedColumns: [],
    dirty: false,
  }));
}

export function tradeRecordDraftKey(row = {}) {
  return `${String(row.source || "secondary")}:${String(row.id || "")}`;
}

export function cloneTradeRecordDraftRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    record: { ...row.record },
    fieldSources: { ...row.fieldSources },
    dmLookup: normalizeDmLookup(row.dmLookup),
    changedColumns: [...(row.changedColumns || [])],
  }));
}

export function updateTradeRecordDraftCell(rows = [], {
  key,
  column,
  value,
  source = "manual",
} = {}) {
  if (!TRADE_RECORD_COLUMNS.includes(column)) return rows;
  const normalizedValue = cleanCellValue(value);
  return rows.map((row) => {
    if (row.key !== key || row.record[column] === normalizedValue) return row;
    const record = { ...row.record, [column]: normalizedValue };
    const fieldSources = { ...row.fieldSources, [column]: source };
    const changedColumns = [...new Set([...(row.changedColumns || []), column])];
    let dmLookup = row.dmLookup;
    if (column === "债券代码") {
      for (const dmColumn of TRADE_RECORD_DM_COLUMNS) {
        if (fieldSources[dmColumn] !== "dm") continue;
        record[dmColumn] = "";
        delete fieldSources[dmColumn];
        if (!changedColumns.includes(dmColumn)) changedColumns.push(dmColumn);
      }
      dmLookup = normalizeDmLookup();
    } else if (column === "谈判日") {
      if (fieldSources["估值收益率"] === "dm") {
        record["估值收益率"] = "";
        delete fieldSources["估值收益率"];
        if (!changedColumns.includes("估值收益率")) changedColumns.push("估值收益率");
      }
      dmLookup = normalizeDmLookup();
    }
    return {
      ...row,
      record,
      fieldSources,
      dmLookup,
      changedColumns,
      dirty: true,
    };
  });
}

export function pasteTradeRecordDraftCells(rows = [], {
  rowIndex = 0,
  columnIndex = 0,
  text = "",
} = {}) {
  const matrix = clipboardMatrix(text);
  if (!matrix.length) return rows;
  let next = rows;
  matrix.forEach((cells, rowOffset) => {
    const targetRow = next[rowIndex + rowOffset];
    if (!targetRow) return;
    cells.forEach((value, columnOffset) => {
      const column = TRADE_RECORD_COLUMNS[columnIndex + columnOffset];
      if (!column) return;
      next = updateTradeRecordDraftCell(next, {
        key: targetRow.key,
        column,
        value,
        source: "manual",
      });
    });
  });
  return next;
}

export function mergeTradeRecordDmResults(rows = [], results = []) {
  const resultByKey = new Map(
    results.map((result) => [String(result.id || ""), result]),
  );
  return rows.map((row) => {
    const result = resultByKey.get(row.key);
    if (
      !result
      || normalizeSecurityId(result.securityId) !== normalizeSecurityId(row.record["债券代码"])
      || result.requestedDate !== requestedValuationDate(row.record["谈判日"])
    ) {
      return row;
    }
    const record = { ...row.record };
    const fieldSources = { ...row.fieldSources };
    let dirty = row.dirty;
    const changedColumns = [...(row.changedColumns || [])];
    const fields = [
      ["债券简称", result.shortName],
      ["债券类型", result.bondType],
      ["估值收益率", numberText(result.valuationYield)],
    ];
    for (const [column, rawValue] of fields) {
      const value = cleanCellValue(rawValue);
      if (!value || fieldSources[column] === "manual") continue;
      if (record[column] !== value || fieldSources[column] !== "dm") {
        record[column] = value;
        fieldSources[column] = "dm";
        if (!changedColumns.includes(column)) changedColumns.push(column);
        dirty = true;
      }
    }
    return {
      ...row,
      record,
      fieldSources,
      changedColumns,
      dmLookup: normalizeDmLookup({
        status: result.status,
        requestedDate: result.requestedDate,
        valuationDate: result.valuationDate,
        valuationField: result.valuationField,
        missing: result.missing,
        queriedAt: result.queriedAt,
      }),
      dirty,
    };
  });
}

export function tradeRecordDmRequestRows(rows = [], { refresh = false } = {}) {
  return rows
    .filter((row) => String(row.record["债券代码"] || "").trim())
    .filter((row) =>
      refresh
      || TRADE_RECORD_DM_COLUMNS.some((column) =>
        !row.record[column] && row.fieldSources[column] !== "manual"
      )
    )
    .map((row) => ({
      id: row.key,
      securityId: row.record["债券代码"],
      negotiationDate: row.record["谈判日"],
    }));
}

export function tradeRecordDirtyCellCount(rows = []) {
  return rows.reduce((count, row) => count + (row.dirty ? row.changedColumns?.length || 0 : 0), 0);
}

export function isTradeRecordCellValueValid(column, value) {
  const text = cleanCellValue(value);
  if (!text) return true;
  if (TRADE_RECORD_DATE_COLUMNS.has(column)) return isIsoDate(text);
  if (TRADE_RECORD_NUMBER_COLUMNS.has(column)) return Number.isFinite(Number(text));
  if (column === "清算速度(0/1)") return text === "0" || text === "1";
  if (column === "我行方向") return text === "买入" || text === "卖出";
  return true;
}

export function validateTradeRecordDraftRows(rows = []) {
  const errors = [];
  rows.forEach((row, rowIndex) => {
    TRADE_RECORD_COLUMNS.forEach((column) => {
      const value = row.record?.[column] || "";
      if (!isTradeRecordCellValueValid(column, value)) {
        errors.push({
          key: row.key,
          rowIndex,
          column,
          value,
          message: tradeRecordCellValidationMessage(column),
        });
      }
    });
  });
  return errors;
}

function clipboardMatrix(value) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n");
  const rows = normalized.split("\n");
  if (rows.at(-1) === "") rows.pop();
  return rows.filter((row, index) => row || index < rows.length - 1).map((row) => row.split("\t"));
}

function normalizeFieldSources(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    TRADE_RECORD_COLUMNS
      .filter((column) => ["manual", "dm", "parsed"].includes(value[column]))
      .map((column) => [column, value[column]]),
  );
}

function normalizeDmLookup(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: ["complete", "partial", "missing", "error"].includes(input.status)
      ? input.status
      : "",
    requestedDate: cleanCellValue(input.requestedDate),
    valuationDate: cleanCellValue(input.valuationDate),
    valuationField: cleanCellValue(input.valuationField),
    missing: Array.isArray(input.missing)
      ? input.missing.map(cleanCellValue).filter(Boolean)
      : [],
    queriedAt: cleanCellValue(input.queriedAt),
  };
}

function numberText(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function cleanCellValue(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

function normalizeSecurityId(value) {
  return cleanCellValue(value).toUpperCase();
}

function requestedValuationDate(value) {
  if (!isIsoDate(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  const text = cleanCellValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function tradeRecordCellValidationMessage(column) {
  if (TRADE_RECORD_DATE_COLUMNS.has(column)) return `${column}须为 YYYY-MM-DD`;
  if (TRADE_RECORD_NUMBER_COLUMNS.has(column)) return `${column}须为数字`;
  if (column === "清算速度(0/1)") return "清算速度只能填写 0 或 1";
  if (column === "我行方向") return "我行方向只能填写买入或卖出";
  return `${column}格式不正确`;
}
