import { readFileSync } from 'node:fs';

import type { ActionDetails } from '@grandmas-wallet/connect';
import { readTemplate } from '@grandmas-wallet/core';
import { type ParyonAction, PARYON_SERVICE_SPLIT, paryonAddressesAt, paryonTemplateAlone } from '@grandmas-wallet/paryon';
import { describe, expect, it } from 'vitest';

import { type ServiceConfig, servedNetworks } from '../../paryon-service/src/server.js';
import { type Desk, CHIPNET_DESK, MAINNET_DESK, deskFor } from '../src/loan.js';
import { borrowDetails, changeInterestDetails, closeDetails, createKeyDetails, manageDetails, movePeriodDetails, repayDetails } from '../src/xo.js';

/**
 * What the page sends with version 3 of the template, without a wallet: only the borrower's values, and the template
 * it sends, which must be the one Paryon's service serves for the same configuration, or the wallet's hello to the
 * service would not match.
 */

const PAGE = 'https://loan.example/';
const KEY = 'ab'.repeat(32);
/** What the wallet fills in itself: the key's category from what the request is about or makes, the addresses from the bindings. */
const FROM_THE_WALLET = new Set(['keyCategory', 'keyHolder', 'tokensHolder']);

const detailsOf = (desk: Desk): Record<ParyonAction, ActionDetails> => ({
  createKey: createKeyDetails(PAGE, desk),
  movePeriod: movePeriodDetails(PAGE, desk),
  borrow: borrowDetails({ category: KEY }, { debt: 100_00n, collateral: 60_000_000n }, PAGE, desk),
  manage: manageDetails(KEY, 61_000_000n, PAGE, desk),
  repay: repayDetails(KEY, 100_00n, PAGE, desk),
  close: closeDetails(KEY, PAGE, desk),
  changeInterest: changeInterestDetails(KEY, 1_096, PAGE, desk),
});

const production = JSON.parse(readFileSync(new URL('../../../deploy/config/production.json', import.meta.url), 'utf8')) as ServiceConfig & { networks: Record<string, Record<string, unknown>> };
/** The configuration as the page reads it on a network, as `readEnvironment` (packages/ui) resolves it. */
const pageEnvironment = (config: ServiceConfig & { networks?: Record<string, Record<string, unknown>> }, network: string): { network: string; paryon?: unknown; loanUrl?: unknown } => {
  const { networks, ...shared } = config;
  return { ...shared, ...(networks?.[network] ?? {}), network };
};
/** The template the service serves first for a configuration. */
const served = (config: ServiceConfig) => servedNetworks(config).served[0]?.template;
/** A chain of one's own on this machine, with the mockup's deployment of Paryon's contracts, as a preview may be configured. */
const localRegtest = { ...(JSON.parse(readFileSync(new URL('../../../deploy/config/local-regtest.json', import.meta.url), 'utf8')) as ServiceConfig), paryon: production.networks['mockup']?.['paryon'] };

describe('the requests of version 3', () => {
  for (const desk of [CHIPNET_DESK, MAINNET_DESK]) {
    describe(desk.deployment.name, () => {
      const details = detailsOf(desk);
      for (const action of Object.keys(PARYON_SERVICE_SPLIT) as ParyonAction[]) {
        it(`${action}: only the borrower's values, the loan it is about, where the key goes and the page's address; no coin`, () => {
          const sent = details[action];
          expect(sent.templateAction).toBe(action);
          expect(sent.role).toBe('borrower');
          expect(sent.template).toEqual(desk.template.names);
          expect(sent.page).toBe(PAGE);
          expect(sent).not.toHaveProperty('inputs');
          // The variables are the borrower's in the template's split, less what the wallet fills in itself.
          expect(Object.keys(sent.variables).sort()).toEqual(PARYON_SERVICE_SPLIT[action].borrower.filter((variable) => !FROM_THE_WALLET.has(variable)).sort());
          for (const variable of PARYON_SERVICE_SPLIT[action].service) expect(sent.variables).not.toHaveProperty(variable);
          // Every variable sent is one the action asks of the borrower in the template.
          const { definition } = readTemplate(desk.template.texts.template);
          const asked = (definition.actions?.[action] as { roles?: Record<string, { requirements?: { variables?: string[] } }> } | undefined)?.roles?.['borrower']?.requirements?.variables ?? [];
          for (const variable of Object.keys(sent.variables)) expect(asked).toContain(variable);
          // The wallet's own values: the key's category, and the addresses the key and the PUSD go to.
          const keyed = PARYON_SERVICE_SPLIT[action].borrower.includes('keyCategory');
          if (action === 'createKey') expect(sent).toMatchObject({ creates: 'keyCategory' });
          else expect(sent).not.toHaveProperty('creates');
          if (keyed && action !== 'createKey') expect(sent.about).toEqual({ category: KEY, spent: action !== 'borrow' });
          else expect(sent).not.toHaveProperty('about');
          const bindings = PARYON_SERVICE_SPLIT[action].borrower.filter((variable) => variable === 'keyHolder' || variable === 'tokensHolder');
          expect(Object.keys(sent.bindings ?? {}).sort()).toEqual(bindings.sort());
        });
      }

      it('the values themselves: decimal text for amounts, a whole number for the rate; the key back where it was, or to a fresh address', () => {
        expect(details.borrow).toMatchObject({ variables: { debt: '10000', collateral: '60000000', startingRate: 0 }, bindings: { keyHolder: 'receive', tokensHolder: 'receive' } });
        expect(details.manage).toMatchObject({ variables: { collateral: '61000000' }, bindings: { keyHolder: 'return' } });
        expect(details.repay).toMatchObject({ variables: { repayAmount: '10000' }, bindings: { keyHolder: 'return' } });
        expect(details.close).toMatchObject({ variables: {}, bindings: { keyHolder: 'receive' } });
        expect(details.changeInterest).toMatchObject({ variables: { interestRate: 1_096 }, bindings: { keyHolder: 'return' } });
        expect(details.createKey.variables).toEqual({});
        expect(details.movePeriod.variables).toEqual({});
        expect(details.movePeriod).not.toHaveProperty('bindings');
      });
    });
  }

  it('without a web address, the requests carry none', () => {
    expect(createKeyDetails(undefined)).not.toHaveProperty('page');
    expect(closeDetails(KEY)).not.toHaveProperty('page');
  });
});

