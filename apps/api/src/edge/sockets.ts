import fastifyWebsocket from '@fastify/websocket';
import { notificationPending, edgeRoutes } from '@daifuku/mod-edge-integration';
import type { RelayPrincipal } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { relayContext, verifiedSocket, type EdgeOptions } from './context.ts';
import { relaySocketHasCapacity, sendRelayNotification } from './socket-notifications.ts';
export async function registerRelaySockets(server: FastifyInstance, opts: EdgeOptions) {
  await server.register(fastifyWebsocket, { options: { maxPayload: 1024, perMessageDeflate: false } });
  const connected = new Set<WebSocket>(), groups = new Map<string, Set<WebSocket>>();
  const pending = new WeakMap<object, RelayPrincipal>();
  server.get(edgeRoutes.notifications, { websocket: true, preValidation: async (req) => { pending.set(req, await verifiedSocket(opts, req)); } }, (socket, req) => {
    const principal = pending.get(req); pending.delete(req);
    if (!principal) { socket.close(1008, 'Authentication required'); return; }
    const key = principal.gatewayId, group = groups.get(key) ?? new Set<WebSocket>();
    if (connected.size >= 500 || group.size >= 3) { socket.close(1013, 'Connection limit'); return; }
    connected.add(socket); group.add(socket); groups.set(key, group);
    let running = false, alive = true;
    socket.on('error', () => socket.close());
    socket.on('message', () => socket.close(1008, 'Notifications only'));
    socket.on('pong', () => { alive = true; });
    const check = async () => {
      if (running || socket.readyState !== WebSocket.OPEN) return;
      running = true;
      try {
        if (!alive) { socket.terminate(); return; }
        if (!relaySocketHasCapacity(socket, 2)) return;
        alive = false; socket.ping();
        await sendRelayNotification(socket, () => relayContext(opts, principal, notificationPending));
      } catch { socket.close(1008, 'Gateway authorization expired'); }
      finally { running = false; }
    };
    const timer = setInterval(() => { void check(); }, 5000); timer.unref(); void check();
    socket.on('close', () => { clearInterval(timer); connected.delete(socket); group.delete(socket); if (!group.size) groups.delete(key); });
  });
  server.addHook('preClose', async () => { for (const socket of connected) socket.terminate(); });
}
