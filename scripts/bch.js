import { readFileSync } from "node:fs";
import { swapContract, spend } from "../lib/bch.js";
import { preflight } from "../lib/terms.js";
const [command, path] = process.argv.slice(2);
if (!path)
  throw Error(
    "Usage: node scripts/bch.js address|inspect|preflight|claim|refund public-terms.json",
  );
const input = JSON.parse(readFileSync(path, "utf8")),
  spec = input.bch ?? input;
if (command === "address")
  console.log(
    JSON.stringify(
      { network: "chipnet", tokenAddress: swapContract(spec).tokenAddress },
      null,
      2,
    ),
  );
else if (command === "preflight")
  console.log(JSON.stringify(preflight(input), null, 2));
else if (command === "inspect") {
  const c = swapContract(spec);
  console.log(
    JSON.stringify(
      {
        network: "chipnet",
        observedAt: new Date().toISOString(),
        tokenAddress: c.tokenAddress,
        utxos: await c.getUtxos(),
        notice:
          "Single-server unspent output observation, not confirmation proof",
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
} else {
  if (!process.env.BCH_WIF) throw Error("Set BCH_WIF privately in your shell");
  const tx = await spend(
    spec,
    command,
    process.env.BCH_WIF,
    process.env.SWAP_SECRET,
  );
  if (process.env.BROADCAST !== "YES")
    throw Error(
      "Transaction prepared. To publish intentionally set BROADCAST=YES. No secret was printed.",
    );
  console.log(await tx.send());
}
