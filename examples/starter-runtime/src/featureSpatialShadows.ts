import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

/** Private fixture metadata; public scene/model contracts stay unchanged. */
export interface ShadowAssets {
  models: Record<string,string>;
  subjects: Record<string,{label:string;frame:{u0:number;v0:number;u1:number;v1:number};width:number;height:number;originY:number;volumeHeight:number}>;
}

export const shadowControls=`<label>그림자 원본<select data-control="shadow-mode"><option value="proxy">부피 모델 · 카메라와 독립</option><option value="billboard">표시 평면 · 카메라를 따라감</option><option value="off">그림자 없음 · 비교 기준</option></select></label>
  <label class="feature-check"><input data-control="proxy-visible" type="checkbox"> 간소화 부피 표시</label>
  <label>비교 사물<select data-control="shadow-asset"><option value="tree">나무</option><option value="lantern">가로등 · 가는 기둥</option><option value="crate">상자 · 발 피벗</option></select></label>
  <label>부피 정밀도<select data-control="shadow-lod"><option value="fixed">고정 · 같은 그림자 유지</option><option value="distance">거리 LOD · 간소화 비교</option></select></label>
  <label>그림자 영역 기준<select data-control="shadow-center"><option value="camera">카메라 목표점 추적</option><option value="world">고정 월드 · 정원 중심</option></select></label>
  <label>그림자 영역 반경 <output data-value="shadow-extent">240</output><input data-control="shadow-extent" type="range" min="48" max="512" step="16" value="240"></label>
  <label>카메라 회전 <output data-value="camera-angle">0°</output><input data-control="camera-angle" type="range" min="-180" max="180" step="30" value="0"></label>
  <label>카메라 이동 X<input data-control="camera-pan" type="range" min="-256" max="256" step="16" value="0"></label>
  <label>카메라 확대 <output data-value="camera-zoom">100%</output><input data-control="camera-zoom" type="range" min="50" max="200" step="25" value="100"></label>
  <label>카메라 거리 <output data-value="camera-distance">100%</output><input data-control="camera-distance" type="range" min="50" max="200" step="10" value="100"></label>
  <button data-control="shadow-offscreen">화면 밖 나무 그림자 보기</button>
  <p>위 버튼은 나무를 화면 밖에 두고 그림자만 봅니다. 영역 기준을 카메라 추적으로 바꿔 경계를 비교하세요. 고정 월드는 지정한 반경·깊이 안에서만 그림자를 유지합니다.</p>
  <label>태양 비교<select data-control="shadow-sun-preset"><option value="custom">직접 조절</option><option value="5">낮은 태양 · 5°</option><option value="45">기본 · 45°</option><option value="81.9">높은 태양 · 81.9°</option><option value="90">천정 · 90°</option></select></label>
  <label>태양 고도 <output data-value="shadow-elevation">45°</output><input data-control="shadow-elevation" type="range" min="0" max="90" step="0.1" value="45"></label>
  <label>태양 방위 <output data-value="shadow-azimuth">−135°</output><input data-control="shadow-azimuth" type="range" min="-180" max="180" step="5" value="-135"></label>
  <label class="feature-check"><input data-control="shadow-coverage" type="checkbox"> 그림자 영역 표시</label>
  <p>청록은 유한 맵 경계, 주황은 내부 fade 시작선입니다(높이 0 기준). 낮은 태양의 긴 그림자도 이 범위 밖에서는 사라집니다. 천정에서는 짧아지고 지평선에서는 바닥 직접광이 없어집니다.</p>
  <details><summary>캐릭터 자세 · 애니메이션</summary>
    <label>위치 X<input data-control="actor-x" type="range" min="-24" max="24" step="8" value="0"></label>
    <label>높이<input data-control="actor-height" type="range" min="0" max="32" step="8" value="0"></label>
    <label>부피 회전<input data-control="actor-yaw" type="range" min="0" max="360" step="30" value="0"></label>
    <label>정지 프레임<input data-control="actor-frame" type="range" min="0" max="3" step="1" value="0"></label>
    <label class="feature-check"><input data-control="actor-animate" type="checkbox"> 네 프레임 재생</label>
    <label class="feature-check"><input data-control="actor-flip-x" type="checkbox"> 좌우 반전</label>
    <label class="feature-check"><input data-control="actor-flip-y" type="checkbox"> 상하 반전</label>
  </details><p>반전·프레임은 그림만 바꿉니다. LOD는 멀어질 때 660, 가까워질 때 540 단위에서 부피를 교체합니다. 직교 카메라는 거리와 화면 크기가 독립입니다.</p>
  <a data-control="playback-download" download="shadow-playback.json" href="#">재생 상태 JSON · 반전 포함</a>`;

