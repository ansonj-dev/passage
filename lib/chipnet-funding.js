import { Contract, TransactionBuilder, placeholderP2PKHUnlocker } from "cashscript";
import { binToHex, cashAddressToLockingBytecode, decodeCashAddress, decodeTransaction,
  hexToBin, hashTransactionUiOrder, createVirtualMachineBCH, decodeAuthenticationInstructions } from "@bitauth/libauth";
import artifact from "../artifacts/TokenSwap.json" with { type: "json" };
import { preflight } from "./terms.js";

export const FUNDING_SATS = 2500n;
export const FUNDING_FEE = 1500n;
const TOKEN_CHANGE_SATS = 1000n, MIN_CHANGE = 546n, MAX_INPUT_SATS = 1000000n;

export function requireChipnet(provider) {
  if (provider?.network !== "chipnet") throw Error("Chipnet provider required; mainnet funding is disabled");
}

export function deriveFundingAddress(plan, provider) {
  requireChipnet(provider);
  if (plan.bch?.network !== "chipnet") throw Error("Only Chipnet swap terms are allowed");
  return new Contract(artifact, [plan.bch.hashlock, plan.bch.claimant, plan.bch.refunder, BigInt(plan.bch.expiry)], { provider }).tokenAddress;
}

function tokenAddress(value) {
  if (typeof value !== "string" || !value.startsWith("bchtest:")) return false;
  const decoded = decodeCashAddress(value);
  return typeof decoded !== "string" && decoded.prefix === "bchtest" &&
    decoded.type === "p2pkhWithTokens" && decoded.payload.length === 20;
}

export function fundingTermsKey(plan) {
  return JSON.stringify({ direction: plan.direction, bch: {
    network: plan.bch.network, address: plan.bch.address, hashlock: plan.bch.hashlock,
    claimant: plan.bch.claimant, refunder: plan.bch.refunder, expiry: plan.bch.expiry,
    category: plan.bch.category, amount: String(plan.bch.amount), claimAddress: plan.bch.claimAddress, refundAddress: plan.bch.refundAddress,
  }, evm: plan.evm, evmAmount: String(plan.evmAmount) });
}

export function buildChipnetFunding({ plan, walletUtxos, changeAddress, provider, now }) {
  requireChipnet(provider);
  const report = preflight(plan, now);
  if (!report.ready) throw Error(report.errors.join("\n"));
  const address = deriveFundingAddress(plan, provider);
  if (plan.bch.address !== address) throw Error("Swap address does not match the bundled contract and agreed terms");
  if (!tokenAddress(changeAddress)) throw Error("Chipnet token-aware P2PKH change address required");
  const candidates = walletUtxos.filter(entry => {
    const { utxo, from, path, index } = entry;
    if (![0, 1].includes(path) || !Number.isInteger(index) || index < 0 || index >= 20 || !tokenAddress(from)) return false;
    const lock = cashAddressToLockingBytecode(from);
    return typeof lock !== "string" && binToHex(lock.bytecode) === utxo.lockingBytecode &&
      typeof utxo.satoshis === "bigint" && utxo.satoshis > 0n && utxo.satoshis <= MAX_INPUT_SATS;
  });
  const amount = BigInt(plan.bch.amount);
  const tokens = candidates.filter(e => e.utxo.token && !e.utxo.token.nft &&
    e.utxo.token.category === plan.bch.category && e.utxo.token.amount >= amount)
    .sort((a, b) => a.utxo.token.amount < b.utxo.token.amount ? -1 : a.utxo.token.amount > b.utxo.token.amount ? 1 : 0);
  let selected, tokenChange;
  for (const token of tokens) {
    tokenChange = token.utxo.token.amount - amount;
    const required = FUNDING_SATS + FUNDING_FEE + MIN_CHANGE + (tokenChange > 0n ? TOKEN_CHANGE_SATS : 0n);
    if (token.utxo.satoshis >= required) { selected = [token]; break; }
    const cash = candidates.filter(e => !e.utxo.token && e.utxo.satoshis + token.utxo.satoshis >= required &&
      e.utxo.satoshis + token.utxo.satoshis <= MAX_INPUT_SATS &&
      !(e.utxo.txid === token.utxo.txid && e.utxo.vout === token.utxo.vout))
      .sort((a, b) => Number(a.utxo.satoshis - b.utxo.satoshis))[0];
    if (cash) { selected = [token, cash]; break; }
  }
  if (!selected) throw Error("Need one matching fungible test-token output plus enough Chipnet BCH for 2,500 contract sats, a 1,500 sat fee and change; total input cap is 0.01 test BCH");
  const total = selected.reduce((sum, entry) => sum + entry.utxo.satoshis, 0n);
  const builder = new TransactionBuilder({ provider, maximumFeeSatoshis: FUNDING_FEE, maximumFeeSatsPerByte: 10 });
  selected.forEach(entry => builder.addInput(entry.utxo, placeholderP2PKHUnlocker(entry.from)));
  builder.addOutput({ to: address, amount: FUNDING_SATS, token: { category: plan.bch.category, amount } });
  if (tokenChange > 0n) builder.addOutput({ to: changeAddress, amount: TOKEN_CHANGE_SATS, token: { category: plan.bch.category, amount: tokenChange } });
  builder.addOutput({ to: changeAddress, amount: total - FUNDING_SATS - FUNDING_FEE - (tokenChange > 0n ? TOKEN_CHANGE_SATS : 0n) });
  const request = builder.generateWcTransactionObject({ broadcast: false, userPrompt: "Passage: fund the agreed Chipnet test-token HTLC only. Review token category, quantity, refund key, timeout and all change." });
  return { builder, request, inputPaths: selected.map((entry, i) => [i, entry.path === 0 ? "receive" : "change", entry.index]),
    termsKey: fundingTermsKey(plan), summary: { network: "chipnet", address, category: plan.bch.category,
      tokenAmount: amount.toString(), tokenChange: tokenChange.toString(), contractSats: FUNDING_SATS.toString(),
      feeSats: FUNDING_FEE.toString(), changeAddress, bchChangeSats: builder.outputs.at(-1).amount.toString(),
      inputs: selected.map(e => ({ txid: e.utxo.txid, vout: e.utxo.vout, satoshis: e.utxo.satoshis.toString() })),
      refundKey: plan.bch.refunder, refundAfter: new Date(plan.bch.expiry * 1000).toISOString(),
      notice: "Preparation is not funding. Both chains and a usable claim/refund signer require independent checks." } };
}

