import type { AddressInfo } from 'node:net';

import { type WebSocket, WebSocketServer } from 'ws';

/**
 * A Nostr relay that keeps everything in memory, on a port of this machine: what WizardConnect sessions travel
 * through, for tests that run both sides of a session with the real transport. It keeps events, sends a
 * subscriber the stored ones that match and then every new one.
 */

interface Event {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}
type Filter = { ids?: string[]; authors?: string[]; kinds?: number[]; since?: number; until?: number; limit?: number } & Record<`#${string}`, string[] | undefined>;

const matches = (filter: Filter, event: Event): boolean =>
  (filter.ids === undefined || filter.ids.includes(event.id)) &&
  (filter.authors === undefined || filter.authors.includes(event.pubkey)) &&
  (filter.kinds === undefined || filter.kinds.includes(event.kind)) &&
  (filter.since === undefined || event.created_at >= filter.since) &&
  (filter.until === undefined || event.created_at <= filter.until) &&
  Object.entries(filter).every(([key, values]: [string, unknown]) => !key.startsWith('#') || !Array.isArray(values) || event.tags.some((tag) => tag[0] === key.slice(1) && (values as unknown[]).includes(tag[1])));

export interface MemoryRelay {
  url: string;
  /** How many events were published, and the largest, in characters. */
  published(): { count: number; largest: number };
  close(): Promise<void>;
}

export const startMemoryRelay = async (): Promise<MemoryRelay> => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const events: Event[] = [];
  const subscriptions = new Map<WebSocket, Map<string, Filter[]>>();
  let largest = 0;
  server.on('connection', (socket) => {
    subscriptions.set(socket, new Map());
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('message', (data) => {
      let message: unknown[];
      try {
        message = JSON.parse(String(data)) as unknown[];
      } catch {
        return;
      }
      const [type, ...rest] = message;
      if (type === 'EVENT') {
        const event = rest[0] as Event;
        socket.send(JSON.stringify(['OK', event.id, true, '']));
        largest = Math.max(largest, event.content.length);
        events.push(event);
        for (const [subscriber, subscribed] of subscriptions) {
          for (const [id, filters] of subscribed) if (filters.some((filter) => matches(filter, event))) subscriber.send(JSON.stringify(['EVENT', id, event]));
        }
      } else if (type === 'REQ') {
        const [id, ...filters] = rest as [string, ...Filter[]];
        subscriptions.get(socket)?.set(id, filters);
        for (const filter of filters) {
          if (filter.limit === 0) continue;
          for (const event of events.filter((stored) => matches(filter, stored))) socket.send(JSON.stringify(['EVENT', id, event]));
        }
        socket.send(JSON.stringify(['EOSE', id]));
      } else if (type === 'CLOSE') {
        subscriptions.get(socket)?.delete(rest[0] as string);
      }
    });
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    published: () => ({ count: events.length, largest }),
    close: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
