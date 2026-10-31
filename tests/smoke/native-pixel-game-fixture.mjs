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
    assets.push({id:meta.assetId,path:meta.assetId+'.png',sha256:meta.pngSha256,pngBase64:btoa(binary),source:JSON.parse(new TextDecoder().decode(json))});
  }
  const normalBindings=[];
  const normalBase=new URL('/game/assets/.ferrum-normals/catalog.json',location.href),normalResponse=await fetch(normalBase);
  if(normalResponse.status!==404) {
    if(!normalResponse.ok)throw Error("Normal catalog unavailable");
    const normalCatalog=await normalResponse.json();
    if(normalCatalog.format!=='ferrum2d.sprite-normal.catalog'||normalCatalog.version!==1)throw Error('Normal catalog differs');
    for(const id of normalCatalog.entries) {
      const raw=await (await fetch(new URL(id+'.json',normalBase))).arrayBuffer();if(await hash(raw)!==id)throw Error('Normal metadata hash differs');
      const pair=JSON.parse(new TextDecoder().decode(raw));normalBindings.push({binding:pair.binding,report:pair.report});
      for(const texture of Object.values(pair.binding.textures)) {
        const existing=assets.find(asset=>asset.id===texture.asset);
        if(existing){if(existing.sha256!==texture.sha256)throw Error('Pixel color and normal catalog conflict');continue;}
        const bytes=await (await fetch(new URL(normalCatalog.manifest.textures[texture.asset],normalBase))).arrayBuffer();if(await hash(bytes)!==texture.sha256)throw Error('Normal texture hash differs');
        let binary='';for(const n of new Uint8Array(bytes))binary+=String.fromCharCode(n);
        assets.push({id:texture.asset,path:texture.asset+'.png',sha256:texture.sha256,pngBase64:btoa(binary)});
        catalog.manifest.textures[texture.asset]=texture.asset+'.png';catalog.manifest.textureOptions[texture.asset]={colorSpace:texture.colorSpace};
      }
    }
  }
  const sceneDocument=await (await fetch('/game/scene-authoring.json')).json();
  const report=await probePixelResume({assets,manifest:catalog.manifest,sceneDocument,normalBindings});
  if(report.bluePixels<100)throw Error('Saved pixel game did not render blue sprite');
  if(sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual.animationSet&&report.playback?.sourceFrames!==2)throw Error('Saved pixel animation did not advance');
  return {...report,editableSourcesVerified:true};
}
