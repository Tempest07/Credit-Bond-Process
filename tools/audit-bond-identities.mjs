// Offline, read-only audit: node tools/audit-bond-identities.mjs snapshot.json report-prefix
// Accepts { projects }, [{ user_id, projects }], or Wrangler D1 JSON results.
// The snapshot/report may contain private records; keep them in ignored .local-data.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const text = value => String(value ?? '').normalize('NFKC').trim();
const name = value => text(value).toUpperCase().replace(/\s/g, '');
const codes = row => [...new Set(['securityCode', 'securityId', 'security_id', 'bondCode'].map(key => name(row?.[key])).filter(Boolean))];
const codeParts = value => { const match = value.match(/^(.*?)(?:\.(SH|SZ|IB))?$/); return { base: match[1], market: match[2] || '' }; };
const sameCode = (a, b) => { const x = codeParts(a), y = codeParts(b); return x.base === y.base && (!x.market || !y.market || x.market === y.market); };
const trancheBase = value => value.replace(/((?:MTN|SCP|CP|PPN|GN)\d+)[A-Z](?=\(|$)/, '$1');

export function expandAuditNames(value) {
  const normalized = name(value);
  const suffix = normalized.match(/(\([^()]*\))$/)?.[1] || '';
  const pieces = (suffix ? normalized.slice(0, -suffix.length) : normalized).split(/[\/、,，]/).filter(Boolean);
  const first = pieces[0] || '';
  return pieces.map((part, index) => {
    if (!index) return part + suffix;
    if (/^\d+$/.test(part) && /\d+$/.test(first)) return first.replace(/\d+$/, part) + suffix;
    if (/^[A-Z]$/.test(part) && /(?:MTN|SCP|CP|PPN|GN)\d+[A-Z]$/.test(first)) return first.slice(0, -1) + part + suffix;
    return part + suffix;
  });
}

export function snapshotAccounts(snapshot) {
  const rows = Array.isArray(snapshot) && snapshot[0]?.results
    ? snapshot.flatMap(item => item.results || []) : Array.isArray(snapshot) ? snapshot : [snapshot];
  if (rows.length && rows.every(row => row.id && !Object.hasOwn(row, 'projects'))) return [{ user_id: '', projects: rows }];
  return rows.map(row => {
    const projects = typeof row.projects === 'string' ? JSON.parse(row.projects) : row.projects;
    if (!Array.isArray(projects)) throw new Error('Snapshot must contain a projects array; refusing an incomplete audit.');
    return { user_id: text(row.user_id), projects };
  });
}

export function auditBondIdentities(snapshot) {
  const accounts = snapshotAccounts(snapshot);
  const findings = [];
  let trancheCount = 0, codedTranches = 0, projectCount = 0;
  const add = (kind, account, project, evidence) => findings.push({
    kind, disposition: 'review-only', account, projectId: text(project.id), projectName: text(project.shortName), evidence,
    suggestedCorrection: null,
  });
  for (const { user_id: account, projects } of accounts) {
    const codeIndex = new Map();
    for (const project of projects) {
      projectCount++;
      const tranches = Array.isArray(project.tranches) ? project.tranches : [];
      const projectNames = expandAuditNames(project.shortName);
      const isAbs = /ABS|ABN|资产支持/i.test(`${project.instrumentType || ''} ${project.absInfo?.planName || ''} ${project.shortName || ''}`);
      const isReallocated = /回拨|取消|撤销|realloc|cancel/i.test([project.status, ...tranches.flatMap(t => [t.status, t.resultStatus, t.allocationNote])].join(' '));
      const payments = new Set();
      for (const [index, tranche] of tranches.entries()) {
        trancheCount++;
        const trancheCodes = codes(tranche), trancheName = name(tranche.shortName);
        const ref = { trancheIndex: index, trancheId: text(tranche.id), shortName: text(tranche.shortName), codes: trancheCodes };
        if (trancheCodes.length) codedTranches++;
        if (trancheCodes.some((code, i) => trancheCodes.slice(i + 1).some(other => !sameCode(code, other)))) {
          add('conflicting-code-fields', account, project, ref);
        }
        if (!isAbs && !isReallocated && trancheName && projectNames.length && !projectNames.some(p => p === trancheName || trancheBase(p) === trancheBase(trancheName))) {
          add('project-tranche-name-mismatch', account, project, ref);
        }
        const date = text(tranche.paymentDate).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) payments.add(date);
        for (const code of trancheCodes) {
          const base = codeParts(code).base;
          const prior = codeIndex.get(base) || [];
          for (const existing of prior) {
            if (!trancheName || !existing.name || existing.name === trancheName || trancheBase(existing.name) === trancheBase(trancheName)) continue;
            if (!sameCode(code, existing.code)) continue; // Different explicit venues can legitimately share a numeric code.
            add('same-code-different-names', account, project, { ...ref, otherProjectId: existing.projectId, otherShortName: existing.name, otherCode: existing.code });
          }
          prior.push({ projectId: text(project.id), name: trancheName, code });
          codeIndex.set(base, prior);
        }
      }
      if (!isAbs && !isReallocated && payments.size > 1) add('different-tranche-payment-dates', account, project, { paymentDates: [...payments].sort() });
    }
  }
  return {
    summary: { accounts: accounts.length, projects: projectCount, tranches: trancheCount, codedTranches, uncodedTranches: trancheCount - codedTranches, findings: findings.length, affectedProjects: new Set(findings.map(f => `${f.account}|${f.projectId}`)).size, certainCorrections: 0 },
    limitations: [
      'This is a structural audit, not market-data validation. Missing codes and missing original lookup requests limit detection.',
      'A conflict does not identify which value is correct. All findings require corroboration; no database writes or automatic corrections are performed.',
      'Narrative opinions, manual prices, approvals, bids and trades are not interpreted as bond identity and are never modified.',
    ],
    findings,
  };
}

export function renderAuditReport(report) {
  const s = report.summary;
  return [
    '# 债券身份批量只读审计', '',
    `账号 ${s.accounts}；项目 ${s.projects}；品种 ${s.tranches}；有代码 ${s.codedTranches}；无代码 ${s.uncodedTranches}。`,
    `发现 ${s.findings} 条待核实线索，涉及 ${s.affectedProjects} 个项目；可无歧义自动更正 ${s.certainCorrections} 条。`, '',
    '这是结构一致性检查，不等于全部证券已经通过 DM 逐笔核验。未保存原始查询时，无法还原用户原本想新增的券。',
    '未写入数据库；未修改人工定价、审批意见、投标或成交记录。所有线索均需权威资料进一步核实。', '',
    ...report.findings.flatMap((f, i) => [`## ${i + 1}. ${f.kind}`, '', `项目：${f.projectName}（${f.projectId}）；账号：${f.account || '未标记'}`, '', '```json', JSON.stringify(f.evidence, null, 2), '```', '', '建议：核对原始发行资料及证券代码；当前证据不足以指定替换值。', '']),
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , input, output] = process.argv;
  if (!input || !output) throw new Error('Usage: node tools/audit-bond-identities.mjs snapshot.json report-prefix');
  const report = auditBondIdentities(JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, '')));
  await writeFile(`${output}.json`, JSON.stringify(report, null, 2));
  await writeFile(`${output}.md`, renderAuditReport(report));
  console.log(JSON.stringify(report.summary));
}
