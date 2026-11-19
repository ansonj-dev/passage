import { installChipnetWallet } from "./chipnet-wallet.js";
import "./style.css";
import {
  BrowserProvider,
  Contract,
  parseUnits,
  sha256,
  hexlify,
  randomBytes,
  isAddress,
} from "ethers";
import { preflight } from "../lib/terms.js";
const $ = (s) => document.querySelector(s);
let plan, secret;
$("#app").innerHTML =
  `<header><b>↗ passage</b><span>THE STABLECOIN CROSSING</span><i>Chipnet / EVM testnet</i></header><main><section class="intro"><p class="eyebrow">MOVE VALUE. KEEP CONTROL.</p><h1>A quieter way<br>to cross chains.</h1><p>Pair BCH stablecoins with EVM stablecoins using the same secret. Every lock has a clear route home.</p><div class="route"><b>PUSD</b><span>BITCOIN CASH</span><hr><b>USDC</b><span>EVM TESTNET</span></div><aside><b>Built around a fair exchange.</b><p>Two parties lock funds. One secret settles both sides. If the trade stops, each sender can refund after their timeout.</p></aside></section><section class="card"><div class="top"><b>Prepare a crossing</b><span>01 / 03</span></div><label>Direction<select id="direction"><option value="bch-first">PUSD on BCH → USDC on EVM</option><option value="evm-first">USDC on EVM → PUSD on BCH</option></select></label><div class="row"><label>Amount<input id="amount" value="10" inputmode="decimal"></label><label>EVM token decimals<input id="decimals" value="6" type="number" min="0" max="18"></label></div><label>BCH claimant public key<input id="claimant" placeholder="02 / 03 + 64 hex characters"></label><label>BCH refund public key<input id="refunder" placeholder="The BCH sender's compressed public key"></label><button id="prepare">Create hash lock plan <span>→</span></button><p class="note">Preparation derives a real Chipnet contract address. It does not move funds or supply a counterparty.</p><div id="result" role="status">Your swap terms will appear here.</div><button id="export" class="secondary">Export public swap terms ↓</button><details><summary>EVM wallet & contract</summary><label>Deployed StableSwap address<input id="contract" placeholder="0x…"></label><label>ERC20 test token address<input id="token" placeholder="0x…"></label><label>Receiving counterparty<input id="receiver" placeholder="0x…"></label><button id="connect" class="secondary">Connect EVM wallet</button><button id="lock" class="secondary">Approve & lock ERC20</button><label>Existing lock ID<input id="lockid" placeholder="0x…"></label><button id="claim" class="secondary">Claim EVM lock with secret</button><button id="refund" class="secondary">Refund expired EVM lock</button><label>Secret (private until claiming)<input id="secret" type="password" placeholder="0x + 64 hex characters"></label></details></section></main><section class="steps"><article><small>01</small><h3>Agree on terms</h3><p>Verify token identities, amounts, keys, networks and both refund times with your counterparty.</p></article><article><small>02</small><h3>Lock, then inspect</h3><p>The first chain uses the longer timeout. Wait for confirmations before funding the second.</p></article><article><small>03</small><h3>Reveal & settle</h3><p>The initiator claims the second lock. The revealed secret unlocks the first for the counterparty.</p></article></section><footer>PASSAGE / BCH BLAZE 2026 <span>Local prototype · no liquidity service connected</span></footer>`;
const show = (x) =>
  ($("#result").textContent =
    typeof x === "string" ? x : JSON.stringify(x, null, 2));
const act = (id, fn) =>
  ($(id).onclick = async () => {
    try {
      show("Working…");
      await fn();
    } catch (e) {
      show(e.shortMessage || e.message);
    }
  });
act("#export", async () => {
  if (!plan) throw Error("Prepare terms first");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "passage-public-terms.json";
  a.click();
  URL.revokeObjectURL(url);
  show(
    "Public terms exported. Store the secret separately; closing this tab loses it.",
  );
});
let signer;
act("#connect", async () => {
  if (!window.ethereum) throw Error("Install an EVM wallet");
  const provider = new BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  const chain = await provider.getNetwork();
  if (![31337n, 11155111n].includes(chain.chainId))
    throw Error("Use local chain 31337 or Sepolia");
  show({ wallet: await signer.getAddress(), chainId: String(chain.chainId) });
});
const abi = [
  "function lock(address,address,uint256,bytes32,uint256,bytes32) returns(bytes32)",
  "function claim(bytes32,bytes32)",
  "function refund(bytes32)",
  "event Locked(bytes32 indexed id, bytes32 indexed hashlock, address token, address sender, address receiver, uint256 amount, uint256 expiry)",
];

