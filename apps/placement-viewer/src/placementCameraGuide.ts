import type { SpatialCameraSpec, SpatialPoint } from "@ferrum2d/ferrum-web/core";
import { spatialCameraBasis } from "./placementSpatialCamera";
import { setUiAttribute, setUiText, uiText, uiMessage } from "./placementLocale";

/** Eight near/far corners. Does not mutate the authored game camera. */
export function cameraGuideCorners(camera: SpatialCameraSpec, aspect: number): SpatialPoint[] {
  const { forward, right, up } = spatialCameraBasis(camera);
  return [camera.near ?? 0.1, camera.far ?? 10000].flatMap(distance => {
    const height = camera.projection === "orthographic" ? (camera.height ?? 240) / 2 : distance * Math.tan((camera.fovDegrees ?? 60) * Math.PI / 360);
    return [[-1,-1], [1,-1], [1,1], [-1,1]].map(([x,y]) => {
      const v = forward.map((f, i) => f * distance + right[i] * x * height * aspect + up[i] * y * height);
      return { x: camera.position.x + v[0], y: camera.position.y + v[1], elevation: camera.position.elevation + v[2] };
    });
  });
}

/** Clip in homogeneous space so crossing the near plane never creates huge SVG coordinates. */
export function projectGuideSegment(a: SpatialPoint, b: SpatialPoint, m: Float32Array, width: number, height: number) {
  const clip = (p: SpatialPoint) => [0,1,2,3].map(i => m[i] * p.x + m[i+4] * p.elevation - m[i+8] * p.y + m[i+12]);
  const start = clip(a), end = clip(b);
  let lo = 0, hi = 1;
  for (const axis of [0,1,2]) for (const sign of [-1,1]) {
    const da = start[3] + sign * start[axis], db = end[3] + sign * end[axis];
    if (da < 0 && db < 0) return;
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      if (da < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    }
  }
  if (lo > hi) return;
  const point = (t: number) => {
    const p = start.map((v, i) => v + (end[i] - v) * t);
    return p[3] > 1e-9 ? [(p[0]/p[3]+1)*width/2, (1-p[1]/p[3])*height/2] : undefined;
  };
  const p = point(lo), q = point(hi);
  if (p && q && [...p,...q].every(Number.isFinite) && Math.hypot(p[0]-q[0],p[1]-q[1]) > 0.25) return `M${p[0]},${p[1]}L${q[0]},${q[1]}`;
}

export function createPlacementCameraGuide(stage: HTMLElement, settings: HTMLElement) {
  const label = document.createElement("label"), toggle = document.createElement("input"), hint = document.createElement("p"), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  toggle.type = "checkbox"; toggle.dataset.placementCameraGuide = "true";
  setUiAttribute(toggle, "aria-label", "Game Camera Guide"); label.append(toggle, uiText("Game Camera Guide"));
  hint.className = "placement-camera-guide-hint";
  settings.append(label, hint); svg.classList.add("placement-camera-guide");
  setUiAttribute(svg, "aria-label", "Game camera near and far bounds"); stage.append(svg); svg.style.display = "none";
  let signature = "";
  return {
    frame(camera: SpatialCameraSpec | undefined, matrix: Float32Array | undefined, width: number, height: number, aspect: number) {
      svg.style.display = toggle.checked && camera && matrix ? "" : "none";
      hint.hidden = !toggle.checked || !camera;
      if (!toggle.checked || !camera || !matrix) return;
      const key = JSON.stringify([camera, Array.from(matrix), width, height, aspect]);
      if (key === signature) return; signature = key;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.replaceChildren();
      const corners = cameraGuideCorners(camera, aspect), segments = [
        ...[0,1,2,3].map(i => [i, (i+1)%4, "near"] as const),
        ...[0,1,2,3].map(i => [i+4, (i+1)%4+4, "far"] as const),
        ...[0,1,2,3].map(i => [i, i+4, "side"] as const),
      ];
      const add = (a: SpatialPoint, b: SpatialPoint, kind: string) => {
        const d = projectGuideSegment(a,b,matrix,width,height); if (!d) return;
        const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d",d); path.setAttribute("class", kind); svg.append(path);
      };
      for (const [a,b,kind] of segments) add(corners[a],corners[b],kind);
      const hasBounds = svg.childElementCount > 0;
      add(camera.position, camera.target, "direction");
      if (!hasBounds) {
        const note = document.createElementNS(svg.namespaceURI,"text");note.setAttribute("x","12");note.setAttribute("y","48");
        note.setAttribute("data-placement-camera-guide-outside","true");setUiText(note,"Camera bounds outside view · Zoom out");svg.append(note);
      }
      const p = camera.target, m = matrix, w = m[3]*p.x+m[7]*p.elevation-m[11]*p.y+m[15],
        nx = (m[0]*p.x+m[4]*p.elevation-m[8]*p.y+m[12])/w,
        ny = (m[1]*p.x+m[5]*p.elevation-m[9]*p.y+m[13])/w,
        nz = (m[2]*p.x+m[6]*p.elevation-m[10]*p.y+m[14])/w;
      if (w > 0 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1 && Math.abs(nz) <= 1) {
        const x = (nx+1)*width/2, y = (1-ny)*height/2, marker = document.createElementNS(svg.namespaceURI,"circle"), caption = document.createElementNS(svg.namespaceURI,"text");
        marker.setAttribute("cx",String(x));marker.setAttribute("cy",String(y));marker.setAttribute("r","5");marker.setAttribute("class","target");
        caption.setAttribute("x",String(Math.max(8,Math.min(width-110,x+8))));caption.setAttribute("y",String(Math.max(16,y-8)));setUiText(caption,"Game Camera");svg.append(marker,caption);
      }
      setUiText(hint, uiMessage("Game Camera · Near {0} · Far {1} · Dashed: direction", camera.near ?? 0.1, camera.far ?? 10000));
    },
  };
}
