import { quoteRows } from '../../../bond-list-filter.js';
import { sameProjectOfrRow } from '../../../project-ofr.js';
import { DEFAULT_BRANCHES, ensureSchema, validateSections } from './_shared.js';

export async function ensureProjectOffersSchema(db) {
  await ensureSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS bond_list_project_offers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, tranche_id TEXT NOT NULL,
    branch_title TEXT NOT NULL, security_code TEXT NOT NULL, short_name TEXT NOT NULL,
    base_valuation REAL NOT NULL, ofr_yield REAL NOT NULL, raw_line TEXT NOT NULL,
    valuation_source TEXT NOT NULL, valuation_at TEXT NOT NULL,
    created_at TEXT NOT NULL, seen_at TEXT,
    draft_revision INTEGER NOT NULL,
    UNIQUE(user_id, project_id, tranche_id, draft_revision)
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_bond_list_project_offers_owner
    ON bond_list_project_offers(user_id, created_at DESC)`).run();
}

export async function readOfrDraft(db, owner) {
  await db.prepare(`INSERT INTO bond_list_drafts (user_id, sections, revision, updated_at)
    VALUES (?1, ?2, 0, ?3) ON CONFLICT(user_id) DO NOTHING`)
    .bind(owner, JSON.stringify(DEFAULT_BRANCHES.map(title => ({ title, text: '' }))), new Date().toISOString()).run();
  const row = await db.prepare('SELECT sections, revision, updated_at FROM bond_list_drafts WHERE user_id = ?1').bind(owner).first();
  const sections = validateSections(JSON.parse(row.sections));
  return { sections, revision: Number(row.revision), updatedAt: row.updated_at };
}

export function publicProjectOffer(row, rows) {
  const value = {
    id: row.id, projectId: row.project_id, trancheId: row.tranche_id,
    branchTitle: row.branch_title, securityCode: row.security_code, shortName: row.short_name,
    baseValuation: Number(row.base_valuation), ofrYield: Number(row.ofr_yield), rawLine: row.raw_line,
    valuationSource: row.valuation_source, valuationAt: row.valuation_at,
    createdAt: row.created_at, seenAt: row.seen_at || null,
  };
  return { ...value, present: rows.some(quote => sameProjectOfrRow(value, quote)) };
}

export async function readProjectOffers(db, owner, sections, projectId = '', trancheId = '') {
  const statement = projectId
    ? db.prepare(`SELECT * FROM bond_list_project_offers WHERE user_id = ?1 AND project_id = ?2 AND tranche_id = ?3
        ORDER BY draft_revision DESC, created_at DESC, id DESC`).bind(owner, projectId, trancheId)
    : db.prepare('SELECT * FROM bond_list_project_offers WHERE user_id = ?1 ORDER BY draft_revision DESC, created_at DESC, id DESC').bind(owner);
  const result = await statement.all();
  const rows = quoteRows(sections), latest = new Set();
  return (result.results || []).map(row => {
    const key = JSON.stringify([row.project_id, row.tranche_id]);
    const retired = latest.has(key);
    latest.add(key);
    const offer = publicProjectOffer(row, rows);
    return retired ? { ...offer, present: false } : offer;
  });
}

/** D1 batch is transactional; failed CAS cannot leave orphan source metadata. */
export async function appendProjectOffer(db, owner, draft, stateRevision, sections, transfer) {
  const serialized = JSON.stringify(sections);
  const result = await db.batch([
    db.prepare(`INSERT INTO bond_list_project_offers
      (id,user_id,project_id,tranche_id,branch_title,security_code,short_name,base_valuation,ofr_yield,raw_line,
       valuation_source,valuation_at,created_at,seen_at,draft_revision)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,NULL,?14
      WHERE EXISTS (SELECT 1 FROM bond_list_drafts WHERE user_id = ?2 AND revision = ?15)
        AND EXISTS (SELECT 1 FROM user_app_state WHERE user_id = ?2 AND revision = ?16)`)
      .bind(transfer.id, owner, transfer.projectId, transfer.trancheId, transfer.branchTitle, transfer.securityCode,
        transfer.shortName, transfer.baseValuation, transfer.ofrYield, transfer.rawLine,
        transfer.valuationSource, transfer.valuationAt, transfer.createdAt, draft.revision + 1, draft.revision, stateRevision),
    db.prepare(`UPDATE bond_list_drafts SET sections = ?1, revision = revision + 1, updated_at = ?2
      WHERE user_id = ?3 AND revision = ?4
        AND EXISTS (SELECT 1 FROM bond_list_project_offers WHERE id = ?5 AND user_id = ?3)`)
      .bind(serialized, transfer.createdAt, owner, draft.revision, transfer.id),
  ]);
  return Number(result[0]?.meta?.changes) === 1 && Number(result[1]?.meta?.changes) === 1;
}
