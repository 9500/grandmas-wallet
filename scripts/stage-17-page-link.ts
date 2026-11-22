// What the runs of stage 17 share: a page connected to the wallet as the pages are, with the session in memory.
//
// The page's own code (apps/jar/src/xo.ts, apps/loan/src/xo.ts) makes its requests with `DappRequests`; the wallet
// answers with its connector for applications (`applicationConnector`), exactly as in the browser, every message
// going through JSON and back. Only the relay is left out. The user approves what the wallet shows.
//
// The wallet's screens do not ask for the user's tick yet (proposal section 13.3: a token made from the wallet's
// coin that does not come to the wallet). Where a run needs it, the approval carries the tick, and the run says so.
import { type ActionPreview, type Applications, actionOf, applicationConnector } from '../packages/app/src/index.js';
import { type Channel, type LedgerEntry, type Offer, type Proposal, type XoMessage, DappRequests } from '../packages/connect/src/index.js';

export interface PageLink {
  requests: DappRequests;
  /** Every message the page sent to the wallet, as it travelled. */
  sent: XoMessage[];
  /**
   * Wait until the wallet shows the request, look at the wallet's own figures for it as the user would, and approve
   * it, with the tick where `tick` says so.
   */
  approve: <T>(asked: Promise<T>, options?: { tick?: boolean; seen?: (preview: ActionPreview, entry: LedgerEntry) => void }) => Promise<T>;
  /**
   * Wait until the wallet lists a template the page offered without an action (`DappRequests.offerTemplate`), let the
   * user look at it, and trust it, as the user would in the wallet.
   */
  acceptOffer: <T>(offered: Promise<T>, seen?: (offer: Offer) => void) => Promise<T>;
}

export const pageLink = (applications: Applications, pairing: string): PageLink => {
  let proposals: Proposal[] = [];
  let offers: Offer[] = [];
  let ticks = false;
  // The user's approval, with the tick when it is given: the wallet's own `carryOut`, with the consent passed on.
  const user = Object.create(applications) as Applications;
  user.carryOut = (request, onStage, consent) => applications.carryOut(request, onStage, { ...consent, ...(ticks ? { tokensLeave: true } : {}) });
  const connector = applicationConnector(user, { onProposals: (open) => (proposals = open), onOffers: (open) => (offers = open) });
  const toWallet: ((message: unknown) => void)[] = [];
  const toPage: ((message: unknown) => void)[] = [];
  const sent: XoMessage[] = [];
  let sequence = 0;
  const end = (out: ((message: unknown) => void)[], incoming: ((message: unknown) => void)[], log?: XoMessage[]): Channel => ({
    send: async (message) => {
      log?.push(JSON.parse(JSON.stringify(message)) as XoMessage);
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => (sequence += 2),
  });
  connector.attach(pairing, end(toPage, toWallet));
  const requests = new DappRequests();
  requests.attach(end(toWallet, toPage, sent));
  const approve = async <T>(asked: Promise<T>, options: { tick?: boolean; seen?: (preview: ActionPreview, entry: LedgerEntry) => void } = {}): Promise<T> => {
    // A failure before the wallet shows anything (the page's own checks) comes back as it is.
    const early = asked.then(
      () => undefined,
      (error: unknown) => error,
    );
    for (let turn = 0; turn < 600 && proposals.length === 0; turn++) {
      const settled = await Promise.race([early, new Promise((resolve) => setTimeout(() => resolve('waiting'), 50))]);
      if (settled !== 'waiting' && settled !== undefined) throw settled;
    }
    const [proposal] = proposals;
    if (proposal === undefined) throw new Error('The wallet shows nothing to approve.');
    if (options.seen !== undefined) options.seen(await applications.preview(actionOf(proposal.entry)), proposal.entry);
    ticks = options.tick === true;
    try {
      await proposal.approve();
    } finally {
      ticks = false;
    }
    return asked;
  };
  const acceptOffer = async <T>(offered: Promise<T>, seen?: (offer: Offer) => void): Promise<T> => {
    const early = offered.then(
      () => undefined,
      (error: unknown) => error,
    );
    for (let turn = 0; turn < 600 && offers.length === 0; turn++) {
      const settled = await Promise.race([early, new Promise((resolve) => setTimeout(() => resolve('waiting'), 50))]);
      if (settled !== 'waiting' && settled !== undefined) throw settled;
    }
    const [offer] = offers;
    if (offer === undefined) throw new Error('The wallet shows no template to trust.');
    seen?.(offer);
    await offer.accept();
    return offered;
  };
  return { requests, sent, approve, acceptOffer };
};
