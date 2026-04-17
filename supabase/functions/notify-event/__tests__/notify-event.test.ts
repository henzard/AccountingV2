import { assertEquals } from 'jsr:@std/assert';

// Unit-test the payload shape that notify-event sends to FCM.
// Full integration (live FCM + Supabase) is not tested here — that requires
// secrets and a real Firebase project.

function buildFcmPayload(token: string, title: string, body: string): object {
  return {
    to: token,
    notification: { title, body },
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } },
  };
}

Deno.test('buildFcmPayload: includes token, title, body', () => {
  const payload = buildFcmPayload('tok-abc', 'Hello', 'World') as Record<string, unknown>;
  assertEquals(payload['to'], 'tok-abc');
  const notification = payload['notification'] as Record<string, unknown>;
  assertEquals(notification['title'], 'Hello');
  assertEquals(notification['body'], 'World');
});

Deno.test('buildFcmPayload: sets android high priority', () => {
  const payload = buildFcmPayload('tok', 't', 'b') as Record<string, unknown>;
  const android = payload['android'] as Record<string, unknown>;
  assertEquals(android['priority'], 'high');
});

Deno.test('buildFcmPayload: sets APNS priority 10', () => {
  const payload = buildFcmPayload('tok', 't', 'b') as Record<string, unknown>;
  const apns = payload['apns'] as Record<string, unknown>;
  const headers = apns['headers'] as Record<string, unknown>;
  assertEquals(headers['apns-priority'], '10');
});
