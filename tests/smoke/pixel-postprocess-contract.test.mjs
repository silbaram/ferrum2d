import { test } from 'node:test';
import { deepEqual, throws } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateJsonSchemaContract } from '../../scripts/validate/json-schema-contract.mjs';
import { resolvePostProcessPasses } from '../../packages/ferrum-web/dist/authoring.js';
import { resolveShooterGameSpec } from '../../packages/ferrum-web/dist/starter-scenes.js';
const schema=JSON.parse(await readFile(new URL('../../schemas/shooter-game-spec.schema.json',import.meta.url),'utf8'));
const postSchema={...schema.$defs.postProcessing,$defs:schema.$defs};

test('pixelArt JSON schema and runtime accept the same bounded values and pass order',()=>{
  const pass={kind:'pixelArt',levels:4,dither:1,scanlineIntensity:.25};
  for(const input of [pass,[{opacity:.25},pass],{pixelArt:{levels:256,dither:0}},{pixelArt:false}]) {
    validateJsonSchemaContract(postSchema,input);
    const resolved=resolvePostProcessPasses(input);
    deepEqual(resolved.map(p=>p.kind),Array.isArray(input)?['fade','pixelArt']:input.pixelArt===false?[]:['pixelArt']);
  }
  for(const bad of [{levels:1},{levels:257},{levels:2.5},{levels:'4'},{dither:-.1},{dither:1.1},{scanlineIntensity:2}]) {
    for(const input of [{kind:'pixelArt',...bad},{pixelArt:bad}]) {
      throws(()=>validateJsonSchemaContract(postSchema,input));
      throws(()=>resolvePostProcessPasses(input));
    }
  }
});

test('postprocessing rejects malformed shapes even when disabled, through the full Game Spec resolver',()=>{
  const invalid=[
    {kind:'pixelArt',levels:4,typo:1}, {pixelArt:{levels:4,typo:1}}, {levels:4},
    {kind:null}, {enabled:'false',pixelArt:{}}, {enabled:null,pixelArt:{}},
    {enabled:false,pixelArt:null}, {enabled:false,pixelArt:{levels:1}},
    {kind:'pixelArt',pixelArt:{}}, {pixelArt:{kind:'pixelArt'}}, {enabled:true,typo:1},
    {passes:[{kind:'pixelArt',dither:null}]},
    {color:null},{fade:{color:null}},{vignette:{color:null}},
    {enabled:false,fade:{color:null},pixelArt:{}},
  ];
  for(const input of invalid) {
    throws(()=>validateJsonSchemaContract(postSchema,input),JSON.stringify(input));
    throws(()=>resolvePostProcessPasses(input),JSON.stringify(input));
    throws(()=>resolveShooterGameSpec({postProcessing:input}),JSON.stringify(input));
  }
});

test('valid default fade and disabled stacks remain backward compatible in schema and Game Spec',()=>{
  for(const input of [{},{enabled:false,pixelArt:{}},{enabled:false,passes:[{kind:'pixelArt'}]},
    {pixelArt:{}},[{kind:'pixelArt',levels:2},{kind:'pixelArt',levels:256}],{fade:{kind:'fade',opacity:.2}}]) {
    validateJsonSchemaContract(postSchema,input);
    deepEqual(resolveShooterGameSpec({postProcessing:input}).postProcessing,resolvePostProcessPasses(input));
  }
});
