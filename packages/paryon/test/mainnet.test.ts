import { readFileSync } from 'node:fs';

import { binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { readTemplate } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import {
  CHIPNET_FAST_PERIODS_6,
  MAINNET_V1,
  PARYON_ADDRESSES,
  PARYON_TEMPLATE_VERSION,
  paryonChipnetTemplateText,
  paryonChipnetTemplateTextV1,
  paryonChipnetTemplateTextV2,
  paryonChipnetTemplateTextV3,
  paryonContracts,
  paryonDeploymentOn,
  paryonMainnetTemplateText,
  paryonMainnetTemplateTextV1,
  paryonMainnetTemplateTextV2,
  paryonMainnetTemplateTextV3,
  paryonTemplateAlone,
} from '../src/index.js';

/**
 * Paryon's mainnet deployment as this project names it, and the template made for it. The addresses are those
 * Paryon's published parameters give and that held the deployment's live outputs on 21 November 2026.
 */

const address = (lockingBytecode: Uint8Array): string => {
  const encoded = lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix: 'bitcoincash', tokenSupport: true });
  if (typeof encoded === 'string') throw new Error(encoded);
  return encoded.address;
};

describe('Paryon\'s mainnet deployment, mainnet-v1', () => {
  it('gives the addresses of the Borrowing, price (guarded), loan key factory and manage contracts that hold its live outputs', () => {
    const contracts = paryonContracts(MAINNET_V1);
    expect(address(contracts.borrowing.lockingBytecode)).toBe('bitcoincash:rvszuucxz7fn4pthapvfk3xy8gxjhpvcm9yjt2przz44v5z2ax7v60vhxenkp');
    expect(address(contracts.price.lockingBytecode)).toBe('bitcoincash:rdws0e456rwhzuxahv5jduryn493prvjrmu6ksegq052m5g048jp2evf7rewu');
    expect(address(contracts.loanKeyFactory.lockingBytecode)).toBe('bitcoincash:rw2yket7tfmat5asn70y73aq7epw7lwxyj44hu22swqa9cp9ep0fcy6xjgkv9');
    expect(address(contracts.manage.lockingBytecode)).toBe('bitcoincash:rww8vdvl9g295z6cv3p957tgst80wgctlx8z8zrw90cyz6llgy00w4j75ux8k');
  });

  it('gives the interest function\'s address, where 25 of its coins were found on mainnet and on chipnet on 21 November 2026: the same script for every deployment', () => {
    const lockingBytecode = paryonContracts(MAINNET_V1).changeInterest.lockingBytecode;
    expect(binToHex(lockingBytecode)).toBe('aa20fe0a7b5263a30a0c27428c6ce226e9ee54b6df647647f1121afacc548ff6ec4a87');
    expect(binToHex(paryonContracts(CHIPNET_FAST_PERIODS_6).changeInterest.lockingBytecode)).toBe(binToHex(lockingBytecode));
  });

  it('is the deployment named for mainnet, and chipnet\'s for chipnet; none elsewhere', () => {
    expect(paryonDeploymentOn('mainnet')).toBe(MAINNET_V1);
    expect(paryonDeploymentOn('chipnet')).toBe(CHIPNET_FAST_PERIODS_6);
    expect(paryonDeploymentOn('testnet4')).toBeUndefined();
    expect(MAINNET_V1).toMatchObject({ network: 'mainnet', periodLengthBlocks: 144, timeLockRedemption: 12, startBlockHeight: 948_406 });
  });
});

