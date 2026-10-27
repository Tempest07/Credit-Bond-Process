export const receipt = { id: 'r1', bondShortName: '26测试CP001', securityCode: '042600001.IB', paymentDate: '2026-10-27', amountFen: 100000000,
  recognizedText: '债券简称 26测试CP001\n债券代码 042600001.IB\n银行账号 PRIVATE_BANK_ACCOUNT', updatedAt: 'v1' };
export const projects = [{ id: 'p1', shortName: '26测试CP001', issuerName: '测试发行公司', creditApproval: 'PRIVATE_CREDIT_APPROVAL',
  tranches: [{ id: 't1', shortName: '26测试CP001', securityCode: '042600001.IB', paymentDate: '2026-10-27', winningAmountWan: 100 }] },
{ id: 'p2', shortName: '26无关CP002', issuerName: '无关发行公司', tranches: [{ id: 't2', shortName: '26无关CP002', securityCode: '042600002.IB', paymentDate: '2026-10-27', winningAmountWan: 100 }] }];
export const output = { recommendations: [{ projectId: 'p1', trancheId: 't1', reason: '代码和简称相符，建议核对后选择。', evidence: [
  { receiptField: 'securityCode', receiptQuote: '042600001.IB', candidateField: 'securityCode', candidateQuote: '042600001.IB' },
] }], warnings: [] };
