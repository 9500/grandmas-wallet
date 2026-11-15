# Grandma’s Wallet

**Architecture proposal v0.1 — BCH Blaze 2026**  
**Date:** 15 November 2026  
**Status:** Design proposal for implementation and review. No controller contract, XO extension, or connection adapter described here has yet been implemented or audited as part of this project.

This document consolidates the agreed product direction and proposes an implementation baseline. “Required” describes a property the implementation must achieve; it does not imply that the property has already been demonstrated. Names of proposed actions, fields, profiles, and messages are illustrative until a formal schema is agreed.

## 1. Purpose and central design

Grandma’s Wallet is a Bitcoin Cash wallet that can recover access after the user loses their phone without requiring the user to create or maintain backups manually. A trusted recoverer—called the **bank** in this document—can be a business, family member, or friend.

The user controls the wallet independently during normal operation. The bank receives a separate recovery capability. To exercise it, the bank must create an on-chain recovery claim and wait through a challenge period. The existing wallet can cancel that claim. After an uncontested delay, the bank can replace the wallet’s owner key with a key generated on the user’s replacement device.

Assets and compatible application positions recognize a **stable wallet identity** rather than a permanently fixed owner key. Recovery updates the authority behind that identity. It need not withdraw compatible application positions or move every asset to new outputs.

XO templates describe the controller, its actions, and compatible application interactions. Proposed restoration extensions preserve the information needed to find and operate those contracts. A connection adapter carries XO requests over WizardConnect, with WalletConnect as an optional additional transport.

The intended experience is:

> Set up recovery once, use the wallet normally, and ask the trusted recoverer for help if the phone is lost. The wallet maintains the necessary restoration data automatically.

The precise recovery promise is narrower than “recover every possible application”:

> Given the current enrollment package, available restoration data, an available authorized recoverer, and a functioning blockchain, a replacement compatible wallet can recover control of assets and application positions that use a supported recovery authorization interface.

The bank is trusted to select the correct replacement owner **once recovery becomes eligible**. The blockchain does not establish whether a phone is actually lost. An active wallet must detect a claim and get a valid cancellation confirmed with sufficient margin before recovery becomes eligible.

## 2. Requirements and decisions

| Area | Requirement or decision |
| --- | --- |
| User custody | Owner spending keys are generated locally. Normal spending does not need the bank. |
| Recovery authority | The bank cannot gain spending authority through its recovery credential before the on-chain challenge condition is satisfied. |
| Loss detection | Absence of a successful challenge is the observable condition. Actual loss cannot be proven. |
| Destination | The replacement owner may be chosen when recovery is requested; it is not fixed at enrollment. |
| User backups | No routine manual backup work. The wallet preserves necessary data automatically. |
| Enrollment | Prefer one-way delivery of a compact recovery package from user to bank. No mutual xpub exchange is required for recovery. |
| Public observation | Observing the enrollment exchange must not reveal usable recovery secrets. This requires an authenticated recipient encryption key or an appropriately protected delivery channel. |
| Wallet identity | A persistent on-chain identity survives owner-key changes. |
| Asset support | BCH, fungible CashTokens, and NFTs are in scope. Application positions require compatible authorization and restoration support. |
| Application connections | Prefer WizardConnect. Support normal application-oriented confirmation screens rather than exposing invitation mechanics. |
| Extensibility | Versioned recovery schemes, authorization interfaces, restoration formats, and connection capabilities. |
| Optional self-backup | Owner mnemonic backup remains possible, accompanied by the descriptors required for this wallet. |
| Dropped constraints | Ordinary P2PKH outputs and restoration in unmodified standard wallets are not requirements. |
| Rejected alternative | Off-chain recovery of the original spending seed through recovery services or hardware enclaves is not part of this design. |

“No xpub exchange” concerns recovery enrollment. An independently chosen application connection protocol may have its own public-key disclosure requirements; those must be negotiated separately.

## 3. Participants and trust

**Owner wallet.** Holds the owner seed, monitors the controller, approves transactions, and maintains restoration data. A compromised owner wallet can authorize loss; recovery is not protection against malware already able to use the owner key.

**Bank.** Holds the enrollment package and recovery credential. It may monitor the wallet and pays for recovery transactions. It cannot bypass the challenge period through the intended contract interface, but after an uncontested period it can select a replacement owner it controls. Preventing that is outside the agreed trust model.

**Replacement wallet.** Generates a fresh owner key locally, restores records, validates the controller, and takes over following confirmed recovery. It does not reconstruct the original owner seed.

**Backup stores.** Preserve encrypted records. They do not authorize recovery or receive the owner’s spending keys. Their availability matters: encryption does not prevent deletion or withholding.

**Applications.** Supply templates, action requests, quotes, and position information. Their declarations and labels are untrusted until validated against supported templates, scripts, and wallet policy.

**Network services.** Provide transactions, history, and broadcast access. The wallet must validate what it can and avoid depending on a single notification endpoint for recovery monitoring. An indexer can help locate state but cannot redefine valid controller transitions.

## 4. Architecture

