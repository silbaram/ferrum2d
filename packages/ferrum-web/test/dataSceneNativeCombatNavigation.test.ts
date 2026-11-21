import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { supportsDataSceneNativeCombatMovement, supportsDataSceneNativeCombatCrowd, supportsDataSceneNativeCombatNavigation } from "../src/dataSceneCombatNavigation.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { preflightDataSceneGameplay } from "../src/dataSceneGameplayAuthoring.js";
import { bindSceneBehaviorRecipes } from "../src/gameplayAuthoring.js";

function document() {
  return {
    format:"ferrum2d.consumer.scene-authoring",version:1,
    physics:{space:"spatial",gravity:[0,-10,0],lengthUnit:1},
    gameplay:{primaryActor:"player",combat:true,combatNavigation:{cellSize:0.5,maxStepHeight:0.3,maxDropHeight:0.2,arrivalRadius:1,maxAgents:1}},
    sceneComposition:{initialFragment:"main",prefabs:{player:{props:{components:{
      visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer:"player",
      body:{kind:"fixed",elevation:1,collider:{shape:{type:"sphere",radius:0.25},sensor:true}},
    }}},enemy:{props:{behaviorRecipes:["chaser"],components:{
      visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer:"enemy",
      body:{kind:"kinematic-position",elevation:1,collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}},
    }}}},fragments:{main:{instances:[{id:"player",prefab:"player",x:4,y:0},{id:"enemy",prefab:"enemy",x:0,y:0}]}}},
    behaviorRecipes:{entities:{chaser:{recipes:[{kind:"chase",target:"primaryActor",speed:2,stopDistance:0}]}}},
    spatial:{camera:{projection:"orthographic",position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:0},height:300},
      terrain:[{id:"floor",x:-10,y:-10,width:30,depth:20,elevation:0}],billboards:{player:{},enemy:{}}},
  };
}
const facade = {
  configureDataSceneGameplay:()=>true,dataSceneCombatStats:()=>({}),
  supportsDataSceneCombatNavigation:()=>true,supportsDataSceneNativeCombatNavigation:()=>true,
  supportsDataSceneCombatCrowd:()=>true,
  supportsDataSceneNativeCombatCrowd:()=>true,
  supportsDataSceneCombatMovement:()=>true,supportsDataSceneNativeCombatMovement:()=>true,
} as unknown as FerrumEngine;
function check(input:unknown,engine=facade) {
  const doc=resolveSceneAuthoringDocument(input,{validateBindings:true});
  preflightDataSceneGameplay(engine,doc,bindSceneBehaviorRecipes(doc.sceneComposition,doc.behaviorRecipes),doc.ids,"scene");
  return doc;
}

test("native capsule navigation has an additive capability and rejects older general navigation builds",()=>{
  const raw={data_scene_combat_navigation_version:()=>1,configure_data_scene_gameplay_v4:()=>true,configure_data_scene_gameplay_v5:()=>true};
  equal(supportsDataSceneNativeCombatNavigation({} as Engine),false);
  equal(supportsDataSceneNativeCombatNavigation(raw as unknown as Engine),false);
  for(const version of [0,2]) equal(supportsDataSceneNativeCombatNavigation({...raw,data_scene_native_combat_navigation_version:()=>version} as unknown as Engine),false);
  equal(supportsDataSceneNativeCombatNavigation({...raw,data_scene_native_combat_navigation_version:()=>1} as unknown as Engine),true);
});

test("native navigation accepts inline shape targets and capsule sources without legacy AABB or heightSpan",()=>{
  const doc=document(),before=structuredClone(doc);check(doc);deepEqual(doc,before);
  const old={...facade,supportsDataSceneNativeCombatNavigation:()=>false};
  throws(()=>check(doc,old),/native capsule navigation Wasm/);
  throws(()=>check(doc,{...facade,supportsDataSceneNativeCombatNavigation:undefined} as unknown as FerrumEngine),/native capsule navigation Wasm/);
});

test("native navigation rejects incompatible bodies, up axes and unsupported options before application",()=>{
  for(const change of [
    {kind:"dynamic"},{kind:"kinematic-velocity"},{character:undefined},
    {collider:{shape:{type:"sphere",radius:0.25}}},
    {collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25},sensor:true}},
    {character:{up:[1,0,0]}},
  ]) {
    const d=document();Object.assign(d.sceneComposition.prefabs.enemy.props.components.body,change);
    throws(()=>check(d),/capsule|character|controller/);
  }
  for(const option of [{maxStepHeight:10001},{maxDropHeight:10001}]) {
    const d=document();Object.assign(d.gameplay.combatNavigation,option);
    throws(()=>check(d),/native capsule|native controller/);
  }
});