describe('the template the page sends is the one Paryon\'s service serves for the same configuration', () => {
  it('on chipnet and mainnet: Paryon\'s frozen texts, which name Paryon\'s own service', () => {
    const { served } = servedNetworks(production);
    expect(served.map(({ network }) => network)).toEqual(['chipnet', 'mainnet', 'mockup']);
    for (const network of ['chipnet', 'mainnet']) {
      const desk = deskFor(pageEnvironment(production, network), 'http://localhost:8104/');
      const service = served.find((candidate) => candidate.network === network);
      expect(desk?.template.names).toEqual(service?.template);
      expect(desk?.template.texts.template).toBe(service?.templateText);
    }
    expect(deskFor(pageEnvironment(production, 'chipnet'))).toBe(CHIPNET_DESK);
    expect(deskFor(pageEnvironment(production, 'mainnet'))).toBe(MAINNET_DESK);
  });

  it('on the mockup: the template made for its deployment, naming the loan page at "loanUrl" and the service beside it, whatever address the page is opened at', () => {
    const { served } = servedNetworks(production);
    const service = served.find((candidate) => candidate.network === 'mockup');
    const desk = deskFor(pageEnvironment(production, 'mockup'), 'http://127.0.0.1:8104/');
    expect(desk?.paryons).toBe(false);
    expect(desk?.template.names).toEqual(service?.template);
    expect(desk?.template.texts.template).toBe(service?.templateText);
    const { definition } = readTemplate(desk?.template.texts.template ?? '');
    expect((definition as { resources?: { name: string; url: string }[] }).resources?.map(({ name, url }) => [name, url])).toEqual([
      ['xo_service_v1', 'https://paryon.9500.cash/service/v1'],
      ['Loan page', 'https://paryon.9500.cash/'],
    ]);
  });

  it('on a chain of one\'s own on this machine: the same, with the page at http://localhost:8104/ and the service at http://localhost:8104/service/v1', () => {
    const { served } = servedNetworks(localRegtest);
    expect(served.map(({ network }) => network)).toEqual(['regtest']);
    const desk = deskFor(pageEnvironment(localRegtest, 'regtest'), 'http://localhost:9999/');
    expect(desk?.template.names).toEqual(served[0]?.template);
    expect(desk?.template.names).toEqual(paryonTemplateAlone(desk?.contracts as never, paryonAddressesAt('http://localhost:8104/')).names);
    expect(paryonAddressesAt('http://localhost:8104/').service).toBe('http://localhost:8104/service/v1');
  });

  it('where the configuration gives no "loanUrl", the template names the page where it is served from; with neither, the contracts are still there, and the template says what is missing', () => {
    const { loanUrl: _none, ...withoutUrl } = localRegtest;
    // The service serves no network without the page's address.
    expect(servedNetworks(withoutUrl).skipped).toEqual([{ network: 'regtest', reason: expect.stringMatching(/"loanUrl"/) as string }]);
    const fallback = deskFor(pageEnvironment(withoutUrl, 'regtest'), 'http://localhost:8104/');
    expect(fallback?.template.names).toEqual(served(localRegtest));
    const bare = deskFor(pageEnvironment(withoutUrl, 'regtest'));
    expect(bare?.contracts.deployment.name).toBe('mockup');
    expect(() => bare?.template).toThrow(/names Paryon's deployment mockup but not the loan page's address \("loanUrl"\)/);
  });
});
