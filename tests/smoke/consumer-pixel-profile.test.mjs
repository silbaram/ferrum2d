import assert from 'node:assert/strict';
import {test} from 'node:test';
import fsPromises,{mkdtemp,mkdir,writeFile,rm,symlink,cp,readFile,rename,realpath} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encodePngRgba} from '../../scripts/tools/pack-textures.mjs';
import {validatePixelArtProfile,decodePixelPng} from '../../packages/create-game/templates/_shared/scripts/ferrum-pixel-assets.mjs';
const validatorUrl=new URL('../../packages/create-game/templates/_shared/scripts/ferrum-pixel-assets.mjs',import.meta.url).href;
const encoderUrl=new URL('../../scripts/tools/pack-textures.mjs',import.meta.url).href;
const profile={format:'ferrum2d.consumer.pixel-art-profile',version:1,scale:3,filter:'nearest',palette:['#12345600','#ff0000ff'],assets:[{source:'public/assets/sprite.png',tileWidth:2,tileHeight:2}]};
const pixels=Buffer.from([18,52,86,0,255,0,0,255,255,0,0,255,18,52,86,0]);
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'ferrum-pixel-profile-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'public/assets'),{recursive:true});
  await writeFile(join(root,'public/assets/sprite.png'),encodePngRgba(2,2,pixels));
  const save=async value=>writeFile(join(root,'public/assets/pixel-art.profile.json'),JSON.stringify(value));await save(profile);return {root,save};
}
test('profile decodes RGBA losslessly and checks palette/grid with declared-only scope',async t=>{
  const {root}=await fixture(t),before=await readFile(join(root,'public/assets/sprite.png'));
  assert.deepEqual(decodePixelPng(before).pixels,pixels);
  const result=await validatePixelArtProfile({root,required:true});assert.equal(result.ok,true);assert.equal(result.runtimeVerified,false);assert.equal(result.scope,'declared-profile-and-png');
  assert.deepEqual(result.assets,[{source:profile.assets[0].source,width:2,height:2,frames:1,colors:2,colorsCapped:false}]);assert.deepEqual(await readFile(join(root,'public/assets/sprite.png')),before);
});
test('palette, tile, scale and sampling errors have stable diagnostic paths and fail status',async t=>{
  const {root,save}=await fixture(t);
  for(const [change,code] of [
    [p=>p.scale=1.5,'SCALE'],[p=>p.filter='linear','FILTER'],[p=>p.palette=['#ff0000ff'],'PALETTE_PIXEL'],
    [p=>p.palette=['red'],'PALETTE'],[p=>p.assets[0].tileWidth=3,'TILE_GRID'],[p=>p.assets[0].tileHeight=0,'TILE_SIZE'],
    [p=>p.assets.push(p.assets[0]),'ASSET'],[p=>p.assets=[],'ASSETS']]) {
    const value=structuredClone(profile);change(value);await save(value);const result=await validatePixelArtProfile({root});
    assert.equal(result.ok,false);assert(result.reports.some(r=>r.code==='FERRUM_PIXEL_'+code&&r.path&&r.severity==='error'));
  }
});
test('atlas content rectangles and actual extrusion are validated independently of padding pixels',async t=>{
  const {root,save}=await fixture(t),bytes=Buffer.alloc(4*4*4);for(let i=0;i<bytes.length;i+=4)bytes.set([255,0,0,255],i);
  await writeFile(join(root,'public/assets/sprite.png'),encodePngRgba(4,4,bytes));
  const value=structuredClone(profile);value.assets[0].atlas={padding:1,extrude:1,frames:[{x:1,y:1,width:2,height:2}]};await save(value);
  assert.equal((await validatePixelArtProfile({root})).ok,true);
  bytes[0]=0;await writeFile(join(root,'public/assets/sprite.png'),encodePngRgba(4,4,bytes));assert((await validatePixelArtProfile({root})).reports.some(r=>r.code==='FERRUM_PIXEL_ATLAS_EXTRUDE'));
  value.assets[0].atlas.frames.push({x:2,y:2,width:2,height:2});await save(value);assert((await validatePixelArtProfile({root})).reports.some(r=>r.code==='FERRUM_PIXEL_ATLAS_OVERLAP'));
  value.assets[0].atlas={padding:1,extrude:0,frames:[{x:0,y:0,width:2,height:2},{x:2,y:0,width:2,height:2}]};await save(value);assert((await validatePixelArtProfile({root})).reports.some(r=>r.code==='FERRUM_PIXEL_ATLAS_PADDING'));
  value.assets[0].atlas.frames=[{x:1.5,y:1,width:2,height:2}];await save(value);assert((await validatePixelArtProfile({root})).reports.some(r=>r.code==='FERRUM_PIXEL_ATLAS_RECT'));
});
test('missing, malformed, escaping and corrupt inputs reject without reads outside the project or writes',async t=>{
  const {root,save}=await fixture(t);await rm(join(root,'public/assets/pixel-art.profile.json'));
  assert.equal((await validatePixelArtProfile({root})).configured,false);assert.equal((await validatePixelArtProfile({root,required:true})).ok,false);
  await writeFile(join(root,'public/assets/pixel-art.profile.json'),'{');assert.equal((await validatePixelArtProfile({root})).ok,false);
  for(const source of ['../escape.png','/tmp/escape.png','public/assets/missing.png']) {const value=structuredClone(profile);value.assets[0].source=source;await save(value);assert.equal((await validatePixelArtProfile({root})).ok,false);}
  const external=await mkdtemp(join(tmpdir(),'ferrum-pixel-external-'));t.after(()=>rm(external,{recursive:true,force:true}));await writeFile(join(external,'x.png'),encodePngRgba(2,2,pixels));await symlink(join(external,'x.png'),join(root,'public/assets/link.png'));
  const value=structuredClone(profile);value.assets[0].source='public/assets/link.png';await save(value);assert.match((await validatePixelArtProfile({root})).reports[0].message,/outside/);
  const png=encodePngRgba(2,2,pixels),badType=Buffer.from(png);for(let i=12;i<16;i++)badType[i]|=128;
  let crc=0xffffffff;for(const byte of badType.subarray(12,29)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}badType.writeUInt32BE((crc^0xffffffff)>>>0,29);
  assert.throws(()=>decodePixelPng(badType),/chunk type/);
  for(const input of [png.subarray(0,15),Buffer.concat([png,Buffer.from([0])]),Buffer.from(png).fill(0,29,33)])assert.throws(()=>decodePixelPng(input));
});
test('generated CLI propagates required profile failures and reports through asset validation',async t=>{
  const {root,save}=await fixture(t);await mkdir(join(root,'scripts'));
  for(const name of ['ferrum-assets.mjs','ferrum-pixel-assets.mjs'])await cp(new URL('../../packages/create-game/templates/_shared/scripts/'+name,import.meta.url),join(root,'scripts',name));
  await mkdir(join(root,'node_modules/@ferrum2d'),{recursive:true});await symlink(resolve('packages/ferrum-web'),join(root,'node_modules/@ferrum2d/ferrum-web'));
  const run=(...args)=>{const r=spawnSync(process.execPath,['scripts/ferrum-assets.mjs',...args],{cwd:root,encoding:'utf8',timeout:5000});assert.ifError(r.error);return {...r,report:r.stdout.trim()?JSON.parse(r.stdout):undefined};};
  const pass=run('validate','--profile','pixel-art');assert.equal(pass.status,0,pass.stderr);assert.equal(pass.report.ok,true);assert.equal(pass.report.assetPipeline.pixelArt.runtimeVerified,false);
  const bad={...profile,scale:1.25};await save(bad);const fail=run('validate');assert.equal(fail.status,1,fail.stderr);assert.equal(fail.report.ok,false);assert(fail.report.assetPipeline.reports.some(r=>r.code==='FERRUM_PIXEL_SCALE'));
  await writeFile(join(root,'public/assets/texture-atlas.input.json'),'{');
  const mixed=run('validate');assert.equal(mixed.status,1);assert.equal(mixed.report.ok,false);
  assert(mixed.report.assetPipeline.reports.some(r=>r.code==='FERRUM_PIXEL_SCALE'));assert(mixed.report.assetPipeline.reports.some(r=>r.code==='FERRUM_CONSUMER_ASSET_VALIDATION_FAILED'));
  await rm(join(root,'public/assets/texture-atlas.input.json'));
  await rm(join(root,'public/assets/pixel-art.profile.json'));assert.equal(run('report','--profile','pixel-art').status,1);assert.equal(run('validate').status,0);
  assert.equal(run('validate','--profile','typo').status,1);
});

