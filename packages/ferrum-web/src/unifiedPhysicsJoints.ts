import type {Engine} from "../pkg/ferrum_core.js";
import type {PhysicsEntityHandle} from "./engineTypes/physicsBodies.js";
import type {WasmBridge} from "./wasmBridge.js";
import {physicsEntityHandle} from "./physicsHandles.js";
import {uint32Number} from "./particlePreset.js";
import {physicsBoolean,physicsF32,physicsFloats,physicsPose,type UnifiedPhysicsPose,type UnifiedPhysicsVector3} from "./unifiedPhysicsAuthoring.js";

/** World-local identity. Break/removal invalidates its generation. */
export interface UnifiedPhysicsJointHandle {slot:number;generation:number;}
/** Force-based actuator; position/velocity use linear units or radians for the joint axis. */
export interface UnifiedPhysicsJointMotor {targetPosition:number;targetVelocity:number;stiffness:number;damping:number;maxForce:number;}
/** Effective-mass-normalized acceleration gains. Zero gains release the constrained coordinate. */
export interface UnifiedPhysicsJointSpring {stiffness:number;damping:number;}
export type UnifiedPhysicsJointKind =
  | {type:"fixed"|"spherical"}
  | {type:"revolute"|"prismatic";limits?:readonly [number,number];motor?:UnifiedPhysicsJointMotor}
  | {type:"continuousRevolute";limits:readonly [number,number];motor?:UnifiedPhysicsJointMotor}
  | {type:"distance";length:number}
  | {type:"rope";maxLength:number}
  | {type:"frequencySpring";restLength:number;frequencyHz:number;dampingRatio:number}
  | {type:"accelerationSpring"|"spring";restLength:number;stiffness:number;damping:number}
  | {type:"elasticRope";maxLength:number;spring:UnifiedPhysicsJointSpring}
  | {type:"gear";ratio:number;referenceAngle:number;spring?:UnifiedPhysicsJointSpring}
  | {type:"pulley";groundA:UnifiedPhysicsVector3;groundB:UnifiedPhysicsVector3;length:number;ratio:number;slack?:boolean;spring?:UnifiedPhysicsJointSpring};
export interface UnifiedPhysicsJointOptions {
  bodyA:PhysicsEntityHandle;bodyB:PhysicsEntityHandle;
  kind:UnifiedPhysicsJointKind;
  /** Body-local frames. Hinges use local X; planar hinges must align it with Z. */
  localFrameA?:UnifiedPhysicsPose;localFrameB?:UnifiedPhysicsPose;
  /** Optional elastic locked-axis response; only supported frame joints accept these. */
  linearSpring?:UnifiedPhysicsJointSpring;angularSpring?:UnifiedPhysicsJointSpring;
  enabled?:boolean;contactsEnabled?:boolean;breakForce?:number;breakTorque?:number;
}
export const UNIFIED_PHYSICS_JOINT_LAYOUT={
  stride:14,joint:0,code:2,flags:3,entityA:4,entityB:6,bodyA:8,bodyB:10,force:12,torque:13,
  entityAFlag:1,entityBFlag:2,enabledFlag:4,contactsEnabledFlag:8,
  fixed:0,spherical:1,revolute:2,prismatic:3,distance:4,rope:5,frequencySpring:6,accelerationSpring:7,
  spring:8,elasticRope:9,gear:10,pulley:11,continuousRevolute:12,
  forceBreak:0,torqueBreak:1,forceAndTorqueBreak:2,removed:3,bodyRemoved:4,
} as const;
/** Borrowed until the next read of the same stream, Wasm growth or engine destruction.
 * State rows use code=kind; event rows use code=reason. Force/torque are sampled solver
 * reaction magnitudes from the last fixed tick, not continuous-time physical peaks. */
