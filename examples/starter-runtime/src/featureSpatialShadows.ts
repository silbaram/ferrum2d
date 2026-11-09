import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

export const shadowControls=`<label>그림자 원본<select data-control="shadow-mode"><option value="proxy">부피 모델 · 카메라와 독립</option><option value="billboard">표시 평면 · 카메라를 따라감</option><option value="off">그림자 없음 · 비교 기준</option></select></label>
  <label class="feature-check"><input data-control="proxy-visible" type="checkbox"> 간소화 부피 표시</label>
  <label>그림자 영역 기준<select data-control="shadow-center"><option value="camera">카메라 목표점 추적</option><option value="world">고정 월드 · 정원 중심</option></select></label>
  <label>그림자 영역 반경 <output data-value="shadow-extent">240</output><input data-control="shadow-extent" type="range" min="48" max="512" step="16" value="240"></label>
  <label>카메라 회전 <output data-value="camera-angle">0°</output><input data-control="camera-angle" type="range" min="-180" max="180" step="30" value="0"></label>
  <label>카메라 이동 X<input data-control="camera-pan" type="range" min="-256" max="256" step="16" value="0"></label>
  <label>카메라 확대 <output data-value="camera-zoom">100%</output><input data-control="camera-zoom" type="range" min="50" max="200" step="25" value="100"></label>
  <button data-control="shadow-offscreen">화면 밖 나무 그림자 보기</button>
  <p>위 버튼은 나무를 화면 밖에 두고 그림자만 봅니다. 영역 기준을 카메라 추적으로 바꿔 경계를 비교하세요. 고정 월드는 지정한 반경·깊이 안에서만 그림자를 유지합니다.</p>
  <label>태양 고도 <output data-value="shadow-elevation">45°</output><input data-control="shadow-elevation" type="range" min="10" max="85" step="5" value="45"></label>
  <details><summary>캐릭터 자세 · 애니메이션</summary>
    <label>위치 X<input data-control="actor-x" type="range" min="-24" max="24" step="8" value="0"></label>
    <label>높이<input data-control="actor-height" type="range" min="0" max="32" step="8" value="0"></label>
    <label>부피 회전<input data-control="actor-yaw" type="range" min="0" max="360" step="30" value="0"></label>
    <label>정지 프레임<input data-control="actor-frame" type="range" min="0" max="3" step="1" value="0"></label>
    <label class="feature-check"><input data-control="actor-animate" type="checkbox"> 네 프레임 재생</label>
  </details><p>부피 모델은 캐릭터·나무 형태의 근사입니다. 표시 그림의 프레임과 카메라 방향이 바뀌어도 같은 월드 부피를 사용합니다.</p>`;

export function shadowComparisonSettings(root: HTMLElement){
  const input=(key:string)=>root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)!;
  return {mode:input("shadow-mode").value,visible:input("proxy-visible").checked,elevation:Number(input("shadow-elevation").value),
    center:input("shadow-center").value,extent:Number(input("shadow-extent").value),
    actorX:Number(input("actor-x").value),height:Number(input("actor-height").value),yaw:Number(input("actor-yaw").value),
    frame:Number(input("actor-frame").value),animate:input("actor-animate").checked};
}

/** Cold authoring only. Attachments, animation and shadow geometry remain native-owned. */
export function shadowComparisonScene(source:SceneAuthoringDocumentSpec,settings:ReturnType<typeof shadowComparisonSettings>){
  const scene=structuredClone(source),spatial=scene.spatial!;
  const actor=scene.sceneComposition.fragments!.lab!.instances!.find(i=>i.id==="actor")!;
  actor.x=-48+settings.actorX;
  // This generated fixture always authors a sprite animation set and a static height span.
  const components=actor.props!.components as {visual:{animationSet:{initialClip:number}};body:{heightSpan:{elevation:number}}};
  components.body.heightSpan.elevation=settings.height;components.visual.animationSet.initialClip=settings.animate?0:settings.frame+1;
  const billboards={...spatial.billboards},models={...spatial.models};
  for(const id of ["actor","tree"]){
    billboards[id]={...billboards[id],castShadow:settings.mode==="billboard"};
    models[`${id}_shadow`]={...models[`${id}_shadow`]!,castShadow:settings.mode==="proxy",shadowOnly:!settings.visible};
  }
  spatial.billboards=billboards;spatial.models=models;
  // Instance rotation is 2D sprite/collider rotation; the volume's world yaw is an attachment setting.
  spatial.attachments={...spatial.attachments,actor_shadow:{...spatial.attachments!.actor_shadow!,yawDegrees:settings.yaw}};
  const angle=settings.elevation*Math.PI/180;
  spatial.environment!.lighting!.directional!.direction={x:-Math.SQRT1_2*Math.cos(angle),y:-Math.SQRT1_2*Math.cos(angle),elevation:Math.sin(angle)};
  const shadows=spatial.environment!.lighting!.directional!.shadows!;
  shadows.extent=settings.extent;
  if(settings.center==="world")shadows.center={...source.spatial!.camera.target};
  else delete shadows.center;
  return scene;
}
