# Enrollment and restoration

How a recoverer is given what it needs once, how the wallet keeps restoration data current afterwards, and how a new device rebuilds the wallet from the two. This covers Milestone C of the [implementation plan](../IMPLEMENTATION_PLAN.md) and the proposal's sections 7, 9 and 10.

| Part | Where |
| --- | --- |
| Enrollment package, sealing, the recoverer's checks, confirmation of receipt | `packages/enrollment` |
| Restoration records, backup store clients, write-before-sign, restore | `packages/archive` |
| Backup store server | `apps/archive-store` |
| Reading a controller's history from the chain | `packages/core` (`readControllerHistory`) |

## What each party holds

| Party | Holds | Can do with it |
| --- | --- | --- |
| Owner's device | Owner mnemonic; archive key; its place in the chain of records | Spend; write records |
| Recoverer | Its own encryption key; after enrollment, the package | Open the package; read the archive; request and complete recovery |
| Backup store | Sealed blobs | Nothing but return them or fail to |
| Replacement device | A new owner key; the archive location and key, from the recoverer | Read the archive; after recovery, spend and write records |

The recovery credential is a mnemonic made for this purpose alone. It is unrelated to the owner's mnemonic and gives no power to spend. The archive key gives its holder a view of the wallet's recorded positions and nothing else.

## The enrollment package

One JSON document, signed with the owner key:

| Field | Purpose |
| --- | --- |
| `format`, `version`, `network` | Unambiguous parsing; a package for another network is refused |
| `identity`, `genesisTransactionId` | Which wallet, and the transaction that created it |
| `controller` | Versions of the recovery rules and of the owner-approval interface, the hash of this wallet's controller script, and a reference to the wallet template |
| `recovery` | The recovery mnemonic and how the recovery key follows from it |
| `archive` | Addresses of the backup stores, the archive identifier, and the key to read it |
| `manifest` | Positions that already exist when the package is made |
| `policy` | Owner key hash, recoverer key hash, challenge delay, who the package is for, and when it was made |

The wallet's ordinary funds need no entry: their address follows from the identity. Templates are referred to by hash; the full text is kept in the archive.

### Delivery

The signed package is encrypted to the recoverer's public encryption key with HPKE (RFC 9180, base mode: X25519, HKDF-SHA256, ChaCha20-Poly1305). The result goes into the part of a link after `#`, which a browser does not send to the server, or into a QR code. The owner needs nothing from the recoverer except that public key, and the recoverer can open the link at any later time.

Measured with two store addresses: the package is 1,233 bytes, the sealed envelope 1,618 bytes, and the link 2,189 characters. That fits a QR code, at a density that needs a good camera; a shorter encoding is possible and has not been done.

Someone who records the link learns nothing from it. The encryption does not say who made the package; the signature inside does.

### What the recoverer checks

Before keeping a package the recoverer:

1. verifies the signature and the format, version and network;
2. confirms the controller script hash matches the controller it knows for that identity;
3. reads the wallet's history from the chain, starting at the named creating transaction, and checks every step;
4. confirms the signer is an owner of that wallet, and reports whether it is the present one;
5. derives the recovery key and reports whether it is the wallet's recoverer now;
6. reports any difference between the stated policy and the chain.

### Confirmation of receipt

The recoverer leaves a note in the wallet's archive, signed with the recovery key and naming the exact package. Only someone who opened the package has that key. The owner's wallet shows "package created" until it finds a valid note, then "recoverer confirmed".

## The archive

### Records

A record describes one position: its kind, the parameters its script was built from, the script, the template it is used with, and anything else a restoring wallet must have. Each record also carries the network, the identity, its number in the sequence, the name of the record before it, and the owner epoch of its signer. Statuses are `prepared` (about to sign), `confirmed` (sent) and `closed` (spent by its owner).

Records are signed with the owner key and then encrypted with the archive key (XChaCha20-Poly1305). A blob is named by the SHA-256 of its encrypted bytes, so a store, or a reader without the key, can tell whether a blob is intact.

