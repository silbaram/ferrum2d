import {deepEqual,equal,throws} from "node:assert/strict";
import {test} from "node:test";
import {createUnifiedPhysicsControlApi,type UnifiedPhysicsBodySettings} from "../src/unifiedPhysicsControls.js";

test("control facade checks capabilities, booleans and native identities before accepting edits",()=>{
  let calls=0,alive=true,version=1;
  const native={
    unified_physics_control_version:()=>version,
    set_unified_physics_body_options:()=>{calls++;},
    set_unified_physics_mass_properties:()=>{calls++;},
    query_unified_physics_colliders:()=>new Uint32Array([7,2]),
    add_unified_physics_collider:()=>new Uint32Array([8,3]),
    update_unified_physics_collider:()=>{calls++;},
    remove_unified_physics_collider:()=>{calls++;},
  };
  const api=createUnifiedPhysicsControlApi(native,()=>{if(!alive)throw new Error("destroyed");});
  const h={entityId:1,entityGeneration:2};
  const options:UnifiedPhysicsBodySettings={kind:"dynamic",enabled:true,gravityScale:1,linearDamping:0,angularDamping:0,canSleep:true,ccd:false,lockRotation:false};
  api.setUnifiedPhysicsBodyOptions(h,options);equal(calls,1);
  // Intentionally bypass TypeScript to validate JavaScript callers too.
  throws(()=>api.setUnifiedPhysicsBodyOptions(h,{...options,enabled:undefined as unknown as boolean}));
  throws(()=>api.setUnifiedPhysicsBodyOptions(h,{...options,gravityScale:1e100}));equal(calls,1);
  throws(()=>api.removeUnifiedPhysicsCollider(h,{slot:-1,generation:0}));equal(calls,1);
  deepEqual(api.queryUnifiedPhysicsColliders(h),[{slot:7,generation:2}]);
  native.query_unified_physics_colliders=()=>new Uint32Array([1]);throws(()=>api.queryUnifiedPhysicsColliders(h));
  native.add_unified_physics_collider=()=>new Uint32Array();throws(()=>api.addUnifiedPhysicsCollider(h,{shape:{type:"sphere",radius:1}}));
  version=2;throws(()=>api.setUnifiedPhysicsBodyOptions(h,options),/version 1/);equal(calls,1);
  alive=false;throws(()=>api.setUnifiedPhysicsBodyOptions(h,options),/destroyed/);
});
