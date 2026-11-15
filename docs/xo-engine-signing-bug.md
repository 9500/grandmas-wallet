# Signatures covering all UTXOs are invalid for transactions with more than one input

**Package:** `@xo-cash/engine` 0.1.1-next.18029697917 (with `@xo-cash/crypto` 0.0.5, `@bitauth/libauth` 3.1.0-next.8)
**Network:** chipnet
**Found:** 15 November 2026

## Summary

An unlocking script that uses a signing type with `all_utxos`, such as `<key.schnorr_signature.all_outputs_all_utxos>`, produces a signature the network rejects whenever the transaction has two or more inputs. The standard templates are not affected because they use `all_outputs`.

## Cause

`prepareInputUnlockingCompilation` in `source/compilation/generate-unlocking-bytecode.ts` builds the compilation context with only the spent output of the input being signed:

```ts
const sourceOutputs: Output[] = [];
sourceOutputs[inputIndex] = sourceOutputCompatibleWithCompiler;
```

The signing serialization for `SIGHASH_UTXOS` hashes the spent outputs of every input. With the other entries missing, the signed message differs from the one nodes compute, so the signature does not verify. With one input the list is complete, which is why single-input transactions work.

## How it was confirmed

For a two-input transaction signed by the engine, the signed message was recomputed outside the engine with libauth (`generateSigningSerializationBch`) and checked against the engine's signature and public key:

| Spent outputs given to the serialization | Signature verifies |
| --- | --- |
| All inputs' spent outputs, as nodes use | no |
| Only the signed input's spent output, the rest left empty | **yes** |

This held for both inputs of the transaction. The covered bytecode (the redeem script) and the signing type byte (`0x61`) were correct in both cases.

## Steps to reproduce

1. Import a template with a pay-to-script-hash locking script whose unlocking script contains `<someKey.schnorr_signature.all_outputs_all_utxos>`.
2. Create an output locked by that script and wait for it to be listed as unspent.
3. Create an invitation that spends that output together with any second input, for example an output of the standard wallet template.
4. Call `signInvitation` for each own input, then `executeAction` with `broadcastTransaction: true`.

Result: `TransactionBroadcastFailedError`, with the node reporting `mandatory-script-verify-flag-failed`. Evaluating the transaction locally reports a failed signature check on the input that uses `all_utxos`.

Expected: the transaction is accepted.

## Suggested fix

Fill in the spent output of every input that has an outpoint before compiling. The existing `fetchDecodedTransactionOutput` helper can supply them:

```ts
const sourceOutputs: Output[] = [];

// A signature that covers all UTXOs needs the spent output of every input, not only this one.
for (const [otherInputIndex, otherInput] of mergedInvitation.inputs.entries()) {
    if (otherInputIndex === inputIndex) {
        continue;
    }

    if (otherInput.outpointTransactionHash === undefined || otherInput.outpointIndex === undefined) {
        continue;
    }

    sourceOutputs[otherInputIndex] = await fetchDecodedTransactionOutput(
        binToHex(otherInput.outpointTransactionHash),
        otherInput.outpointIndex,
    );
}

sourceOutputs[inputIndex] = sourceOutputCompatibleWithCompiler;
```

Two points to decide when applying it:

- **Inputs without an outpoint.** If another participant has not yet added an input's outpoint, an `all_utxos` signature cannot be computed correctly. The sketch above leaves such entries empty, which keeps today's behaviour; raising an error when the unlocking script uses an `all_utxos` signing type would be clearer.
- **Lookups.** The sketch fetches each spent output from the server. Outputs already in the account's store could be read from there first.

## Result of the fix

The change was applied to the published build (`dist/index.mjs`) and tested on chipnet with a template whose contracts accept only `all_outputs_all_utxos` signatures. RESULTS_PLACEHOLDER
