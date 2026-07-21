import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      output += char;
    }
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function configPathFromArgs(args) {
  const index = args.indexOf("--config");
  if (index === -1) return "payment-receipt-wrangler.jsonc";
  if (!args[index + 1]) throw new Error("--config 后必须提供文件路径");
  return args[index + 1];
}

function configuredSendersValid(configured) {
  const values = String(configured || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length || values.some((value) => /replace_with/i.test(value))) return false;
  return values.every((value) => value.startsWith("@")
    ? /^@[^\s@]+\.[^\s@]+$/.test(value)
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

const configPath = resolve(configPathFromArgs(process.argv.slice(2)));
const source = await readFile(configPath, "utf8");
const config = JSON.parse(stripJsonComments(source));
const vars = config.vars || {};
const allowedSenders = String(vars.ALLOWED_SENDERS || "").trim();
const expectedRecipient = String(vars.EXPECTED_RECIPIENT || "").trim();
const d1 = (config.d1_databases || []).find((entry) => entry?.binding === "DB");
const r2 = (config.r2_buckets || []).find((entry) => entry?.binding === "PAYMENT_RECEIPTS");
const producer = (config.queues?.producers || []).find((entry) => entry?.binding === "RECEIPT_QUEUE");
const consumers = config.queues?.consumers || [];
const checks = {
  d1DatabaseId: Boolean(d1?.database_id) && !/replace_with/i.test(d1.database_id),
  r2Bucket: r2?.bucket_name === "credit-bond-payment-receipts",
  mainQueue: producer?.queue === "credit-bond-payment-receipts"
    && consumers.some((entry) => entry?.queue === "credit-bond-payment-receipts"),
  deadLetterQueue: consumers.some((entry) => entry?.queue === "credit-bond-payment-receipts-dlq"),
  aiBinding: config.ai?.binding === "AI",
  aiProcessingApproved: String(vars.AI_PROCESSING_APPROVED || "").trim().toLowerCase() === "true",
  allowedSenders: configuredSendersValid(allowedSenders),
  expectedRecipient: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedRecipient)
    && !/replace_with/i.test(expectedRecipient),
  cpuLimit: Number(config.limits?.cpu_ms) === 300000,
};

for (const [name, passed] of Object.entries(checks)) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (!Object.values(checks).every(Boolean)) {
  console.error("缴款单 Worker 尚未满足上线条件；未执行部署。");
  process.exitCode = 1;
} else {
  console.log("缴款单 Worker 静态配置预检通过。");
}
