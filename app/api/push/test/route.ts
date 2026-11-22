import { fail, json, requireUser } from '@/lib/http';
import { sendPushToUser } from '@/lib/alerts';

export async function POST() {
  const auth = await requireUser();
  if (auth.res) return auth.res;
  const sent = await sendPushToUser(auth.user.id, {
    title: 'Notifications are on',
    body: "You'll get a heads-up at 80% and 100% of each budget.",
    url: '/budget',
    tag: 'test',
  });
  if (!sent) return fail(424, 'No devices received the test. Check VAPID keys and that notifications are allowed.');
  return json({ ok: true, sent });
}
