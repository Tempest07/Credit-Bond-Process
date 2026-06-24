const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const REPORT_KIND = "today-bid-opinions";
const SECONDARY_LEDGER_REPORT_KIND = "secondary-trade-ledger";
const BID_PENDING_STATUSES = new Set(["未投标", "待投标"]);

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return jsonResponse(errorPayload(error), 500);
    }
  },

  async scheduled(event, env, context) {
    context.waitUntil(
      sendTodayReport(env, {
        source: "scheduled",
        now: new Date(event.scheduledTime || Date.now()),
      }).catch((error) => {
        console.error("Scheduled mail failed", error);
      }),
    );
  },
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === "/" && request.method === "GET") {
    return htmlResponse(controlPage());
  }

  if (url.pathname === "/health" && request.method === "GET") {
    return jsonResponse({ status: "ok" });
  }

  const denied = authorize(request, env);
  if (denied) return denied;

  if (url.pathname === "/preview-today" && request.method === "GET") {
    const report = await buildReportFromDb(env, {
      date: url.searchParams.get("date") || "",
      now: new Date(),
    });
    return jsonResponse(report);
  }

  if (url.pathname === "/send-today" && request.method === "POST") {
    const result = await sendTodayReport(env, {
      source: "manual",
      date: url.searchParams.get("date") || "",
      now: new Date(),
    });
    return jsonResponse(result, result.status === "sent" ? 200 : 202);
  }

  if (url.pathname === "/preview-secondary-ledger" && request.method === "GET") {
    const report = await buildSecondaryLedgerReportFromDb(env, {
      date: url.searchParams.get("date") || "",
      now: new Date(),
    });
    return jsonResponse(report);
  }

  if (url.pathname === "/send-secondary-ledger" && request.method === "POST") {
    const result = await sendSecondaryLedgerReport(env, {
      source: "manual",
      date: url.searchParams.get("date") || "",
      now: new Date(),
    });
    return jsonResponse(result, result.status === "sent" ? 200 : 202);
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

export async function sendTodayReport(env, options = {}) {
  validateMailEnv(env);
  await ensureMailLogSchema(env.DB);

  const report = await buildReportFromDb(env, options);
  const sendEmpty = stringFlag(env.MAIL_SEND_EMPTY);
  if (!report.projects.length && !sendEmpty) {
    return {
      status: "skipped",
      reason: "今天没有待投标项目",
      date: report.date,
      projectCount: 0,
    };
  }

  const sent = await sendWithResend(env, report);
  const logId = `${REPORT_KIND}:${report.date}:${crypto.randomUUID()}`;
  const sentAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO mail_log (id, report_date, sent_at, subject, project_count, resend_id, source)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    logId,
    report.date,
    sentAt,
    report.subject,
    report.projects.length,
    sent.id || "",
    options.source || "manual",
  ).run();

  return {
    status: "sent",
    date: report.date,
    subject: report.subject,
    projectCount: report.projects.length,
    resendId: sent.id || "",
    sentAt,
  };
}

export async function buildReportFromDb(env, options = {}) {
  const state = await loadState(env.DB);
  return buildTodayMail(state, {
    date: normalizeDate(options.date) || localDate(options.now || new Date(), env.TIME_ZONE || DEFAULT_TIME_ZONE),
    timeZone: env.TIME_ZONE || DEFAULT_TIME_ZONE,
    now: options.now || new Date(),
  });
}

export async function sendSecondaryLedgerReport(env, options = {}) {
  validateMailEnv(env);
  await ensureMailLogSchema(env.DB);

  const report = await buildSecondaryLedgerReportFromDb(env, options);
  const sendEmpty = stringFlag(env.MAIL_SEND_EMPTY);
  if (!report.rows.length && !sendEmpty) {
    return {
      status: "skipped",
      reason: "当日没有二级成交台账记录",
      date: report.date,
      rowCount: 0,
    };
  }

  const sent = await sendWithResend(env, report);
  const logId = `${SECONDARY_LEDGER_REPORT_KIND}:${report.date}:${crypto.randomUUID()}`;
  const sentAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO mail_log (id, report_date, sent_at, subject, project_count, resend_id, source)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    logId,
    report.date,
    sentAt,
    report.subject,
    report.rows.length,
    sent.id || "",
    options.source || "manual",
  ).run();

  return {
    status: "sent",
    date: report.date,
    subject: report.subject,
    rowCount: report.rows.length,
    tradeCount: report.tradeCount,
    protocolCount: report.protocolCount,
    resendId: sent.id || "",
    sentAt,
  };
}