| Component | Responsibility |
| --- | --- |
| Recovery controller | Maintains identity, owner authority, recovery policy, and pending claim state. |
| Wallet asset contracts | Hold BCH or CashTokens and require valid authorization through the controller. |
| Compatible application contracts | Preserve application-specific rules while recognizing the shared wallet authority. |
| XO engine and templates | Construct and validate actions, coordinate invitations, and track relevant outputs. |
| Restoration subsystem | Preserve templates and instance records; discover and reconstruct positions. |
| Connection adapter | Translate application requests into XO engine operations. |
| Owner interface and monitor | Present effects, obtain authorization, watch claims, and initiate cancellations. |
| Bank interface | Import enrollment packages, request recovery, track maturity, and finalize. |

CashTokens documents identity tokens and covenant-tracking tokens as building blocks for persistent identities and interoperating contracts. CashScript’s modular-contract documentation demonstrates cooperation between inputs in the same transaction. These are relevant foundations, not an implementation of this recovery protocol. [S1, S2]

### 4.1 Stable identity and controller UTXO

The proposed baseline uses a uniquely identified tracking NFT carried by a controller UTXO. The wallet identity is anchored to the verified creation of that token, not to the latest transaction ID or an address that changes with state.

Initialization must establish exactly one controller identity and leave no capability that can mint duplicate identity NFTs. Every permitted transition must preserve the required identity, commitment rules, and successor covenant. An NFT category is not automatically a unique identity merely because the wallet calls it one; its issuance and covenant continuity must be validated.

State can be encoded in contract parameters, an NFT commitment, or a commitment to canonical state supplied during spending. The exact encoding, size limits, and validation bytecode are implementation decisions. State committed by a hash must have its necessary preimage preserved.

The controller carries a small BCH value sufficient to maintain its output. Ordinary asset balances live in separate outputs. This prevents recovery setup from requiring a rewrite of the entire portfolio.

### 4.2 No implicit global-state reads

BCH contracts validate the transaction spending their inputs. They do not automatically read an arbitrary, current controller UTXO elsewhere on-chain.

The baseline therefore **spends and recreates the controller in every transaction that uses controller-based owner authorization**. Asset and application inputs inspect the same transaction, authenticate the controller input, and check the required authorization. Several actions can share one controller transition in a transaction where their contracts permit composition.

Receiving funds does not necessarily spend the controller: an incoming output can name the stable identity for its later spending rule.

This creates a serialization point for owner-authorized transactions. Conflicting actions must be queued, rebuilt, or batched. Delegated authority and parallel controllers are possible future work, but they require their own revocation and recovery design; they are not assumed to be safe automatically.

## 5. Controller state machine

The conceptual state contains:

- Network and controller-format identifiers.
- Stable identity anchor and authorization-interface version.
- Current owner public key or policy commitment.
- Recovery public key or recovery-policy commitment.
- Challenge-period encoding.
- Owner epoch, incremented on an owner change.
- State revision, incremented on each controller transition.
- Optional pending claim: claim identifier, proposed owner, and any committed completion parameters.

The initial scheme uses one owner and one recoverer. Threshold or multi-guardian policies are possible later schemes, not implicit behavior of v0.1.

| Action | Starting state | Required authority | Result |
| --- | --- | --- | --- |
| Initialize | No controller | Initial owner, with issuance validation | Active controller |
| Owner authorize | Active | Current owner | Active successor; authorized asset/application action |
| Request recovery | Active | Current recoverer | Pending controller bound to a proposed new owner |
| Cancel recovery | Pending | Current owner | Active successor; pending claim removed |
| Owner authorize and cancel | Pending | Current owner | Active successor; claim cancelled and an owner action performed |
| Finalize recovery | Pending | Recoverer plus satisfied relative delay | Active successor with proposed owner installed |
| Update recovery policy | Active or Pending | Current owner | Updated policy; any pending claim invalidated |
| Owner-initiated key rotation | Active or Pending | Current owner | New owner epoch; pending claim invalidated |

The combined owner-authorize-and-cancel action is a proposed convenience. It must satisfy both transition rules. A minimal implementation may initially require cancellation and subsequent spending as separate transactions, with that UX limitation stated.

### 5.1 Requesting recovery

The bank may request recovery without proving prior inactivity. The enforced delay begins with the new pending controller output. This distinction is intentional: protection comes from the challenge period, not from a claim that the blockchain can detect phone loss.

The request must:

- Authenticate the authorized recovery credential.
- Preserve the current owner and recovery policy.
- Bind the proposed replacement owner and claim identifier.
- Preserve controller continuity and its required value.
- Grant no authority to spend protected assets or exercise application-owner rights.

While pending, the recoverer must not be able to change the proposed owner, shorten the delay, or churn the pending controller through arbitrary successor outputs. A changed destination requires a fresh, valid claim with a fresh delay. Exact claim-replacement and cancellation rules must be specified in bytecode, not just in the client.

### 5.2 Challenge timing

A relative timelock applies to the **pending controller input**, not to the age of a wallet balance, a timestamp supplied by the bank, or the age of the original wallet.

For production, a time-based relative delay is preferable when the policy is expressed in days, because a fixed number of blocks changes its expected duration if block intervals change. Such delays use consensus time rules and quantization, not the phone’s wall clock. The implementation must encode the sequence type, magnitude, transaction version, and script condition consistently. [S3, S4]

The currently reviewed CashScript documentation exposes the relative-age constraint as `this.age` and notes a limitation in its SDK helper for time-based sequence values. This must be checked against the pinned implementation version; direct transaction construction may be necessary. A short block-based delay is acceptable for the Chipnet demonstration, clearly labelled as a test configuration. [S3]

The production challenge length is an open product decision. Examples such as 30 days are illustrative, not an established safe default.

