import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface NotifyPayload {
  userId: string;
  title: string;
  body: string;
}

serve(async (req: Request) => {
  const { userId, title, body }: NotifyPayload = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: tokens, error } = await supabase
    .from('user_fcm_tokens')
    .select('token')
    .eq('user_id', userId);

  if (error || !tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fcmKey = Deno.env.get('FCM_SERVER_KEY');
  if (!fcmKey) {
    return new Response(JSON.stringify({ error: 'FCM_SERVER_KEY not set' }), { status: 500 });
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
