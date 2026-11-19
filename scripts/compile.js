import { compileFile } from 'cashc';
import solc from 'solc';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/TokenSwap.json',JSON.stringify(compileFile('contracts/TokenSwap.cash'),null,2));
const input={language:'Solidity',sources:{'StableSwap.sol':{content:readFileSync('contracts/StableSwap.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input)));
for(const issue of output.errors||[]) { if(issue.severity==='error')throw Error(issue.formattedMessage);console.error(issue.formattedMessage); }
writeFileSync('artifacts/StableSwap.json',JSON.stringify(output.contracts['StableSwap.sol'].StableSwap,null,2));
console.log('Contract artifacts written to artifacts/');
