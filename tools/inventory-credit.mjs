// The desk defines this reporting group by the original ledger product, across
// accounts and issuer industries. Individual product labels still drive grouping.
export const creditGroupName = '信用债';
export const creditScope = '信用债按原表债券类型统计中票、短融（含超短融）、定向工具、公司债和企业债，含对应英文券种，不筛发行人行业。';
export const creditScopeInstruction = creditScope+" 仅当用户或沿用的上下文明确限定库存为信用债时使用 filters.marketType='信用债'，其他筛选和账户范围照常应用。泛问全部持仓不加此条件。交易文件标题不构成库存筛选。用户指定其他券种时按指定范围查询，明确要求原表字面值时使用 sourceMarketType。";

const groupNames = new Set(['信用债','信用债券','信用债类','信用类债券','信用类债','非金融企业信用债','非金融企业信用债券']);
export const isCreditGroup = value => groupNames.has(value);

export const creditSourceTypes = Object.freeze([
  '中票','中期票据','MTN','MTNS','MEDIUM-TERM NOTE','MEDIUM-TERM NOTES','MEDIUM TERM NOTE','MEDIUM TERM NOTES',
  '短融','短期融资券','短期融资债券','CP','COMMERCIAL PAPER','COMMERCIAL PAPERS',
  '超短融','超短期融资','超短期融资券','超短期融资债券','SCP','SUPER SHORT-TERM COMMERCIAL PAPER','SUPER SHORT-TERM COMMERCIAL PAPERS',
  '定向工具','定向债务融资工具','非公开定向债务融资工具','非金融企业非公开定向债务融资工具','PPN','PRIVATE PLACEMENT NOTE','PRIVATE PLACEMENT NOTES',
  '公司债','公司债券','COMPANY BOND','COMPANY BONDS',
  '企业债','企业债券','CORPORATE BOND','CORPORATE BONDS','ENTERPRISE BOND','ENTERPRISE BONDS',
]);
const sourceTypes = new Set(creditSourceTypes);
export const isCreditSourceType = value => sourceTypes.has(String(value ?? '').trim().toUpperCase());
