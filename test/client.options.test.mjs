import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DWLFClient } from '../dist/client.js';

// DWLF-622: per-caller clients. A security property, so pinned: a caller with no credential must never act as the
// operator's account.
const headersOf = (client) => client.http.defaults.headers;

test('apiKey: undefined → no Authorization header, even when DWLF_API_KEY is set', () => {
  const saved = process.env.DWLF_API_KEY;
  process.env.DWLF_API_KEY = 'dwlf_sk_operator';
  const origError = console.error;
  console.error = () => {};
  try {
    const c = new DWLFClient({ apiKey: undefined });
    assert.equal(headersOf(c).Authorization, undefined);
    const callerKey = new DWLFClient({ apiKey: 'dwlf_sk_caller' });
    assert.equal(headersOf(callerKey).Authorization, 'ApiKey dwlf_sk_caller');
    const legacy = new DWLFClient();
    assert.equal(headersOf(legacy).Authorization, 'ApiKey dwlf_sk_operator'); // stdio: the environment, as before
  } finally {
    console.error = origError;
    if (saved === undefined) delete process.env.DWLF_API_KEY; else process.env.DWLF_API_KEY = saved;
  }
});

test('baseURL and timeoutMs override the defaults', () => {
  const c = new DWLFClient({ apiKey: 'k', baseURL: 'http://127.0.0.1:9', timeoutMs: 20000 });
  assert.equal(c.http.defaults.baseURL, 'http://127.0.0.1:9/v2');
  assert.equal(c.http.defaults.timeout, 20000);
  assert.equal(new DWLFClient({ apiKey: 'k' }).http.defaults.timeout, 30000);
});
