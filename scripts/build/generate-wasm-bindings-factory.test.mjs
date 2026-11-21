import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,chmod} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {renderFactory,generateWasmBindingsFactory} from './generate-wasm-bindings-factory.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),pkg=path.join(root,'packages/ferrum-web/pkg');
const source=await readFile(path.join(pkg,'ferrum_core.js'),'utf8');

test('generator preserves source and produces deterministic factory/type output',async()=>{
 const before=await readFile(path.join(pkg,'ferrum_core.js'));await generateWasmBindingsFactory(pkg);await generateWasmBindingsFactory(pkg,{check:true});
 assert.deepEqual(await readFile(path.join(pkg,'ferrum_core.js')),before);assert.equal(renderFactory(source),await readFile(path.join(pkg,'ferrum_core_factory.js'),'utf8'));
});
test('factory freshness rejects missing and stale JS/types without repairing them',async()=>{
 const dir=await mkdtemp(path.join(root,'.factory-test-'));try{
  await writeFile(path.join(dir,'ferrum_core.js'),source);await assert.rejects(generateWasmBindingsFactory(dir,{check:true}),/ENOENT/);
  await generateWasmBindingsFactory(dir);await writeFile(path.join(dir,'ferrum_core_factory.js'),'stale');await assert.rejects(generateWasmBindingsFactory(dir,{check:true}),/stale/);assert.equal(await readFile(path.join(dir,'ferrum_core_factory.js'),'utf8'),'stale');
  await generateWasmBindingsFactory(dir);await writeFile(path.join(dir,'ferrum_core_factory.d.ts'),'stale type');await assert.rejects(generateWasmBindingsFactory(dir,{check:true}),/stale/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('generator rejects unknown exports/finalizers/imports before producing output',()=>{
 assert.throws(()=>renderFactory(source+'\nexport function unknown() {}\n'),/unknown or missing/);
 assert.throws(()=>renderFactory(source.replace('ptr => wasm.__wbg_engine_free(ptr, 1)','ptr => wasm.__wbg_engine_free(ptr, 2)')),/finalizer/);
 assert.throws(()=>renderFactory('import x from "unexpected";\n'+source),/import/);
});
test('build wrapper generates factory only after successful wasm-pack (stubbed compiler, no Rust build)',async()=>{
 const dir=await mkdtemp(path.join(root,'.factory-build-test-'));try{
  const rustup=path.join(dir,'rustup'),pack=path.join(dir,'wasm-pack');await writeFile(rustup,'#!/bin/sh\nexit 1\n');await chmod(rustup,0o755);
  await writeFile(pack,'#!/bin/sh\nexit 23\n');await chmod(pack,0o755);const script=path.join(root,'scripts/build/build-wasm.mjs');
  const before=await readFile(path.join(pkg,'ferrum_core_factory.js'));
  const failure=spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,PATH:dir},encoding:'utf8'});assert.equal(failure.status,23);assert.deepEqual(await readFile(path.join(pkg,'ferrum_core_factory.js')),before);
  await writeFile(pack,'#!/bin/sh\nexit 0\n');const success=spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,PATH:dir},encoding:'utf8'});assert.equal(success.status,0,success.stderr);await generateWasmBindingsFactory(pkg,{check:true});
 }finally{await rm(dir,{recursive:true,force:true});}
});
