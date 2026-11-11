import { loadSpatialGlb, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { check, difference } from "/fixture.mjs";

// Fixed Blender Mapping inputs, independent of the importer's glTF matrix implementation.
const mapping = { offset: [.125, .25], scale: [.75, 1.25], rotation: Math.PI / 2 };
function variant(source, kind, mode = "transformed") {
  const size = new DataView(source).getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(source, 20, size)));
  const binary = new Uint8Array(source, 28 + size).slice(), material = doc.materials[0], pbr = material.pbrMetallicRoughness;
  const texture = structuredClone(pbr.baseColorTexture), normal = material.normalTexture;
  delete pbr.baseColorTexture;delete material.normalTexture;delete material.emissiveTexture;
  material.alphaMode = "OPAQUE";pbr.baseColorFactor = [0,0,0,1];pbr.metallicFactor = 0;pbr.roughnessFactor = .5;
  material.emissiveFactor = [0,0,0];material.extensions = { KHR_materials_specular: { specularFactor: 1 } };
  doc.extensionsRequired = ["KHR_materials_specular", "KHR_texture_transform"];
  const specular = material.extensions.KHR_materials_specular;
  if (kind === "diffuse" || kind === "zero") {
    pbr.baseColorFactor = [.4,.4,.4,1];specular.specularFactor = 0;
    pbr.baseColorTexture=structuredClone(texture);material.alphaMode="MASK";material.normalTexture=normal;
    material.emissiveTexture=structuredClone(texture);
    if(kind==="zero") {pbr.metallicRoughnessTexture=structuredClone(texture);specular.specularTexture=structuredClone(texture);specular.specularColorTexture=structuredClone(texture);}
  }
  if (kind === "diffuse") {delete material.extensions;doc.extensionsRequired = ["KHR_texture_transform"];}
  if (kind === "rough") pbr.roughnessFactor = 1;
  if (kind === "smooth") {
    pbr.roughnessFactor = 0;pbr.baseColorTexture=structuredClone(texture);material.alphaMode="MASK";
    material.normalTexture=normal;material.emissiveTexture=structuredClone(texture);
    pbr.metallicRoughnessTexture=structuredClone(texture);specular.specularTexture=structuredClone(texture);specular.specularColorTexture=structuredClone(texture);
  }
  if (kind === "normal") material.normalTexture = normal;
  if (kind === "emission") {material.emissiveFactor = [.5,.25,.125];material.extensions.KHR_materials_emissive_strength = {emissiveStrength:8};}
  let mapped;
  if (kind === "scalar") mapped = specular.specularTexture = texture;
  if (kind === "roughness") mapped = pbr.metallicRoughnessTexture = texture;
  if (kind === "color") mapped = specular.specularColorTexture = texture;
  if (mapped && mode !== "transformed") {
    delete mapped.extensions;
    if (mode === "baked") {
      const a = doc.accessors[doc.meshes[0].primitives[0].attributes.TEXCOORD_0], b = doc.bufferViews[a.bufferView], data = new DataView(binary.buffer);
      const start = (b.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = b.byteStride ?? 8;
      for(let i=0;i<a.count;i++) {
        const at=start+i*stride,u=data.getFloat32(at,true)*mapping.scale[0],v=(1-data.getFloat32(at+4,true))*mapping.scale[1];
        data.setFloat32(at,mapping.offset[0]+Math.cos(mapping.rotation)*u-Math.sin(mapping.rotation)*v,true);
        data.setFloat32(at+4,1-(mapping.offset[1]+Math.sin(mapping.rotation)*u+Math.cos(mapping.rotation)*v),true);
      }
    }
  }
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded=(json.length+3)&~3, out=new ArrayBuffer(28+padded+binary.length), header=new DataView(out);
  [0x46546c67,2,out.byteLength,padded,0x4e4f534a].forEach((v,i)=>header.setUint32(i*4,v,true));
  new Uint8Array(out,20,padded).fill(32);new Uint8Array(out,20,json.length).set(json);
  header.setUint32(20+padded,binary.length,true);header.setUint32(24+padded,0x004e4942,true);new Uint8Array(out,28+padded).set(binary);
  return out;
}
export async function loadSpecularFixtures(assets, kinds) {
  const source = await (await fetch("/uv/mapping.glb")).arrayBuffer();
  for(const kind of kinds ?? ["diffuse","zero","medium","smooth","rough","normal","emission"])
    assets.set(`uv-spec-${kind}`,await loadSpatialGlb(variant(source,kind),{materialProfile:kind==="diffuse"?"diffuse":"specular"}));
  if (!kinds) for(const kind of ["scalar","roughness","color"])for(const mode of ["transformed","baked","identity"])
    assets.set(`uv-spec-${kind}-${mode}`,await loadSpatialGlb(variant(source,kind,mode),{materialProfile:"specular"}));
  return {assets:assets.size};
}
export async function probeSpecularMaterials(configure, current, reread, engine, apply, registry, assets, renderer, errors) {
  const lighting={ambient:[0,0,0],lights:[],directional:{direction:{x:0,y:-1,elevation:0},intensity:4}},environment={composition:"separated",lighting};
  const run=(name,asset,settings=environment,pose=undefined)=>configure(`specular-${name}`,settings,`uv-spec-${asset}`,false,false,pose);
  await run("diffuse","diffuse");const diffuse=current().slice();
  await run("zero","zero");check(difference(diffuse,current())===0,"zero specular changed diffuse lighting");
  const shadow={composition:"separated",lighting:{ambient:[.05,.05,.05],lights:[{position:{x:-80,y:-80,elevation:120},radius:500,intensity:2}],shadows:{lightIndex:0,resolution:128,bias:.02}}};
  await run("diffuse-cutout-shadow","diffuse",shadow);const shadowPixels=current().slice();
  await run("zero-cutout-shadow","zero",shadow);check(difference(shadowPixels,current())===0,"added maps changed base cutout shadow");
  await run("diffuse-no-environment","diffuse",null);const neutral=current().slice();
  await run("zero-no-environment","zero",null);check(difference(neutral,current())===0,"material profile changed output without environment");
  const rough=await run("rough","rough"),medium=await run("medium","medium");
  check(medium.leaf[0]>rough.leaf[0]+10 && rough.leaf[0]>10,"roughness failed to change direct highlight",{rough:rough.leaf,medium:medium.leaf});
  // At roughness=1, L=N: GGX D=1/pi, Schlick-Smith G=2*NdotV/(1+NdotV).
  // This analytic oracle does not execute or copy the general shader GGX function.
  const nv=200/Math.hypot(55,180,200),vh=Math.sqrt((1+nv)/2),fresnel=.04+.96*(1-vh)**5;
  const linear=4*fresnel/(2*Math.PI*(1+nv)),encoded=Math.round(255*(1.055*linear**(1/2.4)-.055));
  check(rough.leaf.every(v=>Math.abs(v-encoded)<=3),"rough highlight disagrees with analytic energy reference",{actual:rough.leaf,encoded});
  const base=current().slice();await run("normal","normal");check(difference(base,current(),3)>20,"specular ignored tangent normal map");
  await run("smooth","smooth");
  const ambient=await run("ambient-only","medium",{composition:"separated",lighting:{ambient:[1,1,1],lights:[]}});
  check(ambient.leaf.every(v=>v===0),"specular was added to ambient illumination",ambient.leaf);
  const dark=await run("no-direct","medium",{composition:"separated",lighting:{ambient:[0,0,0],lights:[]}});
  check(dark.leaf.every(v=>v===0),"specular generated light without a direct source",dark.leaf);
  const point={...environment,lighting:{ambient:[0,0,0],lights:[{position:{x:65,y:-160,elevation:60},radius:500,intensity:8}]}};
  const pointed=await run("point","medium",point);check(pointed.leaf[0]>20,"point direct specular missing",pointed.leaf);
  await run("ao-base","medium");const noAo=current().slice();
  await run("ao","medium",{...environment,ambientOcclusion:{strength:1,radius:40,bias:.1}});
  check(difference(noAo,current(),3)===0,"separated AO darkened direct specular");
  const emission=await run("emission","emission",{composition:"separated",lighting:{ambient:[0,0,0],lights:[]},colorGrading:{toneMapping:"reinhard"}});
  check(emission.leaf[0]>emission.leaf[1]+8 && emission.leaf[1]>emission.leaf[2]+8 && emission.leaf[0]>220,"emission >1 lost before tone mapping",emission.leaf);
  const comparisons=[];
  for(const kind of ["scalar","roughness","color"]) {
    await run(`${kind}-transformed`,`${kind}-transformed`);const transformed=current().slice();
    await run(`${kind}-baked`,`${kind}-baked`);const diff=difference(transformed,current(),3),count=current().length/4;
    check(diff<count*.001,"specular map UV differs from independent baked reference",{kind,diff,count});
    await run(`${kind}-identity`,`${kind}-identity`);
    check(difference(transformed,current(),3)>20,"specular map transform has no visible effect",kind);
    comparisons.push({kind,differentPixels:diff,pixelCount:count});
    const pose={yawDegrees:35,scale:.8};
    await run(`${kind}-turned`,`${kind}-transformed`,environment,pose);const turned=current().slice();
    await run(`${kind}-turned-baked`,`${kind}-baked`,environment,pose);
    const turnedDiff=difference(turned,current(),3);check(turnedDiff<count*.001,"rotated/scaled material UV differs from baked reference",{kind,turnedDiff,count});
    comparisons.push({kind:`${kind}-turned`,differentPixels:turnedDiff,pixelCount:count});
  }
  const savedRow=await run("save","color-transformed"),before=current().slice();
  const snapshot=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:savedRow.doc})));
  const old=registry.entries().find(row=>row.instanceId==="tree").handle;
  restoreGameStateSnapshot(engine,snapshot,{dataSceneAuthoringApplyOptions:apply});
  const fresh=registry.entries().find(row=>row.instanceId==="tree").handle;
  check(old.entityId!==fresh.entityId || old.entityGeneration!==fresh.entityGeneration,"specular restore retained stale handles");
  const restored=await reread();check(difference(before,restored.data)===0 && restored.stats.modelUploadBytes===0,"specular JSON restore changed pixels/resources");
  let rejected=false;
  try { await loadSpatialGlb(variant(await(await fetch("/uv/mapping.glb")).arrayBuffer(),"medium"),{materialProfile:"diffuse"}); }
  catch(error){rejected=/unsupported extensions|required extensions/.test(String(error));}
  check(rejected,"diffuse silently accepted specular extension");
  const preserved=await reread();check(difference(before,preserved.data)===0,"rejected profile changed active asset");
  let recovery;
  if(typeof renderer.recoverDevice==="function") {
    const oldDevice=renderer.gpuDevice();oldDevice.destroy();await oldDevice.lost;await Promise.resolve();
    check(renderer.deviceState().status==="lost","specular device loss was not observed");
    check(renderer.resourceStats().textureCount===0 && renderer.resourceStats().bufferCount===0,"lost specular GPU resources retained");
    check(await renderer.recoverDevice(),"specular device recovery failed");
    renderer.gpuDevice().addEventListener("uncapturederror",event=>errors.push(event.error.message));
    const recovered=await reread();const diff=difference(before,recovered.data);
    check(diff===0,"specular map device recovery changed pixels",diff);
    const warm=await reread();check(warm.stats.modelUploadBytes===0,"recovered specular material reuploaded on warm frame");
    recovery={generation:renderer.deviceState().generation,differentPixels:diff};
  }
  return {zeroIdentity:true,analytic:{expected:encoded,actual:rough.leaf},comparisons,restored:true,freshHandles:true,failedLoadPreserved:true,assets:assets.size,recovery};
}
