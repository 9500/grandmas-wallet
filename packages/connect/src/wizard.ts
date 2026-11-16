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
 * WizardConnect sessions: an encrypted connection between an application
 * and a wallet, carried by a relay that sees neither side's messages. The
 * application shows a `wiz://` address; the wallet opens it.
 *
 * An application meets two kinds of wallet. An ordinary one shares the
 * public keys of its address chains and signs transactions the application
 * builds. One that speaks XO requests says so under `xo_v1` in the session's
 * extensions and is asked for actions instead. The application's side below
 * serves both; the wallet's side is this project's wallet, which offers no
 * key paths because its funds are not spent by plain signatures.
 */

export type LinkState =
  /** Reaching the relay. */
  | 'connecting'
  /** At the relay; the other side has not answered yet. */
  | 'waiting'
  | 'connected'
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

/** What a wallet offered when it connected. */
export interface WalletOffer {
  /** Public keys of the wallet's address chains. Empty for a wallet whose funds are not spent by plain signatures. */
  paths: { name: string; xpub: string }[];
  /** Set if the wallet speaks XO requests in a version this software knows. */
  xo?: XoAdvertisement;
  /** Why the wallet's XO offer, if it made one, cannot be used. */
  xoProblem?: string;
}

/** A request for signatures as it travels: bytes as hex, amounts as `<bigint: Nn>`. */
export interface WireSignRequest {
  transaction: unknown;
  inputPaths: [number, string, number][];
}

/** The wallet declined to sign, or could not. */
export class SigningRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SigningRefusedError';
  }
}

export interface DappLinkOptions {
  name: string;
  /** Address of an icon the wallet may show next to the name. */
  icon?: string;
  relays?: string[];
  /** From an earlier session, to resume it. */
  credentials?: DappCredentials;
  onStatus(status: LinkStatus, offered?: WalletOffer): void;
  /** Called when the credentials change, so that they can be saved. */
  onCredentials?(credentials: DappCredentials): void;
}

export interface DappLink {
  /** The address the wallet opens to connect. */
  uri: string;
  /** The same address in the form that makes the smallest QR code. */
  qrUri: string;
  channel: Channel;
  /**
   * Ask an ordinary wallet to sign a transaction. Resolves with the signed transaction as hex once the
   * user has agreed in the wallet.
   * @throws SigningRefusedError
   */
  sign(request: WireSignRequest): Promise<string>;
  close(): void;
}

export const openDappLink = (options: DappLinkOptions): DappLink => {
  let client: RelayClient | undefined;
  let listening = false;
  let walletDiscovered = false;
  let closed = false;
  const { channel, deliver } = channelOver(() => client);
  const signing = new Map<number, { resolve: (signed: string) => void; reject: (error: Error) => void }>();
  const abandon = (reason: string): void => {
    for (const waiting of signing.values()) waiting.reject(new SigningRefusedError(reason));
    signing.clear();
  };

  const sendReady = async (): Promise<void> => {
    await client?.relay({
      action: RelayMsgAction.DappReady,
      supported_protocols: [PROTOCOL_NAME],
      wallet_discovered: walletDiscovered,
      time: seconds(),
      ...(walletDiscovered ? { selected_protocol: PROTOCOL_NAME } : {}),
      dapp_name: options.name,
      ...(options.icon === undefined ? {} : { dapp_icon: options.icon }),
      extensions: { chunk: chunkExtensionAdvertisement() },
    } as Parameters<RelayClient['relay']>[0]);
  };

  const onMessage = (message: { action: string; [field: string]: unknown }): void => {
    if (closed) return;
    if (message.action === RelayMsgAction.WalletReady) {
      client?.setPeerCapabilities({ chunk: peerSupportsChunk(message['extensions'] as Record<string, unknown> | undefined) });
      const peerName = typeof message['wallet_name'] === 'string' ? message['wallet_name'] : 'Wallet';
      const session = (message['session'] as Record<string, { paths?: unknown; extensions?: unknown } | undefined> | undefined)?.[PROTOCOL_NAME];
      const firstContact = !walletDiscovered;
      walletDiscovered = true;
      if (typeof message['public_key'] === 'string') {
        options.onCredentials?.({ privateKey: relay.credentials.privateKey, secret: relay.credentials.secret, walletPublicKey: message['public_key'] });
      }
      if (message['dapp_discovered'] !== true || firstContact) void sendReady().catch(() => undefined);
      const paths = (Array.isArray(session?.paths) ? session.paths : []).filter(
        (path): path is { name: string; xpub: string } => typeof (path as { name?: unknown } | null)?.name === 'string' && typeof (path as { xpub?: unknown }).xpub === 'string',
      );
      const offer: WalletOffer = { paths: paths.map(({ name, xpub }) => ({ name, xpub })) };
      try {
        const xo = readAdvertisement(session?.extensions);
        if (xo !== undefined) offer.xo = xo;
      } catch (error) {
        // An XO offer that cannot be used leaves the wallet an ordinary one, if it shared keys.
        offer.xoProblem = error instanceof ProtocolError ? error.message : 'The wallet\'s XO offer could not be read.';
      }
      options.onStatus({ state: 'connected', peerName }, offer);
    } else if (message.action === RelayMsgAction.SignTransactionResponse) {
      const waiting = signing.get(message['sequence'] as number);
      if (waiting === undefined) return;
      signing.delete(message['sequence'] as number);
      const { error, signedTransaction } = message as { error?: unknown; signedTransaction?: unknown };
      if (typeof error === 'string' && error !== '') waiting.reject(new SigningRefusedError(error));
      else if (typeof signedTransaction === 'string' && signedTransaction !== '') waiting.resolve(signedTransaction);
      else waiting.reject(new SigningRefusedError('The wallet answered without a signed transaction.'));
    } else if (message.action === RelayMsgAction.Ping) {
      void client?.relay({ action: RelayMsgAction.Pong, time: seconds() }).catch(() => undefined);
    } else if (message.action === RelayMsgAction.Disconnect) {
      walletDiscovered = false;
      abandon('The wallet ended the connection.');
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
    qrUri: relay.qrUri,
    channel,
    sign: (request) =>
      new Promise<string>((resolve, reject) => {
        const current = client;
        if (current === undefined || !current.isConnected() || !walletDiscovered) {
          reject(new SigningRefusedError('No wallet is connected.'));
          return;
        }
        const sequence = current.nextSequence();
        signing.set(sequence, { resolve, reject });
        current.relay({ action: RelayMsgAction.SignTransactionRequest, time: seconds(), sequence, ...request } as Parameters<RelayClient['relay']>[0]).catch((error: unknown) => {
          signing.delete(sequence);
          reject(new SigningRefusedError(`The request could not be sent to the wallet: ${(error as Error).message}`));
        });
      }),
    close: () => {
      closed = true;
      abandon('The connection was closed.');
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
