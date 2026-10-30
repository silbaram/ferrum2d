import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { showPlacementBottom } from "./placement-panel-navigation.mjs";

/** Actual LOD silhouette and a camera edit before the next render remain selectable. */
export async function smokePlacementModelPicking(parent, timeoutMs=30000) {
  const results=[];
  for(const dpr of [1,2]) {
    const page=await parent.context().browser().newPage({viewport:{width:1100,height:850},deviceScaleFactor:dpr}),errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const url=new URL(parent.url());url.search="?scene=hd2d";
    try {
      await page.goto(url.href);
      await page.waitForFunction(()=>window.ferrumPlacementViewerState?.instances.length===3,undefined,{timeout:timeoutMs});
      await page.locator("[data-placement-language]").selectOption("en");
      const ids={};
      for(const name of ["rock","tree"]) {
        const bytes=await readFile(`examples/data-scene-native/assets/${name}.glb`);
        ids[name]=createHash("sha256").update(bytes).digest("hex");
        await showPlacementBottom(page,"assets");
        await page.locator("[data-placement-model-key]:visible").fill(name);
        await page.evaluate(()=>{window.__pickingImported=false;window.addEventListener("ferrum-placement-model-import",()=>window.__pickingImported=true,{once:true});});
        await page.locator("[data-placement-model-file]:visible").setInputFiles({name:name+".glb",mimeType:"model/gltf-binary",buffer:bytes});
        await page.waitForFunction(()=>window.__pickingImported,undefined,{timeout:timeoutMs});
      }
      for(const projection of ["orthographic","perspective"]) {
        const scene=JSON.parse(await readFile("tests/fixtures/placement.hd2d.scene-authoring.json","utf8"));
        scene.sceneComposition.fragments.main.instances=[{id:"lod_object",prefab:"object",x:0,y:0}];
        scene.spatial.terrain=scene.spatial.terrain.slice(0,1);scene.spatial.billboards={};
        scene.spatial.camera.projection=projection;scene.spatial.camera.fovDegrees=55;
        scene.spatial.models={lod_object:{asset:"rock",contentId:ids.rock,lods:[{asset:"tree",contentId:ids.tree,minDistance:1}]}};
        await page.locator("[data-placement-document-file]").setInputFiles({name:projection+"-picking.scene.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(scene))});
        await page.waitForFunction(()=>window.ferrumPlacementViewerState?.instances.some(i=>i.instanceId==="lod_object")&&!document.querySelector(".demo-shell").inert&&window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws===1,undefined,{timeout:timeoutMs});
        const snapshot=await page.evaluate(()=>{
          const handle=window.ferrumPlacementViewerState.instances.find(i=>i.instanceId==="lod_object").entity,draw=window.ferrumEngine.dataSceneSpatialModelDrawSnapshot(handle);
          return{contentId:draw?.asset.contentId,visible:draw?.cameraVisible};
        });
        assert.deepEqual(snapshot,{contentId:ids.tree,visible:true});
        // The canopy at elevation 64 is outside the original rock's height (24).
        const point=await page.evaluate(()=>window.ferrumPlacementSpatialProject({x:-16,y:0,elevation:64}));
        assert(point?.visible);
        await page.locator("[data-placement-spatial-target]").selectOption("surface:ground");
        const hole=await page.evaluate(()=>window.ferrumPlacementSpatialProject({x:0,y:0,elevation:64}));
        await page.mouse.click(hole.x,hole.y);
        assert.equal(await page.evaluate(()=>window.ferrumPlacementSpatialTarget?.id),"ground","A MASK hole intercepted the ground");
        await page.mouse.click(point.x,point.y);
        try {await page.waitForFunction(()=>window.ferrumPlacementSpatialTarget?.id==="lod_object",undefined,{timeout:timeoutMs});}
        catch(error) {
          await mkdir("artifacts/threejs-viewer-upgrades",{recursive:true});
          await page.screenshot({path:"artifacts/threejs-viewer-upgrades/model-picking-failure.png",fullPage:true});
          console.log("Model picking failure",{dpr,projection,point},await page.evaluate(()=>({target:window.ferrumPlacementSpatialTarget,message:document.querySelector(".placement-spatial-message")?.textContent,canvas:document.querySelector("canvas").getBoundingClientRect().toJSON()})));
          throw error;
        }
        await page.locator("[data-placement-spatial-target]").selectOption("surface:ground");
        const displayed=await page.evaluate(()=>window.ferrumPlacementSpatialProject({x:-16,y:0,elevation:64}));
        await page.evaluate(()=>{
          window.ferrumRuntime.stop();
          const before=JSON.stringify(window.ferrumPlacementSpatialCamera);
          for(let i=0;i<4;i++)document.querySelector("[data-placement-spatial-camera=out]").click();
          if(JSON.stringify(window.ferrumPlacementSpatialCamera)===before)throw new Error("Camera controls did not change the pending camera");
        });
        assert.deepEqual(await page.evaluate(()=>window.ferrumPlacementSpatialProject({x:-16,y:0,elevation:64})),displayed,"The stopped runtime unexpectedly rendered a new camera");
        await page.mouse.click(displayed.x,displayed.y);
        assert.equal(await page.evaluate(()=>window.ferrumPlacementSpatialTarget?.id),"lod_object","Picking used a camera that has not rendered yet");
        await page.evaluate(()=>window.ferrumRuntime.start());
        results.push({dpr,projection,lodSilhouette:true,displayedCamera:true});
      }
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  }
  await mkdir("artifacts/threejs-viewer-upgrades",{recursive:true});
  await writeFile("artifacts/threejs-viewer-upgrades/model-picking-checks.json",JSON.stringify({ok:true,results},null,2)+"\n");
  return results;
}
