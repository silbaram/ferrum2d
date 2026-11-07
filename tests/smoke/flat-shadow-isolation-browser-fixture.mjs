import { createRenderer } from "@ferrum2d/ferrum-web/core";
import { check, pixels, difference, png } from "/fixture.mjs";

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
      }
    }
    renderer.setPixelPerfect(false);
    // A same-renderer target change must recreate the physical mask at its new size.
    canvas.style.width="317px";canvas.style.height="211px";renderer.resize();
    const lighting={ambient:[.02,.02,.02,1],pointLights:[{x:30,y:90,radius:300,intensity:.3}],tileOccluders:[{x:100,y:60,width:20,height:50}],shadows:true};
    const redraw=async(name)=>{renderer.setLighting(lighting);renderer.render();const stats=renderer.renderCommands(empty);renderer.renderPostProcess();const data=await pixels(renderer,canvas);rows.push({name,stats,resources:renderer.resourceStats(),image:png(data,canvas.width,canvas.height)});return data;};
    const resized=await redraw("resized");check(rows.at(-1).stats.shadowDrawCalls===1,"resize omitted the mask");
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
        const stats=renderer.renderCommands(empty);
        check(stats.shadowDrawCalls===1,"state restoration test did not render a mask");
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
  for(const row of backends[0].rows.filter(r=>/red-blocked|duplicate-occluder|red-transmission/.test(r.name))) {
    const other=backends[1].rows.find(r=>r.name===row.name),images=[];
    for(const source of [row.image,other.image]){
      const bitmap=await createImageBitmap(await(await fetch(source)).blob()),c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext("2d");ctx.drawImage(bitmap,0,0);bitmap.close();images.push(ctx.getImageData(0,0,c.width,c.height).data);
    }
    let different=0,max=0;
    for(let i=0;i<images[0].length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(images[0][i+c]-images[1][i+c]));if(d>3)different++;max=Math.max(max,d);}
    row.parity={differentPixels:different,maxChannelDelta:max,pixels:images[0].length/4};
    check(different/(images[0].length/4)<.01,"flat shadow backend RGB parity",{name:row.name,...row.parity});
  }
  return backends;
}
