-- Enable RLS on all tables
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE baby_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- user_households junction table (must be created before policies that reference it)
CREATE TABLE user_households (
  user_id UUID REFERENCES auth.users(id),
  household_id TEXT REFERENCES households(id),
  PRIMARY KEY (user_id, household_id)
);
ALTER TABLE user_households ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_owns_mapping" ON user_households
  FOR ALL USING (user_id = auth.uid());

-- Households: user can only access their own household
CREATE POLICY "household_owner_access" ON households
  FOR ALL USING (id = (
    SELECT household_id FROM user_households WHERE user_id = auth.uid() LIMIT 1
  ));

-- All other tables: scoped to household_id the user owns
CREATE POLICY "envelope_household_access" ON envelopes
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "transaction_household_access" ON transactions
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "meter_household_access" ON meter_readings
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "debt_household_access" ON debts
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "baby_step_household_access" ON baby_steps
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "audit_household_access" ON audit_events
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));