export async function buildSecondaryLedgerReportFromDb(env, options = {}) {
  const state = await loadState(env.DB);
  return buildSecondaryLedgerMail(state, {
    date: normalizeDate(options.date) || localDate(options.now || new Date(), env.TIME_ZONE || DEFAULT_TIME_ZONE),
    timeZone: env.TIME_ZONE || DEFAULT_TIME_ZONE,
    now: options.now || new Date(),
  });
}

export function buildTodayMail(state, options = {}) {
  const date = normalizeDate(options.date) || localDate(options.now || new Date(), options.timeZone || DEFAULT_TIME_ZONE);
  const projects = selectTodayBidProjects(state.projects || [], date);
  const subject = buildSubject(date);
  const text = buildTextMail(projects);
  const html = buildHtmlMail(projects, date);
  return {
    date,
    subject,
    projectCount: projects.length,
    projects: projects.map((project) => ({
      id: project.id || "",
      shortName: project.shortName || "",
      cutoffAt: project.cutoffAt || "",
    })),
    text,
    html,
  };
}

export function buildSecondaryLedgerMail(state, options = {}) {
  const date = normalizeDate(options.date) || localDate(options.now || new Date(), options.timeZone || DEFAULT_TIME_ZONE);
  const rows = selectSecondaryLedgerRows(state, date);
  const subject = `二级成交台账${formatSubjectDate(date)}`;
  return {
    date,
    subject,
    rowCount: rows.length,
    tradeCount: rows.filter((row) => row.source === "secondary").length,
    protocolCount: rows.filter((row) => row.source === "protocol").length,
    rows,
    text: buildSecondaryLedgerText(rows, date),
    html: buildSecondaryLedgerHtml(rows, date),
  };
}

export function selectSecondaryLedgerRows(state = {}, date) {
  const secondaryTrades = Array.isArray(state.secondaryTrades) ? state.secondaryTrades : [];
  const protocolTransfers = Array.isArray(state.protocolTransfers) ? state.protocolTransfers : [];
  const secondaryRows = secondaryTrades
    .filter((trade) => isFrontOfficeDoneTrade(trade) && String(trade.ledgerDate || trade.tradeDate || "").slice(0, 10) === date)
    .map((trade) => ({
      id: String(trade.id || ""),
      source: "secondary",
      kind: trade.tradeCategory === "primary_award" ? "一级入库" : trade.tradeCategory === "protocol" ? "协议转让" : "非协议",
      side: trade.side === "buy" ? "买入" : "卖出",
      account: String(trade.account || ""),
      code: String(trade.code || ""),
      shortName: String(trade.shortName || ""),
      amountText: formatWan(trade.quantityWan),
      priceText: String(trade.frontOfficePrice || trade.price || ""),
      tradeDate: String(trade.tradeDate || ""),
      settlementText: trade.settlementDate ? `交割 ${trade.settlementDate}` : "",
      counterparty: String(trade.counterparty || trade.intermediary || ""),
      status: trade.ledgerSentAt ? "已发送" : "待发送",
      sortKey: `${trade.tradeDate || ""}:${trade.shortName || ""}:${trade.id || ""}`,
    }));

  const linkedProtocolIds = new Set(secondaryTrades.map((trade) => String(trade.protocolTransferId || "")).filter(Boolean));
  const protocolRows = protocolTransfers
    .filter((record) => String(record.tradeDate || "").slice(0, 10) === date && !linkedProtocolIds.has(String(record.id || "")))
    .map((record) => ({
      id: String(record.id || ""),
      source: "protocol",
      kind: "协议转让",
      side: "协议转让",
      account: "SSE",
      code: String(record.code || ""),
      shortName: String(record.shortName || ""),
      amountText: formatWan(record.amountTenThousand),
      priceText: record.price ? `净价${record.price}` : "",
      tradeDate: String(record.tradeDate || ""),
      settlementText: "协议流程",
      counterparty: protocolTransferFlow(record),
      status: protocolTransferStatus(record),
      sortKey: `${record.tradeDate || ""}:${record.shortName || ""}:${record.id || ""}`,
    }));

  return [...secondaryRows, ...protocolRows].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

export function selectTodayBidProjects(projects = [], date) {
  return projects
    .filter((project) =>
      BID_PENDING_STATUSES.has(String(project.status || "").trim())
      && String(project.cutoffAt || "").slice(0, 10) === date
    )
    .sort((left, right) =>
      String(left.cutoffAt || "").localeCompare(String(right.cutoffAt || ""))
      || String(left.shortName || "").localeCompare(String(right.shortName || ""))
    );
}

function buildSubject(date) {
  return `流程意见${formatSubjectDate(date)}`;
}

function formatSubjectDate(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[1].slice(2)}${match[2]}${match[3]}`;
}

function buildTextMail(projects) {
  if (!projects.length) return "今日暂无待投标项目。";
  return projects.map((project, index) => [
    `${index + 1}. ${project.shortName || "未命名项目"}`,
    "项目简表：",
    formatProjectBrief(project),
    "",
    "流程意见：",
    formatOpinion(project),
  ].join("\n")).join("\n\n");
}

function buildHtmlMail(projects, date) {
  const body = projects.length
    ? projects.map((project, index) => `
      <section class="project">
        <h2>${index + 1}. ${escapeHtml(project.shortName || "未命名项目")}</h2>
        <h3>项目简表：</h3>
        <pre>${escapeHtml(formatProjectBrief(project))}</pre>
        <h3>流程意见：</h3>
        <pre>${escapeHtml(formatOpinion(project))}</pre>
      </section>
    `).join("")
    : "<p>今日暂无待投标项目。</p>";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 24px; color: #202124; background: #f6f7f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; }
    main { max-width: 920px; margin: 0 auto; padding: 24px; border: 1px solid #e6e8ef; border-radius: 14px; background: #fff; }
    h1 { margin: 0 0 18px; font-size: 20px; }
    h2 { margin: 0 0 10px; color: #1f3a8a; font-size: 16px; }
    h3 { margin: 12px 0 6px; font-size: 13px; }
    .project { margin-top: 18px; padding-top: 18px; border-top: 1px solid #e6e8ef; }
    .project:first-of-type { border-top: 0; }
    pre { margin: 0; padding: 12px; border-radius: 10px; background: #f8fafc; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; }
    .date { color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>今日流程意见提示</h1>
    <p class="date">日期：${escapeHtml(date)}</p>
    ${body}
  </main>
</body>
</html>`;
}

