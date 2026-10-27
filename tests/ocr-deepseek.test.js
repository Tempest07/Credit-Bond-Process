import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDeepSeekOcr, DEEPSEEK_OCR_ENDPOINT } from '../ocr-deepseek.js';

const key = 'ocr-only-fake-secret-for-unit-tests';
const env = { OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_OCR_API_KEY: key,
  DEEPSEEK_API_KEY: 'separate-issuance-fake-secret-not-for-ocr' };
const jpeg = new Uint8Array([255,216,255,192,0,11,8,0,10,0,10,1,1,17,0]);
const imageUrl = `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;
const input = { messages: [{ role: 'user', content: [{ type: 'text', text: '逐字抄录，返回 JSON。' },
  { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }] }], max_tokens: 400 };
const reply = (content = '{"name":"26苏交通CP008"}', finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content } }] });

test('OCR uses only its own key and explicit mode, failing closed on invalid configuration', () => {
  assert.equal(selectDeepSeekOcr({ DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY }), null);
  assert.equal(selectDeepSeekOcr({ ...env, OCR_AI_PROVIDER: 'legacy' }), null);
  for (const bad of [{ OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY },
    { ...env, OCR_AI_PROVIDER: 'unexpected' }, { ...env, DEEPSEEK_OCR_MODEL: 'deepseek-v4-pro' },
    { ...env, DEEPSEEK_OCR_API_KEY: 'bad\nkey' }]) {
    assert.throws(() => selectDeepSeekOcr(bad), error => error.code === 'DEEPSEEK_OCR_CONFIG' && error.httpStatus === 503);
  }
});

test('OCR sends inline original-detail images only to the official endpoint and normalizes result', async () => {
  let calls = 0;
  const ai = selectDeepSeekOcr(env, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, DEEPSEEK_OCR_ENDPOINT); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.ok(!JSON.stringify(options).includes(env.DEEPSEEK_API_KEY));
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-flash'); assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].content[1].image_url.url, imageUrl);
    assert.equal(body.messages[0].content[1].image_url.detail, 'original');
    return reply();
  } });
  const result = await ai.run('old-qwen-model', input);
  assert.deepEqual(result, { response: '{"name":"26苏交通CP008"}', model: 'deepseek-flash', provider: 'deepseek' });
  assert.equal(calls, 1);
});

test('OCR rejects remote URLs, mismatched image bytes, oversized dimensions and missing images before requests', async () => {
  let calls = 0;
  const ai = selectDeepSeekOcr(env, { fetchImpl: () => { calls++; throw Error('unexpected'); } });
  const png = Buffer.alloc(24); png.set([137,80,78,71,13,10,26,10]); png.writeUInt32BE(8193,16); png.writeUInt32BE(100,20);
  for (const url of ['https://example.com/private.png', imageUrl.replace('jpeg','png'), 'data:image/png;base64,AAAA',
    `data:image/png;base64,${png.toString('base64')}`]) {
    const invalid = structuredClone(input); invalid.messages[0].content[1].image_url.url = url;
    await assert.rejects(ai.run('',invalid), error => /^DEEPSEEK_OCR_INPUT$/.test(error.code));
  }
  await assert.rejects(ai.run('', { messages: [{ role: 'user', content: 'no image' }] }));
  const systemImage = structuredClone(input); systemImage.messages[0].role = 'system';
  await assert.rejects(ai.run('', systemImage));
  assert.equal(calls,0);
});

test('OCR does not retry or expose upstream content on authentication, balance, rate-limit or redirect failures', async () => {
  for (const [http, status] of [[401,503],[403,503],[402,503],[429,429],[503,503],[400,502],[302,502]]) {
    let calls = 0;
    const ai = selectDeepSeekOcr(env, { fetchImpl: async () => { calls++; return new Response(key, { status: http }); } });
    await assert.rejects(ai.run('',input), error => {
      assert.equal(error.httpStatus,status); assert.equal(error.upstreamStatus,http);
      assert.equal(error.nonRetryable,true); assert.equal(error.retryable,false);
      assert.ok(!error.message.includes(key)); return true;
    });
    assert.equal(calls,1);
  }
});

test('OCR rejects truncation, malformed JSON, oversized response and leaked secret fields', async () => {
  for (const response of [reply('{}','length'), reply('not JSON'), reply('[]'), reply(JSON.stringify({ key })),
    new Response('x'.repeat(256001)), new Response('{}', { headers: { 'Content-Length': '256001' } })]) {
    const ai = selectDeepSeekOcr(env, { fetchImpl: async () => response });
    await assert.rejects(ai.run('',input), error => error.code === 'DEEPSEEK_OCR_PROTOCOL' && !error.message.includes(key));
  }
});

test('OCR deadline bounds a stalled transport and a stalled response body', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const started = Date.now();
    await assert.rejects(selectDeepSeekOcr(env,{ fetchImpl,timeoutMs:20 }).run('',input), error => error.code === 'DEEPSEEK_OCR_TIMEOUT');
    assert.ok(Date.now()-started < 1000);
  }
});

test('OCR respects cancellation before network access', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const ai = selectDeepSeekOcr(env, { signal: controller.signal,fetchImpl: () => { calls++; } });
  await assert.rejects(ai.run('',input), error => error.code === 'DEEPSEEK_OCR_ABORTED');
  assert.equal(calls,0);
});
