// Split the existing self-authored GLBs; these are format regressions, not Blender export acceptance.
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
for(const name of ["rock","tree-material","building"]){
  const source=await readFile(`examples/data-scene-native/assets/${name}.glb`),jsonLength=source.readUInt32LE(12);
  const json=JSON.parse(source.subarray(20,20+jsonLength).toString()),binary=source.subarray(28+jsonLength);
  const output=resolve(`examples/data-scene-native/assets/gltf/${name}`);await mkdir(output,{recursive:true});
  const imageViews=new Set((json.images??[]).map(image=>image.bufferView));
  const indexMap=new Map(),views=[];
  json.bufferViews.forEach((view,i)=>{if(!imageViews.has(i)){indexMap.set(i,views.length);views.push(view);}});
  for(const accessor of json.accessors)accessor.bufferView=indexMap.get(accessor.bufferView);
  const images=[];
  for(const [i,image] of (json.images??[]).entries()){
    const view=json.bufferViews[image.bufferView],uri=`texture-${i}.${image.mimeType==="image/jpeg"?"jpg":"png"}`;
    await writeFile(resolve(output,uri),binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength));
    images.push({uri,...(i%2?{mimeType:image.mimeType}:{})});
  }
  const length=Math.ceil(Math.max(...views.map(view=>(view.byteOffset??0)+view.byteLength))/4)*4;
  json.buffers=[{uri:"scene.bin",byteLength:length}];json.bufferViews=views;json.images=images;
  json.asset.generator="Ferrum2D self-authored separate glTF regression";
  await writeFile(resolve(output,"scene.bin"),binary.subarray(0,length));
  await writeFile(resolve(output,"scene.gltf"),JSON.stringify(json,null,2)+"\n");
}