function buildSecondaryLedgerText(rows, date) {
  if (!rows.length) return `${date} 暂无二级成交台账记录。`;
  const header = ["序号", "类型", "方向", "账户", "代码", "简称", "金额", "价格", "交易日", "交割/流程", "对手方", "状态"];
  const body = rows.map((row, index) => [
    index + 1,
    row.kind,
    row.side,
    row.account,
    row.code || "代码待补",
    row.shortName || "简称待补",
    row.amountText || "金额待补",
    row.priceText || "价格待补",
    row.tradeDate,
    row.settlementText,
    row.counterparty || "对手方待补",
    row.status,
  ].join("\t"));
  return [`二级成交台账 ${date}`, header.join("\t"), ...body].join("\n");
}

function buildSecondaryLedgerHtml(rows, date) {
  const body = rows.length
    ? `
      <table>
        <thead>
          <tr>
            <th>序号</th><th>类型</th><th>方向</th><th>账户</th><th>代码</th><th>简称</th><th>金额</th><th>价格</th><th>交易日</th><th>交割/流程</th><th>对手方</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(row.kind)}</td>
              <td>${escapeHtml(row.side)}</td>
              <td>${escapeHtml(row.account)}</td>
              <td>${escapeHtml(row.code || "代码待补")}</td>
              <td>${escapeHtml(row.shortName || "简称待补")}</td>
              <td>${escapeHtml(row.amountText || "金额待补")}</td>
              <td>${escapeHtml(row.priceText || "价格待补")}</td>
              <td>${escapeHtml(row.tradeDate)}</td>
              <td>${escapeHtml(row.settlementText)}</td>
              <td>${escapeHtml(row.counterparty || "对手方待补")}</td>
              <td>${escapeHtml(row.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`
    : "<p>当日暂无二级成交台账记录。</p>";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 24px; color: #202124; background: #f6f7f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; }
    main { max-width: 1080px; margin: 0 auto; padding: 24px; border: 1px solid #e6e8ef; border-radius: 14px; background: #fff; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    .date { margin: 0 0 18px; color: #64748b; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 9px; border: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { color: #1f3a8a; background: #f8fafc; }
    tbody tr:nth-child(even) { background: #fbfdff; }
  </style>
</head>
<body>
  <main>
    <h1>二级成交台账</h1>
    <p class="date">日期：${escapeHtml(date)}</p>
    ${body}
  </main>
</body>
</html>`;
}

function isFrontOfficeDoneTrade(trade = {}) {
  return Boolean(trade.frontOfficeDone)
    || ["front_office_done", "ledgered", "sent"].includes(String(trade.tradeStage || ""));
}

function protocolTransferFlow(record = {}) {
  return [record.seller || "卖方待补", record.buyer || "买方/做市商待补", record.finalBuyer]
    .filter(Boolean)
    .join(" → ");
}

function protocolTransferStatus(record = {}) {
  if (record.exchangeSubmitted) return "已递交";
  if (record.ownSealed) return "待递交上交所";
  if (record.counterpartySealed) return "待本方用印";
  return "待对手方用印";
}

function formatWan(value) {
  const number = numberOrNull(value);
  if (!Number.isFinite(number)) return "";
  return Math.abs(number) >= 10000 ? `${formatNumber(number / 10000)}亿` : `${formatNumber(number)}万`;
}

function formatProjectBrief(project) {
  const sourceText = String(project.sourceText || "").trim();
  if (sourceText) return sourceText;

  const tranches = Array.isArray(project.tranches) ? project.tranches : [];
  const lines = [
    `简称：${project.shortName || "待补"}`,
    `主体：${project.issuerName || "待补"}`,
    `分行：${project.branch || "待补"}`,
    `发行场所：${project.venue || "待补"}`,
    `主承身份：${project.sponsorStatus || "待补"}`,
    `主承销商：${project.leadUnderwriter || "待补"}`,
    `截标时间：${formatDateTime(project.cutoffAt)}`,
  ];

  for (const tranche of tranches) {
    const inquiry = formatInquiry(tranche);
    lines.push([
      `品种：${tranche.shortName || project.shortName || "待补"}`,
      `期限：${tranche.durationText || "待补"}`,
      `询价区间：${inquiry}`,
      `比例限制：${formatPercentValue(tranche.suggestedRatio)}`,
      `表内投标：${formatBid(tranche)}`,
    ].join("；"));
  }

  return lines.join("\n");
}

function formatOpinion(project) {
  return String(project.opinion || "").trim() || "【暂无流程意见】";
}

async function loadState(db) {
  if (!db) throw new Error("D1 binding DB 尚未配置");
  const row = await db.prepare("SELECT data FROM app_state WHERE id = 1").first();
  return row?.data ? JSON.parse(row.data) : { version: 2, issuers: [], projects: [], updatedAt: null };
}

async function sendWithResend(env, report) {
  const timeoutMs = positiveInteger(env.RESEND_TIMEOUT_MS) || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: splitEmails(env.MAIL_TO),
        cc: splitEmails(env.MAIL_CC),
        bcc: splitEmails(env.MAIL_BCC),
        reply_to: env.MAIL_REPLY_TO || undefined,
        subject: report.subject,
        text: report.text,
        html: report.html,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Resend 请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未返回，请稍后重试或检查 RESEND_API_KEY / MAIL_FROM / MAIL_TO 配置`);
    }
    throw new Error(`无法连接 Resend：${error.message || error}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Resend 发送失败：HTTP ${response.status}`);
  }
  return payload;
}

