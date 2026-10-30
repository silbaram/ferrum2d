import { probePixelResume } from "./pixel-runtime-fixture.mjs";

export async function probeSavedProjectGame() {
  const base = new URL('/game/assets/.ferrum-pixels/catalog.json',location.href);
  const catalog = await (await fetch(base)).json();
  if(catalog.format !== 'ferrum2d.pixel.catalog' || catalog.version !== 1)throw Error('Pixel catalog format differs');
  const assets=[];
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  for(const meta of catalog.revisions) {
    const png=await (await fetch(new URL(meta.assetId+'.png',base))).arrayBuffer();
    const json=await (await fetch(new URL(meta.assetId+'.json',base))).arrayBuffer();
    if(await hash(png)!==meta.pngSha256 || await hash(json)!==meta.jsonSha256)throw Error('Saved pixel source hash differs');
    let binary='';for(const n of new Uint8Array(png))binary+=String.fromCharCode(n);
    assets.push({id:meta.assetId,path:meta.assetId+'.png',sha256:meta.pngSha256,pngBase64:btoa(binary)});
  }
  const sceneDocument=await (await fetch('/game/scene-authoring.json')).json();
  const report=await probePixelResume({assets,manifest:catalog.manifest,sceneDocument});
  if(report.bluePixels<100)throw Error('Saved pixel game did not render blue sprite');
  return {...report,editableSourcesVerified:true};
}
