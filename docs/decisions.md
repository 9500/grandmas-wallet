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

## D4 — Controller contract v1

**Date:** 15 Nov 2026 · **Status:** implemented and tested in the VM; not audited, not yet run on chipnet

Source: `contracts/controller.cash` (CashScript 0.14.0). Compiled size: 402 bytes, 196 opcodes, so the controller is a pay-to-script-hash (32-byte) output. The contract has no constructor parameters; every wallet shares the same bytecode and address, and is told apart by its identity token category.

**Rules that hold for every transition**

- The controller is input 0 and its successor is output 0.
- Transaction version is 2.
- The successor has the same locking bytecode, the same token category and capability (mutable), the same fungible amount, and at least the same BCH value.
- The state is 69 bytes with version `0x01`.
- The authorizing signature must use signing type `0x61` (all inputs, all outputs, all spent outputs). Other types are rejected even when the signature is otherwise valid.

**Transitions**

| Function | Signed by | From | Result |
| --- | --- | --- | --- |
| `ownerAuthorize` | owner | Active or Pending | Active; owner, recoverer, delay and epoch unchanged; claim cleared |
| `requestRecovery` | recoverer | Active only | Pending with the presented proposed owner; nothing else changes |
| `finalizeRecovery` | recoverer, after the relative delay | Pending only | Active; owner becomes the proposed owner; epoch + 1 |
| `ownerUpdate` | owner | Active or Pending | Active with the given owner, recoverer and delay; epoch + 1 only if the owner changed |

**Decisions taken**

- Combined authorize-and-cancel is included: `ownerAuthorize` on a Pending controller cancels the claim (proposal decision #4).
- A second claim on a Pending controller is rejected, including one naming the same proposed owner. A different destination requires the first claim to be cancelled or finalized first, which gives a fresh delay (C06).
- `ownerUpdate` validates the new delay on chain (only the BIP68 value and type flag, value not zero) and rejects zero key hashes.
- The duplicate-identity rule needs no output scan: with a mutable (non-minting) token and a fixed fungible amount, consensus rules already prevent a second token of the category from being created.

**Known limits**

- The initial state is not checked by the contract. A client must validate the genesis transaction (exactly one token output of the category, mutable, valid state, sent to the controller script) before trusting an identity. This validator is the next piece of client work.
- The VM tests check that the finalizing input carries a sequence number satisfying the delay. That the UTXO has really aged that long is enforced by nodes (BIP68) and will be exercised on chipnet.
- Any party can attach further inputs and outputs to a controller transaction. The signer's signature covers all of them.
- The epoch stops at 2^31-1 owner changes.

**Tests:** `packages/core/test/controller.test.ts` runs the compiled bytecode in the libauth 2026 VM with standardness rules on. Each rejection test first confirms the unmodified transaction is accepted, then applies one change. Covered acceptance tests at controller level: C01, C03, C04, C05, C06, C09, C10, C11, C12, C14, X02. C02, C07 and C08 need the asset and application contracts.

## D5 — Shared authorization interface v1, asset covenant and Savings Jar

**Date:** 15 Nov 2026 · **Status:** implemented and tested in the VM; not audited, not yet run on chipnet

Sources: `contracts/lib/authorization.cash` (the interface), `contracts/asset.cash` (87 bytes), `contracts/savingsJar.cash` (90 bytes).

**Interface v1.** A protected input is constructed with the wallet identity (the controller's token category) and requires all of:

1. Input 0 carries that identity's NFT with mutable capability.
2. The state in input 0 is 69 bytes with version `0x01`.
3. A public key that hashes to the owner recorded in that state, and a signature by it with signing type `0x61`.
4. Output 0 carries the same identity NFT, and its state equals the input state with the claim cleared: same epoch, owner, recoverer and delay, status Active.

Rule 4 is stricter than the implementation plan proposed ("same owner and epoch"): the recoverer and delay must be unchanged too. The only controller transitions that produce such a successor are an owner authorization and an owner update that changes nothing.

**Consequences**

- A recovery claim or completion can never share a transaction with a protected spend, whoever signs the protected input (C07, C08).
- Replacing the owner, recoverer or delay and spending protected outputs are separate transactions.
- Spending while a claim is pending works in one transaction and cancels the claim (C10).
- After recovery the old owner key fails on every protected output at once, and the new owner spends them where they are (C12).
- Each protected input carries its own owner public key and signature (about 100 bytes per input).

**Asset covenant.** One script per identity; holds BCH, fungible tokens or NFTs. It places no rule on outputs: the owner's signature covers them and the wallet chooses where change goes. It is a pay-to-script-hash (32-byte) output although the script would fit a bare script, because the wallet's receiving address must be expressible as a CashAddress that other wallets can pay.

**Savings Jar.** Parameters: identity and unlock time (block height or timestamp). Withdrawal needs the interface and a transaction locktime at or after the unlock time. Deposits are ordinary payments to the jar address; there is no separate top-up function. The unlock time is part of the script, so it must be preserved to find and spend the jar again — it is the first piece of data the restoration archive has to carry.

**Known limits**

- All of a wallet's assets sit at one address, so its balance and activity are publicly linked.
- Every protected spend consumes and recreates the controller, so a wallet's spends are sequential.
- Tokens or outputs sent to these addresses by others are spendable by the owner like any other; nothing here filters them.

**Tests:** `packages/core/test/protected.test.ts`. Rejection tests for the attacks check that the transaction fails at the protected input while the controller input on its own is satisfied, so the protection is shown to come from the interface and not from the controller. With these, the controller, asset covenant and Savings Jar pass C01–C12 and C14 in the VM, which meets the plan's first checkpoint (C03–C09). C13 concerns wallet behaviour on reorganizations and is not a contract test.

## D6 — Chipnet run of the contracts

**Date:** 15 Nov 2026 · **Status:** done once, on chipnet with one-minute blocks

The controller, asset covenant and Savings Jar were run through the full lifecycle on chipnet (`docs/chipnet-run.md`; results in `docs/chipnet-log.md`). Wallet identity `1819a56a9094983ba24ed3a85906c0c07261eac47e37b50454059a56481e656b`.

**Confirmed on the network**

- Every permitted transaction was accepted: genesis, owner payment, claim, cancellation, second claim, completion after the delay, payment and Savings Jar withdrawal by the replacement key.
- The three invalid attempts were refused by the node: a claim carrying a spend of wallet funds (script failure), completion immediately after the claim (`non-BIP68-final`), and a spend by the old owner key after recovery (script failure).
- The time-based relative delay is enforced by nodes. With a delay of one 512-second interval, the completing transaction was accepted about 11 minutes after the claim was sent: the interval itself plus the lag of the median block time.
- The Savings Jar's timestamp lock is enforced the same way: with a 5-minute lock, withdrawal was accepted about 12.5 minutes after the jar was created.

**Cost:** 60,000 satoshis in, 49,655 returned. Of the 10,345 difference, 1,000 remain in the controller output and 9,345 were fees for 14 transactions at 1 satoshi per byte. A controller transaction is roughly 700 to 1,000 bytes.

**Not covered by this run:** token and NFT transfers, owner updates, block-based delays, and behaviour across a chain reorganization.
