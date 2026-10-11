import { pino } from 'pino';

import { env } from '@/common/utils/envConfig';

const logger = pino({ name: 'deferred-notify' });

export async function notifyDeferredJobTerminal(args: {
  jobId: string;
  status: 'done' | 'failed';
  goal?: string;
  excerpt?: string;
}): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    return;
  }
  const title = args.status === 'done' ? 'Deferred job complete' : 'Deferred job failed';
  const text = [
    title,
    `job_id: ${args.jobId}`,
    args.goal ? `goal: ${args.goal.slice(0, 200)}` : '',
    args.excerpt ? args.excerpt.slice(0, 500) : '',
    'Poll via deferred plugin job_id or /deferred-jobs/recent',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ jobId: args.jobId, err: message }, 'telegram notify failed');
  }
}
