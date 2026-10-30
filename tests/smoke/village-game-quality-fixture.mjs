import { loadSpatialGlb } from '@ferrum2d/ferrum-web/core';
import { startCombatProbe } from './hd2d-combat-browser-fixture.mjs';

export async function startVillageQuality(canvas, { effects=true, audio=true, enemies=32, lod=false }={}) {
  const [manifest, document] = await Promise.all([
    fetch('/village/manifest.json').then(r=>r.json()),
    fetch('/village.scene.json').then(r=>r.json()),
  ]);
  const models={}, textureIds={}, textureUrls={};
  // Bounded cold fixture load: the real village has 14 models, no runtime requests.
  for (const [id, entry] of Object.entries(manifest.models)) models[id]=await loadSpatialGlb('/village/'+entry.file,{materialProfile:'diffuse'});
  if (lod) {
    for(const name of ["tree","pine"]) {
      const key="village_"+name, resource=await loadSpatialGlb("/lod/"+name+".glb",{materialProfile:"diffuse"});
      models[key+"_lod"]=resource;
      for(const model of Object.values(document.spatial.models)) if(model.asset===key)model.lods=[{asset:key+"_lod",contentId:resource.contentId,minDistance:600}];
    }
  }
  let id=10;
  for (const [name, entry] of Object.entries(manifest.textures)) {textureIds[name]=id++;textureUrls[name]='/village/'+entry.file;}
  const demo=await startCombatProbe(canvas,enemies,{document,models,textureIds,textureUrls,effects,audio});
  demo.modelEvidence=Object.fromEntries(Object.entries(models).map(([id,a])=>[id,{contentId:a.contentId,bounds:a.bounds,triangles:a.triangleCount,primitives:a.primitiveCount,bytes:a.byteLength}]));
  return demo;
}