export function shadowComparisonSettings(root: HTMLElement){
  const input=(key:string)=>root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)!;
  return {mode:input("shadow-mode").value,visible:input("proxy-visible").checked,elevation:Number(input("shadow-elevation").value),
    center:input("shadow-center").value,extent:Number(input("shadow-extent").value),asset:input("shadow-asset").value,lod:input("shadow-lod").value,azimuth:Number(input("shadow-azimuth").value),coverage:input("shadow-coverage").checked,
    actorX:Number(input("actor-x").value),height:Number(input("actor-height").value),yaw:Number(input("actor-yaw").value),
    frame:Number(input("actor-frame").value),animate:input("actor-animate").checked,flipX:input("actor-flip-x").checked,flipY:input("actor-flip-y").checked};
}

/** Cold authoring only. Attachments, animation and shadow geometry remain native-owned. */
export function shadowComparisonScene(source:SceneAuthoringDocumentSpec,settings:ReturnType<typeof shadowComparisonSettings>,assets:ShadowAssets){
  const scene=structuredClone(source),spatial=scene.spatial!;
  const actor=scene.sceneComposition.fragments!.lab!.instances!.find(i=>i.id==="actor")!;
  actor.x=-48+settings.actorX;
  // This generated fixture always authors a sprite animation set and a static height span.
  const components=actor.props!.components as {visual:{animationSet:{initialClip:number}};body:{heightSpan:{elevation:number}}};
  components.body.heightSpan.elevation=settings.height;components.visual.animationSet.initialClip=settings.animate?0:settings.frame+1;
  const subject=assets.subjects[settings.asset]!;
  const tree=scene.sceneComposition.fragments!.lab!.instances!.find(i=>i.id==="tree")!;
  const treeComponents=tree.props!.components as Record<string,unknown>;
  treeComponents.visual={kind:"sprite",texture:"shadow-garden",width:subject.width,height:subject.height,originX:.5,originY:subject.originY,frame:subject.frame};
  treeComponents.body={type:"static",heightSpan:{floorId:0,elevation:0,height:subject.volumeHeight}};
  const billboards={...spatial.billboards},models={...spatial.models};
  for(const id of ["actor","tree"]){
    billboards[id]={...billboards[id],castShadow:settings.mode==="billboard"};
    const asset=`shadow-${id==="actor"?"actor":settings.asset}`,low=`${asset}-low`;
    models[`${id}_shadow`]={...models[`${id}_shadow`]!,asset,contentId:assets.models[asset]!,castShadow:settings.mode==="proxy",shadowOnly:!settings.visible,
      ...(settings.lod==="distance"?{lods:[{asset:low,contentId:assets.models[low]!,minDistance:600}]}:{})};
  }
  spatial.billboards=billboards;spatial.models=models;
  // Instance rotation is 2D sprite/collider rotation; the volume's world yaw is an attachment setting.
  spatial.attachments={...spatial.attachments,actor_shadow:{...spatial.attachments!.actor_shadow!,yawDegrees:settings.yaw}};
  const angle=settings.elevation*Math.PI/180,azimuth=settings.azimuth*Math.PI/180;
  spatial.environment!.lighting!.directional!.direction={x:Math.cos(azimuth)*Math.cos(angle),y:Math.sin(azimuth)*Math.cos(angle),elevation:Math.sin(angle)};
  const shadows=spatial.environment!.lighting!.directional!.shadows!;
  shadows.extent=settings.extent;
  if(settings.center==="world")shadows.center={...source.spatial!.camera.target};
  else delete shadows.center;
  return scene;
}
