# Idea: a viewing secret and a log on chain, in place of the recovery kit

Status: an idea under discussion, written down on 18 November 2026. Nothing here is implemented or decided, except where a line says so. The design in force is `Grandmas_Wallet_Architecture_Proposal_v0.4.md`; this note proposes a change to its sections 9, 10 and 11.

## 1. The problem

After a recovery, the new phone has a new seed and knows nothing of the old one. To find and sweep the coins at the earlier seeds' addresses it needs each earlier seed's **viewing key**: the extended public keys of the two address branches and a 32-byte blinding seed (proposal section 7.6). A viewing key finds coins and cannot spend them.

Today the recoverer holds these in the **recovery kit** (proposal section 9.4, `packages/enrollment/src/kit.ts`):

| Part of the kit | Secret | Grows |
| --- | --- | --- |
| Identity, creating transaction, rule versions, the policy as the owner saw it | No: on chain or derivable | No |
| Where the backup stores are, and the access to them | Yes | With each new archive |
| One viewing-key record for every seed the wallet has had | Yes | With each recovery and each move to a new phone |

What follows from that:

- The kit is a document of variable size. It cannot be written down as twelve words.
- It has to be kept current: after every move to a new seed the wallet sends the recoverer an update (section 9.7), and the recoverer answers with a signed receipt, which is how the wallet knows it may say "Protected".
- The recoverer needs a place to keep it and a key to decrypt it. Today that is a key in the recoverer page's browser storage. Losing that browser's data loses every kit.

The last point blocks the direction the owner wants for recoverers (section 6 below): a friend who uses an ordinary wallet over plain WizardConnect has no way to decrypt or store anything for us.

## 2. The idea

Separate the secret from the data.

1. **A viewing secret of fixed size.** At enrollment the phone makes a random 128-bit secret. That is what twelve words encode. It gives no power to spend.
2. **A log on chain.** Each seed's viewing-key record is encrypted with the viewing secret and written into a data output of the controller transaction that brings that seed in: the creation, a move to a new seed, the first transaction of a new owner after a recovery.
3. **Recovery needs three things:** the wallet's identity, the viewing secret, and the chain. The new phone walks the controller's history from the identity, decrypts each record, and has every viewing key the wallet ever had.

The recoverer keeps a constant twelve words for each wallet, however often the wallet moves.

### What a record holds

| Field | Bytes |
| --- | --- |
| Public key and chain code of the branch for addresses given out | 65 |
| Public key and chain code of the change branch | 65 |
| Blinding seed | 32 |
| Authentication tag | 16 |
| Total | about 178, plus a few bytes of framing |

The nonce need not be stored: it can be derived from something unique and public, such as the identity and the epoch number in the controller's state. The network and the address-scheme version are known from the controller.

A smaller record is possible if the blinding seed is derived from the viewing secret and the epoch, leaving the two branches (130 bytes and the tag). Whether that is wise is an open question (section 7).

## 3. Two variants

### 3.1 A fixed secret

The viewing secret never changes. This is the simplest form: one secret opens every record, past and future.

The cost: anyone who once learned the secret can watch the wallet's balances for good. In particular, whoever holds the lost phone after a recovery, if they can unlock it. They cannot spend from the new seed's addresses. Today a recovered wallet's new addresses are invisible to the old phone, so this would be a loss of privacy.

### 3.2 A secret that changes at a recovery (recommended in the discussion)

- At a recovery, the new phone picks a new viewing secret. It writes the previous secret on chain, encrypted with the new one, beside its own viewing-key record. The newest secret therefore opens the whole history backwards, and an older secret opens nothing newer.
- The recoverer stores the new secret. It takes part in every recovery, so this adds no step for it.
- A move to a new phone that the owner makes themselves keeps the same secret: the owner holds both phones and no stranger is involved.

The recoverer still holds exactly one secret of fixed size per wallet.

How the new phone learns the previous secret, and how the recoverer learns the new one, has to be designed: both travel between the new phone and the recoverer during the takeover, where today the request and the hand-over travel (section 11.1).

## 4. What this would remove

- **The kit as a document.** What passes to the recoverer at enrollment is the viewing secret.
- **Update messages to the recoverer** after a move to a new seed (section 9.7).
- **Receipts.** The wallet can read its own record back from the chain. "Protected" would mean: the chain names the recoverer, and the wallet's record is on chain.
- **The backup stores as something recovery depends on** (section 10.1). They would still hold what is convenient and not essential: templates, labels, application notes. Whether their access record also goes into the log is open.

## 5. Costs and limits

- **Fees.** Each transaction that brings in a seed carries about 200 more bytes.
- **The records are public for good.** Their secrecy rests on the viewing secret alone. A leaked secret exposes every balance and payment of the wallet, never the coins. With the fixed variant this includes the future; with the changing variant, up to the next recovery.
- **The viewing secret is essential.** If the phone is lost and the recoverer's copy of the secret is lost too, the recoverer can still move the wallet to a new owner, and the new owner cannot find the coins. This is the same as losing the kit today, with a smaller thing to lose.
- **A reader of the chain sees that a wallet uses this scheme,** and how many seeds it has had. The controller is readable on purpose already (section 16.2).

