import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createVisitorFetch, isPublicAddress, validateVisitorApi } from './visitorApi.js';

const api = { baseUrl: 'https://api.example.com/v1/', apiKey: 'visitor-secret', model: 'visitor-model' };

test('visitor API requires bounded strings and a public HTTPS URL without embedded secrets or query', () => {
  assert.deepEqual(validateVisitorApi(api), { ...api, baseUrl: 'https://api.example.com/v1' });
  for (const baseUrl of [
    'http://api.example.com/v1', 'file:///etc/passwd', 'https://user:visitor-secret@api.example.com/v1',
    'https://api.example.com/v1?key=visitor-secret', 'https://api.example.com/v1#visitor-secret',
    'https://api.example.com/v1?', 'https://localhost/v1', 'https://x.localhost./v1',
    'https://machine.internal/v1', 'https://host.local/v1', 'https://127.1/v1',
    'https://2130706433/v1', 'https://0x7f000001/v1', 'https://169.254.169.254/v1',
    'https://10.0.0.1/v1', 'https://[::1]/v1', 'https://[::ffff:127.0.0.1]/v1',
    'https://[64:ff9b::a00:1]/v1', 'https://[fc00::1]/v1'
  ]) {
    assert.throws(() => validateVisitorApi({ ...api, baseUrl }), error => {
      assert.equal(error.statusCode, 400);
      assert.doesNotMatch(error.message, /visitor-secret/);
      return true;
    }, baseUrl);
  }
  for (const [field, limit] of [['baseUrl', 2048], ['apiKey', 4096], ['model', 200]]) {
    for (const value of ['', 3, {}, 'a\r\nsecret', 'a\u0000secret', 'a'.repeat(limit + 1)]) {
      assert.throws(() => validateVisitorApi({ ...api, [field]: value }), error => error.statusCode === 400);
    }
  }
});

test('private, reserved, mapped, link-local and transition IPs are excluded', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.1.2', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '192.168.1.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1',
    'fe80::1', 'fc00::1', 'fd00::1', 'ff02::1', '64:ff9b::7f00:1', '2001::1', '2001:db8::1',
    '2002:7f00:1::', '3fff::1', 'not-an-address'
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test('all DNS results are checked before connecting, including mixed public and private answers', async () => {
  for (const addresses of [[], ['127.0.0.1'], ['93.184.216.34', '10.0.0.1'], ['2606:4700::1111', '::ffff:127.0.0.1']]) {
    let calls = 0;
    const fetch = createVisitorFetch({
      lookup: async () => addresses.map(address => ({ address })),
      request: () => { calls++; throw new Error('Should not connect.'); }
    });
    await assert.rejects(fetch('https://api.example.com/v1/chat/completions'), error => error.statusCode === 400 && error.reason === 'destination');
    assert.equal(calls, 0);
  }
});

function responseRequest(onRequest, { status = 200, body = '{"ok":true}', headers = {} } = {}) {
  return (url, options, onResponse) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = requestBody => {
      onRequest(url, options, requestBody);
      queueMicrotask(() => {
        const response = Readable.from([Buffer.from(body)]);
        response.statusCode = status;
        response.headers = headers;
        onResponse(response);
      });
    };
    return req;
  };
}

test('DNS is resolved once per request and the checked IP is pinned while preserving HTTPS hostname', async () => {
  let resolutions = 0, requests = 0;
  const fetch = createVisitorFetch({
    lookup: async (hostname, options) => {
      assert.equal(hostname, 'api.example.com'); assert.equal(options.all, true);
      resolutions++;
      return [{ address: resolutions === 1 ? '93.184.216.34' : '10.0.0.1', family: 4 }];
    },
    request: responseRequest((url, options, body) => {
      requests++;
      assert.equal(url.hostname, 'api.example.com'); assert.equal(url.protocol, 'https:');
      assert.equal(options.agent, false); assert.equal(options.autoSelectFamily, false);
      assert.equal(options.headers.Authorization, 'Bearer visitor-secret');
      assert.equal(body, '{"model":"visitor-model"}');
      options.lookup('api.example.com', {}, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4);
      });
      options.lookup('api.example.com', { all: true }, (error, records) => {
        assert.equal(error, null); assert.deepEqual(records, [{ address: '93.184.216.34', family: 4 }]);
      });
    })
  });
  const response = await fetch('https://api.example.com/v1/chat/completions', {
    headers: { Authorization: 'Bearer visitor-secret' }, body: '{"model":"visitor-model"}'
  });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(resolutions, 1); assert.equal(requests, 1);
  await assert.rejects(fetch('https://api.example.com/v1/chat/completions'), error => error.reason === 'destination');
  assert.equal(resolutions, 2); assert.equal(requests, 1);
});

test('redirects are never followed and their location or provider body never leaves the transport', async () => {
  let requests = 0;
  const fetch = createVisitorFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: responseRequest(() => requests++, {
      status: 302, headers: { location: 'https://127.0.0.1/visitor-secret' }, body: 'visitor-secret'
    })
  });
  await assert.rejects(fetch('https://api.example.com/v1/chat/completions', { headers: { Authorization: 'Bearer visitor-secret' } }), error => {
    assert.equal(error.reason, 'redirect'); assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /visitor-secret|127\.0\.0\.1/);
    return true;
  });
  assert.equal(requests, 1);
});

test('network errors are sanitized before leaving the transport', async () => {
  const fetch = createVisitorFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: () => { throw new Error('visitor-secret echoed by the network'); }
  });
  await assert.rejects(fetch('https://api.example.com/v1/chat/completions'), error => {
    assert.equal(error.reason, 'network'); assert.doesNotMatch(error.message, /visitor-secret/); return true;
  });
});

test('request timeout also bounds DNS lookup and never starts a late connection', async () => {
  const controller = new AbortController();
  let completeLookup, requests = 0;
  const fetch = createVisitorFetch({
    lookup: () => new Promise(resolve => { completeLookup = resolve; }),
    request: () => { requests++; throw new Error('Should not connect.'); }
  });
  const pending = fetch('https://api.example.com/v1/chat/completions', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, error => error.reason === 'timeout' && error.statusCode === 504);
  completeLookup([{ address: '93.184.216.34', family: 4 }]);
  await Promise.resolve();
  assert.equal(requests, 0);
});

test('oversized responses are stopped before parsing', async () => {
  const fetch = createVisitorFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: responseRequest(() => {}, { body: 'x'.repeat(5 * 1024 * 1024 + 1) })
  });
  await assert.rejects(fetch('https://api.example.com/v1/chat/completions'), error => error.reason === 'response');
});
