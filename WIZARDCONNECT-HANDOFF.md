# Passage: WizardConnect Chipnet funding handoff

2026-11-19 UTC. Implemented and tested locally. **No real wallet was paired, no chain transaction was sent, no HTLC was funded and no swap was completed.**

## Official API and architecture check

Checked the [official dapp integration](https://docs.riftenlabs.com/wizardconnect/dapp/), [HD protocol](https://docs.riftenlabs.com/wizardconnect/protocol/), [public-key derivation](https://docs.riftenlabs.com/wizardconnect/pubkey-derivation/) and [wallet integration](https://docs.riftenlabs.com/wizardconnect/wallet/) documentation, then inspected the actual published package declarations and JavaScript. npm reported current versions `@wizardconnect/core` 0.2.11 and `@wizardconnect/dapp` 0.2.8; both are pinned in this project.

The integration uses `initiateDappRelay`, `DappConnectionManager`, `walletready`, `getPubkey`, explicit HD `inputPaths`, `signTransaction` with `broadcast:false`, AbortSignal cancellation and session teardown. The public HD session carries named xpubs rather than an authenticated selected-chain field. The application therefore fixes its provider to Chipnet, derives only bchtest outputs and requires the participant to select Chipnet in the wallet; it does not claim the handshake proves wallet network selection.

**Published-API discrepancy:** the current documentation describes change-index allocation helpers, but npm dapp 0.2.8 does not expose `getIndexToUse` or `setAddressIndex` in its actual class or pubkey manager. Passage does not call those methods. This test-only adapter returns change to index 0, discloses address reuse, and recommends a dedicated wallet. An offline compatibility test exercises the actual installed key-derivation/signing API.

The project already has BCH CashScript and EVM Solidity HTLCs. Standard P2PKH wallet funding fits WizardConnect without inventing support for arbitrary contract signatures. The new browser adapter funds the BCH contract; existing covenant claim/refund signing stays in the CLI. A valid refund/claim signing route is a prerequisite to funding, not a capability supplied by this adapter.

## New flow and safeguards

1. Prepare/import complete public terms. The first funder holds and privately backs up the matching secret; a second funder independently confirms the first lock.
2. Pair a compatible HD wallet through the explicit QR/URI action. Receive/change public paths are kept in memory; session persistence is disabled. No pairing starts on page load.
3. Acknowledge Chipnet selection and control of an independently usable refund signer. Prepare funding: recompute the contract address from the bundled compiler artifact and full terms, reject an existing local funding record or token-bearing contract output, and scan at most 20 receive plus 20 change addresses.
4. Select one matching non-NFT fungible-token UTXO and, if needed, one BCH-only UTXO. Preserve excess tokens and BCH as wallet change. The contract receives the exact quoted token amount and 2,500 sats; the funding fee is fixed at 1,500 sats; total selected inputs are capped at 1,000,000 test satoshis.
5. Show the exact funding/fee/change/refund summary and explicitly ask the wallet to sign. The wallet request cannot ask it to broadcast. Check every signed input, output, category and amount; require P2PKH `0x61` signatures and locally validate against the BCH VM/source outputs. Invalid or altered transactions are rejected.
6. Save the checked signed txid locally, then enable a separate confirmed Chipnet broadcast action. Save again immediately before sending; require the returned txid to match. A failed response remains an unknown outcome, never a failed/absent transaction claim. Acceptance is labelled unconfirmed.

The panel exports public funding records and, on a separate click, the checked signed transaction for recovery. Signed funding contains an authorization to spend the selected test outputs into the reviewed HTLC; it is not confirmation evidence. These exports do not contain the swap preimage, private keys or relay credentials. Raw signed funding stays only in tab memory unless explicitly exported. After reload/disconnect, inspect retained txids before attempting any new funding; the app does not silently forget or retransmit them.

## Exact validation

Commands ran from `01-stablecoin-bridge`, Node v24.21.0.

| Command/check | Observed result |
|---|---|
| `npm view @wizardconnect/core version` | 0.2.11 |
| `npm view @wizardconnect/dapp version` | 0.2.8 |
| `npm install --save-exact @wizardconnect/core@0.2.11 @wizardconnect/dapp@0.2.8 @bitauth/libauth@3.1.0-next.8 qrcode@1.5.4` | Exit 0; dependencies and lockfile updated. |
| `npm test` | Final 13/13 passed repeatedly. Tests use deterministic unfunded keys and mock providers; no external wallet/network. |
| `npm run compile` | Exit 0, CashScript and Solidity artifacts generated. |
| `npm run build` | Exit 0, Vite 8.3.8, 489 modules; final browser JS 1,055.23 kB / gzip 396.68 kB. Non-fatal >500 kB chunk warning remains. |
| `npm run smoke` | Exit 0: local app and wallet module served, Chipnet address derivation returns bchtest, malformed terms rejected, production index and both assets served. Repeated twice; all smoke child servers stopped. No relay/chain queries, signature or broadcast. |
| Dependency audit | Installation exposed an existing compiler-dev dependency advisory in solc's exact `tmp` 0.2.6. Applied patch override `tmp: 0.2.7` with `npm pkg set overrides.tmp=0.2.7` and `npm install`; install reports zero vulnerabilities. Compiler and tests pass after the patch. `npm audit --omit=dev` and full `npm audit` both report zero. |
| Browser inspection | In-app browser creation failed with OS `GetCursorPos failed: Access is denied. (0x80070005)`. No visual QA, actual relay pairing or wallet interoperability is claimed. |

Tests cover exact/excess-token funding, a separate BCH fee input, NFT exclusion, mainnet rejection, insufficient inventory/value caps, signature flags, invalid/mutated signatures and transactions, source-versus-bundled contract address, actual package key API, forced no-broadcast signing, persistence-before-send, save failures, matching txids and ambiguous network outcomes. Local VM validation covers ordinary funding inputs, **not** either HTLC claim/refund lifecycle or EVM bytecode execution.

## Remaining participant and chain steps

1. Verify the actual test-token categories, quantities and external ERC20 identities. PUSD/USDC UI names do not establish issuer support; never send mainnet PUSD to Chipnet. There is no liquidity provider or counterparty service.
2. Provide two independently controlled counterparties, a compatible Chipnet HD wallet with test tokens/test BCH, and a working signer for the agreed BCH claim/refund keys. Actual wallet compatibility must be tested; do not export a wallet seed to work around unsupported covenant signing.
3. Deploy and independently verify the EVM HTLC bytecode against the compiled artifact on Sepolia or a local EVM chain. Supply gas and exact-transfer ERC20 test inventory; agree on all terms and confirmation policy.
4. Fund the longer-timeout leg first. Independently confirm its exact token, amount, keys, hash, timeout and destination before funding the shorter leg. The checkbox is operator testimony, not proof of a counterparty deposit.
5. For the BCH leg, pair, prepare, review/sign and separately authorize Chipnet broadcast. Retain actual txid/confirmation evidence; server acceptance and a saved local record are insufficient. If the outcome is uncertain, inspect it before retrying.
6. Execute and record both claims with timely monitoring/preimage handling, then demonstrate the reverse direction and an independently verified timeout/refund path using the actual contract signer. The CLI's `BROADCAST=YES` gate and all participant signatures remain manual. Consensus median time can lag a local clock.
7. Publish a full demo with its Node API and browser client, publish source and the short walkthrough/evidence, and complete organizer/account participation and submission gates. The current app is testnet-only and does not satisfy a useful-mainnet-transaction requirement. Static `dist/` hosting alone omits `/api/address` and `/api/inspect`.

No deployment, organizer contact, account creation, event participation or real-money action was performed by this continuation.
