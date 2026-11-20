import {deepEqual,equal,throws} from "node:assert/strict";
import {test} from "node:test";
import {resolveSceneAuthoringDocument,type SceneAuthoringDocumentSpec} from "../src/sceneAuthoringDocument.js";
import {applyDataSceneAuthoringDocument,attachDataSceneRuntimeEngineAdapter} from "../src/dataSceneRuntimeTarget.js";
import type {DataSceneComponentsSpec} from "../src/dataSceneComponents.js";
import type {FerrumEngine} from "../src/engineTypes.js";
import {attachMemoryDataSceneVariableRuntime} from "./dataSceneVariableRuntimeTestAdapter.js";
import type {SceneCompositionJsonValue} from "../src/sceneComposition.js";
import {attachNativePhysicsAuthoring} from "../src/nativePhysicsAuthoring.js";
import {supportsDataSceneSpawnPrefabPhysics} from "../src/dataSceneGameplay.js";
import type {Engine} from "../pkg/ferrum_core.js";

function document():SceneAuthoringDocumentSpec {
  return {format:"ferrum2d.consumer.scene-authoring",version:1,physics:{space:"planar-xy",gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01},
    ids:{actions:{summon:7},prefabs:{minion:1}},
    gameplay:{combat:true,primaryActor:"actor",spawnPrefabs:{minion:{prototypeInstanceId:"seed"}}},
    sceneComposition:{initialFragment:"main",prefabs:{
      actor:{props:{components:{visual:{kind:"sprite",texture:1,width:1,height:1},collider:"none",layer:"player"},behaviorRecipes:"spawner"}},
      seed:{props:{components:{template:"seed"}}},
    },fragments:{main:{instances:[{id:"actor",prefab:"actor"},{id:"seed",prefab:"seed",x:20}]}}},
    behaviorRecipes:{entities:{spawner:{recipes:[{kind:"spawnPrefabAction",action:"summon",prefab:"minion",offsetX:10}]}}}};
}
const planar:DataSceneComponentsSpec={visual:{kind:"sprite",texture:1,width:1,height:1},collider:{type:"circle",radius:0.25,isTrigger:false},layer:"enemy",
  body:{type:"kinematic",kinematicController:{solidMaskBits:0,maxIterations:7,maxStepHeight:3,maxDropHeight:4,allowLedgeDrop:true}}};

test("authored controller overrides precede spawn catalog capture and final terrain/grid admission",()=>{
  const events:string[]=[],controllers:unknown[]=[];
  let spawned=0;
  const e=attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter({
    supportsDataSceneSpawnPrefabs:()=>true,supportsDataSceneSpawnPrefabPhysics:()=>true,dataSceneCombatStats:()=>({}),configureUnifiedPhysics(){},
    applyGameplayBehaviorCommands:(commands:Parameters<FerrumEngine["applyGameplayBehaviorCommands"]>[0])=>({commands,results:[]}),
    configureDataSceneKinematicController(handle:Parameters<FerrumEngine["configureDataSceneKinematicController"]>[0],options:Parameters<FerrumEngine["configureDataSceneKinematicController"]>[1]){events.push("controller");controllers.push({handle,options});return true;},
    configureDataSceneGameplay(){events.push("catalog");equal(controllers.length,1);return true;},
    configureDataSceneCollisionTilemap(){events.push("grid");return true;},
  } as unknown as FerrumEngine,{
    useDataScene(){events.push("activate");},textureId:()=>1,preflightPhysics(){events.push("preflight");},
    spawnDataSceneEntity:()=>({entityId:++spawned,entityGeneration:1}),
  }));
  attachNativePhysicsAuthoring(e,{supported:()=>true,run:operation=>operation(),finalize(){events.push("finalize");}});
  const source=document();source.physics!.collisionTilemap={columns:1,rows:1,tileWidth:10,tileHeight:10,tiles:[0],definitions:[]};
  const result=applyDataSceneAuthoringDocument(e,source,{componentTemplates:{seed:planar}});
  deepEqual(events,["preflight","activate","controller","catalog","grid","finalize"]);
  deepEqual(controllers,[{handle:result.entityHandles.seed,options:{solidMaskBits:0,maxIterations:7,maxStepHeight:3,maxDropHeight:4,allowLedgeDrop:true}}]);
});

test("full native prefab authoring rejects absent and unknown physics capabilities before activation",()=>{
  for(const version of [undefined,0,2,NaN]) {
    let mutations=0;
    const native={data_scene_spawn_prefabs_version:()=>1,data_scene_combat_progress_version:()=>3,configure_data_scene_gameplay_v7:()=>true,
      ...(version===undefined?{}:{data_scene_spawn_prefab_physics_version:()=>version})} as unknown as Engine;
    const e=attachDataSceneRuntimeEngineAdapter({supportsDataSceneSpawnPrefabs:()=>true,
      supportsDataSceneSpawnPrefabPhysics:()=>supportsDataSceneSpawnPrefabPhysics(native),
      configureDataSceneGameplay:()=>{mutations++;return true;},
    } as unknown as FerrumEngine,{
      useDataScene(){mutations++;},textureId:()=>1,spawnDataSceneEntity:()=>{mutations++;return {entityId:1,entityGeneration:1};},
    });
    throws(()=>applyDataSceneAuthoringDocument(e,document(),{componentTemplates:{seed:planar},validateComponents:false,validateBindings:false}),/spawn-prefab physics capability version 1/);
    equal(mutations,0);
  }
});

test("spatial native capsule templates are valid spawn prototypes while dynamic bodies remain rejected",()=>{
  const source=document();source.physics!.space="spatial";
  source.spatial={camera:{projection:"orthographic",position:{x:0,y:-10,elevation:10},target:{x:0,y:0,elevation:0},height:20},terrain:[],billboards:{seed:{}}};
  const native:DataSceneComponentsSpec={...planar,collider:"none",body:{kind:"kinematic-position",collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{pushMass:2}}};
  const resolved=resolveSceneAuthoringDocument(source,{validateBindings:true,validateComponents:true,componentTemplates:{seed:native}});
  equal(resolved.gameplay!.spawnPrefabs!.minion.prototypeInstanceId,"seed");
  deepEqual(resolved.sceneComposition.prefabs.seed.props.components,{template:"seed"});
  for(const kind of [undefined,"dynamic"] as const) {
    const body={kind,collider:{shape:{type:"sphere",radius:0.5}}};
    throws(()=>resolveSceneAuthoringDocument(source,{validateBindings:true,componentTemplates:{seed:{...native,body:body as DataSceneComponentsSpec["body"]}}}),/static\/kinematic/);
  }
  const inline=structuredClone(source);
  inline.sceneComposition.prefabs.seed.props={components:structuredClone(native) as unknown as SceneCompositionJsonValue};
  equal(resolveSceneAuthoringDocument(inline,{validateBindings:true,validateComponents:true}).gameplay!.spawnPrefabs!.minion.prototypeInstanceId,"seed");
});
