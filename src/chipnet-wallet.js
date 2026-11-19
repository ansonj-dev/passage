import { initiateDappRelay } from "@wizardconnect/core";
import { DappConnectionManager } from "@wizardconnect/dapp";
import { ElectrumNetworkProvider } from "cashscript";
import { publicKeyToP2pkhCashAddress, binToHex } from "@bitauth/libauth";
import { sha256 } from "ethers";
import QRCode from "qrcode";
import { preflight } from "../lib/terms.js";
import { buildChipnetFunding, deriveFundingAddress, fundingTermsKey, signChipnetFunding, broadcastChipnetFunding } from "../lib/chipnet-funding.js";
import icon from "./passage.svg?url";

export function installChipnetWallet({ getPlan, getSecret }) {
  const panel = document.createElement("details");
  panel.className = "chipnet-wallet";
  panel.innerHTML = `<summary>BCH wallet · Chipnet funding</summary>
    <p>Connect a WizardConnect HD wallet to fund the agreed test-token contract. This panel signs ordinary wallet inputs; BCH contract claims/refunds still use the separate CLI and a signer you already control.</p>
    <button id="bch-pair" class="secondary">Start new Chipnet wallet pairing</button>
    <img id="bch-qr" hidden width="220" height="220" alt="WizardConnect wallet pairing QR">
    <label>Pairing URI<input id="bch-uri" readonly></label>
    <p id="bch-account" class="note">No wallet connected. Signing keys are never requested.</p>
    <label class="attestation"><input id="bch-network-consent" type="checkbox"> I selected Chipnet in my wallet and will use test BCH/CashTokens only. The HD handshake does not prove the wallet's selected network.</label>
    <label class="attestation"><input id="bch-refund-control" type="checkbox"> I control the agreed BCH refund key and have a working claim/refund signing route before locking funds. This funding panel does not provide that route.</label>
    <button id="bch-prepare" class="secondary">1. Prepare Chipnet funding</button>
    <button id="bch-sign" class="secondary" disabled>2. Review & ask wallet to sign</button>
    <button id="bch-broadcast" class="secondary" disabled>3. Broadcast signed funding to Chipnet</button>
    <button id="bch-cancel" class="secondary">Cancel signing</button>
    <button id="bch-disconnect" class="secondary">Disconnect BCH wallet</button>
    <button id="bch-export-signed" class="secondary">Export signed Chipnet funding</button>
    <button id="bch-export-records" class="secondary">Export local funding records</button>
    <pre id="bch-status" role="status" aria-live="polite">Prepare or import the full public terms first. Pairing, preparation, signing and broadcast are separate actions.</pre>
    <p class="note">Only the Chipnet provider and bchtest outputs are used. The first 20 receive/change addresses are scanned; input value is capped at 0.01 test BCH. Change returns to wallet change index 0, which reuses an address: use a dedicated test wallet. A saved signed transaction ID does not prove broadcast or confirmation. Inspect records and both chains independently before retrying.</p>`;
  document.querySelector("#export").after(panel);
  const $ = selector => panel.querySelector(selector);
  const provider = new ElectrumNetworkProvider("chipnet");
  const storageKey = "passage:chipnet-funding:v1";
  let manager, relay, ready = false, busy = false, controller, prepared, signed;
  const show = value => { $("#bch-status").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2); };
  const records = () => {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved) || saved.some(r => !r || !/^[a-f0-9]{64}$/.test(r.txid) || typeof r.address !== "string"))
      throw Error("Stored funding records are malformed; preserve them and inspect manually before funding");
    return saved;
  };
  const saveRecord = (status, funding = prepared, payment = signed) => {
    const saved = records(), existing = saved.find(r => r.txid === payment.txid);
    const record = { txid: payment.txid, address: funding.summary.address, category: funding.summary.category,
      amount: funding.summary.tokenAmount, network: "chipnet", status, observedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, record); else saved.push(record);
    localStorage.setItem(storageKey, JSON.stringify(saved));
  };
  const resetPreparation = () => {
    prepared = signed = undefined;
    $("#bch-sign").disabled = $("#bch-broadcast").disabled = true;
  };
  function guard({ connected = true } = {}) {
    if (connected && (!ready || !manager)) throw Error("Connect a WizardConnect HD wallet first");
    const plan = getPlan();
    if (!plan) throw Error("Prepare or import complete public swap terms first");
    const report = preflight(plan);
    if (!report.ready) throw Error(report.errors.join("\n"));
    if (!$("#bch-network-consent").checked || !$("#bch-refund-control").checked)
      throw Error("Confirm testnet selection and a usable refund-key signer before funding");
    if (plan.direction === "bch-first") {
      const secret = getSecret();
      if (!document.querySelector("#secret-backed-up").checked || !/^0x[a-fA-F0-9]{64}$/.test(secret) || sha256(secret) !== "0x" + plan.bch.hashlock)
        throw Error("The first funder must privately back up the matching secret before funding");
    } else if (!document.querySelector("#counterparty-checked").checked)
      throw Error("BCH is the second leg: independently confirm the exact EVM lock before funding");
    if (prepared && prepared.termsKey !== fundingTermsKey(plan)) throw Error("Public terms changed; prepare and review funding again");
    return plan;
  }
  function account(path, index) {
    const publicKey = manager.getPubkey(path, BigInt(index));
    if (!publicKey) throw Error("Wallet must share receive and change HD paths");
    return { publicKey, address: publicKeyToP2pkhCashAddress({ publicKey, prefix: "bchtest", tokenSupport: true }).address };
  }
  const run = (selector, fn) => { $(selector).onclick = async () => {
    if (busy) return show("Another BCH action is in progress. Cancel signing or wait for it to finish.");
    busy = true; $(selector).disabled = true;
    try { await fn(); } catch (error) { show(error.message); }
    finally { busy = false; $(selector).disabled = selector === "#bch-sign" ? !prepared || !!signed : selector === "#bch-broadcast" ? !signed : false; }
  }; };
  run("#bch-pair", async () => {
    if (signed) throw Error(`Signed funding ${signed.txid} is still in memory. Inspect/export it before replacing the wallet session.`);
    ready = false; resetPreparation();
    if (manager) await manager.destroy();
    relay?.cleanup();
    const connection = new DappConnectionManager("Passage · Chipnet only", new URL(icon, location.href).href, { session: false });
    manager = connection;
    connection.on("walletready", message => {
      if (manager !== connection) return;
      try {
        const receive = account(0, 0); account(1, 0);
        ready = true;
        $("#bch-account").textContent = `${message.wallet_name} connected. Chipnet token receive address: ${receive.address}. Public key: ${binToHex(receive.publicKey)}. Wallet network selection remains your responsibility.`;
        show("Wallet connected. Fund the displayed address with test tokens and a little test BCH, then prepare the agreed funding transaction.");
      } catch (error) { ready = false; show(error.message); }
    });
    connection.on("disconnect", () => {
      if (manager !== connection) return;
      ready = false; controller?.abort(); resetPreparation(); relay?.cleanup();
      $("#bch-account").textContent = "BCH wallet disconnected. Any signed/broadcast records remain saved locally.";
    });
    relay = initiateDappRelay(payload => {
      connection.updateConnection(payload.client, payload.status);
      if (!ready && manager === connection) show(`Wallet relay: ${payload.status.status}. Select Chipnet in a compatible HD wallet before scanning.`);
    });
    $("#bch-uri").value = relay.uri;
    $("#bch-qr").src = await QRCode.toDataURL(relay.qrUri, { width: 220, margin: 2 });
    $("#bch-qr").hidden = false;
  });
  run("#bch-prepare", async () => {
    if (signed) throw Error(`Signed funding ${signed.txid} already exists. Inspect it and the saved records before any retry.`);
    resetPreparation();
    const plan = structuredClone(guard()), address = deriveFundingAddress(plan, provider);
    const saved = records().find(record => record.address === address);
    if (saved) throw Error(`Funding record already saved: ${saved.txid} (${saved.status}). Inspect Chipnet before any new funding.`);
    if ((await provider.getUtxos(address)).some(utxo => utxo.token)) throw Error("The contract already has a token output. Inspect it before funding again.");
    // Published dapp 0.2.8 has getPubkey(), but no change-index allocation APIs.
    // Keep the destination deterministic and disclose reuse for this testnet adapter.
    const changeIndex = 0n;
    const changeAddress = account(1, changeIndex).address, walletUtxos = [];
    let funding;
    for (const path of [0, 1]) {
      for (let index = 0; index < 20 && !funding; index++) {
        show(`Reading Chipnet ${path === 0 ? "receive" : "change"} address ${index + 1}/20…`);
        const from = account(path, index).address;
        walletUtxos.push(...(await provider.getUtxos(from)).map(utxo => ({ utxo, from, path, index })));
        try { funding = buildChipnetFunding({ plan, walletUtxos, changeAddress, provider }); }
        catch (error) { if (!error.message.startsWith("Need one matching")) throw error; }
      }
      if (funding) break;
    }
    if (!funding) throw Error("No suitable test-token/BCH funding outputs in the first 20 receive/change addresses; use the displayed Chipnet receive address and retry.");
    if (funding.termsKey !== fundingTermsKey(getPlan())) throw Error("Terms changed during scanning; prepare again");
    prepared = { ...funding, changeIndex };
    $("#bch-sign").disabled = false;
    show(prepared.summary);
  });
  run("#bch-sign", async () => {
    guard();
    if (!prepared || signed) throw Error("Prepare a fresh funding request first");
    if (!confirm(`CHIPNET TEST TOKENS ONLY\n\nLock ${prepared.summary.tokenAmount} base units of:\n${prepared.summary.category}\nAt:\n${prepared.summary.address}\n\nContract BCH: 2,500 sats. Fee: 1,500 sats.\nRefund key: ${prepared.summary.refundKey}\nRefund after: ${prepared.summary.refundAfter}\n\nReview token/BCH change in the wallet. Signing does not ask the wallet to broadcast. Continue?`)) return;
    controller = new AbortController();
    show("Awaiting wallet approval. The request has broadcast:false; cancellation is available below.");
    try {
      signed = await signChipnetFunding({ funding: prepared, manager, provider, signal: controller.signal });
      try { saveRecord("signed-not-broadcast-by-app"); }
      catch { throw Error(`Signed funding ${signed.txid} exists, but local record persistence failed. Broadcast is blocked. Export the signed transaction and inspect it before any retry.`); }
      $("#bch-broadcast").disabled = false;
      show({ txid: signed.txid, status: "Signature checked locally; not broadcast by this app. Inspect the reviewed terms, then use the separate Chipnet broadcast button." });
    } finally { controller = undefined; }
  });
  run("#bch-broadcast", async () => {
    guard();
    if (!prepared || !signed) throw Error("A checked wallet signature is required first");
    if (!confirm(`Broadcast signed funding ${signed.txid} to CHIPNET?\nThis locks the quoted test tokens. It does not settle the EVM leg or demonstrate a completed swap.`)) return;
    const funding = prepared, payment = signed;
    const txid = await broadcastChipnetFunding({ signed: payment, provider, saveBeforeBroadcast: async () => saveRecord("broadcast-outcome-pending", funding, payment) });
    saveRecord("server-accepted-unconfirmed", funding, payment);
    show({ txid, network: "chipnet", status: "Chipnet server accepted the transaction. Confirmation depth, both-chain state and contract claim/refund remain separate checks." });
    signed = undefined;
    $("#bch-sign").disabled = true;
  });
  $("#bch-cancel").onclick = () => controller?.abort("User cancelled Chipnet funding signing");
  $("#bch-disconnect").onclick = async () => {
    if (busy && !controller) return show("Wait for the current preparation/broadcast action to finish before disconnecting.");
    controller?.abort("User disconnected"); ready = false;
    try { await manager?.sendDisconnect("User disconnected"); await manager?.destroy(); }
    catch (error) { show(`Disconnect notification failed: ${error.message}. Local session is being closed.`); }
    finally {
      manager?.clearStoredSession(); relay?.cleanup(); relay = undefined;
      resetPreparation(); $("#bch-qr").hidden = true; $("#bch-uri").value = "";
      $("#bch-account").textContent = "Disconnected; session was not persisted. Signed/broadcast records remain in this browser.";
    }
  };
  $("#bch-export-signed").onclick = () => {
    if (!signed || !prepared) return show("No checked signed funding transaction is held in this tab.");
    const content = { network: "chipnet", ...signed, terms: prepared.summary,
      notice: "Signed authorization for the displayed test-token HTLC. Not proof of broadcast or confirmation. Contains no private key or swap secret." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "passage-signed-chipnet-funding.json"; link.click(); URL.revokeObjectURL(url);
    show("Signed funding exported. Keep its txid with your records and inspect Chipnet before any recovery broadcast or retry.");
  };
  $("#bch-export-records").onclick = () => {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(records(), null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "passage-chipnet-funding-records.json"; link.click(); URL.revokeObjectURL(url);
      show("Public funding records exported. Saved IDs and local status labels are not independent confirmation evidence.");
    } catch (error) { show(error.message); }
  };
}
