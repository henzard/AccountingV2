-- Fix: replace LIMIT 1 with IN() to support multi-household users
DROP POLICY IF EXISTS "household_owner_access" ON households;
CREATE POLICY "household_owner_access" ON households
  FOR ALL USING (id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));