export interface UnifiedPhysicsJointBufferView {
  readonly count:number;readonly stride:14;readonly words:Uint32Array;readonly floats:Float32Array;
  readonly droppedNative:number;readonly droppedEvents:number;
}
export interface FerrumUnifiedPhysicsJointApi {
  createUnifiedPhysicsJoint(options:UnifiedPhysicsJointOptions):UnifiedPhysicsJointHandle;
  /** Replaces settings and resets cached reactions, preserving identity and both endpoints. */
  updateUnifiedPhysicsJoint(joint:UnifiedPhysicsJointHandle,options:UnifiedPhysicsJointOptions):void;
  removeUnifiedPhysicsJoint(joint:UnifiedPhysicsJointHandle):void;
  /** Omit handles for all live joints (also overflow recovery). Explicit slot/generation
   * pairs preserve order/duplicates, at most 65536; an empty array requests zero rows. */
  queryUnifiedPhysicsJointStates(handles?:Uint32Array):UnifiedPhysicsJointBufferView;
  /** Initially off. Changing state discards this queue; repeating it retains events. */
  setUnifiedPhysicsJointEventsEnabled(enabled:boolean):void;
  /** Independent of legacy joint diagnostics. Does not step or synchronize geometry. */
  drainUnifiedPhysicsJointEvents():UnifiedPhysicsJointBufferView;
}
const METHODS=["unified_physics_joint_version","create_unified_physics_joint","update_unified_physics_joint","remove_unified_physics_joint",
  "query_unified_physics_joints","set_unified_physics_joint_events_enabled","drain_unified_physics_joint_events",
  "unified_physics_joint_stride_words","unified_physics_joint_count","unified_physics_joint_ptr",
  "unified_physics_joint_dropped_native","unified_physics_joint_dropped_events"] as const;