### 5.3 Cancellation and finalization

The existing wallet signs a cancellation or an owner action that explicitly cancels the claim. Spending the pending controller invalidates a finalization transaction referring to that output.

The owner does not receive special transaction priority at the deadline. Once recovery is eligible, cancellation and finalization can race until one valid spend wins. The operational objective is confirmed cancellation well before eligibility, with allowance for confirmation uncertainty and reorganizations.

Finalization installs exactly the replacement owner committed by the pending claim, clears the claim, and increments the owner epoch. Protected application positions remain in place. The replacement owner uses them in subsequent authorized transactions.

The baseline does not rely on using the new owner’s authority in the same transaction that installs it. Separating those steps simplifies authorization checks and prevents ambiguous mixed recovery/application actions.

After recovery, the wallet should review and, where appropriate, rotate recovery and archive credentials. The original package remains the stable bootstrap during an enrollment’s lifetime; changing the recoverer or its credentials may require an updated package. A stronger promise that one immutable package survives every future policy change is not made.

## 6. Shared authorization interface

The central integration rule is:

> The presence of the controller’s identity token in a transaction is insufficient evidence of owner authorization.

The recoverer can spend the controller to start a claim. If an application treats any controller spend as full authority, the bank could attach an application withdrawal to the claim transaction and bypass the challenge period.

For the proposed baseline, a protected asset or application input must authenticate the controller identity and state, verify an allowed owner-authorizing transition, and require a valid current-owner signature bound to the transaction. The exact method of extracting and validating owner state must be specified and tested. Controller and application checks must agree on a canonical interface.

The controller also validates its own transition. These are complementary checks: neither an application-supplied branch label nor a token’s mere presence is sufficient.

Required properties include:

1. Claims and finalizations cannot masquerade as ordinary owner actions.
2. A fabricated NFT, wrong category, stale controller reference, or substituted state cannot authorize spending.
3. Authorizations bind the relevant transaction, network context, and state; signatures must not permit unapproved output substitution.
4. All relevant token fields and recipient outputs remain subject to the application’s own rules.
5. Recovery does not bypass liquidation, vesting, repayment, or other economic conditions.
6. Unsupported interface versions fail explicitly rather than falling back to token-presence authorization.

The implementation must prove these properties against combined transactions, not merely test each recovery action in isolation.

## 7. Enrollment and the initial package

### 7.1 Key separation

Use separate cryptographic material for:

- Owner spending authority.
- Bank recovery authority.
- Confidentiality of restoration metadata.
- Authentication of archive updates and connection sessions, as required.

The owner wallet generates an independent recovery credential for the bank. It must not be an owner xprv or a derivation that lets the bank reconstruct owner spending keys. The owner’s ability to generate this credential is acceptable because the owner already has full authority.

The wallet should minimize retention of the exported recovery secret after successful enrollment. It must not assume ordinary device storage provides perfect erasure. Compromise of that credential permits claims and delayed recovery, not immediate owner authorization.

### 7.2 One-way, publicly observable delivery

The owner first obtains an authenticated bank encryption public key through a known contact, trusted directory, or other established channel. This is an encryption key, not an HD wallet xpub.

The owner can then encrypt a self-contained enrollment envelope to the bank and send it once. A construction such as HPKE is a candidate; the exact suite and sender-authentication binding require a specification and interoperability tests. [S5]

Public delivery with no prior authenticated recipient key and no protected channel cannot also conceal a bearer recovery secret from observers. A raw secret in a QR or URL is not made confidential by its encoding. Transport links must avoid exposing plaintext credentials to application logs, analytics, or preview services.

The initial on-chain action needs only the owner. The bank can import the package asynchronously. A bank acknowledgment is desirable for verifying delivery and retention, but it need not be a prerequisite for constructing the controller. The UI must distinguish “package created” from “recoverer has confirmed receipt.”

### 7.3 Package contents

| Field group | Purpose |
| --- | --- |
| Format and network identifiers | Prevent ambiguous parsing and cross-network mistakes |
| Controller identity and creation anchor | Locate and authenticate the wallet |
| Exact controller template reference and bootstrap description | Reconstruct the initial controller and follow its successors |
| Recovery scheme and authorization-interface versions | Select compatible implementation behavior |
| Bank recovery credential | Authorize claims and eligible finalization |
| Archive locator and read/decryption capability | Retrieve records created after enrollment |
| Initial restoration manifest | Bootstrap restoration without an undiscoverable dependency |
| Authenticated policy description | Bind expected delay, recoverer, and owner enrollment context |

A compact QR can carry the encrypted bootstrap envelope or a secure reference to it. Full templates and the growing archive need not fit into one QR. Size targets must be measured with the chosen encoding and encryption overhead.

The package can expose wallet history to the recoverer through its metadata-reading capability. That privacy consequence must be explained; secrecy from a passive observer does not imply secrecy from the chosen bank.

## 8. Normal wallet and application operation

Incoming BCH and CashTokens are received into supported asset contracts tied to the stable identity. A normal outgoing transaction co-spends the controller and affected asset inputs, proves owner authorization, preserves controller continuity, and sends change back to a supported recoverable policy.

The owner does not periodically sweep the whole balance to reset per-output recovery timers. Background work primarily monitors the controller and preserves data. Blockchain writes are required for ordinary actions and when a claim must be cancelled.

Applications can interact with this wallet in different ways:

