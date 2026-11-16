import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  type RelayClient,
  PROTOCOL_NAME,
  RelayMsgAction,
  chunkExtensionAdvertisement,
  initiateDappRelay,
  initiateWalletRelay,
  peerSupportsChunk,
} from '@wizardconnect/core';

import { type Channel, type XoAdvertisement, type XoMessage, ProtocolError, XO_EXTENSION, isXoMessage, readAdvertisement } from './protocol.js';

/**
 * XO requests over WizardConnect: an encrypted session between an
 * application and a wallet, carried by a relay that sees neither side's
 * messages. The application shows a `wiz://` address; the wallet opens it.
 *
 * Only the session's own machinery is used here: pairing, the two "ready"
 * messages, and custom actions. The wallet offers no key paths, because its
 * funds are not spent by plain signatures; what it offers instead is listed
 * under `xo_v1` in the session's extensions.
 */

export type LinkState =
  /** Reaching the relay. */
  | 'connecting'
  /** At the relay; the other side has not answered yet. */
  | 'waiting'
  | 'connected'
  /** The other side does not speak XO requests, or speaks a version this software does not know. */
  | 'incompatible'
  | 'disconnected';

export interface LinkStatus {
  state: LinkState;
  /** The other side's name for itself. Shown to the user; not verified. */
  peerName?: string;
  reason?: string;
}

const seconds = (): number => Math.floor(Date.now() / 1000);

/** The part both sides share: handing extension messages to listeners and sending them. */
const channelOver = (client: () => RelayClient | undefined) => {
  const handlers = new Set<(message: unknown) => void>();
  const channel: Channel = {
    send: async (message: XoMessage) => {
      const relay = client();
      if (relay === undefined || !relay.isConnected()) throw new Error('Not connected.');
      await relay.relay(message);
    },
    onMessage: (handler) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    nextSequence: () => client()?.nextSequence() ?? 0,
  };
  const deliver = (message: unknown) => {
    if (isXoMessage(message)) for (const handler of [...handlers]) handler(message);
  };
  return { channel, deliver };
};

// ── The application's side ──────────────────────────────────────────────────

/** What an application keeps to come back to the same wallet after the page is loaded again. */
export interface DappCredentials {
  privateKey: string;
  secret: string;
  /** Known once a wallet has answered. */
  walletPublicKey?: string;
}

export interface DappLinkOptions {
  name: string;
  relays?: string[];
  /** From an earlier session, to resume it. */
  credentials?: DappCredentials;
  onStatus(status: LinkStatus, offered?: XoAdvertisement): void;
  /** Called when the credentials change, so that they can be saved. */
  onCredentials?(credentials: DappCredentials): void;
}

export interface DappLink {
  /** The address the wallet opens to connect. */
  uri: string;
  channel: Channel;
  close(): void;
}