## 6. Where the idea came from, and what it has to serve

The owner wants two ways to get a recoverer, both with as little for the wallet's user to do as possible. This was discussed on 18 November 2026 and is not designed in detail.

- **A bank.** The user scans an activation code from the bank and has a wallet with a small starting balance. The bank creates the wallet on chain and pays for it; the user sees nothing of the enrollment. For the demonstration the bank is an open page that anyone can run: it asks to be funded and issues codes.
- **A friend or family member** who uses an ordinary wallet (Cashonize first; Selene to be tried by the owner later) and connects it to a recoverer page over plain WizardConnect, with no extension. They fund the first transaction. The recoverer does not use Grandma's Wallet.

Decided by the owner in that discussion:

- The recoverer's authority should be a **token**, not a key, and it should be done in one change, not a badge now and authority later.
- Plain WizardConnect, without an extension.
- Cashonize is the wallet to make work first.

Why this matters for the kit: plain WizardConnect offers one request, signing a transaction. The wallet shares public keys and returns signatures; there is no message signing and no decryption (checked against the protocol description at docs.riftenlabs.com/wizardconnect/protocol). So a friend's wallet cannot open a sealed kit. With a viewing secret of fixed size the problem becomes "where do twelve words live", which has answers:

| Who | Where the viewing secret lives |
| --- | --- |
| A bank | A field in the customer's record. |
| A friend, simplest | The friend writes the twelve words down or saves them, once. With the fixed variant they never change; with the changing variant, at a recovery. |
| A friend, nothing to keep | The recoverer page asks the friend's wallet to sign a fixed transaction that can never be sent, derives a key from the signature, and stores the viewing secret wrapped with that key, for example in the commitment of the recoverer's own token. This works only if the wallet signs the same thing the same way every time. Untested. |

The last two can exist together: the wrapped copy for convenience, the written words as a fallback.

## 7. Open questions

1. **Does a record fit in one data output** under the network's current relay rules? Not checked. If it does not, it could be split, or the record made smaller (section 2).
2. **Fixed or changing secret?** The discussion leaned to the changing one. With it, the steps of a takeover that carry the old and the new secret need designing, and with them what happens when a takeover is abandoned half way.
3. **Who makes the first record?** If the recoverer creates the wallet on chain from the phone's request, the phone has to give it the encrypted record to include, or write it in a transaction of its own right after.
4. **Should the contract require the record?** The controller could refuse an owner change without a data output. That costs bytes in every controller transaction and cannot check that the record is right. The alternative is that the wallet writes it and checks it.
5. **Moves the owner makes themselves** (section 9.7): the record of the new seed goes into the move's own transaction. What if the device stops between the move and the record, should they ever be two transactions?
6. **Deriving the blinding seed from the viewing secret** would shorten the record and tie the two together. Is there a reason to keep them independent? One: with the changing variant, the blinding seed of an earlier seed must not change when the secret does.
7. **Wallets created before this change.** They hold kits and receipts. Do they stay as they are, or move to the log at their next owner change?
8. **What else, if anything, belongs in the log?** The access to the backup stores; the rule versions.
9. **Deterministic signatures** in Cashonize and Selene, for the "nothing to keep" way of section 6.
10. **A user's own backup** (section 18.1) lists the earlier viewing-key records in its "complete" form. With the log, the twelve words of the seed, the identity and the viewing secret would be a complete backup of fixed size.

## 8. What would change in the code, roughly

Not a plan; a first reading of where the kit and the receipts reach.

- `packages/enrollment`: the kit (`kit.ts`), the hand-over and takeover (`recoverer.ts`), update messages (`messages.ts`).
- `packages/archive`: viewing-key records (`viewing-key.ts`) and receipts (`receipt.ts`).
- `packages/app`: the recovery flow (`recovery-flow.ts`), what the wallet says about its protection (`protection.ts`), the user's backup (`user-backup.ts`), the transactions that bring in a seed (`owner-wallet.ts`).
- `packages/core`: reading a controller's history would also return the data outputs beside each step.
- The recoverer page and the wallet's set-up, takeover and move screens, which the new ways of enrolling would rewrite in any case.
- The proposal's sections 9, 10.1, 10.6, 11, 16.5, 17 and 18.1, their tests in section 21, and the design page `docs/design_v0.5.html`.

A token as the recoverer's authority is a separate change to the controller contract (`contracts/controller.cash`): the two recoverer actions would check that the transaction spends the recoverer's token, in place of a key and a signature. The state's layout can stay, with the hash of the token's category where the hash of the recoverer's key is now. It is mentioned here because the two changes meet in the recoverer page.
