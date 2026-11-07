import { createRenderer } from "@ferrum2d/ferrum-web/core";
import { check, pixels, difference, png } from "/fixture.mjs";
import { probeFlatVolumeShadows } from "/volume-shadows.mjs";

const empty = { commandCount: 0, floatsPerCommand: 15, buffer: new Float32Array(0) };
async function probe(canvas, backend, colorManagement = "legacy") {
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  const clearColor = [.08, .12, .1, 1];
  const renderer = await createRenderer(canvas, { preferred: backend, colorManagement, fallbackBehavior: "silent",
    webgl2: { preserveDrawingBuffer: true, clearColor }, webgpu: { clearColor } });
  check((typeof renderer.gpuDevice === "function") === (backend === "webgpu"), "flat shadow renderer fell back");
  let device = backend === "webgpu" ? renderer.gpuDevice() : undefined;
  const errors = [], rows = [], allocations = {textures:0,buffers:0,groups:0};
  const watch = () => {
    device?.addEventListener("uncapturederror", e => errors.push(e.error.message));
    const owner = device ?? canvas.getContext("webgl2");
    for(const [method,key] of [["createTexture","textures"],["createBuffer","buffers"],...(device?[["createBindGroup","groups"]]:[])]) {
      const original=owner[method].bind(owner);owner[method]=(...args)=>{allocations[key]++;return original(...args);};
    }
  };
  watch();
  try {
    renderer.resize();
    const makeImage = rgba => { const c=document.createElement("canvas");c.width=c.height=1;c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba),1,1),0,0);return c.toDataURL(); };
    await renderer.loadTexture(1,makeImage([20,20,20,255]));
    await renderer.loadTexture(2,makeImage([128,128,255,255]),{colorSpace:"none"});
    const alphaImage=document.createElement("canvas");alphaImage.width=alphaImage.height=2;
    alphaImage.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray([255,255,255,255,255,255,255,0,255,255,255,0,255,255,255,255]),2,2),0,0);
    await renderer.loadTexture(3,alphaImage.toDataURL());
    for (const virtual of [false,true]) {
      renderer.setPixelPerfect(virtual?{width:320,height:180}:false);
      const size = renderer.viewportSize(), scale = Math.min(size.width / 320, size.height / 180),
        ox = size.width / 2 - 160 * scale, oy = size.height / 2 - 90 * scale,
        at = (x, y) => ({ x: ox + x * scale, y: oy + y * scale }),
        light = (x, color) => ({ ...at(x, 90), radius: 250 * scale, height:125*scale, intensity: .4, falloff: 1, color }),
        a = light(60, [1, 0, 0, 1]), b = light(260, [0, 0, 1, 1]),
        wall = { ...at(100, 70), width: 20 * scale, height: 40 * scale },
        mapped = { commandCount:1,floatsPerCommand:15,buffer:new Float32Array([size.width/2,size.height/2,size.width,size.height,0,0,1,1,1,1,1,1,1,0,0]),
          spriteNormalMaterials:{version:1,stride:2,buffer:new Uint32Array([2,0])} };
      for(const normal of [false,true]) {
        const prefix=`${virtual?"virtual":"physical"}-${normal?"normal":"flat"}-`;
        const draw = async (name, pointLights, occluders, opacity, {tint=[0,0,0],enabled=true,warm=false}={}) => {
          renderer.setLighting({ enabled,ambient: [.05, .04, .03, .3], pointLights, tileOccluders: occluders,
            shadows: { enabled: true, color: [...tint, opacity] },
            directionalLight: { directionX: 1, directionY: 0, color: [0, 1, 0], intensity: .05 } });
          const before={...allocations};renderer.render();const stats=renderer.renderCommands(normal?mapped:empty);renderer.renderPostProcess();
          check((stats.normalDrawCalls??0)===(normal&&enabled?1:0),"normal MRT path was not exercised",{normal,enabled,stats});
          const allocated=Object.fromEntries(Object.entries(allocations).map(([key,n])=>[key,n-before[key]]));
          if(warm)check(Object.values(allocated).every(n=>n===0),"warm shadow draw allocated GPU resources",allocated);
          const data = await pixels(renderer, canvas), presentation=renderer.pixelPerfectPresentation(),p=at(180,90),
            x=Math.floor(presentation?presentation.x+p.x*presentation.width/size.width:p.x*canvas.width/size.width),
            y=Math.floor(presentation?presentation.y+p.y*presentation.height/size.height:p.y*canvas.height/size.height),
            offset=(y*canvas.width+x)*4,receiver=Array.from(data.subarray(offset,offset+4)),resources=renderer.resourceStats();
          rows.push({name:prefix+name,receiver,stats,resources,allocated,image:png(data,canvas.width,canvas.height)});
          check(!errors.length,"flat shadow GPU error",errors);
          return {data,receiver,stats,resources};
        };
        const lit=await draw("both-unshadowed",[a,b],[],1),noA=await draw("only-blue",[b],[wall],1),blocked=await draw("red-blocked",[a,b],[wall],1);
        check(lit.receiver[0]>noA.receiver[0]+20,"red reference light was not visible",{lit:lit.receiver,noA:noA.receiver});
        check(blocked.receiver.every((v,i)=>Math.abs(v-noA.receiver[i])<=2),"red shadow changed ambient, sun or unoccluded blue",{lit:lit.receiver,noA:noA.receiver,blocked:blocked.receiver});
        const warm=await draw("warm",[a,b],[wall],1,{warm:true});
        check(difference(blocked.data,warm.data)===0,"warm shadow pixels changed");
        const single=await draw("one-occluder",[a,b],[wall],.5,{warm:true}),duplicate=await draw("duplicate-occluder",[a,b],[wall,{...wall}],.5);
        check(difference(single.data,duplicate.data)===0,"overlapping occluders compounded shadow opacity");
        check(duplicate.stats.shadowCasterCount===single.stats.shadowCasterCount*2,"duplicate caster test did not submit both occluders");
        const tinted=await draw("red-transmission",[a,b],[wall],1,{tint:[1,0,0],warm:true});
        check(tinted.receiver.every((v,i)=>Math.abs(v-lit.receiver[i])<=2),"shadow tint suppressed a transmitted channel",{tinted:tinted.receiver,lit:lit.receiver});
        check(tinted.data.every((v,i)=>i%4===3||v<=lit.data[i]+1),"shadow tint emitted unrelated light");
        const off=await draw("zero-opacity",[a,b],[wall],0);
        check(difference(off.data,lit.data)===0,"zero opacity shadows changed light");
        const width=virtual?320:canvas.width,height=virtual?180:canvas.height;
        check(blocked.resources.renderTargetCount===off.resources.renderTargetCount+1,"mask target accounting");
        check(blocked.resources.textureBytes-off.resources.textureBytes===width*height,"mask must use one R8 byte per physical target pixel");
        const none=await draw("no-lights",[],[wall],1),disabled=await draw("disabled",[],[wall],1,{enabled:false});
        check(none.stats.shadowDrawCalls===0&&disabled.stats.shadowDrawCalls===0,"inactive lights rendered a mask");
        check(none.resources.renderTargetCount===off.resources.renderTargetCount,"no-light frame retained a mask");
        await sunGroundShadows(renderer,canvas,{size,scale,at,normal,prefix,rows,allocations,errors});
      }
    }
    renderer.setPixelPerfect(false);
    // A same-renderer target change must recreate the physical mask at its new size.
    canvas.style.width="317px";canvas.style.height="211px";renderer.resize();
    const lighting={ambient:[.02,.02,.02,1],directionalLight:{directionX:1,directionY:0,intensity:.2,color:[0,1,0]},pointLights:[{x:30,y:90,radius:300,intensity:.3}],tileOccluders:[{x:100,y:60,width:20,height:50}],shadows:true};
    const recoveryCommands={commandCount:2,floatsPerCommand:15,buffer:new Float32Array([0,0,317,211,0,0,1,1,1,1,1,1,1,4,0,80,60,40,50,0,0,1,1,0,0,0,.5,0,20,0])};
    const redraw=async(name)=>{renderer.setLighting(lighting);renderer.render();const stats=renderer.renderCommands(recoveryCommands);renderer.renderPostProcess();const data=await pixels(renderer,canvas);rows.push({name,stats,resources:renderer.resourceStats(),image:png(data,canvas.width,canvas.height)});return data;};
    const resized=await redraw("resized");check(rows.at(-1).stats.shadowDrawCalls===2,"resize omitted point or sun mask");
    if(device){
      const old=device;old.destroy();await old.lost;await new Promise(done=>setTimeout(done,0));await renderer.recoverDevice();device=renderer.gpuDevice();watch();
      const recovered=await redraw("recovered");check(difference(resized,recovered)===0,"device recovery changed per-light shadow pixels");
    }
    if(!device){
      const gl=canvas.getContext("webgl2");
      renderer.render();
      const framebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=Array.from(gl.getParameter(gl.VIEWPORT));
      gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,Math.floor(canvas.width/2),canvas.height);gl.colorMask(false,true,true,true);
      try {
        const stats=renderer.renderCommands(recoveryCommands);
        check(stats.shadowDrawCalls===2,"state restoration test did not render both masks");
        check(gl.getParameter(gl.FRAMEBUFFER_BINDING)===framebuffer&&Array.from(gl.getParameter(gl.VIEWPORT)).every((v,i)=>v===viewport[i]),"shadow mask leaked framebuffer or viewport");
        check(gl.isEnabled(gl.SCISSOR_TEST)&&gl.getParameter(gl.COLOR_WRITEMASK)[0]===false&&gl.getParameter(gl.BLEND_EQUATION_RGB)===gl.FUNC_ADD,"shadow mask leaked scissor, color mask or blend equation");
      } finally {gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);renderer.renderPostProcess();}
    }
    renderer.destroy();
    const finalResources=renderer.resourceStats();
    check(finalResources.textureCount===0&&finalResources.bufferCount===0&&finalResources.renderTargetCount===0,"shadow teardown leaked renderer resources",finalResources);

    return { backend, colorManagement, rows, errors, finalResources };
  } finally { renderer.destroy(); window.disposeSpatialGpuTarget?.(canvas); device?.destroy(); }
}
export async function probeFlatShadowIsolation() {
  const backends = [];
  for (const [backend,colorManagement] of [["webgl2","legacy"],["webgpu","legacy"],["webgl2","linear-srgb"]]) {
    const canvas=document.createElement("canvas");document.body.replaceChildren(canvas);
    backends.push(await probe(canvas,backend,colorManagement));
  }
  for(const row of backends[0].rows.filter(r=>/red-blocked|duplicate-occluder|red-transmission|sun-/.test(r.name))) {
    const other=backends[1].rows.find(r=>r.name===row.name),images=[];
    for(const source of [row.image,other.image]){
      const bitmap=await createImageBitmap(await(await fetch(source)).blob()),c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext("2d");ctx.drawImage(bitmap,0,0);bitmap.close();images.push(ctx.getImageData(0,0,c.width,c.height).data);
    }
    let different=0,max=0;
    for(let i=0;i<images[0].length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(images[0][i+c]-images[1][i+c]));if(d>3)different++;max=Math.max(max,d);}
    row.parity={differentPixels:different,maxChannelDelta:max,pixels:images[0].length/4};
    check(different/(images[0].length/4)<.01,"flat shadow backend RGB parity",{name:row.name,...row.parity});
  }
  const volumes=await probeFlatVolumeShadows();
  for(let i=0;i<backends.length;i++)backends[i].volumes=volumes[i];
  return backends;
}

