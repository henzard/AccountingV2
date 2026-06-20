import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface NotifyPayload {
  userId: string;
  householdId: string;
  title: string;
  body: string;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { userId, householdId, title, body }: NotifyPayload = await req.json();

  if (
    typeof userId !== 'string' ||
    typeof householdId !== 'string' ||
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    !userId.trim() ||
    !householdId.trim() ||
    !title.trim() ||
    !body.trim()
  ) {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const MAX_TITLE = 120;
  const MAX_BODY = 500;
  if (title.length > MAX_TITLE || body.length > MAX_BODY) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: membership } = await serviceClient
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the target userId is also a member of the same household.
  // Without this check, an authenticated caller could send push
  // notifications to any user in the system (IDOR).
  const { data: targetMembership } = await serviceClient
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .single();

  if (!targetMembership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: tokens, error } = await serviceClient
    .from('user_fcm_tokens')
    .select('token')
    .eq('user_id', userId);

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const MAX_SENDS_PER_HOUR = 20;
  const { data: allowed, error: rateErr } = await serviceClient.rpc(
    'check_and_reserve_notify_send',
    { p_sender_id: user.id, p_max_per_hour: MAX_SENDS_PER_HOUR },
  );

  if (rateErr) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fcmKey = Deno.env.get('FCM_SERVER_KEY');
  if (!fcmKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
  }

  let sent = 0;
  for (const { token } of tokens) {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${fcmKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body },
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      }),
    });
    if (res.ok) sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
