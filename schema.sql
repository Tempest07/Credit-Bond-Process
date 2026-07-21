CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_app_state (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_receipt_batches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  received_date TEXT NOT NULL,
  raw_object_key TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL DEFAULT '',
  processing_status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, message_id)
);

CREATE TABLE IF NOT EXISTS payment_receipt_files (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  page_count INTEGER,
  blank_pages_json TEXT NOT NULL DEFAULT '[]',
  page_analysis_json TEXT NOT NULL DEFAULT '[]',
  grouping_json TEXT NOT NULL DEFAULT '{}',
  processing_status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, sha256),
  FOREIGN KEY (batch_id) REFERENCES payment_receipt_batches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_receipts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  source_pages_json TEXT NOT NULL,
  source_page_label TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  sha256 TEXT NOT NULL,
  payment_date TEXT,
  amount_fen INTEGER,
  payer_name TEXT NOT NULL DEFAULT '',
  payee_name TEXT NOT NULL DEFAULT '',
  bond_short_name TEXT NOT NULL DEFAULT '',
  security_code TEXT NOT NULL DEFAULT '',
  prepayment_number TEXT NOT NULL DEFAULT '',
  bank_reference TEXT NOT NULL DEFAULT '',
  recognized_text TEXT NOT NULL DEFAULT '',
  recognition_status TEXT NOT NULL DEFAULT 'pending',
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  candidate_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES payment_receipt_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES payment_receipt_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_receipt_matches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  tranche_id TEXT NOT NULL,
  match_source TEXT NOT NULL,
  match_score INTEGER NOT NULL DEFAULT 0,
  match_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, project_id, tranche_id),
  FOREIGN KEY (receipt_id) REFERENCES payment_receipts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_receipt_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  receipt_id TEXT,
  batch_id TEXT,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_owner_date
  ON payment_receipts(owner_user_id, payment_date, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_owner_status
  ON payment_receipts(owner_user_id, match_status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_owner_sha
  ON payment_receipts(owner_user_id, sha256, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_receipts_file_pages
  ON payment_receipts(file_id, source_page_label);
CREATE INDEX IF NOT EXISTS idx_payment_receipt_matches_target
  ON payment_receipt_matches(owner_user_id, project_id, tranche_id);
