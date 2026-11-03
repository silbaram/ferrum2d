import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveSpritePalettes, validatePaletteTexture, type SpritePaletteSwap } from "../src/spritePalette.js";
import { resolveSpriteMaterialPreset, spriteMaterialPasses, spriteMaterialPassRequiresCommandCopy } from "../src/spriteMaterial.js";

const colors=[{from:"#aBcD01",to:"#102030"}];
const input=()=>[{textureId:7,colors:colors.map(pair=>({...pair}))}];

test("palette normalization owns RGB8 tables and treats hex case as equivalent",()=>{
  const source=input(), tables=resolveSpritePalettes(source)!;
  source[0].colors[0].from="#000000"; source[0].colors[0].to="#ffffff";
  const entry=tables.get(7)!;
  equal(entry.count,1); deepEqual([...entry.from.slice(0,4)],[171,205,1,0]);
  equal(entry.to[0],Math.fround(16/255)); equal(entry.to[3],0);
  equal(entry.key,resolveSpritePalettes([{textureId:7,colors:[{from:"#abcd01",to:"#102030"}]}])!.get(7)!.key);
});

test("palette is opt-in, base-only, and does not cause command staging or ABI copies",()=>{
  equal(resolveSpritePalettes([]),undefined);
  equal(resolveSpriteMaterialPreset(false).paletteSwap,undefined);
  const passes=spriteMaterialPasses(resolveSpriteMaterialPreset({paletteSwap:input(),outline:true}));
  equal(passes.length,5);
  for(const pass of passes.slice(0,4)) equal(pass.paletteSwap,undefined);
  equal(passes[4].paletteSwap?.size,1); equal(spriteMaterialPassRequiresCommandCopy(passes[4]),false);
});

test("palette rejects ambiguous, sparse and malformed bindings",()=>{
  const invalid:unknown[]=[null,{},new Array(1),[{textureId:-1,colors}], [{textureId:1.1,colors}], [{textureId:0x1000000,colors}],
    [{textureId:NaN,colors}], [...input(),...input()], [{textureId:7,colors:[]}], [{textureId:7,colors:new Array(2)}],
    [{textureId:7,colors:[...colors,{from:"#ABCD01",to:"#ffffff"}]}],
    ...["#abc","#11223344","red","#gg1122",null,1].map(from=>[{textureId:7,colors:[{from,to:"#000000"}]}]),
    [{textureId:7,colors:[{from:"#000000",to:"#fff"}]}],
  ];
  for(const value of invalid) throws(()=>resolveSpritePalettes(value as SpritePaletteSwap[]),/paletteSwap/);
});

test("palette enforces both binding and color budgets",()=>{
  const binding={textureId:0xffffff,colors:Array.from({length:32},(_,i)=>({from:"#"+i.toString(16).padStart(6,"0"),to:"#ffffff"}))};
  equal(resolveSpritePalettes([binding])?.get(0xffffff)?.count,32);
  throws(()=>resolveSpritePalettes([{...binding,colors:[...binding.colors,{from:"#ffffff",to:"#000000"}]}]),/1..32/);
  equal(resolveSpritePalettes(Array.from({length:64},(_,textureId)=>({...binding,textureId})))?.size,64);
  throws(()=>resolveSpritePalettes(Array.from({length:65},(_,textureId)=>({...binding,textureId}))),/64/);
});

test("palette diagnoses legacy premultiplication and unsupported render textures",()=>{
  throws(()=>validatePaletteTexture(undefined,false),/RenderTexture/);
  throws(()=>validatePaletteTexture({colorSpace:"none",compressed:true},false),/ktx2Url/);
  throws(()=>validatePaletteTexture({colorSpace:"srgb"},false),/colorSpace/);
  equal(validatePaletteTexture({colorSpace:"srgb"},true),true);
  for(const colorSpace of ["linear","none"] as const) for(const linear of [true,false]) equal(validatePaletteTexture({colorSpace},linear),false);
});
