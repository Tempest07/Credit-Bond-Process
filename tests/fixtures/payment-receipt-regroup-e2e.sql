INSERT OR REPLACE INTO user_app_state (user_id, data, updated_at) VALUES (
  'admin',
  '{"version":4,"issuers":[],"projects":[{"id":"e2e-project","shortName":"26国新租赁SCP007","status":"待缴款","tranches":[{"id":"e2e-tranche","shortName":"26国新租赁SCP007","securityCode":"012681839","paymentDate":"2026-07-21","winningAmountWan":30000,"resultStatus":"中标","paymentCompleted":false}]}],"protocolTransfers":[],"secondaryInventoryPositions":[],"secondaryOrders":[],"secondaryTrades":[],"ftpCurve":{},"reminderState":{}}',
  '2026-07-21T10:00:00.000Z'
);

INSERT OR REPLACE INTO payment_receipt_batches (
  id, owner_user_id, message_id, sender, recipient, subject,
  received_at, received_date, raw_object_key, raw_sha256, processing_status,
  error_message, created_at, updated_at
) VALUES (
  'e2e-batch', 'admin', 'e2e-message', 'internal@example.com',
  'payment-receipts@tempest07.com', 'E2E sample',
  '2026-07-21T10:00:00.000Z', '2026-07-21', 'e2e/message.eml', '',
  'processed', '', '2026-07-21T10:00:00.000Z', '2026-07-21T10:00:00.000Z'
);

INSERT OR REPLACE INTO payment_receipt_files (
  id, batch_id, filename, mime_type, byte_size, sha256, object_key,
  page_count, blank_pages_json, page_analysis_json, grouping_json,
  processing_status, error_message, created_at, updated_at
) VALUES (
  'e2e-file', 'e2e-batch', '投行部缴款单样例1.pdf', 'application/pdf', 1,
  'e2e-source-sha', 'e2e/source.pdf', 2, '[2]',
  '[{"pageNumber":1,"classification":"receipt_start","confidence":0.99,"boundaryEvidence":"标题及缴款金额表明为新单据首页","recognizedText":"国新融资租赁有限公司2026年度第七期超短期融资券 配售确认及缴款通知书 债券简称：26国新租赁SCP007 债券代码：012681839 应缴款项总额：30,000.0000万元人民币 请于2026年07月21日16:30前划拨","fields":{"paymentDate":"2026-07-21","bondShortName":"26国新租赁SCP007","securityCode":"012681839","prepaymentNumber":"","payerName":"兴业银行股份有限公司","payeeName":"","bankReference":""}},{"pageNumber":2,"classification":"blank","confidence":0.98,"boundaryEvidence":"只有扫描噪点","recognizedText":"","fields":{}}]',
  '{"version":1,"groups":[{"pageNumbers":[1],"pageLabel":"1"}],"blankPages":[2],"uncertainPages":[]}',
  'processed', '', '2026-07-21T10:00:00.000Z', '2026-07-21T10:00:00.000Z'
);

INSERT OR REPLACE INTO payment_receipts (
  id, owner_user_id, batch_id, file_id, source_pages_json, source_page_label,
  object_key, mime_type, sha256, payment_date, amount_fen, payer_name,
  payee_name, bond_short_name, security_code, prepayment_number,
  bank_reference, recognized_text, recognition_status, match_status,
  candidate_json, error_message, created_at, updated_at
) VALUES (
  'e2e-receipt', 'admin', 'e2e-batch', 'e2e-file', '[1]', '1',
  'e2e/split.pdf', 'application/pdf', 'e2e-fingerprint', '2026-07-21',
  30000000000, '兴业银行股份有限公司', '', '26国新租赁SCP007', '012681839',
  '', '', 'sample', 'recognized', 'matched', '[]', '',
  '2026-07-21T10:00:00.000Z', '2026-07-21T10:00:00.000Z'
);

INSERT OR REPLACE INTO payment_receipt_matches (
  id, owner_user_id, receipt_id, project_id, tranche_id,
  match_source, match_score, match_reason, created_at, updated_at
) VALUES (
  'e2e-match', 'admin', 'e2e-receipt', 'e2e-project', 'e2e-tranche',
  'manual', 100, 'E2E existing match',
  '2026-07-21T10:00:00.000Z', '2026-07-21T10:00:00.000Z'
);

INSERT OR REPLACE INTO payment_receipt_events (
  id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at
) VALUES (
  'e2e-extracted', 'admin', NULL, 'e2e-batch',
  'email_attachments_extracted', '{"acceptedPdfCount":1,"attachmentCount":1}',
  '2026-07-21T10:00:00.000Z'
);