async function sunGroundShadows(renderer,canvas,{size,scale,at,normal,prefix,rows,allocations,errors}) {
  const rectangle=(x,y,w,h,texture,flags,alpha=1,rotation=0)=>{const p=at(x,y);return [p.x,p.y,w*scale,h*scale,0,0,1,1,1,1,1,alpha,texture,flags,rotation];};
  const background=rectangle(0,0,320,180,1,4), shadow=rectangle(140,70,60,40,0,20);
  shadow[8]=shadow[9]=shadow[10]=0;
  const draw=async(name,{intensity=.4,alpha=1,copies=1,shape="box",cover=0,enabled=true,legacy=false,warm=false}={})=>{
    const records=[background];
    for(let i=0;i<copies;i++)records.push(shape==="alpha"?rectangle(140,70,60,40,3,36,alpha,Math.PI/2):[...shadow.slice(0,11),alpha,...shadow.slice(12)]);
    if(cover)records.push(rectangle(140,70,60,40,1,0,cover));
    const commands={commandCount:records.length,floatsPerCommand:15,buffer:new Float32Array(records.flat()),groundShadowProjection:new Float32Array([1,0,1]),
      ...(normal?{spriteNormalMaterials:{version:1,stride:2,buffer:new Uint32Array(records.flatMap((_,i)=>[i===0?2:16777215,0]))}}:{})};
    renderer.setLighting(legacy?false:{enabled,ambient:[.05,.04,.03,.3],pointLights:[{...at(170,90),radius:200*scale,height:100*scale,intensity:.15,color:[0,0,1]}],
      directionalLight:{directionX:1,directionY:0,intensity,color:[0,1,0]},shadows:false});
    const before={...allocations};renderer.render();const stats=renderer.renderCommands(commands);renderer.renderPostProcess();
    const allocated=Object.fromEntries(Object.entries(allocations).map(([key,n])=>[key,n-before[key]]));
    if(warm)check(Object.values(allocated).every(n=>n===0),"warm sun shadow allocated GPU resources",allocated);
    const data=await pixels(renderer,canvas),presentation=renderer.pixelPerfectPresentation();
    const sample=(x,y)=>{const p=at(x,y),px=Math.floor(presentation?presentation.x+p.x*presentation.width/size.width:p.x*canvas.width/size.width),py=Math.floor(presentation?presentation.y+p.y*presentation.height/size.height:p.y*canvas.height/size.height),offset=(py*canvas.width+px)*4;return Array.from(data.subarray(offset,offset+4));};
    const receiver=sample(185,80),hole=sample(155,80),resources=renderer.resourceStats();
    rows.push({name:prefix+"sun-"+name,receiver,hole,stats,resources,allocated,image:png(data,canvas.width,canvas.height)});
    check(!errors.length,"sun shadow GPU error",errors);
    return {data,receiver,hole,stats,resources};
  };
  const open=await draw("open",{copies:0}),blocked=await draw("blocked"),noSun=await draw("zero",{intensity:0}),noSunOpen=await draw("zero-open",{intensity:0,copies:0});
  check(open.receiver[1]>blocked.receiver[1]+20,"sun ground receiver was not shadowed",{open:open.receiver,blocked:blocked.receiver});
  check(blocked.receiver.every((v,i)=>Math.abs(v-noSun.receiver[i])<=2),"sun shadow suppressed ambient or blue point light",{blocked:blocked.receiver,noSun:noSun.receiver});
  check(difference(noSun.data,noSunOpen.data)===0,"zero sun left black geometry on the scene");
  const partial=await draw("partial",{alpha:.5}),duplicate=await draw("duplicate",{alpha:.5,copies:2});
  check(difference(partial.data,duplicate.data)===0,"overlapping sun silhouettes compounded opacity");
  const cutout=await draw("alpha",{shape:"alpha"});
  check(cutout.receiver.every((v,i)=>Math.abs(v-blocked.receiver[i])<=2)&&cutout.hole.every((v,i)=>Math.abs(v-open.hole[i])<=2),"sun alpha holes or UV projection changed",{cutout:{receiver:cutout.receiver,hole:cutout.hole},blocked:blocked.receiver,open:open.hole});
  const warm=await draw("warm",{warm:true});check(difference(warm.data,blocked.data)===0,"warm sun pixels changed");
  const covered=await draw("upright",{cover:1}),coverOpen=await draw("upright-open",{cover:1,copies:0});
  check(difference(covered.data,coverOpen.data)===0,"ground sunlight shadow shaded upright roof/wall pixels");
  const translucent=await draw("translucent",{cover:.5});
  check(translucent.receiver[1]>blocked.receiver[1]+5&&translucent.receiver[1]<open.receiver[1]-5,"foreground alpha did not partially remove ground-only coverage");
  const weak=await draw("weak",{intensity:.035}),weakOpen=await draw("weak-open",{intensity:.035,copies:0});
  // Compare encoded contrasts rather than treating sRGB values as linear irradiance.
  check(weakOpen.receiver[1]-weak.receiver[1]<=(open.receiver[1]-blocked.receiver[1])*.4+2
    && [0,2].every(c=>Math.abs(weakOpen.receiver[c]-weak.receiver[c])<=2),"weak sun left a disproportionately dark shadow",{weak:weak.receiver,weakOpen:weakOpen.receiver,open:open.receiver,blocked:blocked.receiver});
  const disabled=await draw("disabled",{enabled:false}),disabledOpen=await draw("disabled-open",{enabled:false,copies:0});
  check(difference(disabled.data,disabledOpen.data)===0,"disabled lighting retained native sun silhouettes");
  const legacy=await draw("legacy",{legacy:true}),legacyOpen=await draw("legacy-open",{legacy:true,copies:0});
  check(legacyOpen.receiver[0]>legacy.receiver[0]+10,"standalone legacy ground silhouettes stopped drawing");
  const width=renderer.pixelPerfectPresentation()?320:canvas.width,height=renderer.pixelPerfectPresentation()?180:canvas.height;
  check(blocked.resources.textureBytes-noSun.resources.textureBytes===width*height,"sun mask storage must be one R8 byte per target pixel");
  check(blocked.stats.shadowCasterCount===1&&duplicate.stats.shadowCasterCount===2&&noSun.stats.shadowDrawCalls===0,"sun caster statistics do not describe submitted work");
  const none=await draw("no-casters",{copies:0});
  check(none.resources.renderTargetCount===noSun.resources.renderTargetCount&&none.stats.shadowDrawCalls===0,"no-caster frame retained the sunlight mask");
}