// Operator controls intentionally distinguish public preparation from observed funding.
const controls = document.createElement("details");
controls.open = true;
controls.innerHTML =
  '<summary>Testnet swap terms</summary><p>This demo uses your own test tokens on Chipnet and Sepolia/local EVM. PUSD and USDC names describe the intended pair; no issuer bridge or liquidity service is connected.</p><label>EVM network<select id="chain"><option value="11155111">Sepolia</option><option value="31337">Local EVM 31337</option></select></label><label>Chipnet test token category<input id="category" placeholder="64 hex characters"></label><label>Chipnet token amount in base units<input id="bchunits" inputmode="numeric" placeholder="1000000"></label><label>BCH token-aware claim address<input id="claimaddress" placeholder="bchtest:z…"></label><label>BCH token-aware refund address<input id="refundaddress" placeholder="bchtest:z…"></label><label>EVM sender address<input id="evmsender" placeholder="0x…"></label><label class="attestation"><input id="counterparty-checked" type="checkbox"> I independently checked the first lock, both recipient keys, token identities, amounts and timeout ordering before funding the second lock.</label>';
$("#prepare").before(controls);
const backupLabel = document.createElement("label");
backupLabel.className = "attestation";
backupLabel.innerHTML =
  '<input id="secret-backed-up" type="checkbox"> If I fund the first lock, I have privately saved the matching secret outside this tab. Public exports never contain it.';
controls.append(backupLabel);
const inspection = document.createElement("details");
inspection.innerHTML =
  '<summary>Preflight & inspect public state</summary><button id="preflight" class="secondary">Check plan and timeout window</button><button id="inspectbch" class="secondary">Read Chipnet unspent outputs</button><button id="inspectevm" class="secondary">Read EVM lock state</button><p>Read-only observations do not establish a complete trade or a confirmation policy. Never disclose the secret before both correctly funded locks are independently confirmed.</p><label>Import public terms JSON<input id="importterms" type="file" accept="application/json"></label>';