describe('the frozen templates', () => {
  const IDENTIFIERS = {
    1: { chipnet: ['aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be', '99b19cdebc79ac9ece0dcd7773f0ce846ec2adabd27e763e781dfb75600aaf61'], mainnet: ['efa0e18915670a6d21a634821d4558a316a4191a219447f615523fde6a6143a5', 'd30ac987f2b7c8862d763ffdba9175290051cabb68ec9a6ff78cbd6ed601a052'] },
    2: { chipnet: ['3fa4baf9f313ee2a5046ae30fdf1f7affc6aca21a29e3f6b38227b4a826e9235', '5736521d3b57ba550dba51625018d76182183f5302418747a0fbe1f982ab01ef'], mainnet: ['30647ea4b817c4e58b32fb4fc104643af9c1e92295729b33d5551dc875569364', '68e9bc50ff7d64ba72c5498ce595f01e39ffa7c13f67cb0b0fd95717ea0ca5c1'] },
    3: { chipnet: ['160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20', 'f7cdfbc37a81b71dd879bc3c07756151501aea5bfce0f5c51e7147c18d66deab'], mainnet: ['89b1af236ace2e5544f28f286a830186dc742597ddb9a7e7e3a205ad1b48092a', '6b671ec1e9df62b4e3e9f6f8d723effa4bcc69e28e4fe859f7f1cc04dea75b7b'] },
  } as const;
  const TEXTS = {
    1: { chipnet: paryonChipnetTemplateTextV1, mainnet: paryonMainnetTemplateTextV1 },
    2: { chipnet: paryonChipnetTemplateTextV2, mainnet: paryonMainnetTemplateTextV2 },
    3: { chipnet: paryonChipnetTemplateTextV3, mainnet: paryonMainnetTemplateTextV3 },
  } as const;

  it('the names without a version mean version 3', () => {
    expect(PARYON_TEMPLATE_VERSION).toBe(3);
    expect(paryonChipnetTemplateText).toBe(paryonChipnetTemplateTextV3);
    expect(paryonMainnetTemplateText).toBe(paryonMainnetTemplateTextV3);
  });

  it('makes version 3 unless another is named, with Paryon\'s own addresses for its own deployments, and fixes its texts and identifiers', () => {
    for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) {
      const which = deployment === MAINNET_V1 ? 'mainnet' : 'chipnet';
      for (const made of [paryonTemplateAlone(paryonContracts(deployment)), paryonTemplateAlone(paryonContracts(deployment), 3, PARYON_ADDRESSES), paryonTemplateAlone(paryonContracts(deployment), PARYON_ADDRESSES)]) {
        expect(made.texts.template).toBe(TEXTS[3][which]);
        expect([made.names.identifier, made.names.contentHash]).toEqual(IDENTIFIERS[3][which]);
        expect((JSON.parse(made.texts.template) as { version: string }).version).toBe('3');
      }
    }
  });

  it('asks for the addresses of the service and the page of a deployment that is not Paryon\'s own', () => {
    const own = { ...CHIPNET_FAST_PERIODS_6, name: 'local' };
    expect(() => paryonTemplateAlone(paryonContracts(own))).toThrow(/give their addresses/);
    const addresses = { service: 'http://127.0.0.1:18610/service/v1', page: 'http://127.0.0.1:18610/' };
    const made = paryonTemplateAlone(paryonContracts(own), addresses);
    expect(made).toEqual(paryonTemplateAlone(paryonContracts(own), 3, addresses));
    expect(made.texts.template).toContain(addresses.service);
  });

  it('leaves version 1 of chipnet and mainnet as frozen, text and identifier, reachable only by a name that says so', () => {
    const chipnet = paryonTemplateAlone(paryonContracts(CHIPNET_FAST_PERIODS_6), 1);
    const mainnet = paryonTemplateAlone(paryonContracts(MAINNET_V1), 1);
    expect(chipnet.texts.template).toBe(paryonChipnetTemplateTextV1);
    expect(chipnet.names.identifier).toBe('aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be');
    expect(chipnet.names.contentHash).toBe('99b19cdebc79ac9ece0dcd7773f0ce846ec2adabd27e763e781dfb75600aaf61');
    expect(mainnet.texts.template).toBe(paryonMainnetTemplateTextV1);
    expect(mainnet.names.identifier).toBe('efa0e18915670a6d21a634821d4558a316a4191a219447f615523fde6a6143a5');
    expect(mainnet.names.contentHash).toBe('d30ac987f2b7c8862d763ffdba9175290051cabb68ec9a6ff78cbd6ed601a052');
  });

  it('makes version 2 when it is named, from the same source, and fixes its texts and identifiers', () => {
    for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) {
      const which = deployment === MAINNET_V1 ? 'mainnet' : 'chipnet';
      const made = paryonTemplateAlone(paryonContracts(deployment), 2);
      expect(made.texts.template).toBe(TEXTS[2][which]);
      expect([made.names.identifier, made.names.contentHash]).toEqual(IDENTIFIERS[2][which]);
      expect((JSON.parse(made.texts.template) as { version: string }).version).toBe('2');
      expect((JSON.parse(TEXTS[1][which]) as { version: string }).version).toBe('1');
    }
  });

  it('are the files in frozen/, one for each version and deployment, which XO\'s validator takes', () => {
    for (const version of [1, 2, 3] as const) {
      for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) {
        const which = deployment === MAINNET_V1 ? 'mainnet' : 'chipnet';
        const text = readFileSync(new URL(`../frozen/paryon-loan-v${version}-${deployment.name}.json`, import.meta.url), 'utf8');
        expect(text).toBe(TEXTS[version][which]);
        // XO's validator (`parseTemplate`, through the wallet's reading of a template) takes each.
        const read = readTemplate(text);
        expect([read.identifier, read.contentHash]).toEqual(IDENTIFIERS[version][which]);
      }
    }
  });

  for (const version of [1, 2, 3] as const) {
    it(`version ${version}: chipnet's and mainnet's differ only in the deployment's values: the same actions, transactions, inputs, outputs and unlocking scripts`, () => {
      const chipnetText = TEXTS[version].chipnet;
      const mainnetText = TEXTS[version].mainnet;
      const chipnet = JSON.parse(chipnetText) as Record<string, Record<string, unknown>>;
      const mainnet = JSON.parse(mainnetText) as Record<string, Record<string, unknown>>;
      for (const part of ['actions', 'transactions', 'inputs', 'outputs', 'lockingScripts', 'variables', 'roles', 'start', 'resources'] as const) expect(Object.keys(mainnet[part] ?? {})).toEqual(Object.keys(chipnet[part] ?? {}));
      expect(mainnet['actions']).toEqual(chipnet['actions']);
      expect(mainnet['transactions']).toEqual(chipnet['transactions']);
      expect(mainnet['variables']).toEqual(chipnet['variables']);
      expect(mainnet['start']).toEqual(chipnet['start']);
      expect(mainnet['resources']).toEqual(chipnet['resources']);
      expect(mainnet['lockingScripts']).toEqual(chipnet['lockingScripts']);
      const swap = (text: string): string =>
        text
          .replaceAll(CHIPNET_FAST_PERIODS_6.tokenIds.paryon, MAINNET_V1.tokenIds.paryon)
          .replaceAll(CHIPNET_FAST_PERIODS_6.tokenIds.loanKeyFactory, MAINNET_V1.tokenIds.loanKeyFactory)
          .replaceAll(CHIPNET_FAST_PERIODS_6.protocolFeeLockingBytecode, MAINNET_V1.protocolFeeLockingBytecode)
          .replaceAll(CHIPNET_FAST_PERIODS_6.name, MAINNET_V1.name);
      expect(JSON.parse(swap(JSON.stringify(chipnet['outputs'])))).toEqual(mainnet['outputs']);
      expect(JSON.parse(swap(JSON.stringify(chipnet['constants'])))).toEqual(mainnet['constants']);
      // The unlocking scripts are the same; of the contracts' scripts, those without parameters are too.
      const chipnetScripts = chipnet['scripts'] as Record<string, string>;
      const mainnetScripts = mainnet['scripts'] as Record<string, string>;
      const same = ['unlockWithoutArguments', 'unlockBorrow', 'unlockMovePeriod', 'unlockSharePrice', 'unlockManage', 'unlockRepay', 'originProofBytecode', 'loanBytecode', 'sidecarBytecode', 'manageBytecode', ...(version >= 2 ? ['unlockChangeInterest', 'changeInterestBytecode'] : [])];
      for (const name of same) expect(mainnetScripts[name]).toBe(chipnetScripts[name]);
      for (const name of ['borrowingBytecode', 'priceBytecode', 'loanKeyFactoryBytecode', 'originEnforcerBytecode']) expect(mainnetScripts[name]).not.toBe(chipnetScripts[name]);
      // Nothing in mainnet's text speaks of chipnet or of test coins.
      expect(mainnetText).not.toMatch(/chipnet|test/i);
    });
  }
});
