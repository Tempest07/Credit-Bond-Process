// Shared by the lookup API and every browser consumer. Similarity is not identity.
export function bondName(value = "") {
  return String(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "")
    .replace(/\([^)]*\)/g, "").replace(/_BC$/, "");
}

export function bondCode(value = "") {
  return String(value).trim().toUpperCase();
}

export function sameSecurityCode(a, b) {
  a = bondCode(a); b = bondCode(b);
  return Boolean(a && b && (a === b || ((!a.includes(".") || !b.includes(".")) && a.split(".")[0] === b.split(".")[0])));
}

export function sameBondIdentity(a = {}, b = {}) {
  if (a.securityId && b.securityId) return sameSecurityCode(a.securityId, b.securityId);
  return Boolean(bondName(a.shortName) && bondName(a.shortName) === bondName(b.shortName));
}

export function splitBondNames(value = "") {
  const parts = String(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "").split("/").filter(Boolean);
  const first = parts[0] || "";
  const suffix = first.match(/\([^)]*\)$/)?.[0] || parts.at(-1)?.match(/\([^)]*\)$/)?.[0] || "";
  const base = bondName(first);
  return parts.map((part, i) => {
    const name = bondName(part);
    if (i && /^\d+$/.test(name)) return base.replace(/\d+$/, name.padStart(base.match(/\d+$/)?.[0].length || 0, "0")) + suffix;
    if (i && /^[A-Z]$/.test(name)) return base.replace(/[A-Z]$/, name) + suffix;
    return name + suffix;
  });
}

export function sameTrancheSeries(a, b) {
  a = bondName(a); b = bondName(b);
  // Only explicit letter variants of the same complete base, never adjacent issue numbers.
  return Boolean(a && b && a !== b && /\d[A-Z]?$/.test(a) && /\d[A-Z]?$/.test(b)
    && a.replace(/(\d)[A-Z]$/, "$1") === b.replace(/(\d)[A-Z]$/, "$1"));
}

function issueName(value) {
  // Preserve the year and issuance number; strip only the individual tranche label.
  return String(value || "").normalize("NFKC").toUpperCase()
    .replace(/\(?品种[一二三四五六七八九十\d]+\)?/g, "")
    .replace(/\bTRANCHE\s+[A-Z0-9]+\b/g, "").replace(/\s+/g, "");
}

export function sameIssuance(a = {}, b = {}) {
  if (a.issuerName && b.issuerName && bondName(a.issuerName) !== bondName(b.issuerName)) return false;
  if (a.subscribeDate && b.subscribeDate && a.subscribeDate !== b.subscribeDate) return false;
  if (sameTrancheSeries(a.shortName, b.shortName)) return true;
  return Boolean(a.issuerName && b.issuerName && a.subscribeDate && b.subscribeDate
    && a.fullName && b.fullName && issueName(a.fullName) === issueName(b.fullName));
}

function targetMatches(entry, target) {
  if (sameBondIdentity(entry, target)) return true;
  if (target.securityId) return false;
  const base = bondName(target.shortName);
  return /\d$/.test(base) && sameTrancheSeries(entry.shortName, base);
}

export function validateIssueGroup(group, normalized = {}, query = {}) {
  if (!group?.tranches?.length) return null;
  // ABS plan/class membership is established by the dedicated plan matcher.
  const abs = normalized.isAbs || normalized.absInfo || /^(ABS|ABN)$/i.test(group.instrumentType || "");
  const queryNames = splitBondNames(query.shortName);
  const target = normalized.shortName || normalized.securityId ? normalized : query;
  const anchors = group.tranches.filter(entry => targetMatches(entry, target)
    || (!normalized.securityId && queryNames.some(shortName => targetMatches(entry, { shortName }))));
  if (!anchors.length) return abs && !query.securityId && !query.shortName ? group : null;
  let allowed = group.tranches.filter(entry => {
    // A name claiming to be the target may not carry a conflicting known code.
    if (bondName(entry.shortName) === bondName(target.shortName) && entry.securityId && target.securityId
      && !sameSecurityCode(entry.securityId, target.securityId)) return false;
    if (entry.issuerName && normalized.issuerName && bondName(entry.issuerName) !== bondName(normalized.issuerName)) return false;
    if (entry.subscribeDate && normalized.subscribeDate && entry.subscribeDate !== normalized.subscribeDate) return false;
    if (!abs && entry.fullName && normalized.fullName && issueName(entry.fullName) !== issueName(normalized.fullName)) return false;
    if (anchors.includes(entry)) return true;
    if (queryNames.length > 1 && queryNames.some(shortName => sameBondIdentity(entry, { shortName }))) return true;
    return anchors.some(anchor => sameIssuance(entry, { ...normalized, ...anchor,
      fullName: normalized.fullName || anchor.fullName,
      issuerName: normalized.issuerName || anchor.issuerName,
      subscribeDate: normalized.subscribeDate || anchor.subscribeDate,
    })
      || (abs && entry.planIdentity && entry.planIdentity === anchor.planIdentity));
  });
  // A reallocation must point to a retained, identified destination, not merely a missing result.
  allowed = allowed.filter(entry => entry.status !== "reallocated" || allowed.some(target => target !== entry
    && target.status === "issued" && sameBondIdentity(target, {
      shortName: entry.reallocationTargetShortName, securityId: entry.reallocationTargetSecurityId,
    })));
  if (!anchors.some(anchor => allowed.includes(anchor))) return null;
  if (allowed.length === group.tranches.length) return group;
  return allowed.length ? { ...group, tranches: allowed, issueName: allowed.map(entry => entry.shortName).filter(Boolean).join("/"), totalScale: null } : null;
}

export function normalizeLookupPayload(payload = {}) {
  const normalized = payload.normalized || {};
  const query = payload.query || {};
  const issueGroup = validateIssueGroup(payload.issueGroup || normalized.issueGroup, normalized, query);
  const explicitAlias = (normalized.identityAliases || []).some(alias =>
    (!query.securityId || sameSecurityCode(alias.securityId, query.securityId))
    && (!query.shortName || splitBondNames(query.shortName).some(name => bondName(name) === bondName(alias.shortName)))
    && Boolean(query.securityId || query.shortName));
  let identityError = payload.identityError || "";
  if (!explicitAlias && query.securityId && normalized.securityId && !sameSecurityCode(query.securityId, normalized.securityId)) {
    identityError = "返回债券代码与查询不一致，已停止带入，请核对债券代码。";
  } else if (!explicitAlias && query.shortName && normalized.shortName && !splitBondNames(query.shortName).some(shortName =>
    sameBondIdentity({ shortName }, normalized) || (/\d$/.test(bondName(shortName)) && sameTrancheSeries(shortName, normalized.shortName)))) {
    const redirected = issueGroup?.tranches.some(entry => splitBondNames(query.shortName).some(shortName => sameBondIdentity(entry, { shortName }))
      && entry.status === "reallocated" && sameBondIdentity(normalized, { shortName: entry.reallocationTargetShortName, securityId: entry.reallocationTargetSecurityId }));
    if (!redirected) identityError = "返回债券简称与查询不一致，已停止带入，请选择准确债券。";
  }
  return { ...payload, normalized: { ...normalized, issueGroup }, issueGroup, identityError,
    ...(identityError ? { ok: false, error: identityError, requiresSelection: true } : {}) };
}
