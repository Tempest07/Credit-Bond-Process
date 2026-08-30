const STATE_COLLECTIONS = [
  { key: "issuers", label: "主体", nameKeys: ["legalName", "shortName"] },
  { key: "absCreditApprovals", label: "50217 批单", nameKeys: ["projectName", "shelfName", "enhancerName"] },
  { key: "projects", label: "项目", nameKeys: ["shortName", "bondFullName", "issuerName"] },
  { key: "protocolTransfers", label: "协议转让", nameKeys: ["shortName", "code"] },
  { key: "secondaryInventoryPositions", label: "二级库存", nameKeys: ["shortName", "code"] },
  { key: "secondaryOrders", label: "二级挂单", nameKeys: ["shortName", "code"] },
  { key: "secondaryTrades", label: "二级成交", nameKeys: ["shortName", "code"] },
];

const SAVE_SOURCES = new Set(["autosave", "manual", "import", "idle", "revert", "migration"]);

export function summarizeStateChange(before = {}, after = {}) {
  const collections = {};
  let total = 0;

  for (const definition of STATE_COLLECTIONS) {
    const change = summarizeCollectionChange(before?.[definition.key], after?.[definition.key], definition);
    collections[definition.key] = change;
    total += change.added + change.updated + change.removed;
  }

  const settings = [
    ["ftpCurve", "FTP 曲线"],
    ["reminderState", "提醒设置"],
  ].filter(([key]) => !jsonEqual(before?.[key] || {}, after?.[key] || {}))
    .map(([key, label]) => ({ key, label }));
  total += settings.length;

  return {
    total,
    collections,
    settings,
  };
}

export function formatStateChangeSummary(summary = {}) {
  const parts = [];
  for (const definition of STATE_COLLECTIONS) {
    const change = summary?.collections?.[definition.key] || {};
    const counts = [];
    if (change.added) counts.push(`新增 ${change.added}`);
    if (change.updated) counts.push(`修改 ${change.updated}`);
    if (change.removed) counts.push(`删除 ${change.removed}`);
    if (counts.length) parts.push(`${definition.label} ${counts.join(" / ")}`);
  }
  if (summary?.settings?.length) parts.push(summary.settings.map((item) => item.label).join("、") + "有改动");
  return parts.length ? parts.join("；") : "内容无变化";
}

export function statePayloadEquals(left = {}, right = {}) {
  return jsonEqual(withoutServerTimestamp(left), withoutServerTimestamp(right));
}

export function normalizeStateSaveMeta(input = {}, fallbackSource = "autosave") {
  const requestedSource = String(input?.source || fallbackSource).trim().toLowerCase();
  return {
    source: SAVE_SOURCES.has(requestedSource) ? requestedSource : fallbackSource,
    clientId: cleanMetaText(input?.clientId, 100),
    clientLabel: cleanMetaText(input?.clientLabel, 120),
  };
}

function summarizeCollectionChange(beforeValue, afterValue, definition) {
  const before = indexCollection(beforeValue);
  const after = indexCollection(afterValue);
  const items = [];
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [key, value] of after) {
    if (!before.has(key)) {
      added += 1;
      pushItem(items, "added", key, value, definition);
    } else if (!jsonEqual(before.get(key), value)) {
      updated += 1;
      pushItem(items, "updated", key, value, definition);
    }
  }

  for (const [key, value] of before) {
    if (after.has(key)) continue;
    removed += 1;
    pushItem(items, "removed", key, value, definition);
  }

  return { added, updated, removed, items };
}

function indexCollection(value) {
  const rows = Array.isArray(value) ? value : [];
  const indexed = new Map();
  rows.forEach((row, index) => {
    const key = String(row?.id || row?.legalName || row?.code || `row-${index}`);
    indexed.set(key, row);
  });
  return indexed;
}

function pushItem(items, type, key, value, definition) {
  if (items.length >= 20) return;
  const label = definition.nameKeys
    .map((nameKey) => String(value?.[nameKey] || "").trim())
    .find(Boolean) || key;
  items.push({ type, id: key, label: cleanMetaText(label, 120) });
}

function withoutServerTimestamp(value) {
  if (!value || typeof value !== "object") return value;
  const clone = { ...value };
  delete clone.updatedAt;
  return clone;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cleanMetaText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
