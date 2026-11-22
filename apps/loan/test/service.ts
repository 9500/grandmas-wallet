import { binToHex, hexToBin } from '@bitauth/libauth';
import { type ServiceHandlers, type ServiceItem, answerServiceRequest } from '@grandmas-wallet/connect';
import { invitationFromText, invitationToText, readTemplate, templateLockingBytecode, typedValues } from '@grandmas-wallet/core';
import { type ParyonAction, type ParyonServiceChain, paryonService, possibleActions, serviceShare } from '@grandmas-wallet/paryon';

import type { Desk } from '../src/loan.js';

/**
 * Paryon's loan service in memory, for the page's tests: `xo_service_v1` over Paryon's service library, as
 * packages/paryon/test/service-wallet.test.ts has it, with a join that appends one commit of the service's share. The
 * wallet reaches it through the `fetch` given here, at the address the desk's template names. What it brings is what
 * apps/paryon-service brings, without the engine of the real service.
 */

type Invitation = ReturnType<typeof invitationFromText>;
type Commit = Invitation['commits'][number];

export interface InMemoryService {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The kinds of request the wallet sent, in order (`xo_service_hello`, `xo_service_possible_request`, `xo_service_join_request`). */
  calls: string[];
  /** The address the template names for the service. */
  url: string;
  /** Before each join: a test may spend one of the coins the service is about to bring. */
  beforeJoin?: () => void;
}

export const inMemoryService = (desk: Desk, chain: ParyonServiceChain, network = 'chipnet'): InMemoryService => {
  const text = desk.template.texts.template;
  const service = paryonService(desk.contracts, text, network);
  const { definition } = readTemplate(text);
  const url = (definition as { resources?: { name: string; url: string }[] }).resources?.find((resource) => resource.name === 'xo_service_v1')?.url ?? '';
  const scriptHex = (identifier: string | undefined): string | undefined => {
    if (identifier === undefined) return undefined;
    try {
      return binToHex(templateLockingBytecode(definition, identifier, {}));
    } catch {
      return undefined;
    }
  };
  const calls: string[] = [];
  const self: InMemoryService = { fetch: undefined as never, calls, url };
  const handlers: ServiceHandlers = {
    hello: (asked) => (asked.template.identifier === desk.template.names.identifier ? { ok: true, serves: [{ template: desk.template.names, role: 'service' }] } : { ok: false, error: 'This service does not serve that template.', code: 'unknown-template' }),
    possible: async (asked) => {
      const { starts, items } = await possibleActions(service, { tokens: asked.tokens, made: asked.made }, chain);
      return {
        ok: true,
        height: (await chain.tip()).height,
        start: starts,
        items: items.map(({ lockingScript, ...item }): ServiceItem => {
          const script = scriptHex(lockingScript);
          return { ref: `${item.action}:${item.category}`, ...item, ...(script === undefined ? {} : { lockingScript: script }) };
        }),
      };
    },
    join: async (asked) => {
      self.beforeJoin?.();
      const invitation = invitationFromText(asked.invitation);
      const [first] = invitation.commits;
      const committed = {
        variables: Object.fromEntries((first?.data.variables ?? []).map(({ variableIdentifier, value }) => [variableIdentifier, String(value)])),
        inputs: (first?.data.inputs ?? []).map((input) => `${binToHex(input.outpointTransactionHash ?? new Uint8Array())}:${input.outpointIndex ?? 0}`),
      };
      const share = await serviceShare(service, invitation.actionIdentifier as ParyonAction, committed, chain, { pick: () => 0 });
      if (!share.ok) return { ok: false, error: share.reason, code: share.code };
      const values = typedValues(definition, share.variables);
      const previous = invitation.commits.at(-1) as Commit;
      const now = Date.now();
      invitation.commits.push({
        commitIdentifier: `service-${now}`,
        previousCommitIdentifier: previous.commitIdentifier,
        entityIdentifier: 'paryon-service',
        createdAtTimestamp: now,
        expiresAtTimestamp: now + 60_000,
        signature: 'service-signature',
        data: {
          roleIdentifier: 'service',
          ...(Object.keys(values).length === 0 ? {} : { variables: Object.entries(values).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'service', value: value as never })) }),
          inputs: share.inputs.map(({ outpoint, inputIdentifier, unlockingBytecode, sequenceNumber }) => ({
            outpointTransactionHash: hexToBin(outpoint.split(':')[0] as string),
            outpointIndex: Number(outpoint.split(':')[1]),
            inputIdentifier,
            unlockingBytecode,
            sequenceNumber,
          })),
          outputs: share.outputs.map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'service' })),
        },
      });
      return { ok: true, invitation: invitationToText(invitation) };
    },
  };
  self.fetch = async (address, init) => {
    if (address !== url) throw new Error(`The wallet asked ${address}, not the service the template names (${url}).`);
    calls.push(String((JSON.parse(String(init.body)) as { xo_service_v1: { action: string } }).xo_service_v1.action));
    const answer = await answerServiceRequest({ method: init.method ?? 'GET', body: String(init.body) }, { [network]: handlers });
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
  return self;
};
