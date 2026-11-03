import { probeAsepriteResume } from './aseprite-resume-browser-fixture.mjs';
export async function probeSavedProjectGame() {
  const base=new URL('/game/assets/.ferrum-aseprite/',location.href);
  const catalog=await(await fetch(new URL('catalog.json',base))).json();
  const document=await(await fetch('/game/scene-authoring.json')).json();
  if(catalog.format!=='ferrum2d.aseprite.catalog'||catalog.version!==1||!catalog.revisions.some(r=>r.sourcePng))throw Error('Saved trim catalog missing');
  return probeAsepriteResume({bundle:{revisions:catalog.revisions,manifest:catalog.manifest},document,instance:'sprite',animation:true,assetBase:base.href});
}