$("#export").after(inspection);
act("#prepare", async () => {
  if (
    !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test($("#amount").value) ||
    Number($("#amount").value) <= 0
  )
    throw Error("Enter a positive amount with at most 6 decimals");
  const decimals = Number($("#decimals").value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw Error("Token decimals must be an integer from 0 to 18");
  secret = hexlify(randomBytes(32));
  $("#secret").value = secret;
  const now = Math.floor(Date.now() / 1000),
    first = $("#direction").value === "bch-first";
  const spec = {
    hashlock: sha256(secret).slice(2),
    claimant: $("#claimant").value.trim(),
    refunder: $("#refunder").value.trim(),
    expiry: now + (first ? 14400 : 7200),
  };
  const r = await fetch("/api/address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    }),
    data = await r.json();
  if (!r.ok) throw Error(data.error);
  plan = {
    version: 1,
    direction: $("#direction").value,
    displayAmount: $("#amount").value,
    evmDecimals: decimals,
    evmAmount: parseUnits($("#amount").value, decimals).toString(),
    bch: {
      ...spec,
      ...data,
      category: $("#category").value.trim(),
      amount: $("#bchunits").value.trim(),
      claimAddress: $("#claimaddress").value.trim(),
      refundAddress: $("#refundaddress").value.trim(),
    },
    evm: {
      contractAddress: $("#contract").value.trim(),
      tokenAddress: $("#token").value.trim(),
      receiver: $("#receiver").value.trim(),
      sender: $("#evmsender").value.trim(),
      chainId: $("#chain").value,
      expiry: now + (first ? 7200 : 14400),
    },
    state: "public terms prepared; funding unobserved",
  };
  $("#counterparty-checked").checked = false;
  $("#secret-backed-up").checked = false;
  show({ terms: plan, preflight: preflight(plan) });
});
act("#preflight", async () => {
  if (!plan) throw Error("Prepare or import public terms");
  show(preflight(plan));
});
act("#inspectbch", async () => {
  if (!plan) throw Error("Prepare or import terms");
  const r = await fetch("/api/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan.bch),
    }),
    data = await r.json();
  if (!r.ok) throw Error(data.error);
  show(data);
});
$("#importterms").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 32000) throw Error("Terms file is too large");
    const imported = JSON.parse(await file.text());
    if (imported.version !== 1 || !imported.bch || !imported.evm)
      throw Error("Not a Passage public terms export");
    const r = await fetch("/api/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(imported.bch),
      }),
      derived = await r.json();
    if (!r.ok) throw Error(derived.error);
    if (imported.bch.address !== derived.address)
      throw Error("Contract address does not match the public terms");
    plan = imported;
    $("#contract").value = plan.evm.contractAddress || "";
    $("#token").value = plan.evm.tokenAddress || "";
    $("#receiver").value = plan.evm.receiver || "";
    $("#evmsender").value = plan.evm.sender || "";
    secret = undefined;
    $("#secret").value = "";
    $("#counterparty-checked").checked = false;
    show({
      imported: true,
      preflight: preflight(plan),
      note: "No secret was imported. Counterparty terms must be independently verified.",
    });
  } catch (error) {
    show(error.message);
  } finally {
    e.target.value = "";
  }
};
const readProvider = () => {
  if (!signer) throw Error("Connect EVM wallet first");
  return signer.provider;
};
async function checkedSwap() {
  const chain = await readProvider().getNetwork();
  if (![31337n, 11155111n].includes(chain.chainId))
    throw Error("Only Sepolia or local EVM is allowed");
  if (plan && chain.chainId !== BigInt(plan.evm.chainId))
    throw Error("Connected chain differs from the public terms");
  if (
    plan &&
    $("#contract").value.toLowerCase() !==
      (plan.evm.contractAddress || "").toLowerCase()
  )
    throw Error("Swap address differs from the agreed terms");
  if (
    !isAddress($("#contract").value) ||
    (await signer.provider.getCode($("#contract").value)) === "0x"
  )
    throw Error("No deployed swap contract at this address");
  return new Contract(
    $("#contract").value,
    [
      ...abi,
      "function locks(bytes32) view returns(address token,address sender,address receiver,uint256 amount,uint256 expiry)",
      "function hashes(bytes32) view returns(bytes32)",
    ],
    signer,
  );
}
async function inspectEvm() {
  const c = await checkedSwap();
  if (!/^0x[a-fA-F0-9]{64}$/.test($("#lockid").value))
    throw Error("Enter an EVM lock ID");
  const [lock, hash, block] = await Promise.all([
    c.locks($("#lockid").value),
    c.hashes($("#lockid").value),
    signer.provider.getBlock("latest"),
  ]);
  return { c, lock, hash, now: block.timestamp };
}
act("#inspectevm", async () => {
  const { lock, hash, now } = await inspectEvm();
  show({
    observedAt: new Date(now * 1000).toISOString(),
    token: lock.token,
    sender: lock.sender,
    receiver: lock.receiver,
    amount: lock.amount.toString(),
    hashlock: hash,
    expiry: lock.expiry.toString(),
    state:
      lock.amount === 0n
        ? "absent or spent"
        : BigInt(now) >= lock.expiry
          ? "refund time reached"
          : "funded; claims require recipient and secret",
    matchesPlan: plan
      ? {
          hash: hash === "0x" + plan.bch.hashlock,
          amount: lock.amount === BigInt(plan.evmAmount),
          expiry: lock.expiry === BigInt(plan.evm.expiry),
        }
      : null,
  });
});
act("#lock", async () => {
  if (!plan) throw Error("Prepare or import terms");
  const report = preflight(plan);
  if (!report.ready) throw Error(report.errors.join("\n"));
  const c = await checkedSwap(),
    wallet = await signer.getAddress();
  if (
    wallet.toLowerCase() !== plan.evm.sender.toLowerCase() ||
    $("#token").value.toLowerCase() !== plan.evm.tokenAddress.toLowerCase() ||
    $("#receiver").value.toLowerCase() !== plan.evm.receiver.toLowerCase()
  )
    throw Error(
      "Sender, token or receiver differs from the agreed public terms",
    );
  if (
    !isAddress($("#token").value) ||
    !isAddress($("#receiver").value) ||
    $("#receiver").value.toLowerCase() === wallet.toLowerCase()
  )
    throw Error(
      "Valid token and distinct receiving counterparty addresses are required",
    );
  const token = new Contract(
    $("#token").value,
    [
      "function approve(address,uint256) returns(bool)",
      "function decimals() view returns(uint8)",
      "function balanceOf(address) view returns(uint256)",
    ],
    signer,
  );
  const [decimals, balance, block] = await Promise.all([
    token.decimals(),
    token.balanceOf(wallet),
    signer.provider.getBlock("latest"),
  ]);
  if (Number(decimals) !== plan.evmDecimals || balance < BigInt(plan.evmAmount))
    throw Error("Token decimals mismatch or insufficient inventory");
  if (plan.evm.expiry - block.timestamp < 1800)
    throw Error("Chain time leaves less than the required 30-minute window");
  if (
    plan.direction === "evm-first" &&
    (!$("#secret-backed-up").checked ||
      !/^0x[a-fA-F0-9]{64}$/.test($("#secret").value) ||
      sha256($("#secret").value) !== "0x" + plan.bch.hashlock)
  )
    throw Error(
      "The first funder must hold the matching secret and acknowledge a private backup before locking",
    );
  if (plan.direction === "bch-first" && !$("#counterparty-checked").checked)
    throw Error(
      "This is the second-funded leg: inspect and confirm the BCH lock before approving",
    );
  if (
    !confirm(
      `TESTNET ONLY\nLock ${plan.evmAmount} token base units on chain ${plan.evm.chainId}?\nReceiver: ${$("#receiver").value}\nRefund after: ${new Date(plan.evm.expiry * 1000).toISOString()}\nThis does not verify or settle the BCH leg.`,
    )
  )
    return;
  await (await token.approve(await c.getAddress(), plan.evmAmount)).wait();
  await checkedSwap();
  const tx = await c.lock(
      $("#token").value,
      $("#receiver").value,
      plan.evmAmount,
      "0x" + plan.bch.hashlock,
      plan.evm.expiry,
      hexlify(randomBytes(32)),
    ),
    receipt = await tx.wait();
  const log = receipt.logs
    .map((l) => {
      try {
        return c.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "Locked");
  if (log) {
    $("#lockid").value = log.args.id;
    plan.evm.lockId = log.args.id;
  }
  show({
    transaction: receipt.hash,
    lockId: log?.args.id,
    status:
      "EVM receipt observed. BCH leg and confirmation depth remain separate checks.",
  });
});
act("#claim", async () => {
  if (!plan) throw Error("Import agreed public terms first");
  const { c, lock, hash, now } = await inspectEvm();
  if (
    lock.token.toLowerCase() !== plan.evm.tokenAddress.toLowerCase() ||
    lock.sender.toLowerCase() !== plan.evm.sender.toLowerCase() ||
    lock.receiver.toLowerCase() !== plan.evm.receiver.toLowerCase() ||
    lock.amount !== BigInt(plan.evmAmount) ||
    hash !== "0x" + plan.bch.hashlock ||
    lock.expiry !== BigInt(plan.evm.expiry)
  )
    throw Error("Lock does not match the agreed public terms");
  if (lock.receiver.toLowerCase() !== (await signer.getAddress()).toLowerCase())
    throw Error("Connected wallet is not the lock recipient");
  if (Number(lock.expiry) - now < 1800)
    throw Error(
      "Less than 30 minutes remain; inspect both chains before any recovery action",
    );
  if (
    !/^0x[a-fA-F0-9]{64}$/.test($("#secret").value) ||
    sha256($("#secret").value) !== hash
  )
    throw Error("Secret does not match this lock");
  if (
    !$("#counterparty-checked").checked ||
    !confirm(
      "Both locks must be independently confirmed. Claiming publishes the secret permanently. Continue?",
    )
  )
    throw Error("Verify both locks and acknowledge the checklist first");
  const tx = await c.claim($("#lockid").value, $("#secret").value);
  show({
    transaction: (await tx.wait()).hash,
    status:
      "EVM claim receipt observed; secret is public. Counterparty must claim the BCH leg.",
  });
});
act("#refund", async () => {
  const { c, lock, now } = await inspectEvm();
  if (
    lock.sender.toLowerCase() !== (await signer.getAddress()).toLowerCase() ||
    lock.amount === 0n
  )
    throw Error("No refundable lock belongs to this wallet");
  if (BigInt(now) < lock.expiry)
    throw Error("Chain time has not reached the refund timestamp");
  const tx = await c.refund($("#lockid").value);
  show({
    transaction: (await tx.wait()).hash,
    status: "EVM refund receipt observed. This does not refund BCH.",
  });
});

installChipnetWallet({ getPlan: () => plan, getSecret: () => $("#secret").value });
