// Use the ledger's 会计分类 (column C), independently of its 表内/委外 column.
const subjects = [
  ['AFS',['AFS']],
  ['Receivable',['RECEIVABLE']],
  ['委外（公募）',['公募','委外(公募)']],
  ['委外（专户）',['专户','委外(专户)']],
  ['Trading',['TRADING']],
];
const labels = new Map(subjects.flatMap(([label,aliases])=>aliases.map(alias=>[alias,label])));
export function accountLabel(value) {
  const raw = value.trim();
  const key = raw.toUpperCase().replaceAll('（','(').replaceAll('）',')').replaceAll(' ','');
  return labels.get(key) ?? raw;
}
const normalized = "upper(replace(replace(replace(trim(account),'（','('),'）',')'),' ',''))";
// All literals come from the vocabulary above. Bind user-supplied filters separately.
export const accountSql = '(CASE '+normalized+' '+[...labels].map(([alias,label])=>
  "WHEN '"+alias+"' THEN '"+label+"'").join(' ')+" ELSE trim(account) END)";
