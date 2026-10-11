#!/usr/bin/env node
/**
 * Phase 0 spike: submit one OpenRouter Batch row and poll to terminal.
 * Usage: OPENROUTER_API_KEY=sk-... node scripts/spike-openrouter-batch.mjs [model]
 */
const model = process.argv[2] || 'openai/gpt-5.6-luna-pro:batch';
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('Set OPENROUTER_API_KEY');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const body = {
    endpoint: '/v1/chat/completions',
    model,
    requests: [
      {
        custom_id: `spike-${Date.now()}`,
        body: { messages: [{ role: 'user', content: 'Reply with exactly: batch_ok' }] },
      },
    ],
  };
  const sub = await fetch('https://openrouter.ai/api/v1/batches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const submitted = await sub.json();
  if (!submitted.id) {
    console.error('submit failed', submitted);
    process.exit(1);
  }
  console.log('submitted', submitted.id, submitted.status);
  const t0 = Date.now();
  for (let i = 0; i < 80; i++) {
    await sleep(i < 3 ? 15_000 : 30_000);
    const pr = await fetch(`https://openrouter.ai/api/v1/batches/${submitted.id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const st = await pr.json();
    console.log('poll', i, st.status, `${Math.round((Date.now() - t0) / 1000)}s`);
    if (['completed', 'failed', 'expired', 'cancelled'].includes(st.status)) {
      console.log(JSON.stringify(st, null, 2).slice(0, 4000));
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