export const openDappLink = (options: DappLinkOptions): DappLink => {
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
    } as Parameters<RelayClient['relay']>[0]);
  };

  const onMessage = (message: { action: string; [field: string]: unknown }): void => {
    if (closed) return;
    if (message.action === RelayMsgAction.WalletReady) {
      client?.setPeerCapabilities({ chunk: peerSupportsChunk(message['extensions'] as Record<string, unknown> | undefined) });
      const peerName = typeof message['wallet_name'] === 'string' ? message['wallet_name'] : 'Wallet';
      const session = (message['session'] as Record<string, { extensions?: unknown } | undefined> | undefined)?.[PROTOCOL_NAME];
      const firstContact = !walletDiscovered;
      walletDiscovered = true;
      if (typeof message['public_key'] === 'string') {
        options.onCredentials?.({ privateKey: relay.credentials.privateKey, secret: relay.credentials.secret, walletPublicKey: message['public_key'] });
      }
      if (message['dapp_discovered'] !== true || firstContact) void sendReady().catch(() => undefined);
      try {
        const offered = readAdvertisement(session?.extensions);
        if (offered === undefined) options.onStatus({ state: 'incompatible', peerName, reason: 'This wallet does not offer XO requests.' });
        else options.onStatus({ state: 'connected', peerName }, offered);
      } catch (error) {
        options.onStatus({ state: 'incompatible', peerName, reason: error instanceof ProtocolError ? error.message : 'The wallet\'s answer could not be read.' });
      }
    } else if (message.action === RelayMsgAction.Disconnect) {
      walletDiscovered = false;
      options.onStatus({ state: 'disconnected', reason: 'The wallet ended the connection.' });
    } else {
      deliver(message);
    }
  };

  const existing = options.credentials;
  const relay = initiateDappRelay(
    (payload) => {
      if (closed) return;
      client = payload.client;
      if (!listening) {
        listening = true;
        payload.client.on('message', onMessage);
      }
      if (payload.status.status === 'connected') {
        options.onStatus({ state: 'waiting' });
        void sendReady().catch(() => undefined);
      } else if (payload.status.status === 'reconnecting') {
        options.onStatus({ state: 'connecting' });
      } else {
        options.onStatus({ state: 'disconnected' });
      }
    },
    {
      ...(options.relays === undefined || options.relays.length === 0 ? {} : { explicitRelayUrls: options.relays }),
      ...(existing?.walletPublicKey === undefined ? {} : { existingCredentials: { privateKey: existing.privateKey, secret: existing.secret, walletPublicKey: existing.walletPublicKey } }),
    },
  );
  options.onCredentials?.({ privateKey: relay.credentials.privateKey, secret: relay.credentials.secret, ...(existing?.walletPublicKey === undefined ? {} : { walletPublicKey: existing.walletPublicKey }) });

  return {
    uri: relay.uri,
    channel,
    close: () => {
      closed = true;
      const ending = client?.relay({ action: RelayMsgAction.Disconnect, reason: 'user_disconnect', time: seconds() } as Parameters<RelayClient['relay']>[0]);
      void Promise.resolve(ending)
        .catch(() => undefined)
        .finally(() => relay.cleanup());
    },
  };
};

// ── The wallet's side ───────────────────────────────────────────────────────

export interface WalletLinkOptions {
  /** The `wiz://` address the application showed. */
  uri: string;
  /** This wallet's key for this one connection, 32 bytes as hex. A new one per connection keeps applications from linking them. */
  privateKey: string;
  name: string;
  offered: XoAdvertisement;
  onStatus(status: LinkStatus): void;
}

export interface WalletLink {
  channel: Channel;
  close(): void;
}

export const newLinkKey = (): string => binToHex(crypto.getRandomValues(new Uint8Array(32)));

export const openWalletLink = (options: WalletLinkOptions): WalletLink => {
  let client: RelayClient | undefined;
  let listening = false;
  let closed = false;
  let dappDiscovered = false;
  let peerName: string | undefined;
  const { channel, deliver } = channelOver(() => client);

  const sendReady = async (): Promise<void> => {
    await client?.relay({
      action: RelayMsgAction.WalletReady,
      supported_protocols: [PROTOCOL_NAME],
      wallet_name: options.name,
      wallet_icon: '',
      time: seconds(),
      dapp_discovered: dappDiscovered,
      // No key paths: this wallet's funds are not spent by plain signatures. What it offers is in the extension.
      session: { [PROTOCOL_NAME]: { paths: [], extensions: { [XO_EXTENSION]: options.offered } } },
      public_key: binToHex(relay.walletPublicKey),
      secret: relay.secret,
      extensions: { chunk: chunkExtensionAdvertisement() },
    } as Parameters<RelayClient['relay']>[0]);
  };

  const status = (state: LinkState, reason?: string): void =>
    options.onStatus({ state, ...(peerName === undefined ? {} : { peerName }), ...(reason === undefined ? {} : { reason }) });

  const onMessage = (message: { action: string; [field: string]: unknown }): void => {
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
      status('disconnected', 'The application ended the connection.');
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
      const ending = client?.relay({ action: RelayMsgAction.Disconnect, reason: 'user_disconnect', time: seconds() } as Parameters<RelayClient['relay']>[0]);
      void Promise.resolve(ending)
        .catch(() => undefined)
        .finally(() => relay.cleanup());
    },
  };
};
