import assert from "node:assert/strict";
import { showPlacementMenu, openPlacementLightingAdvanced } from "./placement-panel-navigation.mjs";

export async function smokeLightingUpgrade(page) {
  const open=()=>showPlacementMenu(page,"lighting"), source=()=>page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
  const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const edit=async(name,value)=>{await open();const input=page.locator(`[data-placement-lighting-field="${name}"]`);await openPlacementLightingAdvanced(input);await input.fill(String(value));await input.press("Enter");await paint();};
  const original=await source(),lights=original.spatial.environment.lighting.lights;
  for(const mood of ["Day","Sunset","Night","Interior"]){
    await open();await page.locator('[data-placement-lighting-preset="Atmosphere Preset"]').selectOption(mood);await paint();
    const doc=await source();assert.deepEqual(doc.spatial.environment.lighting.lights,lights);assert(doc.spatial.environment.bloom);assert(doc.spatial.environment.ambientOcclusion);
    assert.equal(doc.spatial.environment.colorGrading.toneMapping,"aces");
  }
  await open();await openPlacementLightingAdvanced(page.locator('[data-placement-lighting-preset="Lighting Quality"]'));await page.locator('[data-placement-lighting-preset="Lighting Quality"]').selectOption("Low");await paint();
  assert.equal((await source()).spatial.environment.lighting.maxActiveLights,1);assert.equal((await source()).spatial.environment.bloom,undefined);
  await openPlacementLightingAdvanced(page.locator('[data-placement-lighting-preset="Lighting Quality"]'));await page.locator('[data-placement-lighting-preset="Lighting Quality"]').selectOption("High");await paint();
  assert.equal((await source()).spatial.environment.lighting.maxActiveLights,4);
  await page.locator('[data-placement-lighting-toggle="spot"]').check();await edit("spot-angle",55);await edit("spot-penumbra",.4);
  await edit("point-x",0);await edit("point-y",0);await edit("point-elevation",64);
  const ids=await page.locator('[data-placement-lighting-binding] option').evaluateAll(items=>items.map(i=>i.value).filter(Boolean));
  await page.locator('[data-placement-lighting-binding]').selectOption(ids[0]);await paint();
  assert.deepEqual((await source()).spatial.lightBindings[ids[0]],[0]);
  await page.locator('[data-placement-lighting-binding]').selectOption("");await paint();
  assert.deepEqual((await source()).spatial.lightBindings??{},{});
  await page.keyboard.press("Escape");await page.keyboard.press("Escape");
  const icon=page.locator('.placement-light-gizmos > button[data-light-index="0"]');await icon.waitFor({state:"visible"});
  await page.evaluate(()=>{window.__lightEvents=[];for(const kind of ["pointerdown","pointermove","pointerup","pointercancel","lostpointercapture"]){window.addEventListener(kind,e=>{if(window.__lightEvents.length<80)window.__lightEvents.push({kind,target:e.target.outerHTML?.slice(0,160),history:window.ferrumPlacementViewerHistory,position:window.ferrumPlacementSpatialExportDocument().spatial.environment.lighting.lights[0].position});});}window.addEventListener("ferrum-placement-document-error",e=>window.__lightEvents.push({error:String(e.detail)}));});
  let before=await source(),box=await icon.boundingBox();
  await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+72,box.y+32,{steps:5});await page.mouse.up();await paint();
  const moved=await source();if(JSON.stringify(moved.spatial.environment.lighting.lights[0].position)===JSON.stringify(before.spatial.environment.lighting.lights[0].position))console.log("Light drag events",await page.evaluate(()=>window.__lightEvents));assert.notDeepEqual(moved.spatial.environment.lighting.lights[0].position,before.spatial.environment.lighting.lights[0].position);
  assert.equal(await page.evaluate(()=>window.ferrumPlacementSpatialTarget),undefined,"Light selection must clear object selection");
  assert.equal(await page.locator('.placement-spatial-transform-tools').isVisible(),false,"Object tools must hide for light selection");
  await page.getByRole('button',{name:'crate_ground',exact:true}).click();await paint();
  assert.equal(await page.locator('.placement-light-tools').isVisible(),false,"Selecting an object must hide light tools");
  await icon.click();await paint();
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),before);
  await page.locator('[data-placement-action="redo"]').click();await paint();assert.deepEqual(await source(),moved);
  for(const kind of ["height","radius"]){
    await icon.click();const handle=page.locator(`[data-light-handle="${kind}"]`);box=await handle.boundingBox();before=await source();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2-25,{steps:4});await page.keyboard.press("Escape");await page.mouse.up();await paint();assert.deepEqual(await source(),before,`${kind} cancellation`);
    await handle.focus();await handle.press("ArrowUp");await paint();const after=await source();
    assert.equal(kind==="height"?after.spatial.environment.lighting.lights[0].position.elevation:after.spatial.environment.lighting.lights[0].radius,(kind==="height"?before.spatial.environment.lighting.lights[0].position.elevation:before.spatial.environment.lighting.lights[0].radius)+1);
  }
  await edit("point-radius",1e6);await page.keyboard.press("Escape");await page.keyboard.press("Escape");await icon.click();
  before=await source();await page.locator('[data-light-handle="radius"]').press("ArrowUp");await paint();assert.deepEqual(await source(),before,"Radius keyboard edits stop at the schema limit");
  await page.locator('[data-placement-action="undo"]').click();await paint();
  await open();await page.locator('[data-placement-lighting-preset="Atmosphere Preset"]').selectOption("Night");await page.keyboard.press("Escape");await page.keyboard.press("Escape");
  await page.screenshot({path:"artifacts/viewer-lighting/advanced.png",fullPage:true});
  const following=await source();following.spatial.actor={instanceId:"agent_ground",speed:60};delete following.spatial.lightBindings;
  const actorInstance=Object.values(following.sceneComposition.fragments).flatMap(fragment=>fragment.instances).find(instance=>instance.id==="agent_ground");
  actorInstance.props.components.body.type="kinematic";actorInstance.props.components.collider.enabled=true;
  following.spatial.environment.lighting.lights[0].followActor=true;
  await withInitialSpatialDocument(page,following,async fresh=>{
    const source=()=>fresh.evaluate(()=>window.ferrumPlacementSpatialExportDocument()), paint=()=>fresh.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    await fresh.waitForFunction(()=>window.ferrumPlacementSpatialExportDocument().spatial?.environment?.lighting?.lights[0]?.followActor===true);
    const followBefore=await source(),actor=await fresh.evaluate(()=>window.ferrumPlacementViewerState.instances.find(i=>i.instanceId==="agent_ground"));
    const binding=fresh.locator('[data-placement-lighting-binding]');
    await showPlacementMenu(fresh,"lighting");await openPlacementLightingAdvanced(binding);assert.equal(await binding.inputValue(),"agent_ground");
    await binding.selectOption("");await paint();
    const detached=(await source()).spatial.environment.lighting.lights[0],offset=followBefore.spatial.environment.lighting.lights[0].position;
    assert.equal(detached.followActor,undefined);
    assert.deepEqual(detached.position,{x:offset.x+actor.transform.x,y:offset.y+actor.transform.y,elevation:offset.elevation+(actor.body?.heightSpan?.elevation??0)+(followBefore.spatial.billboards.agent_ground?.elevation??0)});
    await fresh.keyboard.press("Escape");await fresh.keyboard.press("Escape");await fresh.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),followBefore);
  });
  return {presets:4,quality:true,spot:true,bindings:true,followActorDetach:true,drag:true,undoRedo:true,cancel:true,keyboard:true};
}

// Without `physics`, a `spatial.actor` document runs on the legacy path only as
// the first Data Scene of a fresh Engine. Studio tabs share one Engine, so the
// document opens as the initial HD-2D scene of a separate Studio page.
async function withInitialSpatialDocument(page,document,run){
  const fresh=await page.context().browser().newPage({viewport:page.viewportSize()}),errors=[];
  fresh.on("pageerror",error=>errors.push(error.message));
  try{
    await fresh.route(/\/placement\.hd2d\.scene-authoring\.json(?:\?.*)?$/,route=>route.fulfill({contentType:"application/json",body:JSON.stringify(document)}));
    const url=new URL(page.url());url.search="?scene=hd2d";
    await fresh.goto(url.href,{waitUntil:"networkidle"});
    await fresh.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==="spatial"&&!!window.ferrumPlacementViewerRuntimeFrame);
    await fresh.locator('[data-placement-language]').selectOption("en");
    await run(fresh);
    assert.deepEqual(errors,[]);
  }finally{await fresh.close();}
}
