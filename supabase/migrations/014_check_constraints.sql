-- 014_check_constraints.sql
-- Adds CHECK constraint on households.payday_day and missing indexes.

-- 1. CHECK constraint: payday_day must be a valid day-of-month
ALTER TABLE public.households
  ADD CONSTRAINT households_payday_day_range CHECK (payday_day BETWEEN 1 AND 31);

-- 2. Missing indexes for common FK look-ups
CREATE INDEX IF NOT EXISTS idx_debts_household_id ON public.debts(household_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_household_id ON public.audit_events(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_household_id ON public.household_members(household_id);
