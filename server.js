import express from "express";
import { createServer } from "vite";
import { swapContract } from "./lib/bch.js";
const app = express();
const port = Number(process.env.PASSAGE_PORT || 4101);
const hmrPort = Number(process.env.PASSAGE_HMR_PORT || 24101);
if (![port, hmrPort].every(value => Number.isInteger(value) && value >= 1 && value <= 65535))
  throw Error("PASSAGE_PORT and PASSAGE_HMR_PORT must be valid TCP ports");
app.set("json replacer", (_, v) => (typeof v === "bigint" ? v.toString() : v));
app.use(express.json({ limit: "16kb" }));
app.post("/api/address", (req, res) => {
  try {
    const c = swapContract(req.body);
    res.json({
      network: "chipnet",
      address: c.tokenAddress,
      bytecode: c.bytecode,
      bytes: c.bytesize,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/inspect", async (req, res) => {
  try {
    const c = swapContract(req.body);
    const utxos = await c.getUtxos();
    res
      .set("Cache-Control", "no-store")
      .json({
        network: "chipnet",
        address: c.tokenAddress,
        observedAt: new Date().toISOString(),
        utxos,
        notice:
          "Unspent outputs observed from one Electrum server. Confirmation depth and counterparty terms must be checked separately.",
      });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.use(
  (
    await createServer({
      server: { middlewareMode: true, hmr: { port: hmrPort } },
      appType: "spa",
    })
  ).middlewares,
);
app.listen(port, "127.0.0.1", () =>
  console.log(`Passage http://localhost:${port}`),
);
