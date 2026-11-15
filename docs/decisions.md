# Decisions log

Protocol and tooling decisions, newest last. Each entry records what was decided, on what evidence, and what it affects.

## D1 — Controller state is stored unhashed in the NFT commitment

**Date:** 15 Nov 2026 · **Status:** decided

The controller state (69 bytes) is stored directly in the identity NFT's commitment, so that asset and application contracts can read the current owner from the controller input.

**Evidence**

- CHIP-2024-12 P2S: "The limit on maximum length of token commitments is raised from 40 bytes to 128 bytes." Active on chipnet since Nov 2025 and on mainnet since 15 May 2026.
- Checked in the libauth `BCH_2026_05` virtual machine with standardness enabled: a 69-byte and a 128-byte commitment are accepted, 129 bytes is rejected, and 69 bytes is rejected under the 2025 rules (`packages/core/test/commitment-limit.test.ts`).

**Consequence:** the hashed-state fallback from the implementation plan is not needed. 59 bytes remain free for later fields.

## D2 — Controller state layout v1

**Date:** 15 Nov 2026 · **Status:** decided for the prototype

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 1 | format / authorization-interface version (`0x01`) |
| 1 | 1 | status: `0x00` Active, `0x01` Pending |
| 2 | 4 | owner epoch, little-endian, 0 to 2^31-1 |
| 6 | 20 | owner public key hash (hash160) |
| 26 | 20 | recoverer public key hash (hash160) |
| 46 | 3 | challenge delay as a BIP68 relative locktime, little-endian |
| 49 | 20 | proposed owner public key hash; all zero when Active |

- Integers are fixed-width little-endian with the top bit clear, so contracts can read them with `OP_BIN2NUM`.
- The delay keeps only the BIP68 value (low 16 bits) and the type flag (bit 22). Blocks: 1 to 65,535. Time: 1 to 65,535 units of 512 seconds (about 388 days).
- A reader checks the version byte first and rejects anything other than `0x01`.
- Zero key hashes are invalid. Active with a non-zero proposed owner, and Pending with a zero one, are invalid.

## D3 — Pinned dependency set

**Date:** 15 Nov 2026 · **Status:** decided, recheck before each milestone

Use the versions the XO web dev wallet pins, so invitations produced here load in the debug tool:

| Package | Version |
| --- | --- |
| `@bitauth/libauth` | 3.1.0-next.8 |
| `@xo-cash/engine` | 0.1.1-next.18029697917 |
| `@xo-cash/state` | 0.0.5 |
| `@xo-cash/templates` | 0.0.12 |
| `@xo-cash/types` | 0.0.8 |
| `@xo-cash/utils` | 0.0.10 |
| `@xo-cash/crypto` | 0.0.5 |
| `@xo-cash/primitives` | 0.0.3 |
| `@electrum-cash/web-socket` | 4.2.0 |

Only libauth is installed so far; each XO package is added, at the version above, by the first workspace that uses it.