| Application design | Expected recovery behavior |
| --- | --- |
| Uses the shared controller authorization interface | Owner rotation can preserve positions without withdrawing them |
| Uses a transferable ownership NFT | May work by protecting that NFT; exact spending semantics must be reviewed |
| Requires the original owner’s fixed public key | Not generically recoverable through a replacement key |
| Requires a separate secret only stored on the phone | Not complete unless that secret has an appropriate preservation/recovery design |
| Uses XO templates but fixed-key authorization | Templates alone do not make it recoverable |

Cauldron’s documented pool withdrawal path requires the creator’s public key and signature. Existing pool contracts therefore do not acquire controller-based recovery merely because a wallet or template wraps their interface. Ordinary swaps are a separate integration task: protected inputs and outputs can be composed where the transaction builder and contracts permit it. [S6]

Moria’s documented transferable loan NFTs illustrate a potentially useful ownership model. Holding such an NFT under an owner-authorized asset covenant may preserve recoverability, but compatibility must be established against the exact contract version. [S7]

For the prototype, use a purpose-built application position with the shared interface. Do not advertise complete Cauldron LP recovery until a compatible pool contract or another independently validated integration exists.

## 9. Automatic backups and restoration

### 9.1 One initial package, evolving restoration data

The initial package can remain the only item the bank manually retains during an enrollment. It cannot contain information that future application interactions have not yet created.

The wallet therefore maintains an encrypted restoration archive. Its stable bootstrap information lets the bank retrieve newer records without receiving a new package after every transaction. This is automatic data backup, not off-chain custody or delayed release of the owner seed.

Two independent conditions determine whether a position is recoverable:

1. **Authority:** its contracts permit the recovered wallet identity to act.
2. **Information:** the data required to discover and operate the position remains available.

Backing up all metadata cannot repair a fixed-key authorization restriction. A perfect recovery contract cannot reconstruct missing off-chain data.

### 9.2 Template-level restoration description

A proposed XO restoration profile would declare:

- Discovery rules and supported indexer queries or chain-scanning strategies.
- Which values are derived, obtained from the chain, or preserved externally.
- Exact script, template, and dependency requirements.
- Role bindings and supported authorization-interface versions.
- Continuation actions, including exits where the application provides them.
- The security significance and permitted recipients of retained fields.
- Required engine capabilities and schema versions.

This profile is a proposed extension. Templates must be reviewed and tested; an arbitrary application cannot make itself safe by setting a “recoverable” flag. Unknown critical requirements must prevent the wallet from promising full recovery.

### 9.3 Position-level restoration records

Each instantiated position needs its own record. A proposed record contains:

| Group | Contents |
| --- | --- |
| Identity | Record version, network, wallet identity, logical position identifier |
| Template | Exact template content hash, complete template, required dependencies and execution format |
| Instance | Parameters, reconstructed locking/redeem scripts, public role bindings, relevant derivation metadata |
| Discovery | Creation anchors where known, script identifiers, tracking-token identifiers, successor rules, scan starting information |
| Authorization | Controller reference, supported interface, role mapping, owner epoch context |
| Non-chain data | Necessary invitation contributions and other explicitly classified information |
| Integrity | Record identifier, prior-record reference, revision, author signature, and encryption envelope |

Store sufficient material to recreate scripts exactly. Source code alone may depend on compiler behavior; record compiled artifacts and the relevant toolchain versions where needed. Template hashes provide integrity, not availability. Preserve complete templates rather than assuming a registry or application URL will exist forever.

The archive should not blindly copy every field from the local database. Temporary reservations, expired connection credentials, display caches, and secrets need different treatment from indispensable restoration data.

### 9.4 Data classification and keys

| Data class | Treatment |
| --- | --- |
| Public, reconstructible chain data | Cache optionally; revalidate against the chain |
| Private reconstruction metadata | Encrypt for authorized restoration readers; no independent spending power |
| Recovery credential | Restrict to the enrollment workflow and recoverer’s custody |
| Owner spending seed | Never include in the bank-readable restoration archive |
| Application secret with independent spending power | Requires a separate compatible design; do not share as ordinary metadata |
| Connection/session secrets | Separate scope and lifecycle; not wallet recovery authority |

The metadata encryption key must be recoverable independently of the lost owner seed. The bank may know that key from enrollment. This grants visibility into retained metadata but must not grant immediate control of funds.

Shared decryption capability is not sufficient to authenticate archive writes: a reader who knows a symmetric key might otherwise forge records. Records require separate authorization checks, such as signatures validated against the wallet’s owner history. After recovery, the replacement owner signs new records under the new epoch. A malicious or stale record must not redirect funds or override confirmed controller state.

If a future application requires a secret preimage that by itself authorizes withdrawal, making that preimage bank-readable would bypass recovery protection. Such an application is unsupported under the baseline until it has a safe preservation and authorization design.

### 9.5 Preserve data before funds depend on it

Before the wallet publishes a new receiving address or releases a signature enabling a new position, it must persist the indispensable restoration record to the configured stores and obtain the required acknowledgments.

This is a write-before-sign or write-before-address-publication rule. Backing up only after broadcast leaves a loss window.

Records can initially describe a prepared action and its discoverable output scripts. The final transaction ID is appended when known. Restoration must tolerate a phone disappearing after broadcast but before that final update. Conversely, prepared records for transactions that never occur must not be mistaken for live positions.

