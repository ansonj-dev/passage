import { swapContract } from "../lib/bch.js";

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  ));
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return sendJson(res, 405, { error: "POST required." });
  try {
    const contract = swapContract(req.body);
    const utxos = await contract.getUtxos();
    return sendJson(res, 200, {
      network: "chipnet",
      address: contract.tokenAddress,
      observedAt: new Date().toISOString(),
      utxos,
      notice:
        "Unspent outputs observed from one Electrum server. Confirmation depth and counterparty terms must be checked separately.",
    });
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
}
