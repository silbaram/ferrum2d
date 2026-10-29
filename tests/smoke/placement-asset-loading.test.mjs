import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require=createRequire(new URL("../../apps/placement-viewer/package.json",import.meta.url)),ts=require("typescript");
const data=code=>"data:text/javascript;base64,"+Buffer.from(code).toString("base64");
// Only the locale presentation dependency is stubbed. Events, promises and AbortSignal are native.
const locale=data("export const setUiText=(e,t)=>{e.textContent=String(t)};export const setUiAttribute=(e,k,v)=>e.setAttribute(k,v);export const uiMessage=(t,...v)=>t.replace(/\\{(\\d+)\\}/g,(_,i)=>v[i]);");
const code=ts.transpileModule(await readFile("apps/placement-viewer/src/placementAssetLoading.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createPlacementAssetLoading}=await import(data(code.replace('"./placementLocale"',JSON.stringify(locale))));
class Element extends EventTarget {
  dataset={};children=[];hidden=false;textContent="";style={};
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this[name]=value;}
  remove(){this.removed=true;}
  click(){this.dispatchEvent(new Event("click"));}
}
function host(){const elements=[];globalThis.document={body:new Element(),createElement(){const e=new Element();elements.push(e);return e;}};globalThis.window={};return{elements,button:key=>elements.find(e=>e.dataset[key])};}
const tick=()=>new Promise(r=>setTimeout(r,0));
test("retry resumes the original caller and retains the failed source progress",async()=>{
  const h=host(),loader=createPlacementAssetLoading();let attempts=0;
  const result=loader.run("Models",async(signal,progress)=>{progress({loaded:2,total:4,name:"well.glb"});if(++attempts===1)throw new Error("offline");return 42;});
  await tick();assert.equal(window.ferrumPlacementAssetLoading.state,"error");assert.equal(window.ferrumPlacementAssetLoading.name,"well.glb");
  h.button("placementAssetRetry").click();assert.equal(await result,42);assert.equal(attempts,2);assert.equal(window.ferrumPlacementAssetLoading.loaded,2);loader.destroy();
});
test("cancel while waiting for retry settles the original request and removes its retry listener",async()=>{
  const h=host(),loader=createPlacementAssetLoading();let attempts=0;
  const result=loader.run("Models",async()=>{attempts++;throw new Error("offline");});
  const rejected=assert.rejects(result,/cancelled/);await tick();h.button("placementAssetCancel").click();await rejected;
  h.button("placementAssetRetry").click();await tick();assert.equal(attempts,1);assert.equal(window.ferrumPlacementAssetLoading.state,"cancelled");loader.destroy();
});
test("superseded delayed operations cannot overwrite a newer result, even if they ignore cancellation",async()=>{
  host();const loader=createPlacementAssetLoading();let complete;
  const old=loader.run("Old",async()=>new Promise(r=>complete=r));const rejected=assert.rejects(old,/replaced/);
  const next=await loader.run("New",async(signal,progress)=>{progress({loaded:3,total:3,name:"new.glb"});return "new";});
  complete("old");await rejected;assert.equal(next,"new");assert.equal(window.ferrumPlacementAssetLoading.name,"new.glb");loader.destroy();
});
test("cancel settles immediately while an uncooperative decode is still pending",async()=>{
  const h=host(),loader=createPlacementAssetLoading();let complete,settled=false,lateProgress;
  const result=loader.run("Models",async(signal,progress)=>{lateProgress=progress;return new Promise(r=>complete=r);});
  const rejected=assert.rejects(result,/cancelled/).then(()=>{settled=true;});
  h.button("placementAssetCancel").click();await tick();
  try { assert(settled,"cancel must release the caller before decode finishes"); }
  finally { complete("late");await rejected; }
  lateProgress({loaded:1,total:1,name:"stale.glb"});
  assert.equal(window.ferrumPlacementAssetLoading.state,"cancelled");loader.destroy();
});
test("a replaced request rejects before its old decode finishes and absorbs late failures",async()=>{
  host();const loader=createPlacementAssetLoading();let fail,settled=false;
  const old=loader.run("Old",async()=>new Promise((resolve,reject)=>fail=reject));
  const rejected=assert.rejects(old,/replaced/).then(()=>{settled=true;});
  await loader.run("New",async()=>"new");await tick();
  try { assert(settled,"replacement must release the superseded caller immediately"); }
  finally { fail(new Error("late decode failure"));await rejected; }
  assert.equal(window.ferrumPlacementAssetLoading.state,"ready");loader.destroy();
});
test("nonretryable errors propagate immediately and Close dismisses the error panel",async()=>{
  const h=host(),loader=createPlacementAssetLoading();await assert.rejects(loader.run("Models",async()=>{throw new Error("contentId mismatch");},undefined,()=>false),/contentId mismatch/);
  const panel=h.elements.find(e=>e.dataset.placementAssetLoading==="error");assert(!panel.hidden);h.button("placementAssetCancel").click();assert(panel.hidden);loader.destroy();
});
test("dispose aborts active work and prevents late publication or reuse",async()=>{
  host();const loader=createPlacementAssetLoading();let complete;
  const result=loader.run("Models",async()=>new Promise(r=>complete=r)),rejected=assert.rejects(result,/disposed/);loader.destroy();complete("late");await rejected;
  await assert.rejects(loader.run("Again",async()=>0),/disposed/);
});
test("Escape cancels the loading request through the keyboard-accessible popup",async()=>{
  const h=host(),loader=createPlacementAssetLoading(),result=loader.run("Models",async()=>{throw new Error("offline");}),rejected=assert.rejects(result,/cancelled/);
  await tick();const panel=h.elements.find(e=>e.dataset.placementAssetLoading==="error"),event=new Event("keydown",{cancelable:true});Object.defineProperty(event,"code",{value:"Escape"});panel.dispatchEvent(event);await rejected;assert(event.defaultPrevented);loader.destroy();
});
