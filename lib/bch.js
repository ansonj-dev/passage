import { compileFile } from "cashc";
import {
  Contract,
  ElectrumNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
} from "cashscript";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { decodeCashAddress } from "@bitauth/libauth";
export function swapContract(spec) {
  for (const k of ["claimant", "refunder"])
    if (!/^(02|03)[a-f0-9]{64}$/.test(spec[k]))
      throw Error("Compressed BCH public keys required");
  if (!/^[a-f0-9]{64}$/.test(spec.hashlock))
    throw Error("SHA256 hash must have 32 bytes");
  if (!Number.isSafeInteger(spec.expiry) || spec.expiry < 500000000)
    throw Error("Use a UNIX timestamp expiry");
  const artifact = compileFile(
    fileURLToPath(new URL("../contracts/TokenSwap.cash", import.meta.url)),
  );
  const provider = new ElectrumNetworkProvider("chipnet");
  return new Contract(
    artifact,
    [spec.hashlock, spec.claimant, spec.refunder, BigInt(spec.expiry)],
    { provider },
  );
}
export async function spend(spec, branch, wif, secret) {
  if (!["claim", "refund"].includes(branch))
    throw Error("Choose claim or refund");
  const contract = swapContract(spec),
    signer = new SignatureTemplate(wif);
  const expected = branch === "claim" ? spec.claimant : spec.refunder;
  if (Buffer.from(signer.publicKey).toString("hex") !== expected)
    throw Error("Signer does not own this branch");
  if (spec.network !== "chipnet")
    throw Error("Explicit network: chipnet required");
  if (
    !/^[a-f0-9]{64}$/.test(spec.category) ||
    !/^[1-9]\d*$/.test(String(spec.amount))
  )
    throw Error(
      "Verified token category and positive base-unit amount required",
    );
  for (const field of ["claimAddress", "refundAddress"]) {
    const a = decodeCashAddress(spec[field] || "");
    if (
      typeof a === "string" ||
      a.prefix !== "bchtest" ||
      !["p2pkhWithTokens", "p2shWithTokens"].includes(a.type) ||
      (a.type === "p2pkhWithTokens" ? a.payload.length !== 20 : ![20, 32].includes(a.payload.length))
    )
      throw Error("Chipnet token-aware payout addresses required");
  }
  if (
    branch === "claim" &&
    (!/^[a-f0-9]{64}$/.test(secret || "") ||
      createHash("sha256").update(Buffer.from(secret, "hex")).digest("hex") !==
        spec.hashlock)
  )
    throw Error("Secret must be 32 bytes of hex matching the hash lock");
  if (branch === "claim" && spec.expiry - Date.now() / 1000 < 1800)
    throw Error(
      "Claim safety window is under 30 minutes. Inspect both chains and use a reviewed recovery procedure.",
    );
  if (branch === "refund" && Date.now() / 1000 < spec.expiry)
    throw Error(
      "Refund time has not arrived; network median time may require additional waiting",
    );
  const all = await contract.getUtxos();
  const utxos = all.filter(
    (u) =>
      u.token &&
      !u.token.nft &&
      u.token.category === spec.category &&
      u.token.amount === BigInt(spec.amount),
  );
  if (utxos.length !== 1)
    throw Error(
      "Expected exactly one funded swap UTXO with the quoted token category and amount",
    );
  const utxo = utxos[0],
    fee = 1500n;
  if (utxo.satoshis < 2500n)
    throw Error("Swap UTXO needs at least 2500 sats for dust and fee");
  const unlocker =
    branch === "claim"
      ? contract.unlock.claim(secret, signer)
      : contract.unlock.refund(signer);
  const tx = new TransactionBuilder({
    provider: contract.provider,
    maximumFeeSatoshis: fee,
    maximumFeeSatsPerByte: 10,
  })
    .addInput(utxo, unlocker)
    .addOutput({
      to: branch === "claim" ? spec.claimAddress : spec.refundAddress,
      amount: utxo.satoshis - fee,
      token: utxo.token,
    });
  if (branch === "refund") tx.setLocktime(spec.expiry);
  return tx;
}
