// Use the ledger's 会计分类 (column C), independently of its 表内/委外 column.
const subjects = [
  ['AFS',['AFS']],
  ['Receivable',['RECEIVABLE']],
  ['委外（公募）',['公募','委外(公募)']],
  ['委外（专户）',['专户','委外(专户)']],
  ['Trading',['TRADING']],
];
const ledgerLabels = new Map(subjects.flatMap(([label,aliases])=>aliases.map(alias=>[alias,label])));
const labels = new Map([...ledgerLabels,['委外公募','委外（公募）'],['委外专户','委外（专户）']]);
labels.set('OCI','AFS');
labels.set('AC','Receivable');
const shortNames=[...labels].filter(([name])=>!name.includes('('));
// Workbook rows and model filters may each show an account together with its alias.
for(const [a,label] of shortNames){
  for(const [b,other] of shortNames){
    if(label!==other)continue;
    labels.set(a+'('+b+')',label);
    labels.set(a+'/'+b,label);
  }
}
export function accountLabel(value,version=2) {
  const raw = value.trim();
  if(version!==2)return ledgerLabels.get(raw.toUpperCase().replaceAll('（','(').replaceAll('）',')').replaceAll(' ','')) ?? raw;
  const key = raw.normalize('NFKC').toUpperCase().replace(/\s+/g,'');
  return labels.get(key) ?? raw;
}
const normalized = "upper(replace(replace(replace(trim(account),'（','('),'）',')'),' ',''))";
// All literals come from the vocabulary above. Bind user-supplied filters separately.
const sqlFor = aliases => '(CASE '+normalized+' '+[...aliases].map(([alias,label])=>
  "WHEN '"+alias+"' THEN '"+label+"'").join(' ')+" ELSE trim(account) END)";

export const accountSql = sqlFor(labels);
const originalAccountSql = sqlFor(ledgerLabels);
export const accountSqlFor = (version=2) => version===2?accountSql:originalAccountSql;
