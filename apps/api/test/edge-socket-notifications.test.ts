import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { RELAY_SOCKET_BUFFER_LIMIT, relaySocketHasCapacity, sendRelayNotification } from '../src/edge/socket-notifications.ts';

function stalledReceiver() {
  const socket = {
    readyState: WebSocket.OPEN as WebSocket['readyState'], bufferedAmount: 0,
    terminate: vi.fn(() => { socket.readyState = WebSocket.CLOSED; }),
    send: vi.fn((data: unknown) => { socket.bufferedAmount += Buffer.byteLength(String(data), 'utf8') + 2; }),
  };
  return socket;
}

describe('bounded WSS notification sending', () => {
  it('terminates a non-draining receiver even if its heartbeat stays responsive', async () => {
    const socket = stalledReceiver(), pending = vi.fn(async () => true);
    for (let tick = 0; tick < 1000; tick += 1) await sendRelayNotification(socket, pending);
    expect(socket.send.mock.calls.length).toBeGreaterThan(1);
    expect(socket.send.mock.calls.length).toBeLessThan(1000);
    expect(socket.bufferedAmount).toBeLessThanOrEqual(RELAY_SOCKET_BUFFER_LIMIT);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    const calls = pending.mock.calls.length;
    await sendRelayNotification(socket, pending);
    expect(pending).toHaveBeenCalledTimes(calls);
  });

  it('checks again after asynchronous authorization before appending another frame', async () => {
    const socket = stalledReceiver();
    await sendRelayNotification(socket, async () => { socket.bufferedAmount = RELAY_SOCKET_BUFFER_LIMIT; return true; });
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('reserves ping capacity and leaves healthy notifications and empty queues usable', async () => {
    const socket = stalledReceiver();
    await sendRelayNotification(socket, async () => false);
    expect(socket.send).not.toHaveBeenCalled(); expect(socket.terminate).not.toHaveBeenCalled();
    await sendRelayNotification(socket, async () => true);
    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toEqual({ type: 'jobs_available', protocolVersion: 1 });
    socket.bufferedAmount = RELAY_SOCKET_BUFFER_LIMIT - 2;
    expect(relaySocketHasCapacity(socket, 2)).toBe(true);
    socket.bufferedAmount += 1;
    expect(relaySocketHasCapacity(socket, 2)).toBe(false);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });
});
