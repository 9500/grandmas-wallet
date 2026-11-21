import { readFileSync } from 'node:fs';

import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { readTemplate } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { CHIPNET_FAST_PERIODS_6, MAINNET_V1, paryonChipnetTemplateText, paryonContracts, paryonDeploymentOn, paryonMainnetTemplateText, paryonTemplateAlone } from '../src/index.js';

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

  it('is the deployment named for mainnet, and chipnet\'s for chipnet; none elsewhere', () => {
    expect(paryonDeploymentOn('mainnet')).toBe(MAINNET_V1);
    expect(paryonDeploymentOn('chipnet')).toBe(CHIPNET_FAST_PERIODS_6);
    expect(paryonDeploymentOn('testnet4')).toBeUndefined();
    expect(MAINNET_V1).toMatchObject({ network: 'mainnet', periodLengthBlocks: 144, timeLockRedemption: 12, startBlockHeight: 948_406 });
  });
});

describe('the frozen templates', () => {
  it('leaves chipnet\'s text and identifier as they were, and fixes mainnet\'s', () => {
    const chipnet = paryonTemplateAlone(paryonContracts(CHIPNET_FAST_PERIODS_6));
    const mainnet = paryonTemplateAlone(paryonContracts(MAINNET_V1));
    expect(chipnet.texts.template).toBe(paryonChipnetTemplateText);
    expect(chipnet.names.identifier).toBe('aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be');
    expect(chipnet.names.contentHash).toBe('99b19cdebc79ac9ece0dcd7773f0ce846ec2adabd27e763e781dfb75600aaf61');
    expect(mainnet.texts.template).toBe(paryonMainnetTemplateText);
    expect(mainnet.names.identifier).toBe('efa0e18915670a6d21a634821d4558a316a4191a219447f615523fde6a6143a5');
    expect(mainnet.names.contentHash).toBe('d30ac987f2b7c8862d763ffdba9175290051cabb68ec9a6ff78cbd6ed601a052');
    for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) {
      const text = readFileSync(new URL(`../frozen/paryon-loan-v1-${deployment.name}.json`, import.meta.url), 'utf8');
      expect(text).toBe(deployment === MAINNET_V1 ? paryonMainnetTemplateText : paryonChipnetTemplateText);
      // XO's validator (`parseTemplate`, through the wallet's reading of a template) takes both.
      expect(readTemplate(text).identifier).toBe(deployment === MAINNET_V1 ? 'efa0e18915670a6d21a634821d4558a316a4191a219447f615523fde6a6143a5' : 'aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be');
    }
  });

  it('differ only in the deployment\'s values: the same actions, transactions, inputs, outputs and unlocking scripts', () => {
    const chipnet = JSON.parse(paryonChipnetTemplateText) as Record<string, Record<string, unknown>>;
    const mainnet = JSON.parse(paryonMainnetTemplateText) as Record<string, Record<string, unknown>>;
    for (const part of ['actions', 'transactions', 'inputs', 'outputs', 'lockingScripts', 'variables', 'roles', 'start'] as const) expect(Object.keys(mainnet[part] ?? {})).toEqual(Object.keys(chipnet[part] ?? {}));
    expect(mainnet['actions']).toEqual(chipnet['actions']);
    expect(mainnet['transactions']).toEqual(chipnet['transactions']);
    expect(mainnet['variables']).toEqual(chipnet['variables']);
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
    for (const name of ['unlockWithoutArguments', 'unlockBorrow', 'unlockMovePeriod', 'unlockSharePrice', 'unlockManage', 'unlockRepay', 'originProofBytecode', 'loanBytecode', 'sidecarBytecode', 'manageBytecode']) expect(mainnetScripts[name]).toBe(chipnetScripts[name]);
    for (const name of ['borrowingBytecode', 'priceBytecode', 'loanKeyFactoryBytecode', 'originEnforcerBytecode']) expect(mainnetScripts[name]).not.toBe(chipnetScripts[name]);
    // Nothing in mainnet's text speaks of chipnet or of test coins.
    expect(paryonMainnetTemplateText).not.toMatch(/chipnet|test/i);
  });
});