If another participant changes required data, the wallet updates the prepared record before signing the new proposal. Unsolicited outputs whose complete descriptors are unavailable cannot automatically receive a full-restoration guarantee.

Store failures should pause actions that would create unrecoverable dependencies. A deliberately selected override, if offered later, must clearly withdraw the recovery promise for the affected action; it is not part of the default grandma experience.

### 9.6 Availability, discovery, and freshness

Use multiple storage locations with a portable format and export path. Providers receive encrypted records and need not have custody authority. Replication reduces failure risk but does not prove permanent availability.

The initial package must bootstrap archive discovery without relying on information held only in the archive it is trying to find. Signed updates can add new endpoints while preserving a reachable transition from earlier bootstrap records.

Maintain append-only records or an authenticated revision graph. Detect conflicting histories and do not silently select a server’s “latest” claim. A controller commitment to an archive checkpoint can improve freshness verification, but:

- The committed bytes still have to be available.
- A hash does not enumerate missing positions by itself.
- Not every incoming payment updates the controller.
- A complete policy for checkpoint creation and prepared records is required before claiming completeness.

Indexers and stored hints locate candidates. Restoration verifies those candidates against actual scripts, token identity, transactions, and controller continuity. A stable wallet identity alone does not make every external contract mentioning that identity trivially discoverable.

### 9.7 Optional on-chain archive profile

Some applications may be fully reconstructible from the initial package and blockchain if every required value is safely derivable or published in a discoverable form. Encrypted restoration records could also be placed on-chain.

That is a separate profile with cost, privacy, indexing, and historical-data availability implications. It is still preservation of additional data, even if no separate backup service is used. The baseline permits off-chain encrypted archives rather than imposing this restriction on every application.

## 10. Complete recovery procedure

1. **Open the enrollment package.** The bank decrypts it with its own enrollment key and validates its format, network, and controller anchor.
2. **Locate current state.** Follow the controller’s verified history, checking that the bank’s credential is still authorized. Recover known archive revisions and identify missing data early.
3. **Prepare the replacement device.** The device generates a fresh owner key locally. The bank verifies the user and the proposed key through its chosen operational process.
4. **Preserve replacement bootstrap data.** Record the proposed recovery and any newly required restoration information before publishing the claim.
5. **Request recovery.** Spend the active controller into its pending state with the proposed owner and valid recovery authentication.
6. **Wait and monitor.** Compute eligibility from the chain. Do not interpret a disconnected connection session, local timer, or server acknowledgment as confirmation. Stop if the claim is cancelled, invalidated, or reorganized away.
7. **Finalize.** After the consensus delay is satisfied, submit a valid finalization bound to that exact pending controller and proposed owner.
8. **Verify takeover.** The replacement wallet checks the confirmed owner epoch and rejects records that conflict with the new state.
9. **Restore usable positions.** Rebuild discovery, templates, scripts, and continuation actions; report any missing or unsupported positions explicitly.
10. **Resume protection.** Start monitoring on the replacement device, replenish any fee reserve, and review recovery enrollment and archive access.

The bank may transfer restoration metadata to the replacement device or grant it archive access. It need not know the replacement owner’s private key. It does have the agreed ability to nominate a different owner after an uncontested delay, so correct identification of the user remains a bank responsibility.

If the original device was stolen, its old owner key must fail against the recovered controller after finalization. That does not revoke authority in unrelated fixed-key contracts or outputs outside the supported wallet architecture.

## 11. XO integration

### 11.1 Current foundations

XO’s reviewed guide describes templates, roles, actions, signed invitation contributions, and tracking of relevant scripts. Invitations can be serialized and delivered through an application-chosen transport. Exact template content is identified by its hash. [S8]

The reviewed types and state APIs provide tracked variables/secrets and storage for templates, invitations, and script-related information. The documented `RemoteEncryptedStateManager` is marked not implemented. These APIs are useful starting points, not evidence that the restoration subsystem proposed here already exists. [S9, S10]

### 11.2 Recovery template

Represent the controller’s owner and recoverer as roles. Define the state-machine transitions as actions, with follow-up actions appropriate to each state. The initialization action must not require the bank to join synchronously.

The controller template defines transaction construction and client interpretation. The underlying scripts enforce the recovery restrictions. The template must preserve enough information for a fresh compatible engine to recreate valid actions.

Public recovery-key parameters can be supplied during initialization, but importing the corresponding private capability into another account is a separate enrollment feature. Existing account/key derivation behavior must be examined before assuming a generated secret can simply be attached to an arbitrary role.

### 11.3 Proposed engine extensions

- Versioned restoration descriptions and instance records.
- Explicit separation of bank-readable metadata from immediate spending secrets.
- Secure export/import of the recoverer capability.
- Restore an existing controller identity into a wallet with a new owner seed.
- Reliable archive persistence before signatures or receive-address publication.
- Generic discovery and reconstruction of supported positions.
- Capability checks for authorization interfaces, restoration profiles, and schemes.
- Consistent state restoration after crashes, conflicting invitation updates, or reorganizations.

These require coordinated changes to schemas, validation, storage, and engine behavior. Adding undocumented JSON properties to a template is not sufficient; the reviewed XO validator rejects unknown properties. [S11]

### 11.4 Limits of generic support

A compatible template can teach an engine how to construct a new kind of application action within its supported primitives. It cannot manufacture missing data, create a signature for a lost key, or grant authority absent from an existing contract.

