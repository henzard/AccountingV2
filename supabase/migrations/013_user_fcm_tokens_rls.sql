CREATE TABLE IF NOT EXISTS public.user_fcm_tokens (
  user_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_fcm_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY fcm_own_token ON public.user_fcm_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);