Reading and writing are separate powers. The recoverer can read every record but cannot add a valid one, because a record counts only if it is signed by the key that owned the wallet in the epoch the record names, as shown by the controller's history on chain.

### Write before sign

Before the wallet signs anything that creates a position, it writes a `prepared` record and waits for the stores to confirm they hold it. If they do not, the signature is not made. By default every configured store must confirm; the number is a setting. A record that could not be delivered is kept on the device and sent again before anything else is released, so the chain of records does not fork. A store that was unreachable is brought up to date later.

### Backup stores

A store keeps blobs under an archive identifier and returns them. It holds no keys. Its answer to a write is the blob's hash, which the wallet compares with its own. The server in `apps/archive-store` keeps blobs in a directory and limits their size and number.

Anyone who knows an archive identifier can add blobs to it. Such blobs are rejected on reading because they are not signed by an owner; a store that wanted to prevent the clutter would need write authorization, which is not built.

## Restoring

Given the identity, the archive location and key, the chain and the stores, restoring:

1. reads and checks the controller's history, which gives the owners by epoch and the current state;
2. fetches every blob from every store and keeps those whose content matches their name;
3. decrypts and verifies each record against the owner of its epoch;
4. orders the records, noting missing links and conflicts. Where two records follow the same one, the line written by the latest owner is followed, and the conflict is reported;
5. for each position of a known kind, rebuilds the script from the recorded parameters and the identity and requires it to equal the recorded script, then looks on chain: funds there now, never created, or spent;
6. looks up the wallet's ordinary funds;
7. walks every transaction the owner ever approved and lists outputs to script addresses that are still unspent and that no record describes.

The result is `complete` only if nothing is unresolved. Otherwise it lists why: a store unreachable or returning damaged data, rejected items, missing records, conflicting histories, positions that are incomplete (for example a missing template) or unsupported (an unknown kind, or a requirement the wallet cannot meet), entries of an unknown type, and undescribed outputs.

A record is a hint about where to look, never an instruction. A record cannot make the wallet treat an address as its own unless the address follows from the wallet's identity by the rules of a known kind.

### How the cases in the proposal come out

| Case | Outcome |
| --- | --- |
| R01 Observer records the link | Sees only the sealed envelope |
| R02 Package used after several new positions | All found through the archive; no new package |
| R03 Stores unavailable before a new position | The signature is not released |
| R04 Device lost after sending, before recording | The `prepared` record leads to the funds on chain |
| R05 Prepared transaction never sent | Reported as never created; not a position |
| R06 A store fails or returns damaged data | The other copy is used; the failure is reported; content not signed by an owner is rejected |
| R07 Old or conflicting archive | A position missing from an old copy shows up as an undescribed output; gaps and conflicts are reported; an earlier owner cannot override the new one |
| R08 Unknown kind, unmet requirement, missing template | Reported as unsupported or incomplete, with the reason |
| X04 Device loss | A new device with a new key takes over the wallet and a savings jar from the package and the archive |

All are automated tests (`packages/archive/test`, `packages/enrollment/test`, `apps/archive-store/test`, `test/device-loss.test.ts`). X04 is also a command for chipnet through the XO engine: `npm run xo-demo -- device-loss`.

## Limits

- **Freshness is anchored only where the chain allows.** A position the owner paid for from the wallet is in the controller's history, so its absence from the archive is noticed. A payment to a script address of someone else looks the same and is listed too; the report cannot tell them apart. A position funded entirely from outside the wallet leaves no trace in the controller's history, so a stale archive would hide it.
- **The old owner key can still write records for its own epoch.** They cannot displace the new owner's records, and are reported as a conflict when they follow the same record. They can add clutter.
- **The recovery mnemonic passes through the owner's device.** The device does not keep it after the package is made, but ordinary storage cannot promise erasure. A leaked credential allows a recovery request, which the owner can cancel during the delay; it does not allow spending.
- **The recoverer can read the archive.** That is part of the arrangement and must be said to the user.
- **Not built:** adding or replacing stores after enrollment, write authorization at the store, an archive checkpoint in the controller state, compression of the package.
