const { test, expect } = require('bun:test');
const { fetchWithRetry } = require('../scripts/run_pipeline.js');

test('Fetch with retry backoff on HTTP 429', async () => {
  let attempts = 0;
  const mockFailingFetch = async () => {
    attempts++;
    if (attempts < 3) return { status: 429 };
    return { status: 200, json: async () => ({ code: 0, msg: 'success' }) };
  };

  const res = await fetchWithRetry(mockFailingFetch, 4, 10);
  expect(attempts).toBe(3);
  expect(res.code).toBe(0);
});

test('Fetch with retry backoff on HTTP 5xx server error', async () => {
  let attempts = 0;
  const mockFailingFetch = async () => {
    attempts++;
    if (attempts < 2) return { status: 502 };
    return { status: 200, json: async () => ({ code: 0, msg: 'success' }) };
  };

  const res = await fetchWithRetry(mockFailingFetch, 3, 10);
  expect(attempts).toBe(2);
  expect(res.code).toBe(0);
});

test('Fetch with retry backoff on network throw', async () => {
  let attempts = 0;
  const mockNetworkErrorFetch = async () => {
    attempts++;
    if (attempts < 3) throw new Error('Fetch failed / ECONNRESET');
    return { status: 200, json: async () => ({ code: 0, msg: 'success' }) };
  };

  const res = await fetchWithRetry(mockNetworkErrorFetch, 3, 10);
  expect(attempts).toBe(3);
  expect(res.code).toBe(0);
});

test('Fetch with retry on Feishu 99991400 rate limit JSON response', async () => {
  let attempts = 0;
  const mockFeishuRateLimitFetch = async () => {
    attempts++;
    if (attempts < 3) {
      return { status: 200, json: async () => ({ code: 99991400, msg: 'request trigger rate limit' }) };
    }
    return { status: 200, json: async () => ({ code: 0, msg: 'success' }) };
  };

  const res = await fetchWithRetry(mockFeishuRateLimitFetch, 3, 10);
  expect(attempts).toBe(3);
  expect(res.code).toBe(0);
});

test('Fetch with retry on Feishu message containing rate limit keywords', async () => {
  let attempts = 0;
  const mockFeishuMessageLimitFetch = async () => {
    attempts++;
    if (attempts < 2) {
      return { status: 200, json: async () => ({ code: 210000, msg: 'too many requests per second' }) };
    }
    return { status: 200, json: async () => ({ code: 0, msg: 'success' }) };
  };

  const res = await fetchWithRetry(mockFeishuMessageLimitFetch, 3, 10);
  expect(attempts).toBe(2);
  expect(res.code).toBe(0);
});

test('Fetch with retry exhausts maxRetries and throws', async () => {
  let attempts = 0;
  const mockAlwaysFailingFetch = async () => {
    attempts++;
    return { status: 503 };
  };

  let threw = false;
  try {
    await fetchWithRetry(mockAlwaysFailingFetch, 3, 10);
  } catch (err) {
    threw = true;
    expect(err.message).toContain('HTTP status 503');
  }
  expect(threw).toBe(true);
  expect(attempts).toBe(3);
});

test('Fetch with retry delay backoff exponential scale', async () => {
  let attempts = 0;
  const timestamps = [];
  const mockAlwaysFailingFetch = async () => {
    attempts++;
    timestamps.push(Date.now());
    return { status: 429 };
  };

  try {
    await fetchWithRetry(mockAlwaysFailingFetch, 3, 50);
  } catch (err) {
    // Expected throw
  }

  expect(attempts).toBe(3);
  const diff1 = timestamps[1] - timestamps[0];
  const diff2 = timestamps[2] - timestamps[1];
  
  // Checking exponential scale: delay is roughly 50ms, then 100ms.
  expect(diff1).toBeGreaterThanOrEqual(40);
  expect(diff2).toBeGreaterThanOrEqual(80);
});
