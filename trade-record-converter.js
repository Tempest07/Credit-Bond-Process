// Copied from Trade-Phraser app.js at commit 54d42a6.
// Keep parsing behavior aligned with that source during the phase-one migration.
export const TRADE_RECORD_COLUMNS = [
  "谈判日",
  "交易日",
  "债券代码",
  "债券简称",
  "债券类型",
  "净价",
  "收益率(%)",
  "估值收益率",
  "我行方向",
  "面值（万元）",
  "真实交易对手",
  "交易对手",
  "组合",
  "中介",
  "清算速度(0/1)",
  "成本",
  "价差",
  "清算速度",
  "结算方式",
];

export const TRADE_RECORD_FORMULA_COLUMNS = new Set(["债券简称", "债券类型", "估值收益率"]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function makeDate(year, month, day) {
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function normalizeTradeRecordText(text) {
  if (text === null || text === undefined) return "";

  const replacements = {
    "\u00a0": " ",
    "\u3000": " ",
    "，": " ",
    ",": " ",
    "；": " ",
    ";": " ",
    "：": ":",
    "（": "(",
    "）": ")",
    "＋": "+",
    "％": "%",
  };

  let value = String(text);
  for (const [oldText, newText] of Object.entries(replacements)) {
    value = value.split(oldText).join(newText);
  }

  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeOnce(text, fragment) {
  const normalizedFragment = normalizeTradeRecordText(fragment);
  if (!normalizedFragment) return text;
  return normalizeTradeRecordText(text.replace(new RegExp(escapeRegExp(normalizedFragment)), " "));
}

function parseDateText(dateText, year) {
  let value = normalizeTradeRecordText(dateText);
  value = value.replace(/^\d+[)、]\s*/, "");
  value = value.replace("日", "");
  if (!value) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = /^(\d{1,2})月(\d{1,2})$/.exec(value);
  if (match) {
    return makeDate(year, Number(match[1]), Number(match[2]));
  }

  match = /^(\d{1,2})[./](\d{1,2})$/.exec(value);
  if (match) {
    return makeDate(year, Number(match[1]), Number(match[2]));
  }

  if (/^\d+$/.test(value)) {
    if (value.length === 4) {
      return makeDate(year, Number(value.slice(0, 2)), Number(value.slice(2)));
    }
    if (value.length === 3) {
      return makeDate(year, Number(value.slice(0, 1)), Number(value.slice(1)));
    }
  }

  return null;
}

function parseFaceValue(token) {
  const value = normalizeTradeRecordText(token).toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(千万|kw|k|w|e|万|亿)?$/.exec(value);
  if (!match) return null;

  const number = Number(match[1]);
  const unit = match[2] || "";

  if (unit === "e" || unit === "亿") return Math.round(number * 10000);
  if (unit === "kw" || unit === "k" || unit === "千万") return Math.round(number * 1000);
  if (unit === "w" || unit === "万") return Math.round(number);
  if (number >= 50 && Number.isInteger(number)) return number;

  return null;
}

function parseYieldToken(token) {
  let clean = normalizeTradeRecordText(token).replace("%", "").replace("行权", "");
  clean = clean.replace(/^(收益率|收益|ytm)[:：]?/i, "");

  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;

  const value = Number(clean);
  if (value > 0 && value < 20) return clean;

  return null;
}

function parseNetPriceFromText(text) {
  const patterns = [/净价[:：]?\s*(\d{2,3}(?:\.\d+)?)/i, /(\d{2,3}(?:\.\d+)?)\s*净价/i];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const price = match[1];
    const value = Number(price);
    if (value >= 50 && value <= 150) {
      return { price, fragment: match[0] };
    }
  }

  return { price: "", fragment: "" };
}

function extractIntermediary(text) {
  const match = /【([^】]+)】/.exec(text);
  if (!match) return { intermediary: "", text };

  return {
    intermediary: match[1].trim(),
    text: removeOnce(text, match[0]),
  };
}

function extractBondCodeAndParentheticalDate(text, year) {
  const codePattern = /(?:^|\s)(\d{6,9}(?:\.(?:IB|SH|SZ))?)(?:\(([^)]*)\))?/i;
  const match = codePattern.exec(text);
  if (!match) {
    return { code: "", parentheticalDate: null, text };
  }

  const rawCode = match[1];
  let code = rawCode.toUpperCase();
  if (!code.includes(".")) code = `${code}.IB`;

  let parentheticalDate = null;
  const inside = normalizeTradeRecordText(match[2] || "");
  if (inside) {
    parentheticalDate = parseDateText(inside.split(" ")[0], year);
  }

  return {
    code,
    parentheticalDate,
    text: removeOnce(text, match[0]),
  };
}