// These hooks schedule real filesystem replacements at the open boundary. The
// validator still uses actual descriptors and bytes, and every hook is restored.
async function withFsHook(name,makeHook,run) {
  const original=fsPromises[name];
  fsPromises[name]=makeHook(original);syncBuiltinESMExports();
  try {return await run();}
  finally {fsPromises[name]=original;syncBuiltinESMExports();}
}

for(const replacement of ['leaf','parent'])test(`rejects ${replacement} symlink replacement before any outside bytes are read`,async t=>{
  const {root}=await fixture(t),target=join(root,'public/assets/sprite.png');
  const outside=await mkdtemp(join(tmpdir(),'ferrum-pixel-race-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'sprite.png'),encodePngRgba(2,2,pixels));
  let swapped=false,reads=0,closed=0;
  const result=await withFsHook('open',original=>async function(file,...args) {
    if(file!==target)return original.call(this,file,...args);
    swapped=true;
    if(replacement==='leaf') {await rm(target);await symlink(join(outside,'sprite.png'),target);}
    else {await rename(join(root,'public/assets'),join(root,'public/saved-assets'));await symlink(outside,join(root,'public/assets'),'dir');}
    const handle=await original.call(this,file,...args),read=handle.read.bind(handle),close=handle.close.bind(handle);
    handle.read=(...values)=>{reads++;return read(...values);};
    handle.close=(...values)=>{closed++;return close(...values);};
    return handle;
  },()=>validatePixelArtProfile({root,required:true}));
  assert.equal(swapped,true);assert.equal(result.ok,false);assert.equal(reads,0);
  assert(result.reports.some(r=>r.code==='FERRUM_PIXEL_PNG'));
  if(replacement==='parent')assert.equal(closed,1,'rejecting an opened file must close its descriptor');
});

test('rejects a same-path file replacement by descriptor identity',async t=>{
  const {root}=await fixture(t),target=join(root,'public/assets/sprite.png');let swapped=false,reads=0;
  const result=await withFsHook('open',original=>async function(file,...args) {
    if(file!==target)return original.call(this,file,...args);
    await rename(target,target+'.old');await writeFile(target,encodePngRgba(2,2,pixels));swapped=true;
    const handle=await original.call(this,file,...args),read=handle.read.bind(handle);
    handle.read=(...values)=>{reads++;return read(...values);};return handle;
  },()=>validatePixelArtProfile({root}));
  assert.equal(swapped,true);assert.equal(result.ok,false);assert.equal(reads,0);
  assert.match(result.reports[0].message,/changed/i);
});

test('does not silently skip a profile removed after discovery',async t=>{
  const {root}=await fixture(t),target=join(root,'public/assets/pixel-art.profile.json');let removed=false;
  const result=await withFsHook('open',original=>async function(file,...args) {
    if(file===target){await rm(target);removed=true;}
    return original.call(this,file,...args);
  },()=>validatePixelArtProfile({root}));
  assert.equal(removed,true);assert.equal(result.configured,true);assert.equal(result.ok,false);
  assert.equal(result.reports[0].code,'FERRUM_PIXEL_PROFILE');
});

test('portable file checks work when Linux descriptor paths are unavailable',async t=>{
  const {root}=await fixture(t);
  const result=await withFsHook('readlink',original=>async function(file,...args) {
    if(String(file).startsWith('/proc/self/fd/'))throw Object.assign(Error('procfs unavailable'),{code:'ENOENT'});
    return original.call(this,file,...args);
  },()=>validatePixelArtProfile({root,required:true}));
  assert.equal(result.ok,true);assert.equal(result.assets.length,1);
});

test('non-Linux path branches do not require a Linux descriptor lookup',async t=>{
  const {root}=await fixture(t),platform=Object.getOwnPropertyDescriptor(process,'platform');
  // Exercise the portable branch on this host; this is not a native OS test.
  for(const value of ['darwin','win32']) {
    Object.defineProperty(process,'platform',{...platform,value});
    try {
      const result=await withFsHook('readlink',()=>async()=>{throw Error('Unexpected platform-specific descriptor lookup');},()=>validatePixelArtProfile({root,required:true}));
      assert.equal(result.ok,true,value);
    } finally {Object.defineProperty(process,'platform',platform);}
  }
});

test('Linux checks the opened descriptor path after portable path verification',{skip:process.platform!=='linux'},async t=>{
  const {root}=await fixture(t),target=join(root,'public/assets/sprite.png');
  const outside=await mkdtemp(join(tmpdir(),'ferrum-pixel-opened-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  let moved=false,reads=0;
  const result=await withFsHook('open',original=>async function(file,...args) {
    const handle=await original.call(this,file,...args);
    if(file===target){const read=handle.read.bind(handle);handle.read=(...values)=>{reads++;return read(...values);};}
    return handle;
  },()=>withFsHook('readlink',original=>async function(file,...args) {
    const opened=await original.call(this,file,...args);
    if(!moved&&opened===target) {
      await rename(target,join(outside,'sprite.png'));await writeFile(target,encodePngRgba(2,2,pixels));moved=true;
      return original.call(this,file,...args);
    }
    return opened;
  },()=>validatePixelArtProfile({root,required:true})));
  assert.equal(moved,true);assert.equal(reads,0);assert.equal(result.ok,false);
  assert.match(result.reports[0].message,/opened asset/i);
});

test('a same-length write during the read invalidates the file snapshot',async t=>{
  const {root}=await fixture(t),target=join(root,'public/assets/sprite.png'),replacement=Buffer.from(await readFile(target));
  replacement[replacement.length-1]^=1;let wrote=false;
  const result=await withFsHook('open',original=>async function(file,...args) {
    const handle=await original.call(this,file,...args);
    if(file===target){const read=handle.read.bind(handle);handle.read=async(...values)=>{const value=await read(...values);if(!wrote){await writeFile(target,replacement);wrote=true;}return value;};}
    return handle;
  },()=>validatePixelArtProfile({root,required:true}));
  assert.equal(wrote,true);assert.equal(result.ok,false);assert.match(result.reports[0].message,/changed while reading/i);
});

test('a profile and PNG can use ordinary in-project symlinks',async t=>{
  const {root,save}=await fixture(t);
  await symlink(join(root,'public/assets/sprite.png'),join(root,'public/assets/alias.png'));
  await save({...profile,assets:[{...profile.assets[0],source:'public/assets/alias.png'}]});
  const actual=join(root,'public/assets/actual-profile.json');
  await rename(join(root,'public/assets/pixel-art.profile.json'),actual);
  await symlink(actual,join(root,'public/assets/pixel-art.profile.json'));
  assert.equal((await validatePixelArtProfile({root,required:true})).ok,true);
});

test('FIFO profile and PNG paths fail promptly, including a replacement during open',{skip:process.platform==='win32'},async t=>{
  const {root}=await fixture(t),script=new URL('../../packages/create-game/templates/_shared/scripts/ferrum-assets.mjs',import.meta.url);
  for(const source of ['public/assets/sprite.png','public/assets/pixel-art.profile.json']) {
    const target=join(root,source),saved=await readFile(target);await rm(target);
    const made=spawnSync('mkfifo',[target],{encoding:'utf8',timeout:5000});assert.ifError(made.error);assert.equal(made.status,0,made.stderr);
    const child=spawnSync(process.execPath,[fileURLToPath(script),'report'],{cwd:root,encoding:'utf8',timeout:2000,killSignal:'SIGKILL'});
    assert.ifError(child.error);assert.equal(child.status,1,child.stderr);
    const result=JSON.parse(child.stdout);assert.equal(result.ok,false);
    assert(result.assetPipeline.reports.some(r=>r.code==='FERRUM_PIXEL_'+(source.endsWith('.png')?'PNG':'PROFILE')));
    await rm(target);await writeFile(target,saved);
  }
  // A pre-open stat alone is insufficient: replace the previously regular PNG.
  const code=`
    import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {spawnSync} from 'node:child_process';
    import {validatePixelArtProfile} from ${JSON.stringify(validatorUrl)};
    const target=${JSON.stringify(join(root,'public/assets/sprite.png'))},original=fs.open;
    fs.open=async function(file,...args){if(file===target){await fs.rm(target);const made=spawnSync('mkfifo',[target]);if(made.error||made.status)throw Error('mkfifo failed');}return original.call(this,file,...args);};
    syncBuiltinESMExports();const result=await validatePixelArtProfile({root:${JSON.stringify(root)}});console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:2000,killSignal:'SIGKILL'});
  assert.ifError(child.error);assert.equal(child.status,1,child.stderr);assert.equal(JSON.parse(child.stdout).ok,false);
});

function pngChunk(type,data=Buffer.alloc(0)) {
  const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4,4,'ascii');data.copy(bytes,8);
  let crc=0xffffffff;
  for(let offset=4;offset<data.length+8;offset++){crc^=bytes[offset];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  bytes.writeUInt32BE((crc^0xffffffff)>>>0,data.length+8);return bytes;
}

// The fixture encoder uses one IHDR/IDAT/IEND. Repacketize the same zlib stream;
// the number of chunks must not change either pixels or decoder memory bounds.
function rechunkPng(png,{empty=0,oneByte=false,trailing=Buffer.alloc(0)}={}) {
  const data=Buffer.concat([png.subarray(41,41+png.readUInt32BE(33)),trailing]);
  const output=Buffer.alloc(33+empty*12+(oneByte?data.length*13:data.length+12)+12);
  png.copy(output,0,0,33);output.fill(pngChunk('IDAT'),33,33+empty*12);let offset=33+empty*12;
  if(oneByte){const chunks=Array.from({length:256},(_,value)=>pngChunk('IDAT',Buffer.from([value])));for(const value of data){chunks[value].copy(output,offset);offset+=13;}}
  else {const chunk=pngChunk('IDAT',data);chunk.copy(output,offset);offset+=chunk.length;}
  png.copy(output,offset,png.length-12);return output;
}

test('empty IDAT, one-byte IDAT and unused trailing compressed bytes preserve pixels',()=>{
  const png=encodePngRgba(2,2,pixels);
  for(const options of [{empty:3},{oneByte:true},{empty:2,oneByte:true},{trailing:Buffer.from([1,2,3,0])}])
    assert.deepEqual(decodePixelPng(rechunkPng(png,options)).pixels,pixels);
});

test('duplicate PLTE is invalid while one suggested RGBA palette is allowed',async t=>{
  const {root}=await fixture(t),png=encodePngRgba(2,2,pixels),palette=pngChunk('PLTE',Buffer.from([255,0,0]));
  const one=Buffer.concat([png.subarray(0,33),palette,png.subarray(33)]);
  assert.deepEqual(decodePixelPng(one).pixels,pixels);
  const duplicate=Buffer.concat([png.subarray(0,33),palette,palette,png.subarray(33)]);
  assert.throws(()=>decodePixelPng(duplicate),/palette/i);
  await writeFile(join(root,'public/assets/sprite.png'),duplicate);
  const result=await validatePixelArtProfile({root});assert.equal(result.ok,false);assert.equal(result.reports[0].code,'FERRUM_PIXEL_PNG');
});

for(const shape of ['empty','one-byte'])test(`${shape} IDAT packets keep peak memory bounded by bytes rather than chunk objects`,t=>{
  const code=`
    import assert from 'node:assert/strict';import {encodePngRgba} from ${JSON.stringify(encoderUrl)};
    import {decodePixelPng} from ${JSON.stringify(validatorUrl)};
    ${pngChunk.toString()}\n${rechunkPng.toString()}
    const shape=${JSON.stringify(shape)},size=shape==='empty'?1:512,expected=Buffer.alloc(size*size*4);let state=0x12345678;
    for(let i=0;i<expected.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;expected[i]=state&255;}
    const source=rechunkPng(encodePngRgba(size,size,expected),shape==='empty'?{empty:1000000}:{oneByte:true});
    assert(source.length<16*1024*1024);global.gc();const before=process.resourceUsage().maxRSS;
    const actual=decodePixelPng(source);assert.deepEqual(actual.pixels,expected);
    const growth=process.resourceUsage().maxRSS-before;console.log(JSON.stringify({shape,inputBytes:source.length,maxRssGrowthKiB:growth}));
    assert(growth<96*1024,'PNG chunk parsing exceeded 96 MiB of additional peak RSS: '+growth+' KiB');
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',code],{encoding:'utf8',timeout:15000});
  assert.ifError(child.error);assert.equal(child.status,0,child.stdout+'\n'+child.stderr);
  t.diagnostic(child.stdout.trim());
});