export function verifySignedFunding(rawHex, request) {
  if (typeof rawHex !== "string" || !/^(?:[a-fA-F0-9]{2})+$/.test(rawHex)) throw Error("Wallet returned invalid transaction hex");
  const raw = hexToBin(rawHex), signed = decodeTransaction(raw), expected = request.transaction;
  if (typeof signed === "string") throw Error("Wallet returned an invalid transaction");
  const same = (a, b) => binToHex(a) === binToHex(b);
  const sameToken = (a, b) => !a && !b || !!a && !!b && !a.nft && !b.nft && a.amount === b.amount && same(a.category, b.category);
  if (signed.version !== expected.version || signed.locktime !== expected.locktime ||
      signed.inputs.length !== expected.inputs.length || signed.outputs.length !== expected.outputs.length ||
      signed.inputs.some((input, i) => input.outpointIndex !== expected.inputs[i].outpointIndex ||
        input.sequenceNumber !== expected.inputs[i].sequenceNumber || !same(input.outpointTransactionHash, expected.inputs[i].outpointTransactionHash)) ||
      signed.outputs.some((output, i) => output.valueSatoshis !== expected.outputs[i].valueSatoshis ||
        !same(output.lockingBytecode, expected.outputs[i].lockingBytecode) || !sameToken(output.token, expected.outputs[i].token)))
    throw Error("Signed funding differs from the approved inputs, token amounts, recipients or change; stopped");
  for (const input of signed.inputs) {
    const instructions = decodeAuthenticationInstructions(input.unlockingBytecode);
    if (instructions.length !== 2 || !(instructions[0].data instanceof Uint8Array) ||
        instructions[0].data.at(-1) !== 0x61 || instructions[1].data?.length !== 33)
      throw Error("Wallet must provide P2PKH signatures with SIGHASH_ALL | FORKID | UTXOS (0x61)");
  }
  const verified = createVirtualMachineBCH().verify({ transaction: signed, sourceOutputs: request.sourceOutputs });
  if (verified !== true) throw Error("Wallet transaction failed local BCH validation: " + verified);
  return { rawHex, txid: binToHex(hashTransactionUiOrder(raw)) };
}

export async function signChipnetFunding({ funding, manager, provider, signal }) {
  requireChipnet(provider);
  const snapshot = structuredClone(funding.request);
  snapshot.broadcast = false;
  const response = await manager.signTransaction({ transaction: structuredClone(snapshot), inputPaths: funding.inputPaths }, { signal });
  if (response.error) throw Error(response.error);
  return verifySignedFunding(response.signedTransaction, snapshot);
}

export async function broadcastChipnetFunding({ signed, provider, saveBeforeBroadcast }) {
  requireChipnet(provider);
  await saveBeforeBroadcast(signed.txid);
  try {
    const accepted = await provider.sendRawTransaction(signed.rawHex);
    if (accepted !== signed.txid) throw Error("Server response did not match the signed transaction ID");
  }
  catch { throw Error(`Chipnet broadcast outcome unknown. Saved transaction ${signed.txid}; inspect it before retrying.`); }
  return signed.txid;
}
