const securityCodePattern = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/;
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();

export function ofrYieldFromValuation(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0.05 || value > 100) return null;
  const units = Math.round((value + Number.EPSILON) * 10000) - 500;
  return units > 0 ? units / 10000 : null;
}

export function canonicalOfrCode(value, venue = '') {
  const code = normalize(value);
  if (securityCodePattern.test(code)) return code;
  if (/^\d{9}$/.test(code) && /银行间/.test(venue)) return code + '.IB';
  if (/^\d{6}$/.test(code)) {
    if (/上交所|上海证券交易所/.test(venue)) return code + '.SH';
    if (/深交所|深圳证券交易所/.test(venue)) return code + '.SZ';
    if (/北交所|北京证券交易所/.test(venue)) return code + '.BJ';
  }
  return '';
}

export function validOfrShortName(value) {
  const name = String(value ?? '').normalize('NFKC').trim();
  return Boolean(name && name.length <= 100 && !/[\r\n,，]/.test(name)
    && !/(?:A\/B|\d\/\d{1,3})(?:\([^)]*\))?$/i.test(name));
}

/** Only owned, positively awarded varieties from confirmed results are sale-list candidates. */
export function projectOfrCandidates(project = {}) {
  if (project.resultConfirmed !== true || project.status === '已结束') return [];
  return (Array.isArray(project.tranches) ? project.tranches : []).filter(tranche =>
    typeof tranche?.winningAmountWan === 'number' && Number.isFinite(tranche.winningAmountWan)
    && tranche.winningAmountWan > 0 && tranche.resultStatus !== '未中标'
    && !/取消发行|全部回拨|全额回拨/.test(String(tranche.allocationNote || ''))
    && validOfrShortName(tranche.shortName)
  ).map(tranche => ({
    projectId: String(project.id || ''), trancheId: String(tranche.id || ''),
    shortName: String(tranche.shortName).normalize('NFKC').trim(),
    securityCode: canonicalOfrCode(tranche.securityCode, project.venue),
    branch: String(project.branch || ''),
    initialMarketValuation: typeof tranche.initialMarketValuation === 'number'
      && Number.isFinite(tranche.initialMarketValuation) ? tranche.initialMarketValuation : null,
    initialMarketValuationAt: String(tranche.initialMarketValuationAt || ''),
    needsValuationConfirmation: typeof tranche.initialMarketValuation !== 'number'
      || !Number.isFinite(tranche.initialMarketValuation),
    ofrYield: ofrYieldFromValuation(tranche.initialMarketValuation),
  }));
}

export function formatOfrQuote({ securityCode = '', shortName, ofrYield }) {
  if (!validOfrShortName(shortName) || typeof ofrYield !== 'number' || !Number.isFinite(ofrYield) || ofrYield <= 0) {
    throw new Error('Invalid OFR identity or yield');
  }
  const code = canonicalOfrCode(securityCode);
  const rate = ofrYield.toFixed(4).replace(/\.?0+$/, '');
  return [code, String(shortName).normalize('NFKC').trim(), rate + '*ofr'].filter(Boolean).join('，');
}

export function resolveOfrBranch(branch, titles = []) {
  const clean = value => normalize(value).replace(/^兴业银行/, '').replace(/(?:省|市)?分行$/, '');
  const value = clean(branch);
  if (!value) return '';
  const matches = titles.filter(title => {
    const aliases = [normalize(title), ...String(title).normalize('NFKC').split(/[()/]/).filter(Boolean).map(clean)];
    return aliases.includes(value);
  });
  return matches.length === 1 ? matches[0] : '';
}

/** Quote text may be manually repriced; identity, side and branch remain the match key. */
export function sameProjectOfrRow(transfer = {}, row = {}) {
  if (!normalize(transfer.branchTitle) || normalize(transfer.branchTitle) !== normalize(row.branch)
    || !['ofr', 'both'].includes(row.direction)) return false;
  const left = canonicalOfrCode(transfer.securityCode), right = canonicalOfrCode(row.code);
  if (left && right) return left === right;
  return Boolean(normalize(transfer.shortName) && normalize(transfer.shortName) === normalize(row.name));
}
