import { binToHex, hexToBin } from '@bitauth/libauth';
import { type RelayClient, PROTOCOL_NAME, RelayMsgAction, chunkExtensionAdvertisement, initiateDappRelay, initiateWalletRelay, peerSupportsChunk } from '@wizardconnect/core';

import { type RecovererChannel, type RecovererMessage, RECOVERER_EXTENSION, readRecovererMessage, recovererAnnouncement, speaksRecoverer } from './recoverer.js';
import type { LinkState, LinkStatus } from './wizard.js';

/**
 * The WizardConnect session between a recoverer's page and a wallet (see `recoverer.ts`). The recoverer's page
 * takes the part an application takes with an application session: it shows the `wiz://` address, in its QR
 * code, and the wallet opens it. The wallet offers no key paths and nothing of `xo_v1`; it announces
 * `gw_recoverer_v1` alone, and the page answers only a wallet that does. A session of this kind is its own:
 * the wallet's sessions with applications are not touched by it.
 */

const seconds = (): number => Math.floor(Date.now() / 1000);

/** Hands this extension's messages to listeners, and sends them. Every other message is left alone. */
const channelOver = (client: () => RelayClient | undefined) => {
  const handlers = new Set<(message: RecovererMessage) => void>();
  const channel: RecovererChannel = {
    send: async (message) => {
      const relay = client();
      if (relay === undefined || !relay.isConnected()) throw new Error('Not connected.');
      await relay.relay(message);
    },
    onMessage: (handler) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
  };
  const deliver = (message: unknown): void => {
    const read = readRecovererMessage(message);
    if (read !== undefined) for (const handler of [...handlers]) handler(read);
  };
  return { channel, deliver };
};

type Incoming = { action: string; [field: string]: unknown };
type Outgoing = Parameters<RelayClient['relay']>[0];

// ── The recoverer's page ────────────────────────────────────────────────────

export interface DeskSession {
  /** The address the wallet opens. */
  uri: string;
  channel: RecovererChannel;
  close(): void;
}

/**
 * Offer a session for one wallet. The first wallet that opens the address with its secret is the one the
 * session serves; the relay takes no other.
 */
export const openDeskSession = (options: { name: string; relays?: string[]; onStatus(status: LinkStatus): void }): DeskSession => {
  let client: RelayClient | undefined;
  let listening = false;
  let walletDiscovered = false;
  let closed = false;
  const { channel, deliver } = channelOver(() => client);

  const sendReady = async (): Promise<void> => {
    await client?.relay({
      action: RelayMsgAction.DappReady,
      supported_protocols: [PROTOCOL_NAME],
      wallet_discovered: walletDiscovered,
      time: seconds(),
      ...(walletDiscovered ? { selected_protocol: PROTOCOL_NAME } : {}),
      dapp_name: options.name,
      extensions: { chunk: chunkExtensionAdvertisement() },
    } as Outgoing);
  };

  const onMessage = (message: Incoming): void => {
    if (closed) return;
    if (message.action === RelayMsgAction.WalletReady) {
      client?.setPeerCapabilities({ chunk: peerSupportsChunk(message['extensions'] as Record<string, unknown> | undefined) });
      const session = (message['session'] as Record<string, { extensions?: unknown } | undefined> | undefined)?.[PROTOCOL_NAME];
      if (!speaksRecoverer(session?.extensions)) {
        options.onStatus({ state: 'disconnected', reason: 'The wallet that connected does not offer to hand anything to a recoverer.' });
        return;
      }
      const firstContact = !walletDiscovered;
      walletDiscovered = true;
      if (message['dapp_discovered'] !== true || firstContact) void sendReady().catch(() => undefined);
      options.onStatus({ state: 'connected', peerName: typeof message['wallet_name'] === 'string' ? message['wallet_name'].slice(0, 60) : 'A wallet' });
    } else if (message.action === RelayMsgAction.Ping) {
      void client?.relay({ action: RelayMsgAction.Pong, time: seconds() }).catch(() => undefined);
    } else if (message.action === RelayMsgAction.Disconnect) {
      walletDiscovered = false;
      options.onStatus({ state: 'disconnected', reason: 'The wallet ended the connection.' });
    } else {
      deliver(message);
    }
  };

  const relay = initiateDappRelay(
    (payload) => {
      if (closed) return;
      client = payload.client;
      if (!listening) {
        listening = true;
        payload.client.on('message', onMessage);
      }
      if (payload.status.status === 'connected') {
        options.onStatus({ state: walletDiscovered ? 'connected' : 'waiting' });
        void sendReady().catch(() => undefined);
      } else if (payload.status.status === 'reconnecting') {
        options.onStatus({ state: 'connecting' });
      } else {
        options.onStatus({ state: 'disconnected' });
      }
    },
    options.relays === undefined || options.relays.length === 0 ? {} : { explicitRelayUrls: options.relays },
  );

  return {
    uri: relay.uri,
    channel,
    close: () => {
      closed = true;
      const ending = client?.relay({ action: RelayMsgAction.Disconnect, reason: 'user_disconnect', time: seconds() } as Outgoing);
      void Promise.resolve(ending)
        .catch(() => undefined)
        .finally(() => relay.cleanup());
    },
  };
};

