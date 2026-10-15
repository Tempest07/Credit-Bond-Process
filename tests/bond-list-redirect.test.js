import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../bond-list/redirect.js', import.meta.url), 'utf8');

test('saved OFR/BID links enter the module and keep the gateway prefix', () => {
  for (const [oldUrl, expected] of [
    ['https://tempest07.com/bond-centre/bond-list/', 'https://tempest07.com/bond-centre/#bond-list'],
    ['https://tempest07.com/bond-centre/bond-list/index.html?test=1', 'https://tempest07.com/bond-centre/?test=1#bond-list'],
    ['http://127.0.0.1:8814/bond-list/', 'http://127.0.0.1:8814/#bond-list'],
  ]) {
    let redirected;
    const source = new URL(oldUrl);
    vm.runInNewContext(script, { URL, window: { location: {
      href: source.href,
      search: source.search,
      replace: target => { redirected = target; },
    } } });
    assert.equal(redirected, expected);
  }
});