Application continuation without the original website is a design objective. It depends on preserving the exact template, instance data, necessary dependencies, and a compatible execution environment. It does not imply reproducing the original website’s complete interface or unrelated off-chain service.

## 12. WizardConnect and WalletConnect

An XO invitation represents an action under construction. A connection session can carry many actions. Production interfaces should hide invitation mechanics behind application-oriented requests and confirmations.

The proposed flow is:

1. Connect and negotiate supported protocols, networks, schema versions, and permissions.
2. The application requests an action or supplies an invitation already started by another participant.
3. The wallet validates the template and parameters, creates or joins the invitation, and supplies permitted public data.
4. The adapter exchanges updates automatically; the wallet chooses funds and enforces change and recovery policy.
5. The wallet presents concrete effects for approval.
6. Required restoration data is durably preserved before signatures are released.
7. The transaction is completed and its result returned; outputs and positions are tracked.

WizardConnect documents a base handshake, negotiated application protocols, and optional custom-message extensions to `hdwalletv1`. A dedicated XO protocol or an XO extension could use those mechanisms. Neither is claimed to be an existing standard. WalletConnect’s negotiated methods and session requests offer another possible adapter. [S12, S13, S14]

Conceptual operations are “request XO action,” “submit invitation,” “update invitation,” and “report action result.” Exact message names, account representations, limits, and authentication bindings remain to be specified.

The adapter must address request correlation, replay handling, cancellation, reconnects, conflicting updates, payload limits, errors, and privacy permissions. Receiving public invitation information is not permission to sign. A template’s display text or hash must not substitute for verification of actual transaction effects.

Connection timeouts and the on-chain recovery delay are independent. A recovery claim must remain discoverable and actionable after the original session expires; the wallet must not keep a transport request open for an entire challenge period.

Legacy raw signing requests may be supported separately, but they do not automatically carry XO restoration information or accommodate controller-based funding. Existing Cauldron connectivity does not become recovery-compatible simply because WizardConnect is present. There must be a supported application integration or a validated translation for that transaction type.

## 13. User experience and background operation

The owner interface should present “Set up recovery,” “Recovery enabled,” “Recovery request detected,” and “Cancel recovery.” The bank interface should present the user’s enrolled wallet, the proposed replacement owner, claim status, chain-derived eligibility, and finalization controls.

Do not expose template IDs, invitation commits, role selection, or manual input construction as routine user tasks. Advanced diagnostics remain available for developers and recovery troubleshooting.

Ordinary operation must monitor controller state, maintain archives, and report whether protection is operational. The fact that a phone is powered on or used for another app is not evidence that its wallet has successfully monitored the chain. Production background scheduling and notifications require platform-specific validation.

An operational wallet can automatically cancel unexpected claims. A legitimate recovery must account for the case where an old device is still online and continues cancelling: an accessible old wallet can authorize a direct owner-key rotation or explicitly participate in the migration. The software must not silently disable cancellation merely because an unauthenticated message says recovery is legitimate.

Maintain access to cancellation fees. The bank funds its claim/finalization costs; the controller must not permit it to drain the controller reserve as transaction fees. Owner cancellation may use owner-authorized asset inputs or a deliberately funded reserve. An ordinary nonrecoverable fee pocket, if introduced, must be disclosed and excluded from the complete-recovery promise.

Repeated malicious claims can create cost and contention even if they cannot immediately steal. Owner-authorized removal or replacement of an abusive recoverer is necessary. Bonds, rate limits, or delegated watchtowers are future options that need their own security design. No unrestricted owner key is given to a watchtower in the baseline.

## 14. Optional mnemonic backup and extensibility

The owner can retain a mnemonic as an additional recovery method. For this contract wallet, the mnemonic may still need the controller descriptor, template data, and application archive. Standard-wallet restoration is not promised. If a future deterministic bootstrap lets a mnemonic locate all required records, that must be specified and tested rather than assumed.

A mnemonic for an old owner key does not override a completed owner rotation. A recovered device starts from a new owner seed and the persistent wallet identity.

Version these layers separately:

| Layer | What changes |
| --- | --- |
| Recovery scheme | Who can initiate recovery, challenge rules, and completion conditions |
| Authorization interface | How protected contracts verify current authority |
| Enrollment envelope | Credential delivery, encryption suites, and bootstrap fields |
| Restoration profile | Data classification, record schema, discovery, and continuation |
| Connection protocol | Message transport, capabilities, and request lifecycle |
| XO template | Exact action and script descriptions identified by content |

Changes require owner authorization where they affect control. Unknown critical versions are rejected. Old positions retain their exact template references; importing a newer template must not silently reinterpret or rederive keys for existing positions.

Pluggability means a common outer format and capability negotiation can accommodate new schemes. It does not mean already-deployed immutable contracts accept arbitrary new recovery code. Some changes require a compatible controller upgrade; others require migration of affected assets or positions. The first implementation should have a deliberately bounded upgrade policy rather than unrestricted script replacement.

## 15. Security and operational boundaries