// ── The wallet ──────────────────────────────────────────────────────────────

export interface JoinedDesk {
  channel: RecovererChannel;
  close(): void;
}

/**
 * Open a recoverer page's session.
 * @param options.privateKey - this wallet's key for this session alone, 32 bytes as hex; the same key reconnects
 * @throws if the address cannot be read
 */
export const joinDeskSession = (options: { uri: string; privateKey: string; name: string; onStatus(status: LinkStatus): void }): JoinedDesk => {
  let client: RelayClient | undefined;
  let listening = false;
  let closed = false;
  let dappDiscovered = false;
  let peerName: string | undefined;
  const { channel, deliver } = channelOver(() => client);

  const status = (state: LinkState, reason?: string): void =>
    options.onStatus({ state, ...(peerName === undefined ? {} : { peerName }), ...(reason === undefined ? {} : { reason }) });

  const sendReady = async (): Promise<void> => {
    await client?.relay({
      action: RelayMsgAction.WalletReady,
      supported_protocols: [PROTOCOL_NAME],
      wallet_name: options.name,
      wallet_icon: '',
      time: seconds(),
      dapp_discovered: dappDiscovered,
      // No key paths and no XO requests: what this session is for is in its own extension.
      session: { [PROTOCOL_NAME]: { paths: [], extensions: { [RECOVERER_EXTENSION]: recovererAnnouncement() } } },
      public_key: binToHex(relay.walletPublicKey),
      secret: relay.secret,
      extensions: { chunk: chunkExtensionAdvertisement() },
    } as Outgoing);
  };

  const onMessage = (message: Incoming): void => {
    if (closed) return;
    if (message.action === RelayMsgAction.DappReady) {
      client?.setPeerCapabilities({ chunk: peerSupportsChunk(message['extensions'] as Record<string, unknown> | undefined) });
      if (typeof message['dapp_name'] === 'string') peerName = message['dapp_name'].slice(0, 60);
      if (message['wallet_discovered'] !== true) {
        void sendReady().catch(() => undefined);
        return;
      }
      dappDiscovered = true;
      status('connected');
    } else if (message.action === RelayMsgAction.Ping) {
      void client?.relay({ action: RelayMsgAction.Pong, time: seconds() }).catch(() => undefined);
    } else if (message.action === RelayMsgAction.Disconnect) {
      status('disconnected', 'The recoverer\'s page ended the connection.');
    } else {
      deliver(message);
    }
  };

  const relay = initiateWalletRelay(
    (payload) => {
      if (closed) return;
      client = payload.client;
      if (!listening) {
        listening = true;
        payload.client.on('message', onMessage);
      }
      if (payload.status.status === 'connected') {
        dappDiscovered = false;
        status('waiting');
        void sendReady().catch(() => undefined);
      } else if (payload.status.status === 'reconnecting') {
        status('connecting');
      } else {
        status('disconnected');
      }
    },
    { uri: options.uri, walletPrivateKey: hexToBin(options.privateKey) },
  );

  return {
    channel,
    close: () => {
      closed = true;
      const ending = client?.relay({ action: RelayMsgAction.Disconnect, reason: 'user_disconnect', time: seconds() } as Outgoing);
      void Promise.resolve(ending)
        .catch(() => undefined)
        .finally(() => relay.cleanup());
    },
  };
};
