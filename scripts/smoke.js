import { spawn } from "node:child_process";
import { once } from "node:events";
import { SigningKey } from "ethers";
const children = [];
async function start(args, marker, env = {}) {
  const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, ...env } });
  children.push(child); let output = "";
  child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  for (let i = 0; i < 100 && !output.includes(marker); i++) {
    if (child.exitCode !== null) throw Error(output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!output.includes(marker) || child.exitCode !== null) throw Error(output || "Local server failed to start");
}
try {
  await start(["server.js"], "Passage http://localhost:14101", { PASSAGE_PORT: "14101", PASSAGE_HMR_PORT: "24111" });
  const root = "http://127.0.0.1:14101";
  if ((await fetch(root)).status !== 200) throw Error("Development page failed");
  const module = await fetch(root + "/src/chipnet-wallet.js");
  if (module.status !== 200 || !(await module.text()).includes("Start new Chipnet wallet pairing")) throw Error("Wallet module not served");
  const keys = [1, 2].map(n => SigningKey.computePublicKey("0x" + String(n).padStart(64, "0"), true).slice(2));
  const request = async spec => fetch(root + "/api/address", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
  const response = await request({ claimant: keys[0], refunder: keys[1], hashlock: "a".repeat(64), expiry: Math.floor(Date.now() / 1000) + 14400 });
  const result = await response.json();
  if (response.status !== 200 || result.network !== "chipnet" || !result.address.startsWith("bchtest:")) throw Error("Chipnet derivation API failed");
  if ((await request({})).status !== 400) throw Error("Malformed contract terms were accepted");
  await start(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "14201", "--strictPort"], "127.0.0.1:14201", { NO_COLOR: "1" });
  const production = "http://127.0.0.1:14201", page = await fetch(production);
  const html = await page.text(), assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
  if (page.status !== 200 || assets.length < 2) throw Error("Production index/assets missing");
  for (const asset of assets) if ((await fetch(production + asset)).status !== 200) throw Error("Missing production asset " + asset);
  console.log(`PASS local HTTP smoke: app, wallet module, Chipnet address derivation, malformed-input rejection, production index and ${assets.length} assets. No wallet relay, chain query, signing or broadcast performed.`);
} finally {
  for (const child of children) if (child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
}