function extractTradeDateAndSpeed(text, year) {
  const dateExpr =
    "(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[./]\\d{1,2}|\\d{1,2}月\\d{1,2}日?|\\d{3,4})";
  const serialExpr = "(?:\\d+[)、]\\s*)?";

  const speedPattern = new RegExp(`${serialExpr}(${dateExpr})\\s*\\+\\s*([01])`);
  let match = speedPattern.exec(text);
  if (match) {
    const parsed = parseDateText(match[1], year);
    if (parsed) {
      return {
        tradeDate: parsed,
        speed: match[2],
        text: removeOnce(text, match[0]),
      };
    }
  }

  const exchangePattern = new RegExp(`${serialExpr}(${dateExpr})\\s*(?:交易所|现券交易)`);
  match = exchangePattern.exec(text);
  if (match) {
    const parsed = parseDateText(match[1], year);
    if (parsed) {
      return {
        tradeDate: parsed,
        speed: "1",
        text: removeOnce(text, match[0]),
      };
    }
  }

  return { tradeDate: null, speed: "", text };
}

function cleanPartyName(name) {
  let value = normalizeTradeRecordText(name);
  value = value.replace(/^(出给|to)\s*/i, "");
  value = value.replace(/\s*(出给|to)$/i, "");
  return value.trim();
}

function firstPartyAfterOperator(text, bankName) {
  const value = normalizeTradeRecordText(text);
  if (!value) return "";
  if (value.startsWith(bankName)) return bankName;
  return cleanPartyName(value.split(" ")[0]);
}

function lastPartyBeforeOperator(text, bankName) {
  const value = normalizeTradeRecordText(text);
  if (!value) return "";
  if (value.endsWith(bankName)) return bankName;
  const parts = value.split(" ");
  return cleanPartyName(parts[parts.length - 1]);
}

function extractDirection(text, bankName) {
  const normalizedBankName = normalizeTradeRecordText(bankName);
  const operators = [
    { label: "出给", pattern: /出给/ },
    { label: "to", pattern: /to/i },
  ];

  for (const operator of operators) {
    const match = operator.pattern.exec(text);
    if (!match) continue;

    const leftText = text.slice(0, match.index).trim();
    const rightText = text.slice(match.index + match[0].length).trim();
    const leftParty = lastPartyBeforeOperator(leftText, normalizedBankName);
    const rightParty = firstPartyAfterOperator(rightText, normalizedBankName);

    let direction = "";
    let counterparty = "";

    if (leftParty === normalizedBankName) {
      direction = "卖出";
      counterparty = rightParty;
    } else if (rightParty === normalizedBankName) {
      direction = "买入";
      counterparty = leftParty;
    }

    if (direction) {
      let cleanedText = text;
      for (const fragment of [match[0], leftParty, rightParty]) {
        cleanedText = removeOnce(cleanedText, fragment);
      }
      return { direction, counterparty, text: cleanedText };
    }

    return { direction: "", counterparty: "", text: removeOnce(text, operator.label) };
  }

  return { direction: "", counterparty: "", text };
}

function removeRemainingTerm(text) {
  return normalizeTradeRecordText(text.replace(/\b\d+(?:\.\d+)?\s*[dDyY](?:\([^)]*\))?/g, " "));
}

function cleanResidualText(text) {
  let value = removeRemainingTerm(text);
  value = value.replace(/\b\d+[)、]\s*/g, " ");
  value = value.replace(/(^|\s)(买入|卖出)(?=\s|$)/g, " ");
  return normalizeTradeRecordText(value);
}

function extractYieldAndFace(text) {
  const tokens = normalizeTradeRecordText(text).split(" ").filter(Boolean);
  let yieldValue = "";
  let faceValue = "";
  const usedIndexes = new Set();

  for (const [index, token] of tokens.entries()) {
    const value = parseYieldToken(token);
    if (!value) continue;

    const hasYieldHint =
      token.includes(".")
      || token.includes("%")
      || token.includes("行权")
      || token.includes("收益")
      || token.toLowerCase().includes("ytm");

    if (hasYieldHint) {
      yieldValue = value;
      usedIndexes.add(index);
      break;
    }
  }

  if (!yieldValue) {
    for (const [index, token] of tokens.entries()) {
      const value = parseYieldToken(token);
      if (value && parseFaceValue(token) === null) {
        yieldValue = value;
        usedIndexes.add(index);
        break;
      }
    }
  }

  for (const [index, token] of tokens.entries()) {
    if (usedIndexes.has(index)) continue;
    const value = parseFaceValue(token);
    if (value !== null) {
      faceValue = String(value);
      usedIndexes.add(index);
      break;
    }
  }

  const remaining = tokens.filter((_, index) => !usedIndexes.has(index)).join(" ");
  return { yieldValue, faceValue, remaining };
}

