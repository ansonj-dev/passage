import test from "node:test";
import assert from "node:assert/strict";
import { MockNetworkProvider, SignatureTemplate, SighashType } from "cashscript";
import { DappConnectionManager } from "@wizardconnect/dapp";
import { binToHex, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, decodeTransaction, encodeTransaction, hexToBin, publicKeyToP2pkhCashAddress } from "@bitauth/libauth";
import { buildChipnetFunding, deriveFundingAddress, verifySignedFunding, signChipnetFunding, broadcastChipnetFunding } from "./chipnet-funding.js";
import { swapContract } from "./bch.js";

const now=1795046400;
const signers=[1,2,3].map(n=>new SignatureTemplate(hexToBin(n.toString(16).padStart(64,"0"))));
const address=key=>publicKeyToP2pkhCashAddress({publicKey:key,prefix:"bchtest",tokenSupport:true}).address;
function fixture({amount=50n,tokenSats=10000n,cash=false}={}) {
  const provider=new MockNetworkProvider(); provider.network="chipnet";
  const from=address(signers[0].publicKey), change=address(signers[1].publicKey);
  const plan={version:1,direction:"bch-first",evmAmount:"50",bch:{network:"chipnet",claimant:binToHex(signers[1].publicKey),refunder:binToHex(signers[2].publicKey),hashlock:"b".repeat(64),category:"a".repeat(64),amount:"50",expiry:now+14400,claimAddress:change,refundAddress:address(signers[2].publicKey)},evm:{chainId:"11155111",contractAddress:"0x"+"1".repeat(40),tokenAddress:"0x"+"2".repeat(40),sender:"0x"+"3".repeat(40),receiver:"0x"+"4".repeat(40),expiry:now+7200}};
  plan.bch.address=deriveFundingAddress(plan,provider);
  const utxo=provider.addUtxo(from,{txid:"1".repeat(64),vout:0,satoshis:tokenSats,token:{category:plan.bch.category,amount}});
  const walletUtxos=[{utxo,from,path:0,index:0}];
  if(cash)walletUtxos.push({utxo:provider.addUtxo(from,{txid:"2".repeat(64),vout:0,satoshis:10000n}),from,path:0,index:0});
  const args={plan,walletUtxos,changeAddress:change,provider,now};
  return {...args,args};
}
function signedFunding(funding) {
  funding.builder.inputs.forEach(input=>{input.unlocker=signers[0].unlockP2PKH();});
  return funding.builder.build();
}
test("funding locks exact tokens and 2500 sats, preserves change, and never asks wallet to broadcast",()=>{
  const f=fixture({amount:100n}), funding=buildChipnetFunding(f.args);
  assert.equal(funding.request.broadcast,false);
  assert.deepEqual(funding.inputPaths,[[0,"receive",0]]);
  assert.equal(funding.summary.tokenAmount,"50");assert.equal(funding.summary.tokenChange,"50");
  assert.equal(funding.summary.contractSats,"2500");assert.equal(funding.summary.feeSats,"1500");
  assert.equal(funding.request.transaction.outputs.reduce((sum,o)=>sum+(o.token?.amount??0n),0n),100n);
  assert.equal(funding.request.transaction.outputs.reduce((sum,o)=>sum+o.valueSatoshis,0n),8500n);
  assert.match(verifySignedFunding(signedFunding(funding),funding.request).txid,/^[a-f0-9]{64}$/);
});
test("a BCH-only fee input is used when test tokens have only dust; unrelated tokens/NFTs are excluded",()=>{
  const f=fixture({tokenSats:1000n,cash:true});
  f.walletUtxos.unshift({...f.walletUtxos[0],utxo:{...f.walletUtxos[0].utxo,txid:"3".repeat(64),token:{category:f.plan.bch.category,amount:500n,nft:{capability:"none",commitment:""}}}});
  const funding=buildChipnetFunding(f.args);
  assert.equal(funding.inputPaths.length,2);assert.equal(funding.request.transaction.outputs.length,2);
  assert.equal(funding.summary.tokenChange,"0");
  assert.match(verifySignedFunding(signedFunding(funding),funding.request).txid,/^[a-f0-9]{64}$/);
});
test("mainnet provider/terms, mismatched contract, insufficient tokens and oversized BCH input fail closed",()=>{
  for(const mutate of [f=>f.provider.network="mainnet",f=>f.plan.bch.network="mainnet",f=>f.plan.bch.address=f.changeAddress,f=>f.walletUtxos[0].utxo.token.amount=1n,f=>f.walletUtxos[0].utxo.token.category="c".repeat(64),f=>f.walletUtxos[0].utxo.token.nft={capability:"none",commitment:""},f=>f.walletUtxos[0].utxo.lockingBytecode="00",f=>f.walletUtxos[0].utxo.satoshis=1000001n,f=>f.changeAddress=f.changeAddress.replace("bchtest:","bitcoincash:"),f=>f.walletUtxos[0].path=7]) {
    const f=fixture();mutate(f);assert.throws(()=>buildChipnetFunding(f),Error);
  }
});
test("signed funding rejects altered category, token quantity, output address, inputs and invalid signatures",()=>{
  const f=fixture(),funding=buildChipnetFunding(f.args);
  assert.throws(()=>verifySignedFunding(binToHex(encodeTransaction(funding.request.transaction)),funding.request),/P2PKH signatures/);
  for(const mutate of [tx=>tx.outputs[0].token.amount++,tx=>tx.outputs[0].token.category[0]++,tx=>tx.outputs[0].lockingBytecode[0]++,tx=>tx.outputs.at(-1).valueSatoshis++,tx=>tx.inputs[0].outpointIndex++,tx=>tx.inputs[0].sequenceNumber--,tx=>tx.locktime++]) {
    const changed=structuredClone(funding.request.transaction);mutate(changed);
    assert.throws(()=>verifySignedFunding(binToHex(encodeTransaction(changed)),funding.request),/differs/);
  }
  const invalidSignature=decodeTransaction(hexToBin(signedFunding(funding)));
  invalidSignature.inputs[0].unlockingBytecode[5]^=1;
  assert.throws(()=>verifySignedFunding(binToHex(encodeTransaction(invalidSignature)),funding.request),/local BCH validation/);
});
test("bundled browser contract address matches the independently compiled CashScript source",()=>{
  const f=fixture();
  assert.equal(deriveFundingAddress(f.plan,f.provider),swapContract(f.plan.bch).tokenAddress);
});
test("wallet signatures must commit all outputs and source UTXOs",()=>{
  for(const flags of [SighashType.SIGHASH_ALL,SighashType.SIGHASH_NONE|SighashType.SIGHASH_UTXOS]) {
    const f=fixture(),funding=buildChipnetFunding(f.args);
    const signer=new SignatureTemplate(signers[0].privateKey,flags);
    funding.builder.inputs.forEach(input=>{input.unlocker=signer.unlockP2PKH();});
    assert.throws(()=>verifySignedFunding(funding.builder.build(),funding.request),/SIGHASH_ALL/);
  }
});
test("signing sends exact HD paths with broadcast false and verifies returned transaction locally",async()=>{
  const f=fixture(),funding=buildChipnetFunding(f.args),raw=signedFunding(funding);
  const controller=new AbortController();let calls=0;
  const manager={async signTransaction(request,options){calls++;assert.equal(request.transaction.broadcast,false);assert.deepEqual(request.inputPaths,[[0,"receive",0]]);assert.equal(options.signal,controller.signal);return {signedTransaction:raw};}};
  const signed=await signChipnetFunding({funding,manager,provider:f.provider,signal:controller.signal});
  assert.equal(calls,1);assert.equal(signed.rawHex,raw);
  await assert.rejects(signChipnetFunding({funding,manager,provider:{network:"mainnet"}}),/mainnet/);
  assert.equal(calls,1);
});
test("Chipnet broadcast saves txid first; failures remain unknown and mainnet never calls transport",async()=>{
  const order=[],signed={txid:"a".repeat(64),rawHex:"00"};
  const provider={network:"chipnet",async sendRawTransaction(){order.push("broadcast");throw Error("offline");}};
  await assert.rejects(broadcastChipnetFunding({signed,provider,saveBeforeBroadcast:async txid=>{assert.equal(txid,signed.txid);order.push("save");}}),/outcome unknown/);
  assert.deepEqual(order,["save","broadcast"]);
  await assert.rejects(broadcastChipnetFunding({signed,provider:{...provider,network:"mainnet"},saveBeforeBroadcast:async()=>order.push("bad-save")}),/mainnet/);
  assert.deepEqual(order,["save","broadcast"]);
});
test("published WizardConnect API derives receive/change keys without undocumented allocation methods",async()=>{
  const manager=new DappConnectionManager("Offline compatibility test",undefined,{session:false});
  const privateNode=deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(7));
  manager.pubkeyState.setXpubNode(0,deriveHdPublicNode(privateNode));
  manager.pubkeyState.setXpubNode(1,deriveHdPublicNode(privateNode));
  assert.equal(manager.getPubkey(0,0n).length,33);
  assert.equal(manager.getPubkey(1,0n).length,33);
  assert.match(address(manager.getPubkey(1,0n)),/^bchtest:/);
  assert.equal(typeof manager.signTransaction,"function");
  assert.equal(manager.loadStoredSession(),null);
  await manager.destroy();
});
test("broadcast accepts only the exact saved Chipnet txid, with failed persistence stopping transport",async()=>{
  const signed={txid:"a".repeat(64),rawHex:"00"};let sends=0;
  const provider={network:"chipnet",async sendRawTransaction(){sends++;return signed.txid;}};
  assert.equal(await broadcastChipnetFunding({signed,provider,saveBeforeBroadcast:async()=>{}}),signed.txid);
  await assert.rejects(broadcastChipnetFunding({signed,provider,saveBeforeBroadcast:async()=>{throw Error("storage full");}}),/storage full/);
  assert.equal(sends,1);
  await assert.rejects(broadcastChipnetFunding({signed,provider:{...provider,sendRawTransaction:async()=>"b".repeat(64)},saveBeforeBroadcast:async()=>{}}),/outcome unknown/);
});
