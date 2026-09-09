export function valuationSample() {
  const profile = { bondClass: 'MTN', market: 'interbank', perpetual: false, subordinated: false, structured: false, exercisable: false };
  return {
    source: '人工构造测试材料（非市场行情）', sample: true, collectedAt: new Date().toISOString(), requestedDate: '2026-09-08', valuationDate: '2026-09-08',
    target: { issuerName: '示例交通集团有限公司', shortName: '示例MTN001', durationText: '5Y', offeringType: 'public', venue: '银行间', profile },
    targets: [{ durationText: '5Y', years: 5, hasExercise: false }],
    candidates: [4.6,4.8,5.2,5.4].map((years,i) => ({ securityId: `SAMPLE${i+1}`, shortName: `示例存续券${i+1}`, years, rate: [1.72,1.74,1.78,1.80][i], offeringType: 'public', profile, source: '示例中债估值', yieldBasis: '到期收益率', valuationDate: '2026-09-08', reliability: '测试数据', sourceSpreadBp: 0 })),
    excluded: [], curve: null, warnings: ['演示数据，仅用于功能验证'], counts: { outstanding: 4, eligible: 4, queried: 4, priced: 4 },
  };
}
