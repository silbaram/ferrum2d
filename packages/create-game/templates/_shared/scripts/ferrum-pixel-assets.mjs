import {lstat,open,readlink,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';

const PROFILE='public/assets/pixel-art.profile.json';
const MAX_BYTES=16*1024*1024,MAX_PIXELS=2048*2048;
const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Authoring declarations + PNG bytes only; this does not inspect a running renderer. */
export async function validatePixelArtProfile({root=process.cwd(),required=false}={}) {
  const reports=[],assets=[];
  const issue=(code,location,message)=>reports.push({kind:'pixel-art',code:'FERRUM_PIXEL_'+code,path:location,severity:'error',message,suggestion:'Correct the profile or regenerate the referenced PNG, then run ferrum:asset-validate.'});
  let config;
  try {config=JSON.parse((await boundedFile(root,PROFILE,64*1024)).toString('utf8'));}
  catch(error) {
    if(error.code==='ENOENT'&&!required)return {configured:false,ok:true,profile:PROFILE,assets:[],reports:[],runtimeVerified:false};
    issue('PROFILE',PROFILE,error.code==='ENOENT'?'Pixel-art profile is required.':error.message);
    return result();
  }
  if(!object(config)||config.format!=='ferrum2d.consumer.pixel-art-profile'||config.version!==1) {
    issue('PROFILE',PROFILE,'Expected ferrum2d.consumer.pixel-art-profile version 1.');return result();
  }
  if(!integer(config.scale,1,16))issue('SCALE',PROFILE+'#/scale','Declared display scale must be an integer from 1 to 16.');
  if(config.filter!=='nearest')issue('FILTER',PROFILE+'#/filter','Pixel-art sampling must be declared nearest. Verify the same choice in the game renderer.');
  if(!Array.isArray(config.assets)||!config.assets.length||config.assets.length>64) {
    issue('ASSETS',PROFILE+'#/assets','Declare 1–64 PNG assets.');return result();
  }
  const paths=new Set();
  for(const [i,asset] of config.assets.entries()) {
    const loc=PROFILE+'#/assets/'+i;
    if(!object(asset)||typeof asset.source!=='string'||paths.has(asset.source)) {issue('ASSET',loc,'Asset source must be a unique project-relative PNG path.');continue;}
    paths.add(asset.source);
    const palette=asset.palette??config.palette;
    let colors;
    if(!Array.isArray(palette)||!palette.length||palette.length>256||palette.some(c=>typeof c!=='string'||!/^#[0-9a-f]{8}$/i.test(c)))
      issue('PALETTE',loc+'/palette','Palette requires 1–256 #RRGGBBAA entries.');
    else colors=new Set(palette.map(c=>c.toLowerCase()));
    if(!integer(asset.tileWidth,1,2048)||!integer(asset.tileHeight,1,2048)) {issue('TILE_SIZE',loc,'tileWidth and tileHeight must be integers from 1 to 2048.');continue;}
    try {
      const image=decodePixelPng(await boundedFile(root,asset.source,MAX_BYTES));
      let frames=[{x:0,y:0,width:image.width,height:image.height}];
      if(asset.atlas!==undefined) {
        const atlas=asset.atlas;
        if(!object(atlas)||!integer(atlas.padding,0,64)||!integer(atlas.extrude,0,atlas.padding)||!Array.isArray(atlas.frames)||!atlas.frames.length||atlas.frames.length>256) {
          issue('ATLAS',loc+'/atlas','Atlas needs padding 0–64, extrude 0–padding and 1–256 pixel rectangles.');continue;
        }
        frames=atlas.frames;
        if(frames.some(f=>!object(f)||!integer(f.x,0,image.width-1)||!integer(f.y,0,image.height-1)||!integer(f.width,1,image.width)||!integer(f.height,1,image.height)||f.x+f.width>image.width||f.y+f.height>image.height)) {
          issue('ATLAS_RECT',loc+'/atlas/frames','Frame rectangles must use integer pixels inside the PNG.');continue;
        }
        let invalidSpacing=false;
        if(frames.some(f=>f.x<atlas.padding||f.y<atlas.padding||f.x+f.width+atlas.padding>image.width||f.y+f.height+atlas.padding>image.height)) {
          issue('ATLAS_PADDING',loc+'/atlas','Declared padding extends outside the PNG.');invalidSpacing=true;
        }
        rectangles: for(let a=0;a<frames.length;a++)for(let b=a+1;b<frames.length;b++) {
          const x=frames[a],y=frames[b],padding=atlas.padding;
          if(x.x<y.x+y.width&&y.x<x.x+x.width&&x.y<y.y+y.height&&y.y<x.y+x.height) {
            issue('ATLAS_OVERLAP',loc+'/atlas/frames/'+b,'Atlas frame rectangles overlap.');invalidSpacing=true;break rectangles;
          }
          if(x.x-padding<y.x+y.width+padding&&y.x-padding<x.x+x.width+padding&&x.y-padding<y.y+y.height+padding&&y.y-padding<x.y+x.height+padding) {
            issue('ATLAS_PADDING',loc+'/atlas/frames/'+b,'Reserved frame padding overlaps another frame padding.');invalidSpacing=true;break rectangles;
          }
        }
        if(invalidSpacing)continue;
        if(atlas.extrude) {
          const e=atlas.extrude;
          for(const [i,f] of frames.entries()) {
            if(f.x<e||f.y<e||f.x+f.width+e>image.width||f.y+f.height+e>image.height){issue('ATLAS_EXTRUDE',loc+'/atlas/frames/'+i,'Extrusion extends outside the PNG.');continue;}
            let mismatch=false;
            for(let y=f.y-e;y<f.y+f.height+e;y++)for(let x=f.x-e;x<f.x+f.width+e;x++) {
              if(x>=f.x&&x<f.x+f.width&&y>=f.y&&y<f.y+f.height)continue;
              const sx=Math.max(f.x,Math.min(f.x+f.width-1,x)),sy=Math.max(f.y,Math.min(f.y+f.height-1,y));
              const a=(y*image.width+x)*4,b=(sy*image.width+sx)*4;
              if(!image.pixels.subarray(a,a+4).equals(image.pixels.subarray(b,b+4)))mismatch=true;
            }
            if(mismatch)issue('ATLAS_EXTRUDE',loc+'/atlas/frames/'+i,'Extruded pixels differ from the clamped source edge.');
          }
        }
      }
      if(frames.some(f=>f.width%asset.tileWidth||f.height%asset.tileHeight))issue('TILE_GRID',loc,'PNG/frame dimensions must be divisible by the declared tile dimensions.');
      const used=new Set();let mismatch;
      for(const f of frames)for(let y=f.y;y<f.y+f.height;y++)for(let x=f.x;x<f.x+f.width;x++) {
        const offset=(y*image.width+x)*4,color='#'+image.pixels.subarray(offset,offset+4).toString('hex');
        if(used.size<=256)used.add(color);
        if(colors&&!colors.has(color)&&!mismatch)mismatch={x,y,color};
      }
      if(mismatch)issue('PALETTE_PIXEL',asset.source,`Pixel (${mismatch.x}, ${mismatch.y}) uses ${mismatch.color}, outside the declared RGBA palette.`);
      assets.push({source:asset.source,width:image.width,height:image.height,frames:frames.length,colors:used.size,colorsCapped:used.size>256});
    } catch(error) {issue('PNG',asset.source,error.message);}
  }
  return result();
  function result(){return {configured:true,profile:PROFILE,ok:reports.length===0,scope:'declared-profile-and-png',runtimeVerified:false,assets,reports};}
}

async function boundedFile(root,relative,limit) {
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\'))throw Error('Use a project-relative path.');
  const base=await realpath(root),resolved=path.resolve(base,relative),inside=file=>{const r=path.relative(base,file);return r&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
  if(!inside(resolved))throw Error('Asset path is outside the project.');
  const file=await realpath(resolved);if(!inside(file))throw Error('Asset symlink is outside the project.');
  let handle;
  try {
    const rootMetadata=await stat(base,{bigint:true}),before=await lstat(file,{bigint:true});
    if(!before.isFile())throw Error('Asset must be a regular file.');
    if(before.size>BigInt(limit))throw Error('Asset exceeds the byte limit.');
    // NOFOLLOW protects the resolved leaf where supported. NONBLOCK ensures a
    // regular-file -> FIFO replacement cannot stall before descriptor stat.
    handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    const metadata=await handle.stat({bigint:true});
    if(!sameFileVersion(before,metadata))throw Error('Asset changed while opening.');
    await checkPath();
    const size=Number(metadata.size),bytes=Buffer.alloc(size+1);let count=0;
    while(count<bytes.length){const {bytesRead}=await handle.read(bytes,count,bytes.length-count,null);if(!bytesRead)break;count+=bytesRead;}
    if(count!==size||!sameFileVersion(metadata,await handle.stat({bigint:true})))throw Error('Asset changed while reading.');
    await checkPath();
    return bytes.subarray(0,count);

    async function checkPath() {
      if(await realpath(root)!==base||!sameFileIdentity(rootMetadata,await stat(base,{bigint:true})))throw Error('Project root changed while reading.');
      const current=await realpath(resolved);
      if(!inside(current))throw Error('Asset symlink is outside the project.');
      if(current!==file||!sameFileVersion(metadata,await lstat(current,{bigint:true})))throw Error('Asset path changed while reading.');
      if(process.platform==='linux') {
        let openedPath;
        try {openedPath=await readlink(`/proc/self/fd/${handle.fd}`);}
        catch(error) {
          // procfs may be unmounted or hidden. Keep the same portable checks
          // used on Windows/macOS instead of disabling normal consumer files.
          if(!['ENOENT','ENOTDIR','EACCES','EPERM','ENOSYS','ENOTSUP'].includes(error.code))throw error;
        }
        if(openedPath!==undefined&&(!inside(openedPath)||openedPath!==file))throw Error('Opened asset path changed or is outside the project.');
      }
    }
  } catch(error) {
    // Only initial discovery may mean "optional profile absent". Losing a
    // previously resolved profile must not silently disable its validation.
    if(error.code==='ENOENT')throw new Error('Asset changed while opening or reading.',{cause:error});
    throw error;
  } finally {if(handle)await handle.close();}
}

// These portable identity/path checks detect normal save/replacement races;
// Node has no portable openat capability traversal. They are not a sandbox for
// an adversary coordinating root/ancestor renames between every filesystem
// call. Linux fd paths add an opened-file witness when procfs is available.
function sameFileIdentity(a,b) {return a.dev===b.dev&&a.ino===b.ino;}
function sameFileVersion(a,b) {return a.isFile()&&b.isFile()&&sameFileIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;}

function crc(bytes,start=0,end=bytes.length) {let n=0xffffffff;for(let offset=start;offset<end;offset++){n^=bytes[offset];for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
/** Bounded, lossless RGBA8 PNG reader for Ferrum pixel exports; no browser color conversion. */
export function decodePixelPng(bytes) {
  if(bytes.length>MAX_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG signature or byte limit.');
  let offset=8,width=0,height=0,ended=false,hadData=false,closedData=false,hadPalette=false;
  let dataStart=0,dataEnd=0,dataBytes=0;
  while(offset<bytes.length) {
    if(offset+12>bytes.length)throw Error('Truncated PNG.');
    const length=bytes.readUInt32BE(offset),end=offset+8+length;
    if(end+4>bytes.length)throw Error('Truncated PNG chunk.');
    for(let i=offset+4;i<offset+8;i++){const b=bytes[i];if(!(b>=65&&b<=90||b>=97&&b<=122))throw Error('Invalid PNG chunk type.');}
    if(bytes[offset+6]&32)throw Error('Invalid PNG chunk type.');
    const type=bytes.toString('ascii',offset+4,offset+8);
    if(crc(bytes,offset+4,end)!==bytes.readUInt32BE(end))throw Error('PNG CRC mismatch.');
    if(!width&&type!=='IHDR')throw Error('PNG IHDR must be first.');
    if(type==='IHDR') {
      if(width||length!==13)throw Error('Invalid PNG IHDR.');
      width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);
      if(!width||!height||width>2048||height>2048||width*height>MAX_PIXELS)throw Error('PNG dimensions exceed 2048px.');
      if(bytes[offset+16]!==8||bytes[offset+17]!==6||bytes[offset+18]||bytes[offset+19]||bytes[offset+20])throw Error('Pixel profile requires non-interlaced RGBA8 PNG; export or convert losslessly first.');
    } else if(type==='IDAT') {
      if(closedData)throw Error('PNG IDAT chunks must be consecutive.');
      if(!hadData)dataStart=offset;
      hadData=true;dataEnd=end+4;dataBytes+=length;
    }
    else if(type==='IEND') {if(length||!hadData||end+4!==bytes.length)throw Error('Invalid PNG IEND.');ended=true;break;}
    else {
      if(hadData)closedData=true;
      if(type==='PLTE') {
        if(hadPalette||hadData||!length||length%3||length>768)throw Error('Invalid PNG palette chunk.');
        hadPalette=true;
      }
      if(type==='tRNS')throw Error('RGBA PNG cannot use tRNS.');
      if(type==='acTL'||type==='fcTL'||type==='fdAT'||(type[0]===type[0].toUpperCase()&&type!=='PLTE'))throw Error('Unsupported PNG chunk '+type+'.');
    }
    offset=end+4;
  }
  if(!ended)throw Error('PNG IEND missing.');
  // IDATs are consecutive and already validated. A second pass copies bytes
  // into one bounded buffer, without retaining an object per empty/short chunk.
  const compressed=Buffer.alloc(dataBytes);let written=0;
  for(let at=dataStart;at<dataEnd;){const length=bytes.readUInt32BE(at);if(length)bytes.copy(compressed,written,at+8,at+8+length);written+=length;at+=12+length;}
  const stride=width*4,raw=inflateSync(compressed,{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height)throw Error('PNG scanline size differs.');
  const pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];if(filter>4)throw Error('Invalid PNG filter.');
    for(let x=0;x<stride;x++) {
      const index=y*stride+x,a=x>=4?pixels[index-4]:0,b=y?pixels[index-stride]:0,c=y&&x>=4?pixels[index-stride-4]:0;
      let predictor=0;
      if(filter===1)predictor=a;else if(filter===2)predictor=b;else if(filter===3)predictor=Math.floor((a+b)/2);
      else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      pixels[index]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,pixels};
}
