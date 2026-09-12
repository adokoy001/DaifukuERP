import { edgeNotification } from '@daifuku/mod-edge-integration/contract';
import { WebSocket } from 'ws';

export const RELAY_SOCKET_BUFFER_LIMIT = 4096;
type NotificationSocket = Pick<WebSocket, 'readyState' | 'bufferedAmount' | 'terminate' | 'send'>;
const payload = JSON.stringify(edgeNotification.parse({ type: 'jobs_available', protocolVersion: 1 }));
// Include a conservative WebSocket frame-header allowance, not only the JSON byte length.
const notificationBytes = Buffer.byteLength(payload, 'utf8') + 14;

export function relaySocketHasCapacity(socket: NotificationSocket, additionalBytes: number): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount + additionalBytes > RELAY_SOCKET_BUFFER_LIMIT) {
    socket.terminate(); return false;
  }
  return true;
}

/** Notification hints may be discarded: polling recovers them without retaining an unbounded send queue. */
export async function sendRelayNotification(socket: NotificationSocket, pending: () => Promise<boolean>): Promise<void> {
  if (!relaySocketHasCapacity(socket, notificationBytes)) return;
  const hint = await pending();
  // A ping or another transport write may have accumulated while authorization/DB work was pending.
  if (hint && relaySocketHasCapacity(socket, notificationBytes)) socket.send(payload);
}
