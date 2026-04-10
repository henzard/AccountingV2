-- households
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payday_day INTEGER NOT NULL DEFAULT 1,
  user_level INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- envelopes
CREATE TABLE envelopes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  allocated_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  envelope_type TEXT NOT NULL DEFAULT 'spending',
  is_savings_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  period_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- transactions
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  amount_cents INTEGER NOT NULL,
  payee TEXT,
  description TEXT,
  transaction_date TEXT NOT NULL,
  is_business_expense BOOLEAN NOT NULL DEFAULT FALSE,
  spending_trigger_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- meter_readings
CREATE TABLE meter_readings (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  meter_type TEXT NOT NULL,
  reading_value REAL NOT NULL,
  reading_date TEXT NOT NULL,
  cost_cents INTEGER,
  vehicle_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- debts
CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  creditor_name TEXT NOT NULL,
  debt_type TEXT NOT NULL,
  outstanding_balance_cents INTEGER NOT NULL,
  interest_rate_percent REAL NOT NULL,
  minimum_payment_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_paid_off BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- baby_steps
CREATE TABLE baby_steps (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  step_number INTEGER NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- audit_events
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value_json TEXT,
  new_value_json TEXT,
  created_at TEXT NOT NULL,
  is_synced BOOLEAN NOT NULL DEFAULT FALSE
);
