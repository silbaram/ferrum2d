import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const queryControls = `<label>공간 질의<select data-control="query-kind"><option value="circle">원으로 찾기</option><option value="aabb">사각형으로 찾기</option><option value="cast">원을 오른쪽으로 이동</option></select></label>
  <label>반경 <output data-value="query-radius">48</output><input data-control="query-radius" type="range" min="8" max="96" value="48" step="8"></label>
  <div class="feature-buttons"><button data-control="query-left">빈 공간</button><button data-control="query-center">로봇 중심</button></div>
  <p>캔버스에서 포인터를 움직이세요. 검색·충돌 계산은 Rust가 수행하고, 테두리와 대상 표시는 그 결과입니다.</p>`;

export function createQueryFeature(ctx: FeatureContext): FeatureExtra {
  const { root, canvas, runtime, signal } = ctx;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => root.querySelector<T>(`[data-control="${name}"]`)!;
  const overlay = document.createElement("div"); overlay.className = "feature-query-overlay"; overlay.setAttribute("aria-hidden", "true");
  const region = document.createElement("div"), path = document.createElement("div");
  region.className = "feature-query-region"; path.className = "feature-query-path"; overlay.append(path, region);
  const targets = Object.keys(runtime.dataScene!.result.entityHandles).map(name => {
    const marker = document.createElement("span"); marker.textContent = name === "robot" ? "로봇" : "공"; overlay.append(marker);
    return {name, marker};
  });
  root.querySelector(".feature-scene")!.append(overlay);
  let point = {x:240,y:192}, hits: number[] = [], lastSample = -Infinity;
  const sample = () => {
    const radius = Number(control("query-radius").value), kind = control("query-kind").value;
    const query = {...point, radius};
    const result = kind === "circle" ? runtime.engine.queryCircleBodies(query) : kind === "aabb"
      ? runtime.engine.queryAabbBodies({...point, halfWidth:radius, halfHeight:radius})
      : runtime.engine.shapeCastCircleBodies({...query,directionX:1,directionY:0,maxDistance:320});
    hits = result.map(hit => hit.entityId);
    const a = ctx.screenPoint({x:point.x-radius,y:point.y-radius}), b = ctx.screenPoint({x:point.x+radius,y:point.y+radius});
    Object.assign(region.style,{left:`${a.x}px`,top:`${a.y}px`,width:`${b.x-a.x}px`,height:`${b.y-a.y}px`,borderRadius:kind === "aabb" ? "0" : "50%"});
    const end = ctx.screenPoint({x:point.x+320,y:point.y});
    path.hidden = kind !== "cast"; Object.assign(path.style,{left:`${ctx.screenPoint(point).x}px`,top:`${ctx.screenPoint(point).y}px`,width:`${end.x-ctx.screenPoint(point).x}px`});
    const handles = runtime.dataScene!.result.entityHandles;
    const packet = runtime.engine.queryAudioPoseBuffer(new Uint32Array(targets.flatMap(item => { const h = handles[item.name]!; return [h.entityId, h.entityGeneration]; })));
    const states = targets.map((_, index) => { const offset = index * packet.stride; return packet.words[offset] ? { x: packet.floats[offset + 4]!, y: packet.floats[offset + 5]! } : undefined; });
    targets.forEach((item,index) => {
      const state = states[index]; item.marker.hidden = !state;
      if (!state) return;
      const position = ctx.screenPoint(state);
      Object.assign(item.marker.style,{left:`${position.x}px`,top:`${position.y}px`});
      item.marker.dataset.hit = String(hits.includes(handles[item.name]!.entityId));
    });
    root.querySelector('[data-value="query-radius"]')!.textContent = String(radius);
  };
  canvas.addEventListener("pointermove", event => { point = ctx.worldPoint(event); sample(); },{signal});
  for (const key of ["query-kind","query-radius"]) control(key).addEventListener(key === "query-kind" ? "change" : "input", sample,{signal});
  root.querySelector('[data-control="query-left"]')!.addEventListener("click",() => { point={x:100,y:192}; sample(); },{signal});
  root.querySelector('[data-control="query-center"]')!.addEventListener("click",() => { point={x:240,y:192}; sample(); },{signal});
  return { reset() {point={x:240,y:192}; lastSample=-Infinity;}, frame() { if(performance.now()-lastSample>100){lastSample=performance.now(); sample();} },
    observation:() => `질의 ${control<HTMLSelectElement>("query-kind").selectedOptions[0]!.textContent} · 실제 대상 ${hits.length}개`,
    snapshot:() => ({query:{kind:control("query-kind").value,point:{...point},radius:Number(control("query-radius").value),hits:[...hits]}}),pause(){},destroy(){overlay.remove();} };
}