| Scenario | Required behavior or limitation |
| --- | --- |
| Bank attempts early finalization | Consensus validation rejects it |
| Bank combines claim with an application withdrawal | Application authorization rejects it |
| Owner confirms cancellation in time | Original pending output is spent; its recovery attempt becomes invalid |
| Owner is offline beyond the challenge period | Bank may recover even if the device was never physically lost |
| Owner seed is compromised | Attacker has owner powers; this scheme is not a substitute for device security |
| Bank credential is compromised | Attacker can initiate claims; functioning monitoring must challenge them |
| Metadata reader or store is compromised | No immediate spending capability is exposed; privacy and availability can still be affected |
| All copies of indispensable metadata disappear | Affected positions may become unusable despite intact on-chain authority |
| Provider serves an authentic old archive | Wallet detects what it can from revision history/checkpoints and reports uncertainty; freshness is not inferred from a valid signature alone |
| Controller identity is duplicated or detached | Initialization/transition validation rejects the construction |
| Network isolation hides a claim | An operational phone may still fail to challenge; notification availability is part of the threat model |
| Original application website disappears | Preserved supported templates and records allow continuation; external economic services may still be unavailable |
| Original phone returns after recovery | Its old key has no authority over the recovered controller; unrelated legacy positions are unaffected |
| Application liquidates or expires a position | Recovery restores remaining rights, not an earlier economic state |

A shared controller also links activity and may reduce financial privacy. Separate identities for different contexts are possible, but the recovery package and archive must then preserve the full authorized set. Privacy improvements must not silently weaken discovery or revocation.

## 16. Implementation approach and current ecosystem status

Use XO’s current TypeScript ecosystem for the first integration. Libauth is a natural candidate for transaction construction and script validation; CashScript can be evaluated for contract authoring where its compiled behavior and transaction helpers fit. This proposal does not assume that CashScript artifacts are directly interchangeable with XO templates. Any Rust component using **libauth-rs** needs a separate capability and version assessment.

The architectural baseline uses signatures, transaction introspection, CashTokens, covenants, and relative timelocks. It does not require a future block-time change or assume that newer script functions and loops automatically solve recovery. Compiled size, execution cost, transaction limits, and standardness must be measured for the selected scripts and network.

| Item | Status established during this discussion |
| --- | --- |
| XO template/engine concepts | Available; APIs are evolving [S8–S11] |
| XO Web Dev Wallet | Available at blaze.xo.cash for development [S15] |
| Reliable restoration archive described here | Proposed work; not established by the current storage API |
| Secure recoverer role import | Proposed integration; needs implementation investigation |
| XO over WizardConnect/WalletConnect | Proposed adapters; no ready-made adapter verified |
| Shared recovery authorization interface | Proposed contract interface; must be implemented and tested |
| Existing Cauldron pool recovery | Not provided by this design without further contract integration |

The reviewed XO engine and utilities declare MIT. The reviewed web-dev-wallet repository had no root license file, no README license statement, and no package license declaration. Confirm its license before incorporating its code; an independently built interface can use appropriately licensed components. Recheck all pinned dependencies at implementation time. [S11, S15, S16]

WizardConnect’s documentation declares LGPL-3.0-or-later. Account for the actual license obligations when selecting and distributing the integration. [S17]

## 17. Hackathon implementation scope

The first deliverable should prove the recovery and authorization properties before attempting a complete production mobile wallet.

### Milestone A — Contract proof

- Implement a controller with owner, recoverer, and a short Chipnet challenge period.
- Implement a BCH asset covenant and CashToken-preserving variants as needed.
- Implement one demonstrator application position using the same authorization interface.
- Validate owner actions, claims, cancellation, recovery, and combined-transaction attacks.

### Milestone B — XO workflow

- Express the controller and demonstration position as XO templates.
- Demonstrate owner and bank roles using separate test accounts/environments.
- Preserve exact templates and the minimum reconstruction records.
- Complete a recovery without withdrawing the application position.

### Milestone C — Restoration proof

- Implement one-way encrypted enrollment to a known bank public key.
- Implement a portable archive format and write-before-sign/address-publication behavior.
- Use two independent archive locations in the demonstration if feasible.
- Erase the original local wallet state and restore using the bank package and a fresh owner seed.

### Milestone D — Normal application experience

- Implement one negotiated WizardConnect XO request path.
- Show an application action and meaningful wallet confirmation.
- Hide invitation mechanics while keeping developer inspection available.

WalletConnect support, existing DEX migration, mobile background hardening, production recovery delays, delegated cancellation, and broad template compatibility are subsequent work. They should not obscure a failed core recovery invariant.

The official XO bounty accepts demonstrations using Chipnet invitations and follow-up actions. It also requires personally written developer feedback; this architecture proposal is not a substitute for that submission component. [S18]

## 18. Acceptance tests

These are required tests for an eventual implementation, not results already obtained for this proposal.