test("native crowd has its own capability and rejects older facades before applying",()=>{
  const raw={data_scene_combat_navigation_version:()=>1, data_scene_native_combat_navigation_version:()=>1,
    configure_data_scene_gameplay_v4:()=>true, configure_data_scene_gameplay_v5:()=>true,
    data_scene_combat_crowd_version:()=>1};
  equal(supportsDataSceneNativeCombatCrowd(raw as unknown as Engine),false);
  for(const version of [0,2]) equal(supportsDataSceneNativeCombatCrowd({...raw,data_scene_native_combat_crowd_version:()=>version} as unknown as Engine),false);
  equal(supportsDataSceneNativeCombatCrowd({...raw,data_scene_native_combat_crowd_version:()=>1} as unknown as Engine),true);
  const d=document();Object.assign(d.gameplay.combatNavigation,{crowdAvoidance:{padding:0.1}});
  check(d);
  throws(()=>check(d,{...facade,supportsDataSceneNativeCombatCrowd:()=>false}),/native capsule crowd Wasm/);
  throws(()=>check(d,{...facade,supportsDataSceneNativeCombatCrowd:undefined} as unknown as FerrumEngine),/native capsule crowd Wasm/);
});

test("native navigation capacity follows final Chase sources and excludes keyboard-owned spatial actor",()=>{
  const d=document();d.sceneComposition.fragments.main.instances.push({id:"controlled",prefab:"enemy",x:-4,y:0});
  Object.assign(d.spatial.billboards,{controlled:{}});
  Object.assign(d.spatial,{actor:{instanceId:"controlled",speed:2,maxStepHeight:0.3,maxDropHeight:0.2}});
  check(d);
  const over=document();over.sceneComposition.fragments.main.instances.push({id:"extra",prefab:"enemy",x:2,y:2});
  Object.assign(over.spatial.billboards,{extra:{}});throws(()=>check(over),/maxAgents/);
});

test("native navigation keeps per-source Chase stop distance bindings and rejects bodyless targets",()=>{
  const d=document();d.behaviorRecipes.entities.chaser.recipes[0]!.stopDistance=1.5;check(d);
  const bad=document();Reflect.deleteProperty(bad.sceneComposition.prefabs.player.props.components,"body");
  throws(()=>check(bad),/inline shape body/);
});

test("native all-pattern movement requires its own capability and accepts SeekTarget/Accelerate sources",()=>{
  const raw={data_scene_combat_navigation_version:()=>1,data_scene_native_combat_navigation_version:()=>1,
    configure_data_scene_gameplay_v4:()=>true,configure_data_scene_gameplay_v5:()=>true,
    data_scene_combat_movement_version:()=>1,configure_data_scene_gameplay_v6:()=>true};
  equal(supportsDataSceneNativeCombatMovement(raw as unknown as Engine),false);
  for(const version of [0,2])equal(supportsDataSceneNativeCombatMovement({...raw,data_scene_native_combat_movement_version:()=>version} as unknown as Engine),false);
  equal(supportsDataSceneNativeCombatMovement({...raw,data_scene_native_combat_movement_version:()=>1} as unknown as Engine),true);
  for(const recipe of [{kind:"seekTarget",target:"primaryActor",speed:2,turnRate:0.25},
    {kind:"accelerate",accelerationX:0.1,accelerationY:0,maxSpeed:2}]) {
    const d=document();Object.assign(d.gameplay.combatNavigation,{movementPatterns:"all"});
    Object.assign(d.behaviorRecipes.entities.chaser,{recipes:[recipe]});check(d);
    throws(()=>check(d,{...facade,supportsDataSceneNativeCombatMovement:()=>false}),/native capsule movement Wasm/);
    throws(()=>check(d,{...facade,supportsDataSceneNativeCombatMovement:undefined} as unknown as FerrumEngine),/native capsule movement Wasm/);
  }
});

test("native all-pattern capacity follows final motion commands and excludes the input actor",()=>{
  const d=document();Object.assign(d.gameplay.combatNavigation,{movementPatterns:"all",crowdAvoidance:{padding:0.1}});
  Object.assign(d.behaviorRecipes.entities.chaser,{recipes:[
    {kind:"chase",target:"primaryActor",speed:2,stopDistance:1},
    {kind:"seekTarget",target:"primaryActor",speed:2,turnRate:0.25},
  ]});
  d.sceneComposition.fragments.main.instances.push({id:"controlled",prefab:"enemy",x:-4,y:0});
  Object.assign(d.spatial.billboards,{controlled:{}});
  Object.assign(d.spatial,{actor:{instanceId:"controlled",speed:2,maxStepHeight:0.3,maxDropHeight:0.2}});
  check(d);
  Object.assign(d.behaviorRecipes.entities,{accelerator:{recipes:[{kind:"accelerate",accelerationX:0.1,accelerationY:0,maxSpeed:2}]}});
  d.sceneComposition.fragments.main.instances.push(Object.assign({id:"extra",prefab:"enemy",x:0,y:-3},{props:{behaviorRecipes:["accelerator"]}}));
  Object.assign(d.spatial.billboards,{extra:{}});throws(()=>check(d),/maxAgents/);
  Object.assign(d.gameplay.combatNavigation,{maxAgents:2});check(d);
});
