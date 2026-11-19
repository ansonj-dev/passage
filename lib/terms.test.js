import test from "node:test";
import assert from "node:assert/strict";
import { preflight } from "./terms.js";
import { swapContract } from "./bch.js";
import { publicKeyToP2pkhCashAddress, hexToBin, encodeCashAddressNonStandard } from "@bitauth/libauth";
import { SigningKey } from "ethers";
const now=1795046400;
const keys=[1,2].map(n=>SigningKey.computePublicKey("0x"+String(n).padStart(64,"0"),true).slice(2));
const addresses=keys.map(key=>publicKeyToP2pkhCashAddress({publicKey:hexToBin(key),prefix:"bchtest",tokenSupport:true}).address);
const fixture=()=>({version:1,direction:"bch-first",evmAmount:"1000000",bch:{network:"chipnet",claimant:keys[0],refunder:keys[1],category:"a".repeat(64),hashlock:"b".repeat(64),amount:"1000000",claimAddress:addresses[0],refundAddress:addresses[1],expiry:now+14400},evm:{chainId:"11155111",contractAddress:"0x"+"1".repeat(40),tokenAddress:"0x"+"2".repeat(40),sender:"0x"+"3".repeat(40),receiver:"0x"+"4".repeat(40),expiry:now+7200}});
test("both swap directions enforce longer first-chain expiry",()=>{
  const p=fixture(); assert.equal(preflight(p,now).ready,true);
  p.direction="evm-first"; assert.equal(preflight(p,now).ready,false);
  [p.bch.expiry,p.evm.expiry]=[p.evm.expiry,p.bch.expiry]; assert.equal(preflight(p,now).ready,true);
});
test("malformed terms fail closed without date exceptions",()=>{
  for(const mutate of [p=>p.bch.claimant="02"+"f".repeat(64),p=>delete p.bch.claimant,p=>p.evm.receiver="0x"+"0".repeat(40),p=>p.bch.expiry=Number.MAX_SAFE_INTEGER,p=>p.bch.amount="9223372036854775808",p=>p.evmAmount=(1n<<256n).toString(),p=>p.bch.expiry=now+100,p=>p.bch.claimAddress=p.bch.refundAddress.replace("bchtest:","bitcoincash:")]) {
    const p=fixture();mutate(p);assert.equal(preflight(p,now).ready,false);
  }
  assert.equal(preflight(null,now).ready,false);
  const malformed=fixture(); malformed.evm.sender=42; malformed.bch.claimAddress={};
  assert.equal(preflight(malformed,now).ready,false);
  const unsupported=fixture(); unsupported.bch.claimAddress=encodeCashAddressNonStandard({prefix:"bchtest",typeBits:2,payload:new Uint8Array(24)}).address;
  assert.equal(preflight(unsupported,now).ready,false);
});
test("CashScript compiles deterministically and commits keys, secret hash and timeout",()=>{
  const p=fixture().bch, c=swapContract(p);
  assert.match(c.tokenAddress,/^bchtest:/);
  assert.equal(swapContract(p).tokenAddress,c.tokenAddress);
  assert.notEqual(swapContract({...p,expiry:p.expiry+1}).tokenAddress,c.tokenAddress);
  assert.notEqual(swapContract({...p,hashlock:"c".repeat(64)}).tokenAddress,c.tokenAddress);
  assert.notEqual(swapContract({...p,claimant:p.refunder,refunder:p.claimant}).tokenAddress,c.tokenAddress);
});
