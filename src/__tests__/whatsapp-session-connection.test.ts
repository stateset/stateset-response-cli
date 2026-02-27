import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { waitForConnection } from '../whatsapp/session.js';

function createSocket() {
  const ev = new EventEmitter();
  return {
    ev,
  } as unknown as Parameters<typeof waitForConnection>[0];
}

describe('waitForConnection', () => {
  it('resolves on open and removes listeners', async () => {
    const sock = createSocket();
    const pending = waitForConnection(sock);

    (sock.ev as unknown as EventEmitter).emit('connection.update', { connection: 'open' });
    await expect(pending).resolves.toBeUndefined();
    expect((sock.ev as unknown as EventEmitter).listenerCount('connection.update')).toBe(0);
  });

  it('rejects on close and removes listeners', async () => {
    const sock = createSocket();
    const pending = waitForConnection(sock);

    (sock.ev as unknown as EventEmitter).emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 408 } } },
    });

    await expect(pending).rejects.toThrow('Connection closed before opening (code: 408)');
    expect((sock.ev as unknown as EventEmitter).listenerCount('connection.update')).toBe(0);
  });

  it('times out when no connection event arrives', async () => {
    vi.useFakeTimers();
    const sock = createSocket();
    const pending = waitForConnection(sock);
    const rejection = expect(pending).rejects.toThrow('Connection timed out before opening');

    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect((sock.ev as unknown as EventEmitter).listenerCount('connection.update')).toBe(0);
    vi.useRealTimers();
  });
});
