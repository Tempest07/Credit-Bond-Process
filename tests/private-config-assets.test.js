import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/_middleware.js';

const blocked = [
  '/.dev.vars', '/.dev.vars.deepseek', '/.DEV.VARS.production', '/.env', '/.ENV.local',
  '/files/.env.backup', '/assets/.dev.vars/child', '/api/dm/.env',
  '/%2edev.vars', '/.%65nv', '/%2e%64%65%76%2e%76%61%72%73',
  '/%252eenv', '/%25252edev.vars', '/files%2f.env', '/files%252f.dev.vars',
  '/files%5c.env', '/files%255c.DEV.VARS.deepseek', '/files\\.env',
  '/%25%32%65env', '/%2eenv%not-a-valid-escape',
  '/' + '%'.concat('25'.repeat(16), '2eenv'),
];

test('private dotenv asset names are blocked across path segments and encoded variants', async () => {
  for (const path of blocked) {
    let nextCalls = 0;
    const response = await onRequest({ request: new Request('http://127.0.0.1:8838' + path), next() { nextCalls++; return new Response('must not serve'); } });
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', path);
    assert.equal(await response.text(), '', path);
    assert.equal(nextCalls, 0, path);
  }
});

test('private asset protection covers GET, HEAD, and non-read requests', async () => {
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = await onRequest({ request: new Request('https://example.test/nested/.dev.vars.deepseek', { method }), next() { assert.fail('must not continue'); } });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
  }
});

test('ordinary assets, API paths and dotenv-like query values preserve next responses unchanged', async () => {
  for (const path of ['/', '/app.js', '/styles.css', '/api/state', '/api/issuance-results/recognize', '/environment', '/files/my.env', '/files/my.dev.vars', '/app.js?name=.env', '/api/search?q=%2f.dev.vars', '/files/safe%25name.txt']) {
    const expected = new Response('ordinary response', { status: 201, headers: { 'X-Test': 'preserved' } });
    let calls = 0;
    const response = await onRequest({ request: new Request('https://example.test' + path), next() { calls++; return expected; } });
    assert.equal(response, expected, path);
    assert.equal(calls, 1, path);
  }
});
