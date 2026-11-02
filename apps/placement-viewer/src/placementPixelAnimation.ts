import { resolveDataSceneSpriteAnimationSet } from "@ferrum2d/ferrum-web/authoring";
import { pixelAtlasLayout, pixelFrames, type createPixelEditor, type PixelDocument, type PixelFrameInfo, type PixelFrameTag, readPixelTags } from "./placementPixelDocument";

export interface PixelAnimationInput { width: number; height: number; frames: PixelFrameInfo[]; tags?: PixelFrameTag[]; initialTag?: string; originalTiming?: boolean; }
export function pixelAnimationInput(source: PixelDocument): PixelAnimationInput {
  return {width:source.width,height:source.height,frames:pixelFrames(source),
    ...((source.version===5||source.version===6)&&source.tags?{tags:structuredClone(source.tags),initialTag:source.initialTag}:{}),
    ...(source.version===6?{originalTiming:true}:{})};
}
/** Match source exports without serializing cel pixels during UI validation. */
export function pixelEditorAnimationInput(editor: ReturnType<typeof createPixelEditor>): PixelAnimationInput {
  const tags=editor.tags();
  return {width:editor.width,height:editor.height,frames:editor.frames(),
    ...(tags.length?{tags,initialTag:editor.initialTag()}:{}),
    ...(editor.version===6?{originalTiming:true}:{})};
}
/** Keep old valid clip identities; expanded or nonuniform sheets use native source-frame timing. */
export function pixelAnimation(input: PixelAnimationInput) {
  const layout=pixelAtlasLayout(input,input.frames.length);
  const tags=input.tags ? readPixelTags(input.tags,input.frames) : [{id:"all",name:"All Frames",clipId:0,frameIds:input.frames.map(frame=>frame.id),loop:true}];
  const initial=tags.find(tag=>tag.id===(input.initialTag??tags[0].id));
  if(!initial)throw Error("Invalid pixel tag references");
  const timings=tags.map(tag=>{
    const indices=tag.frameIds.map(id=>input.frames.findIndex(frame=>frame.id===id));
    const durations=indices.map(index=>input.frames[index].durationMs);
    if(durations.some(ms=>!Number.isInteger(ms)||ms<1||ms>60000))throw Error("Frame duration must be an integer from 1 to 60000");
    let tickMs=durations[0];
    for(let value of durations){let a=tickMs;while(value){const next=a%value;a=value;value=next;}tickMs=a;}
    const legacyRepeats=durations.map(ms=>ms/tickMs),count=legacyRepeats.reduce((sum,n)=>sum+n,0),fps=1000/tickMs;
    const original=input.originalTiming||input.frames.length>16||count>32;
    const repeats=original?indices.map(()=>1):legacyRepeats;
    const clip=original
      ? {id:tag.clipId,loop:tag.loop,frameDurationsMs:durations,frames:indices.map(index=>({...layout.frames[index]}))}
      : {id:tag.clipId,loop:tag.loop,fps,frames:indices.flatMap((index,i)=>Array.from({length:repeats[i]},()=>({...layout.frames[index]})))};
    const cycleMs=durations.reduce((sum,n)=>sum+n,0),nativeCycleMs=original
      ? durations.reduce((sum,ms)=>sum+Math.fround(ms)/1000,0)*1000 : count*1000/Math.fround(fps);
    return {tagId:tag.id,clip,tickMs:original?null:tickMs,repeats,cycleMs,nativeCycleMs,nativeCycleErrorMs:nativeCycleMs-cycleMs};
  });
  const set=resolveDataSceneSpriteAnimationSet({initialClip:initial.clipId,clips:timings.map(timing=>timing.clip)});
  const timing=timings.find(value=>value.tagId===initial.id)!;
  return {layout,set,tickMs:timing.tickMs,repeats:timing.repeats,cycleMs:timing.cycleMs,
    nativeCycleMs:timing.nativeCycleMs,nativeCycleErrorMs:timing.nativeCycleErrorMs,timings};
}

/** Preview cursor is view state; selection, pixels and Undo are untouched. */
export function pixelPreviewFrame(frames:readonly PixelFrameInfo[],elapsedMs:number) {
  const total=frames.reduce((sum,frame)=>sum+frame.durationMs,0);
  if(!frames.length||total<=0||!Number.isFinite(elapsedMs))throw Error("Invalid pixel preview time");
  let time=((elapsedMs%total)+total)%total;
  for(let index=0;index<frames.length;index++){if(time<frames[index].durationMs)return index;time-=frames[index].durationMs;}
  return frames.length-1;
}
