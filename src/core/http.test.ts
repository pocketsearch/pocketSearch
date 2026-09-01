import { describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './http.js';

describe('fetchWithTimeout', () => {
  it('passes the request through and returns the response', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok', { status: 200 }),
    );
    const res = await fetchWithTimeout('https://example.test/x', {
      method: 'POST',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the request after the timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      fetchWithTimeout('https://slow.test', {
        timeoutMs: 10,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('aborted');
  });

  it('forwards an already-aborted parent signal', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new Error('aborted'));
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithTimeout('https://x.test', {
        parentSignal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('aborted');
  });
});
