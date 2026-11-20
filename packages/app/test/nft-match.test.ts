import { describe, expect, it } from 'vitest';

import { matchNfts, nftCanBecome } from '../src/index.js';

/**
 * Which NFT of a transaction's inputs each NFT of its outputs is (section 13.3, "Fungible tokens and tokens that end"):
 * a contract that keeps its state in a mutable or minting NFT changes its commitment, and that NFT is carried on,
 * not destroyed; an NFT a minting NFT of its category can have made is not made from the wallet's coin.
 */

const nft = (category: string, capability: string, commitment = ''): { category: string; nft: { capability: string; commitment: string } } => ({ category, nft: { capability, commitment } });

describe('matching the NFTs of a transaction', () => {
  it('lets each NFT change only as its capability allows', () => {
    expect(nftCanBecome(nft('aa', 'minting', '01'), nft('aa', 'none', '02'))).toBe(true);
    expect(nftCanBecome(nft('aa', 'mutable', '01'), nft('aa', 'mutable', '02'))).toBe(true);
    expect(nftCanBecome(nft('aa', 'mutable', '01'), nft('aa', 'none', '02'))).toBe(true);
    expect(nftCanBecome(nft('aa', 'mutable', '01'), nft('aa', 'minting', '01'))).toBe(false);
    expect(nftCanBecome(nft('aa', 'none', '01'), nft('aa', 'none', '02'))).toBe(false);
    expect(nftCanBecome(nft('aa', 'minting'), nft('bb', 'minting'))).toBe(false);
  });

  it('carries on a contract\'s minting NFT whose commitment the action changes, as Paryon\'s borrowing contract when it is brought up to date', () => {
    const { notCarriedOn, notExplained } = matchNfts([nft('aa', 'minting', '01000000')], [nft('aa', 'minting', '31000000')]);
    expect(notCarriedOn).toEqual([]);
    expect(notExplained).toEqual([]);
  });

  it('keeps unchanged NFTs together first, and lets the least capable choose before a minting NFT can take its output', () => {
    const { notCarriedOn, notExplained } = matchNfts([nft('aa', 'minting', '01'), nft('aa', 'mutable', '07')], [nft('aa', 'mutable', '08'), nft('aa', 'minting', '02')]);
    expect(notCarriedOn).toEqual([]);
    expect(notExplained).toEqual([]);
  });

  it('leaves over an NFT nothing carries on, and one nothing brought', () => {
    const { notCarriedOn, notExplained } = matchNfts([nft('aa', 'none', '01')], [nft('bb', 'minting')]);
    expect(notCarriedOn).toEqual([nft('aa', 'none', '01')]);
    expect(notExplained).toEqual([nft('bb', 'minting')]);
  });
});