export function blankTradeRecord(negotiationDate) {
  const trade = {};
  for (const column of TRADE_RECORD_COLUMNS) trade[column] = "";
  trade["谈判日"] = formatDate(negotiationDate);
  return trade;
}

export function parseTradeRecordLine(rawLine, negotiationDate, bankName) {
  let text = normalizeTradeRecordText(rawLine);
  const year = negotiationDate.getFullYear();
  const trade = blankTradeRecord(negotiationDate);
  const warnings = [];

  const intermediaryResult = extractIntermediary(text);
  trade["中介"] = intermediaryResult.intermediary;
  text = intermediaryResult.text;

  const directionResult = extractDirection(text, bankName);
  trade["我行方向"] = directionResult.direction;
  trade["真实交易对手"] = directionResult.counterparty;
  text = directionResult.text;

  const dateResult = extractTradeDateAndSpeed(text, year);
  let tradeDate = dateResult.tradeDate;
  trade["清算速度(0/1)"] = dateResult.speed;
  text = dateResult.text;

  const codeResult = extractBondCodeAndParentheticalDate(text, year);
  trade["债券代码"] = codeResult.code;
  text = codeResult.text;

  if (!tradeDate && codeResult.parentheticalDate) {
    tradeDate = codeResult.parentheticalDate;
  }

  if (tradeDate) trade["交易日"] = formatDate(tradeDate);

  const netPriceResult = parseNetPriceFromText(text);
  if (netPriceResult.price) {
    trade["净价"] = netPriceResult.price;
    text = removeOnce(text, netPriceResult.fragment);
  }

  text = cleanResidualText(text);
  const amountResult = extractYieldAndFace(text);
  trade["收益率(%)"] = amountResult.yieldValue;
  trade["面值（万元）"] = amountResult.faceValue;

  if (!trade["中介"]) warnings.push("未识别中介");
  if (!trade["债券代码"]) warnings.push("未识别债券代码");
  if (!trade["交易日"]) warnings.push("未识别交易日");
  if (!trade["清算速度(0/1)"]) warnings.push("未识别清算速度");
  if (!trade["收益率(%)"] && !trade["净价"]) warnings.push("未识别收益率或净价");
  if (!trade["面值（万元）"]) warnings.push("未识别面值");
  if (!trade["我行方向"] || !trade["真实交易对手"]) warnings.push("未识别方向或真实交易对手");

  return { trade, warnings };
}

export function parseTradeRecordText(rawText, negotiationDate, bankName) {
  const trades = [];
  const diagnostics = [];
  const lines = String(rawText || "").split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = normalizeTradeRecordText(rawLine);
    if (!line) return;

    const result = parseTradeRecordLine(line, negotiationDate, bankName);
    trades.push(result.trade);

    if (result.warnings.length) {
      diagnostics.push({
        lineNumber: index + 1,
        original: line,
        message: result.warnings.join("；"),
      });
    }
  });

  return { trades, diagnostics };
}

export function normalizeTradeRecord(input = {}) {
  return Object.fromEntries(
    TRADE_RECORD_COLUMNS.map((column) => [column, String(input?.[column] ?? "").trim()]),
  );
}

export function tradeRecordFormula(columnName, rowNumber) {
  if (columnName === "债券简称") return `@B_INFO_NAME(C${rowNumber})`;
  if (columnName === "债券类型") return `B_INFO_WINDL2TYPE(C${rowNumber})`;
  if (columnName === "估值收益率") {
    return `@IF(@B_ANAL_YIELD_CNBD(C${rowNumber},A${rowNumber}-1,1)=0,"-",B_ANAL_YIELD_CNBD(C${rowNumber},A${rowNumber}-1,1))`;
  }
  return "";
}

export function tradeRecordClipboardFormula(columnName) {
  if (columnName === "债券简称") return `=@B_INFO_NAME(INDIRECT("RC[-1]",FALSE))`;
  if (columnName === "债券类型") return `=B_INFO_WINDL2TYPE(INDIRECT("RC[-2]",FALSE))`;
  if (columnName === "估值收益率") {
    return `=@IF(@B_ANAL_YIELD_CNBD(INDIRECT("RC[-5]",FALSE),INDIRECT("RC[-7]",FALSE)-1,1)=0,"-",B_ANAL_YIELD_CNBD(INDIRECT("RC[-5]",FALSE),INDIRECT("RC[-7]",FALSE)-1,1))`;
  }
  return "";
}

function normalizeClipboardCell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

export function buildTradeRecordClipboardText(trades) {
  return trades
    .map((trade) =>
      TRADE_RECORD_COLUMNS.map((columnName) => {
        if (TRADE_RECORD_FORMULA_COLUMNS.has(columnName)) return tradeRecordClipboardFormula(columnName);
        return normalizeClipboardCell(trade[columnName]);
      }).join("\t"),
    )
    .join("\n");
}
