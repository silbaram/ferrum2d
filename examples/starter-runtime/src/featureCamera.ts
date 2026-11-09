import type { FeatureContext, FeatureExtra } from "./featureExtras";

/** A short presentation impulse; native camera follow/bounds and game simulation stay in Rust. */
export function createCameraFeature(ctx: FeatureContext): FeatureExtra {
  const {root,runtime,signal} = ctx;
  const button = root.querySelector<HTMLButtonElement>('[data-control="camera-shake"]')!;
  let active=false, elapsed=0, impulses=0, lastTime:number|undefined;
  let latest={x:320,y:192}, anchor={...latest};
  const cancel = () => { if(active){active=false;lastTime=undefined;ctx.configureView();} };
  button.addEventListener('click',()=>{
    if(!ctx.playing())return;
    anchor={...latest};elapsed=0;lastTime=undefined;active=true;impulses++;
  },{signal});
  for(const name of ['camera','camera-bounds','zoom'])root.querySelector(`[data-control="${name}"]`)!.addEventListener(name==='zoom'?'input':'change',cancel,{signal});
  return {
    reset(){active=false;elapsed=impulses=0;lastTime=undefined;},
    frame(frame){
      latest={x:frame.cameraX,y:frame.cameraY};
      if(!active)return;
      elapsed+=lastTime===undefined?0:Math.max(0,Math.min(.05,frame.timeSeconds-lastTime));lastTime=frame.timeSeconds;
      if(elapsed>=.4){cancel();return;}
      const amplitude=6*(1-elapsed/.4);
      const bounded=root.querySelector<HTMLInputElement>('[data-control="camera-bounds"]')!.checked;
      if(!runtime.engine.setDataSceneCamera({x:anchor.x+Math.sin(elapsed*65)*amplitude,y:anchor.y+Math.sin(elapsed*51)*amplitude,
        smoothTimeSeconds:0,...(bounded?{bounds:{minX:0,minY:0,maxX:640,maxY:384}}:{})}))throw Error('카메라 충격을 적용하지 못했습니다.');
    },
    observation:()=>`카메라 ${latest.x.toFixed(1)}, ${latest.y.toFixed(1)} · 흔들림 ${active?'재생 중':'대기'} · 충격 ${impulses}회`,
    snapshot:()=>({cameraEffect:{active,elapsed,impulses}}),
    pause(paused){if(paused)cancel();},destroy(){active=false;},
  };
}