| ID | Test | Expected result |
| --- | --- | --- |
| C01 | Owner spends protected BCH without bank involvement | Succeeds |
| C02 | Owner transfers fungible tokens and NFTs | Preserves intended token fields and recoverable change |
| C03 | Bank finalizes immediately after a claim | Rejected |
| C04 | Bank alters sequence/version or other delay-critical fields | Cannot bypass the delay |
| C05 | Owner cancels a pending claim | Old finalization fails because its input is spent |
| C06 | Bank changes the pending destination without a fresh delay | Rejected |
| C07 | Bank combines claim with protected asset/app withdrawal | Rejected |
| C08 | Bank combines finalization with an unapproved owner-authorized action | Rejected by the baseline interface |
| C09 | Fake/duplicate identity, wrong commitment, or detached successor | Rejected |
| C10 | Owner authorizes spending while recovery is pending | Cancels and spends through the supported flow; does not need bank consent |
| C11 | Delay matures and recovery finalizes | Only the committed replacement owner is installed |
| C12 | Old owner signs after confirmed recovery | Rejected for controller-protected positions |
| C13 | Claim/cancel transactions are reorganized or conflict | Wallet rebuilds status and does not report premature finality |
| C14 | Bank tries to consume controller value as fees | Violates preservation rules and is rejected |
| R01 | Passive observer records enrollment link/QR | Cannot obtain recovery or metadata-reading credentials |
| R02 | Initial package is used after several new applications | Retrieves later restoration records without new manual packages |
| R03 | Backup unavailable before a new dependency is created | Wallet refuses to release the enabling signature/address by default |
| R04 | Crash after broadcast, before recording final txid | Prepared record permits discovery and restoration |
| R05 | Prepared transaction never broadcasts | Record does not create a phantom live position |
| R06 | One archive provider fails or corrupts data | Other preserved copy works; invalid content is rejected |
| R07 | Old or conflicting archive history is supplied | Detected where anchored; unresolved completeness is reported |
| R08 | Required secret or template dependency is missing | Explicit unsupported/incomplete result, never silent omission |
| X01 | Original application website is unavailable | Supported position remains operable through preserved XO data |
| X02 | Unknown schema/interface version is received | Explicit refusal or supported migration; no unsafe fallback |
| X03 | Connection request is replayed or session reconnects | No duplicate approval or unintended second transaction |
| X04 | Full device-loss demonstration | Fresh compatible wallet restores control with the bank package and available archive |

The decisive end-to-end demonstration is:

> Create a wallet and one compatible application position; preserve their records; remove the original local wallet state and application website; restore using the bank’s initial package and a new owner key; wait through the challenge; finalize; operate the same application position without first withdrawing it.

A separate adversarial demonstration must show that the bank cannot perform that application action during the pending period.

## 19. Decisions to resolve before freezing a protocol specification

1. Exact identity issuance, controller state encoding, and successor-validation bytecode.
2. Canonical shared-authorization interface and signature binding across composed inputs.
3. Challenge units, production duration, confirmation policy, and cancellation timing margins.
4. Whether combined owner-authorize-and-cancel is included in the first contract version.
5. Controller fee preservation, external fee funding, and mitigation of repeated claims.
6. XO key derivation and the mechanism for importing an independent recoverer capability.
7. Enrollment encryption suite, bank public-key authentication, package size, and acknowledgment UX.
8. Archive discovery, update authentication, retention acknowledgments, checkpoints, and completeness detection.
9. Post-recovery and recoverer-replacement credential rotation, including how enrollment packages are renewed.
10. WizardConnect extension versus a separate negotiated XO application protocol.
11. Review and distribution model for trusted templates and unknown template versions.
12. Mobile scheduling and monitoring behavior required before making a production protection claim.

Resolving these is part of implementation, not evidence that the high-level design is already a finished protocol. The first engineering checkpoint is a compiled controller and demonstrator application that pass C03–C09, because those tests establish the essential delayed-authority boundary.

## 20. Primary references

Sources were reviewed during the design discussion through 15 November 2026. They establish existing primitives and interfaces; the architecture, extensions, field groups, and acceptance criteria above are this project’s proposal. Package versions and documentation may change before implementation.

- **S1 — CashTokens usage examples:** identity tokens, covenant tracking, and composability. https://cashtokens.org/docs/spec/examples/
- **S2 — CashScript modular contracts:** transaction-based cooperation and role-token patterns. https://cashscript.org/docs/design/modular
- **S3 — CashScript global variables:** relative timelocks and transaction-builder caveats. https://cashscript.org/docs/language/globals
- **S4 — Relative locktime specifications:** https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki and https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki
- **S5 — RFC 9180, Hybrid Public Key Encryption:** candidate enrollment-envelope foundation. https://www.rfc-editor.org/rfc/rfc9180.html
- **S6 — Cauldron whitepaper:** pool operation and withdrawal authorization. https://docs.riftenlabs.com/cauldron/whitepaper/
- **S7 — Moria general documentation:** transferable loan ownership NFTs. https://docs.riftenlabs.com/moria/general/
- **S8 — XO getting started:** templates, roles, invitations, script tracking, and application-chosen transport. https://stack.xo.cash/getting-started.html
- **S9 — XO type definitions:** https://stack.xo.cash/api/@xo-cash/types.html
- **S10 — XO state API:** https://stack.xo.cash/api/@xo-cash/state.html
- **S11 — XO utilities:** validation behavior and license declaration. https://www.npmjs.com/package/@xo-cash/utils
- **S12 — WizardConnect protocol:** https://docs.riftenlabs.com/wizardconnect/protocol/
- **S13 — WizardConnect extensions:** https://docs.riftenlabs.com/wizardconnect/extensions/
- **S14 — WalletConnect session namespaces:** https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces
- **S15 — XO Web Dev Wallet:** https://blaze.xo.cash/ and https://gitlab.com/GeneralProtocols/xo/xo-web-devtool ; reviewed package declaration: https://gitlab.com/GeneralProtocols/xo/xo-web-devtool/-/blob/development/package.json
- **S16 — XO engine package:** https://www.npmjs.com/package/@xo-cash/engine
- **S17 — WizardConnect overview and license:** https://docs.riftenlabs.com/wizardconnect/
- **S18 — BCH Blaze Build with XO bounty:** https://bchblaze.cash/bounties/build-with-xo/
