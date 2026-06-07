#!/usr/bin/env node
import {
  CameraRigController,
  ScreenFadeTransition,
  resolvePostProcessPasses,
} from "../../packages/ferrum-web/dist/index.js";

const camera = new CameraRigController({
  x: 50,
  y: 50,
  deadZone: { width: 40, height: 20 },
  bounds: { minX: 0, minY: 0, maxX: 200, maxY: 120 },
});
const cameraSnapshot = camera.step({ x: 180, y: 100 }, 1, {
  viewport: { width: 100, height: 80 },
});
if (cameraSnapshot.x !== 150 || cameraSnapshot.y !== 80) {
  throw new Error(`camera rig did not clamp to viewport bounds: ${JSON.stringify(cameraSnapshot)}`);
}

const fade = new ScreenFadeTransition({
  durationSeconds: 2,
  fromOpacity: 1,
  toOpacity: 0,
});
const fadeSnapshot = fade.update(1);
const fadePasses = fade.postProcessPasses();
if (fadeSnapshot.opacity !== 0.5 || fadePasses[0]?.color[3] !== 0.5) {
  throw new Error(`screen fade did not expose the expected fullscreen pass: ${JSON.stringify(fadeSnapshot)}`);
}

const postProcessPasses = resolvePostProcessPasses([
  { opacity: 0.25 },
  { opacity: 0 },
  { kind: "bloom", threshold: 0.75, intensity: 0.5, radius: 2 },
  { kind: "crt", scanlineIntensity: 0.2 },
  { kind: "vignette", intensity: 0.3 },
]);
if (postProcessPasses.length !== 4 || postProcessPasses[0]?.color[3] !== 0.25) {
  throw new Error(`post-process pass resolver did not filter and resolve effect passes: ${JSON.stringify(postProcessPasses)}`);
}
if (!postProcessPasses.some((pass) => pass.kind === "bloom") || !postProcessPasses.some((pass) => pass.kind === "vignette")) {
  throw new Error(`post-process pass resolver did not expose bloom/vignette passes: ${JSON.stringify(postProcessPasses)}`);
}

console.log(JSON.stringify({
  cameraPostProcessSmoke: {
    camera: cameraSnapshot,
    fade: fadeSnapshot,
    passCount: postProcessPasses.length,
  },
}, null, 2));