async function ensureMailLogSchema(db) {
  if (!db) throw new Error("D1 binding DB 尚未配置");
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mail_log (
      id TEXT PRIMARY KEY,
      report_date TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      subject TEXT NOT NULL,
      project_count INTEGER NOT NULL,
      resend_id TEXT,
      source TEXT
    )
  `).run();
}

function validateMailEnv(env) {
  if (!env.RESEND_API_KEY) throw new Error("Secret RESEND_API_KEY 尚未配置");
  if (!env.MAIL_FROM) throw new Error("Variable MAIL_FROM 尚未配置");
  if (!env.MAIL_TO) throw new Error("Variable MAIL_TO 尚未配置");
}

function authorize(request, env) {
  if (!env.APP_PASSWORD) return jsonResponse({ error: "Secret APP_PASSWORD 尚未配置" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (authorization === `Bearer ${env.APP_PASSWORD}`) return null;
  return jsonResponse({ error: "Unauthorized" }, 401);
}

function controlPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>流程意见邮件发送</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #1f2937; background: linear-gradient(135deg, #eef2ff, #f8fafc); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(920px, calc(100vw - 32px)); padding: 24px; border: 1px solid #e5e7eb; border-radius: 18px; background: rgba(255,255,255,.92); box-shadow: 0 24px 70px rgba(15,23,42,.12); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 18px; color: #64748b; }
    label { display: grid; gap: 8px; margin: 14px 0; font-size: 13px; font-weight: 700; }
    input { min-height: 40px; padding: 8px 10px; border: 1px solid #dbe1ea; border-radius: 10px; font: inherit; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
    button { min-height: 40px; padding: 0 14px; border: 1px solid #c7d2fe; border-radius: 999px; color: #1e3a8a; background: #eef2ff; font-weight: 800; cursor: pointer; }
    button.primary { color: #fff; background: #2563eb; border-color: #2563eb; }
    pre { min-height: 260px; max-height: 60vh; overflow: auto; padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px; background: #0f172a; color: #e2e8f0; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>流程意见邮件发送</h1>
    <p>输入项目中心口令后，可预览或发送“今日待投标”项目的流程意见邮件。</p>
    <label>口令<input id="password" type="password" autocomplete="current-password" placeholder="APP_PASSWORD"></label>
    <label>日期（可留空，默认今天）<input id="date" type="date"></label>
    <div class="actions">
      <button id="preview">预览今日邮件</button>
      <button class="primary" id="send">发送今日邮件</button>
    </div>
    <pre id="output">等待操作...</pre>
  </main>
  <script>
    const output = document.querySelector("#output");
    const password = document.querySelector("#password");
    const date = document.querySelector("#date");
    function query() {
      const params = new URLSearchParams();
      if (date.value) params.set("date", date.value);
      const text = params.toString();
      return text ? "?" + text : "";
    }
    async function call(path, method = "GET") {
      output.textContent = "处理中...";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(path, {
          method,
          headers: { Authorization: "Bearer " + password.value },
          signal: controller.signal,
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (error) {
          data = {
            status: "error",
            httpStatus: response.status,
            message: "Worker 返回了非 JSON 内容",
            body: text.slice(0, 1000),
          };
        }
        output.textContent = JSON.stringify({
          ok: response.ok,
          httpStatus: response.status,
          ...data,
        }, null, 2);
      } catch (error) {
        output.textContent = JSON.stringify({
          status: "error",
          message: controller.signal.aborted ? "请求超过 45 秒仍未返回" : String(error.message || error),
        }, null, 2);
      } finally {
        clearTimeout(timeoutId);
      }
    }
    document.querySelector("#preview").onclick = () => call("/preview-today" + query());
    document.querySelector("#send").onclick = () => call("/send-today" + query(), "POST");
  </script>
</body>
</html>`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorPayload(error) {
  return {
    status: "error",
    error: error.message || String(error),
    hint: guessErrorHint(error),
  };
}

function guessErrorHint(error) {
  const message = String(error?.message || error || "");
  if (/RESEND_API_KEY/i.test(message)) return "请检查 Worker Secret RESEND_API_KEY 是否已填写并重新部署";
  if (/MAIL_FROM/i.test(message)) return "请检查 Worker Text 变量 MAIL_FROM；无自有域名测试时可用：流程意见提示 <onboarding@resend.dev>";
  if (/MAIL_TO/i.test(message)) return "请检查 Worker Text 变量 MAIL_TO；使用 onboarding@resend.dev 测试时，收件人通常必须是 Resend 账号邮箱";
  if (/403|domain|verify|sender|from/i.test(message)) return "这通常是 Resend 发件域名/发件人限制：无自有域名时 MAIL_FROM 用 onboarding@resend.dev，MAIL_TO 用 Resend 账号邮箱";
  if (/401|API key|Unauthorized/i.test(message)) return "这通常是 Resend API Key 不正确或没有保存为 Secret";
  return "请把这段 JSON 错误内容发给我，我可以继续定位";
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function splitEmails(value = "") {
  const emails = String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return emails.length ? emails : undefined;
}

function localDate(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function formatDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "待补";
  return text.replace("T", " ");
}

function formatInquiry(tranche) {
  const low = numberOrNull(tranche?.inquiryLow);
  const high = numberOrNull(tranche?.inquiryHigh);
  return Number.isFinite(low) && Number.isFinite(high)
    ? `${formatNumber(low)}%-${formatNumber(high)}%`
    : "待补";
}

function formatPercentValue(value) {
  const number = numberOrNull(value);
  return Number.isFinite(number) ? `${formatNumber(number)}%` : "待补";
}

function formatBid(tranche) {
  const rate = numberOrNull(tranche?.bidRate);
  const amount = numberOrNull(tranche?.bidAmount);
  if (!Number.isFinite(rate) && !Number.isFinite(amount)) return "待补";
  return `${Number.isFinite(rate) ? `${formatNumber(rate)}%` : "利率待补"}投${Number.isFinite(amount) ? `${formatNumber(amount)}亿` : "金额待补"}`;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function stringFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
