import {
  cashAddressToLockingBytecode,
  decodeCashAddress,
} from "@bitauth/libauth";
import { isAddress, ZeroAddress, SigningKey } from "ethers";
export function preflight(plan, now = Math.floor(Date.now() / 1000)) {
  plan = plan && typeof plan === "object" ? plan : {};
  const errors = [],
    warnings = [];
  if (
    plan.version !== 1 ||
    !["bch-first", "evm-first"].includes(plan.direction)
  )
    errors.push("Unknown plan format or direction");
  if (plan.bch?.network !== "chipnet")
    errors.push("BCH network must be Chipnet");
  if (!["11155111", "31337"].includes(String(plan.evm?.chainId)))
    errors.push("Choose Sepolia or local EVM chain 31337");
  for (const field of ["contractAddress", "tokenAddress", "sender", "receiver"])
    if (!isAddress(plan.evm?.[field] || "") || plan.evm[field] === ZeroAddress)
      errors.push(`Supply the agreed EVM ${field}`);
  if (typeof plan.evm?.sender === "string" &&
      typeof plan.evm?.receiver === "string" &&
      plan.evm.sender.toLowerCase() === plan.evm.receiver.toLowerCase())
    errors.push("EVM sender and receiver must be distinct");
  if (!/^[a-f0-9]{64}$/.test(plan.bch?.hashlock || ""))
    errors.push("Invalid SHA-256 hash lock");
  if (!/^[a-f0-9]{64}$/.test(plan.bch?.category || ""))
    errors.push("Supply the verified Chipnet CashToken category");
  const positiveUnits = (value, maximum) => {
    const text = String(value ?? "");
    return /^[1-9]\d*$/.test(text) && text.length <= 78 && BigInt(text) <= maximum;
  };
  if (!positiveUnits(plan.bch?.amount, 9223372036854775807n))
    errors.push("Supply a positive BCH token amount in base units");
  if (!positiveUnits(plan.evmAmount, (1n << 256n) - 1n))
    errors.push("Supply a positive EVM token amount in base units");
  for (const field of ["claimAddress", "refundAddress"]) {
    const value = typeof plan.bch?.[field] === "string" ? plan.bch[field] : "",
      decoded = decodeCashAddress(value);
    if (
      !value.startsWith("bchtest:") ||
      typeof decoded === "string" ||
      !["p2pkhWithTokens", "p2shWithTokens"].includes(decoded.type) ||
      (decoded.type === "p2pkhWithTokens" ? decoded.payload.length !== 20 : ![20, 32].includes(decoded.payload.length)) ||
      typeof cashAddressToLockingBytecode(value) === "string"
    )
      errors.push(`Supply a Chipnet token-aware ${field}`);
  }
  for (const field of ["claimant", "refunder"]) {
    try {
      const key = plan.bch?.[field];
      if (!/^(02|03)[a-f0-9]{64}$/.test(key || "")) throw Error();
      SigningKey.computePublicKey("0x" + key, true);
    } catch { errors.push(`Supply a valid compressed BCH ${field} key`); }
  }
  if (plan.bch?.claimant === plan.bch?.refunder)
    errors.push("Claimant and refunder must be distinct keys");
  const b = plan.bch?.expiry,
    e = plan.evm?.expiry;
  const timestamp = (value) => Number.isSafeInteger(value) && value >= 500000000 && value <= 4294967295;
  if (!timestamp(b) || !timestamp(e))
    errors.push("Both timeout timestamps are required");
  const first = plan.direction === "bch-first" ? b : e,
    second = plan.direction === "bch-first" ? e : b;
  if (first - second < 3600)
    errors.push(
      "First-funded chain must expire at least one hour after the second",
    );
  if (second - now < 1800)
    errors.push(
      "Less than 30 minutes remain before the short timeout: create fresh terms instead of funding",
    );
  warnings.push(
    "Confirm funding and exact public terms independently before funding the second leg. Preflight does not verify counterparty deposits.",
  );
  warnings.push(
    "BCH claims remain possible after timeout and may race refunds. Monitor both chains.",
  );
  return {
    ready: errors.length === 0,
    checkedAt: new Date(now * 1000).toISOString(),
    firstChain: plan.direction === "bch-first" ? "BCH" : "EVM",
    bchRefundAt: timestamp(b)
      ? new Date(b * 1000).toISOString()
      : null,
    evmRefundAt: timestamp(e)
      ? new Date(e * 1000).toISOString()
      : null,
    timeoutMarginSeconds: first - second,
    errors,
    warnings,
  };
}
