import { swapContract } from "../lib/bch.js";

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  ));
}

export default function handler(req, res) {
  if (req.method !== "POST")
    return sendJson(res, 405, { error: "POST required." });
  try {
    const contract = swapContract(req.body);
    return sendJson(res, 200, {
      network: "chipnet",
      address: contract.tokenAddress,
      bytecode: contract.bytecode,
      bytes: contract.bytesize,
    });
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
}