type Native=Pick<Engine,typeof METHODS[number]>;
function check(native:Native):void {
  if(METHODS.some(m=>typeof native[m]!=="function")||native.unified_physics_joint_version()!==1||native.unified_physics_joint_stride_words()!==14)
    throw new Error("This Wasm core does not support unified physics joints version 1.");
}
function jointHandle(j:UnifiedPhysicsJointHandle):number[] {return [uint32Number(j.slot,"joint slot"),uint32Number(j.generation,"joint generation")];}
/** Shared cold codec; native admission owns physical constraints and capacities. */
export function encodeUnifiedPhysicsJoint(options:UnifiedPhysicsJointOptions) {
  const a=physicsEntityHandle(options.bodyA),b=physicsEntityHandle(options.bodyB);
  const handles=new Uint32Array([a.entityId,a.entityGeneration,b.entityId,b.entityGeneration]);
  let flags=Number(physicsBoolean(options.enabled,true))|(Number(physicsBoolean(options.contactsEnabled,false))<<1);
  const spring=(s:UnifiedPhysicsJointSpring|undefined,bit:number):number[]=>{
    if(s===undefined)return [0,0];flags|=bit;return [physicsF32(s.stiffness),physicsF32(s.damping)];
  };
  const threshold=(value:number|undefined,bit:number):number=>{if(value===undefined)return 0;flags|=bit;return physicsF32(value);};
  const v=[...physicsPose(options.localFrameA),...physicsPose(options.localFrameB),threshold(options.breakForce,4),threshold(options.breakTorque,8),
    ...spring(options.linearSpring,16),...spring(options.angularSpring,32)];
  const k=options.kind;let code:number;
  switch(k.type) {
    case "fixed":code=0;break;case "spherical":code=1;break;
    case "revolute":case "prismatic":case "continuousRevolute": {
      code=k.type==="revolute"?2:k.type==="prismatic"?3:12;
      if(k.type==="continuousRevolute"&&k.limits===undefined)throw new Error("Continuous hinge limits are required.");
      if(k.limits!==undefined){flags|=64;v.push(...physicsFloats(k.limits,2));}else v.push(0,0);
      if(k.motor!==undefined){flags|=128;v.push(k.motor.targetPosition,k.motor.targetVelocity,k.motor.stiffness,k.motor.damping,k.motor.maxForce);}else v.push(0,0,0,0,0);
      break;
    }
    case "distance":code=4;v.push(k.length);break;
    case "rope":code=5;v.push(k.maxLength);break;
    case "frequencySpring":code=6;v.push(k.restLength,k.frequencyHz,k.dampingRatio);break;
    case "accelerationSpring":case "spring":code=k.type==="spring"?8:7;v.push(k.restLength,k.stiffness,k.damping);break;
    case "elasticRope":code=9;v.push(k.maxLength,k.spring.stiffness,k.spring.damping);break;
    case "gear":code=10;v.push(k.ratio,k.referenceAngle,...spring(k.spring,256));break;
    case "pulley":code=11;flags|=Number(physicsBoolean(k.slack,false))<<9;
      v.push(...physicsFloats(k.groundA,3),...physicsFloats(k.groundB,3),k.length,k.ratio,...spring(k.spring,256));break;
    default:throw new Error("Invalid unified physics joint kind.");
  }
  return {handles,metadata:new Uint32Array([code,flags]),values:new Float32Array(v.map(physicsF32))};
}
export function readUnifiedPhysicsJoints(native:Native,memory:WebAssembly.Memory,events:boolean,handles?:Uint32Array):UnifiedPhysicsJointBufferView {
  check(native);
  if(handles!==undefined && (!(handles instanceof Uint32Array)||handles.length%2!==0||handles.length>131072))throw new Error("Joint query requires at most 65536 slot/generation pairs.");
  const expected=handles===undefined?undefined:handles.length/2;
  if(events)native.drain_unified_physics_joint_events();
  else native.query_unified_physics_joints(handles===undefined?new Uint32Array():handles.buffer===memory.buffer?handles.slice():handles,handles===undefined);
  const count=native.unified_physics_joint_count(events),ptr=native.unified_physics_joint_ptr(events);
  const droppedNative=events?native.unified_physics_joint_dropped_native():0,droppedEvents=events?native.unified_physics_joint_dropped_events():0;
  const uint=(v:number)=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff;
  const buffer=memory.buffer;
  if(!uint(count)||count>131072||(!events&&expected!==undefined&&count!==expected)||!uint(ptr)||ptr%4!==0||ptr+count*56>buffer.byteLength||!uint(droppedNative)||!uint(droppedEvents))
    throw new Error("Invalid unified physics joint buffer.");
  return {count,stride:14,words:new Uint32Array(buffer,ptr,count*14),floats:new Float32Array(buffer,ptr,count*14),droppedNative,droppedEvents};
}
export function createUnifiedPhysicsJointApi(native:Native,bridge:Pick<WasmBridge,"readUnifiedPhysicsJoints">,requireAlive:()=>void):FerrumUnifiedPhysicsJointApi {
  const alive=()=>{requireAlive();check(native);};
  return {
    createUnifiedPhysicsJoint(options) {alive();const p=encodeUnifiedPhysicsJoint(options);const id=native.create_unified_physics_joint(p.handles,p.metadata,p.values);
      if(id.length!==2)throw new Error("Invalid created unified joint identity.");return {slot:id[0],generation:id[1]};},
    updateUnifiedPhysicsJoint(joint,options){alive();const id=jointHandle(joint),p=encodeUnifiedPhysicsJoint(options);native.update_unified_physics_joint(new Uint32Array([...id,...p.handles]),p.metadata,p.values);},
    removeUnifiedPhysicsJoint(joint){alive();const [slot,generation]=jointHandle(joint);native.remove_unified_physics_joint(slot,generation);},
    queryUnifiedPhysicsJointStates(handles){alive();return bridge.readUnifiedPhysicsJoints(false,handles);},
    setUnifiedPhysicsJointEventsEnabled(enabled){alive();if(typeof enabled!=="boolean")throw new Error("Joint streaming enabled must be boolean.");native.set_unified_physics_joint_events_enabled(enabled);},
    drainUnifiedPhysicsJointEvents(){alive();return bridge.readUnifiedPhysicsJoints(true);},
  };
}
