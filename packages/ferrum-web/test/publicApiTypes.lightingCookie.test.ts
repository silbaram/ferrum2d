import type { PointLightCookie2D, ResolvedPointLightCookie2D } from "../src/index.js";
import type { PointLightCookie2D as LabsCookie, ResolvedPointLightCookie2D as LabsResolvedCookie } from "../src/labs.js";
import type { FlatLightingPreparer } from "../src/core.js";

const named: PointLightCookie2D = { texture: "pattern", rotationRadians: 0, uv: [1, 0, 0, 1] };
const numeric: LabsCookie = { textureId: 7 };
const resolved: ResolvedPointLightCookie2D = { texture: "pattern", rotationRadians: 0, uv: [0, 0, 1, 1] };
const labsResolved: LabsResolvedCookie = resolved;
const preparer: FlatLightingPreparer = { flatLightingCookieVersion: () => 1, prepareFlatLighting() {} };
// @ts-expect-error Cookie references must be unambiguous.
const ambiguous: PointLightCookie2D = { texture: "pattern", textureId: 7 };
void [named, numeric, labsResolved, preparer, ambiguous];
