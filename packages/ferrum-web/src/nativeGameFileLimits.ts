/** Fixed names mirror file_prepare/limits.rs v1. No caller word buffers/version. */
import { NativeGameFileError, type NativeGameFileNativeLimits, type NativeGameFileResourceLimits } from "./nativeGameFileTypes.js";
const M = 1024*1024;
export const nativeGameFileNativeDefaults: NativeGameFileNativeLimits = Object.freeze({
  maxFileBytes:64*M,maxChecksumBytes:64*M,maxEngineSectionBytes:64*M,maxVariablesSectionBytes:4*M,
  maxAuthoringSectionBytes:16*M,maxResourceManifestSectionBytes:4*M,maxResourceDataSectionBytes:64*M,
  maxDialogueQuestSectionBytes:8*M,maxHostBindingsSectionBytes:4*M,maxDecodeInputBytes:64*M,
  maxDecodeAllocationWork:960*M,maxDecodeValues:64*M,maxDecodeDepth:96,maxDecodeCollection:64*M,
  maxDecodeZeroSizedElements:4096,maxChecksumWork:256*M,maxAllocationWork:1024*M,maxPostDecodeWork:128*M,
  maxPostDecodeScratchBytes:64*M,maxEntitySlots:M,maxJointSlots:M,maxNestedItems:64*M,maxAliasRoots:64*M,
  maxAliasCompareBytes:128*M,maxOutputBytes:64*M,maxMetadataBytes:64*M,
});
export function nativeGameFileLimitWords(input: Partial<NativeGameFileNativeLimits> = {}) {
  if (!input || typeof input!=="object" || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw new NativeGameFileError("LIMITS","create","native limits record");
  const keys=Object.keys(nativeGameFileNativeDefaults) as (keyof NativeGameFileNativeLimits)[], values={...nativeGameFileNativeDefaults};
  for(const key of Reflect.ownKeys(input)){
    const d=Object.getOwnPropertyDescriptor(input,key);
    if(typeof key!=="string"||!keys.includes(key as keyof NativeGameFileNativeLimits)||!d||!("value"in d)||!Number.isSafeInteger(d.value)||d.value<0||d.value>nativeGameFileNativeDefaults[key as keyof NativeGameFileNativeLimits]) throw new NativeGameFileError("LIMITS","create","native limits must only lower known defaults");
    values[key as keyof NativeGameFileNativeLimits]=d.value;
  }
  return { values:Object.freeze(values),words:Uint32Array.from([1,...keys.map(k=>values[k])]) };
}
export function freezeNativeGameFileResourceLimits(input:Partial<NativeGameFileResourceLimits>|undefined):Partial<NativeGameFileResourceLimits>{
  if(input===undefined)return Object.freeze({});
  if(!input||typeof input!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new NativeGameFileError("LIMITS","create","resource limits record");
  const result:Record<string,unknown>={};
  for(const k of Reflect.ownKeys(input)){const d=Object.getOwnPropertyDescriptor(input,k);if(typeof k!=="string"||!d||!("value"in d))throw new NativeGameFileError("LIMITS","create","resource limit descriptor");Object.defineProperty(result,k,{value:d.value,enumerable:true});}
  return Object.freeze(result) as Partial<NativeGameFileResourceLimits>;
}
