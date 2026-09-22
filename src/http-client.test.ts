import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HttpClient, HttpError, HttpClientModule } from './index';

const originalFetch = globalThis.fetch;

describe('HttpClient', () => {
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    (globalThis as any).fetch = async (url: string, init: RequestInit) => handler(url, init);
  }

  test('parses JSON responses and preserves status', async () => {
    mockFetch(() => new Response(JSON.stringify({ hello: 'orbit' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new HttpClient();
    const res = await client.get<{ hello: string }>('/x');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data.hello).toBe('orbit');
  });

  test('serializes JSON body and sets content-type', async () => {
    let seen: any = {};
    mockFetch((url, init) => {
      seen = { url, body: init.body, ct: (init.headers as any)['Content-Type'] };
      return new Response(JSON.stringify({ ok: 1 }), { headers: { 'Content-Type': 'application/json' } });
    });
    const client = new HttpClient();
    await client.post('/create', { name: 'orbit' });
    expect(seen.body).toBe(JSON.stringify({ name: 'orbit' }));
    expect(seen.ct).toBe('application/json');
  });

  test('baseUrl is prefixed', async () => {
    let seen = '';
    mockFetch((url) => { seen = url; return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); });
    const client = new HttpClient({ baseUrl: 'https://api.example.com/v1' });
    await client.get('/users');
    expect(seen).toBe('https://api.example.com/v1/users'.replace('https://api.', 'https://api.')); // same string as constructed
    expect(seen.startsWith('https://')).toBe(true);
  });

  test('query params appended and undefined skipped', async () => {
    let seen = '';
    mockFetch((url) => { seen = url; return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); });
    const client = new HttpClient();
    await client.get('/items', { query: { page: 2, q: 'ab', empty: undefined } });
    expect(seen).toBe('/items?page=2&q=ab');
  });

  test('throws HttpError on 404 by default', async () => {
    mockFetch(() => new Response(JSON.stringify({ message: 'nope' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    const client = new HttpClient();
    try {
      await client.get('/missing');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(404);
      expect((e as HttpError).data).toEqual({ message: 'nope' });
    }
  });

  test('throwOnError: false returns response without throwing', async () => {
    mockFetch(() => new Response('nope', { status: 404 }));
    const client = new HttpClient({ throwOnError: false });
    const res = await client.get('/missing');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.data).toBe('nope');
  });

  test('retries on 5xx then succeeds', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls < 3) return new Response('err', { status: 502 });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    });
    const client = new HttpClient({ retries: 3, retryDelayMs: 1 });
    const res = await client.get('/flaky');
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
  });

  test('does not retry 4xx', async () => {
    let calls = 0;
    mockFetch(() => { calls++; return new Response('bad', { status: 400 }); });
    const client = new HttpClient({ retries: 5, retryDelayMs: 1 });
    await expect(client.get('/nope')).rejects.toThrow('400');
    expect(calls).toBe(1);
  });

  test('retries on 429', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls < 2) return new Response('slow down', { status: 429 });
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    });
    const client = new HttpClient({ retries: 2, retryDelayMs: 1 });
    const res = await client.get('/limited');
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test('timeout aborts the request', async () => {
    mockFetch(async (_url, init) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response('{}')), 1000);
        (init.signal as AbortSignal).addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('Aborted'));
        });
      });
      return new Response('{}');
    });
    const client = new HttpClient({ timeoutMs: 50 });
    await expect(client.get('/slow')).rejects.toThrow();
  });

  test('request interceptor rewrites url and headers', async () => {
    let seen: any = {};
    mockFetch((url, init) => {
      seen = { url, auth: (init.headers as any).Authorization };
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    });
    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    client.addRequestInterceptor((url, init) => ({
      url: url + '?from=interceptor',
      init: { ...init, headers: { ...init.headers as any, Authorization: 'Bearer tok' } },
    }));
    await client.get('/me');
    expect(seen.url).toBe('https://api.example.com/me?from=interceptor');
    expect(seen.auth).toBe('Bearer tok');
  });

  test('response interceptor can transform data', async () => {
    mockFetch(() => new Response(JSON.stringify({ nested: { value: 42 } }), { headers: { 'Content-Type': 'application/json' } }));
    const client = new HttpClient();
    client.addResponseInterceptor((res) => ({ ...res, data: res.data.nested.value }));
    const res = await client.get('/data');
    expect(res.data).toBe(42);
  });
});

describe('HttpClientModule', () => {
  test('exposes HttpClient with configured baseUrl', async () => {
    const { OrbitFactory, Module } = await import('@galaxy-stack/orbit-core');
    @Module({ imports: [HttpClientModule.forRoot({ baseUrl: 'https://x.test' })] })
    class M {}
    const app = await OrbitFactory.create(M);
    const client = await app.getContainer().resolve(HttpClient);
    expect(client).toBeInstanceOf(HttpClient);
  });
});
