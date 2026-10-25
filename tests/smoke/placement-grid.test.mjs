import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
    new URL("../../apps/placement-viewer/package.json", import.meta.url),
  ),
  ts = require("typescript");
const code = ts.transpileModule(
  await readFile(
    new URL(
      "../../apps/placement-viewer/src/placementGridGeometry.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { flatGrid, spatialGrid, gridElevation, visibleWorkingPlane, pointOnElevationPlane, GRID_LINE_BUDGET } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const minor = [0.1, 0.2, 0.3, 0.5],
  major = [0.5, 0.6, 0.7, 0.7],
  v = {
    cssWidth: 1058,
    cssHeight: 724,
    cameraX: 37.25,
    cameraY: -18.5,
    zoom: 1,
  };
const matrix = () => {
  const m = new Float32Array(28);
  m[0] = 0.01;
  m[5] = 0.01;
  m[9] = -0.01;
  m[15] = 1;
  return m;
};
test("2D grid stays on world multiples after camera pan and zoom", () => {
  for (const zoom of [0.125, 0.8, 1, 2, 8]) {
    const g = flatGrid({ ...v, zoom }, 16, minor, major);
    assert(g.lineCount > 0 && g.lineCount <= GRID_LINE_BUDGET);
    assert.equal(g.buffer.length, g.lineCount * 8);
    assert.equal(g.step % 16, 0);
    for (let i = 0; i < g.buffer.length; i += 8) {
      const [x0, y0, x1, y1] = g.buffer.slice(i, i + 4);
      assert(x0 === x1 || y0 === y1);
      assert.equal(Math.abs((x0 === x1 ? x0 : y0) % g.step), 0);
    }
  }
});
test("small zoom uses coarser display spacing without changing snap size", () => {
  const input = { ...v, cssWidth: 100000, cssHeight: 100000, zoom: 0.0001 };
  const copy = structuredClone(input);
  const g = flatGrid(input, 16, minor, major);
  assert(g.step > 16);
  assert(g.lineCount <= 512);
  assert.deepEqual(input, copy);
});
test("2D zero dimensions produce no geometry and origin axes are emphasized", () => {
  assert.equal(flatGrid({ ...v, cssWidth: 0 }, 16, minor, major).lineCount, 0);
  const g = flatGrid({ ...v, cameraX: 0, cameraY: 0 }, 16, minor, major);
  const axes = [];
  for (let i = 0; i < g.buffer.length; i += 8)
    if (
      (g.buffer[i] === 0 && g.buffer[i + 2] === 0) ||
      (g.buffer[i + 1] === 0 && g.buffer[i + 3] === 0)
    )
      axes.push(g.buffer[i + 7]);
  assert.deepEqual(axes, [1, 1]);
});
for (const rampAxis of ["x", "y"])
  test(
    "spatial " + rampAxis + " ramp lines match authored surface heights",
    () => {
      const s = {
        x: -40,
        y: -20,
        width: 80,
        depth: 80,
        elevation: 10,
        endElevation: 50,
        rampAxis,
      };
      const before = JSON.stringify(s);
      const g = spatialGrid([s], matrix(), 800, 600, 16, minor, major);
      assert(g.lineCount > 0);
      assert.equal(g.vertices.length, g.lineCount * 22);
      for (let i = 0; i < g.vertices.length; i += 11) {
        const x = g.vertices[i],
          y = -g.vertices[i + 2],
          z = g.vertices[i + 1];
        assert(Math.abs(z - gridElevation(s, x, y) - 0.025) < 0.00001);
        assert(
          x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.depth,
        );
      }
      assert.equal(JSON.stringify(s), before);
    },
  );
test("spatial grid clips to surfaces and keeps global origin across uneven patch bounds", () => {
  const s = { x: 5, y: 7, width: 70, depth: 60, elevation: 0 };
  const g = spatialGrid([s], matrix(), 800, 600, 16, minor, major);
  for (let i = 0; i < g.vertices.length; i += 22) {
    const [x, , ny] = g.vertices.slice(i, i + 3),
      x1 = g.vertices[i + 11],
      y1 = -g.vertices[i + 13];
    assert.equal((x === x1 ? x : -ny) % g.step, 0);
    assert(x >= 5 && x1 <= 75 && -ny >= 7 && y1 <= 67);
  }
});
test("offscreen and behind-camera surfaces produce no lines", () => {
  const s = { x: 10000, y: 10000, width: 100, depth: 100, elevation: 0 };
  assert.equal(
    spatialGrid([s], matrix(), 800, 600, 16, minor, major).lineCount,
    0,
  );
  const m = matrix();
  m[15] = -1;
  assert.equal(
    spatialGrid([{ ...s, x: 0, y: 0 }], m, 800, 600, 16, minor, major)
      .lineCount,
    0,
  );
});
test("large surface sets stay bounded and do not mutate frame projection", () => {
  const surfaces = Array.from({ length: 256 }, () => ({
      x: -100000,
      y: -100000,
      width: 200000,
      depth: 200000,
      elevation: 0,
    })),
    m = matrix(),
    before = m.slice();
  const g = spatialGrid(surfaces, m, 800, 600, 1, minor, major);
  assert(g.lineCount <= 512);
  assert.equal(
    g.vertices.some((v) => !Number.isFinite(v)),
    false,
  );
  assert.deepEqual(m, before);
});

test("working grid covers the viewport outside terrain and stays at an explicit height", () => {
  const m = matrix();
  m[12] = 0.4; m[13] = -0.1;
  const before = m.slice();
  for (const elevation of [0, 19, -37]) {
    const plane = visibleWorkingPlane(m, elevation);
    assert(plane);
    assert.equal(plane.elevation, elevation);
    const g = spatialGrid([plane], m, 800, 600, 16, minor, major);
    assert(g.lineCount > 0 && g.lineCount <= 512);
    const rect = {left:15, top:20, width:800, height:600};
    for (const x of [rect.left, rect.left+rect.width]) for (const y of [rect.top, rect.top+rect.height]) {
      const hit = pointOnElevationPlane({x,y}, elevation, {camera:m,rect});
      assert(hit);
      assert(hit.x >= plane.x-0.001 && hit.x <= plane.x+plane.width+0.001);
      assert(hit.y >= plane.y-0.001 && hit.y <= plane.y+plane.depth+0.001);
    }
    for (let i=0;i<g.vertices.length;i+=22) {
      assert(Math.abs(g.vertices[i+1]-elevation-0.025)<0.00001);
      assert.equal(Math.abs((g.vertices[i] === g.vertices[i+11] ? g.vertices[i] : -g.vertices[i+2]) % g.step),0);
    }
  }
  assert.deepEqual(m,before);
});
function perspective(eyeHeight) {
  // A look-at perspective matrix aimed horizontally along -Z: the horizon is visible.
  const f=1/Math.tan(Math.PI/6), near=.1, far=50000;
  const m=new Float32Array(16);
  m[0]=f/1.6; m[5]=f; m[10]=(far+near)/(near-far); m[11]=-1;
  m[13]=-f*eyeHeight; m[14]=2*far*near/(near-far);
  return m;
}
test("perspective horizon clipping stays finite, origin-aligned and within the line budget", () => {
  for (const height of [20, 0.001, -20]) {
    const m=perspective(height), before=m.slice();
    const plane=visibleWorkingPlane(m,0);
    assert(plane);
    const g=spatialGrid([plane],m,1200,750,16,minor,major);
    assert(g.lineCount>0 && g.lineCount<=512);
    assert(g.vertices.every(Number.isFinite));
    for(let i=0;i<g.vertices.length;i+=11) {
      assert(Math.abs(g.vertices[i])<=1e6 && Math.abs(g.vertices[i+2])<=1e6);
    }
    assert.deepEqual(m,before);
  }
  const m=perspective(20), rect={left:0,top:0,width:1200,height:750};
  assert.equal(pointOnElevationPlane({x:600,y:375},0,{camera:m,rect}),undefined,"parallel horizon ray must not produce Infinity");
  assert.equal(pointOnElevationPlane({x:600,y:100},0,{camera:m,rect}),undefined,"behind-eye intersection must be rejected");
  const hit=pointOnElevationPlane({x:600,y:650},0,{camera:m,rect});
  assert(hit && hit.y>0 && hit.elevation===0);
});
test("invalid and invisible working planes produce no geometry", () => {
  const m=matrix(); m[15]=-1;
  assert.equal(visibleWorkingPlane(m,0),undefined);
  assert.equal(visibleWorkingPlane(new Float32Array(4),0),undefined);
  assert.equal(visibleWorkingPlane(matrix(),NaN),undefined);
  m[0]=NaN;
  assert.equal(visibleWorkingPlane(m,0),undefined);
});
test("overlapping coplanar terrain lines are merged without changing their opacity", () => {
  const s={x:-40,y:-40,width:80,depth:80,elevation:0};
  const single=spatialGrid([s],matrix(),800,600,16,minor,major);
  const duplicate=spatialGrid([s,s],matrix(),800,600,16,minor,major);
  assert.deepEqual(duplicate.vertices,single.vertices);
  const adjacent=spatialGrid([s,{...s,x:40}],matrix(),800,600,16,minor,major);
  // Horizontal lines become one segment across both patches, including their shared edge.
  for(let i=0;i<adjacent.vertices.length;i+=22) if(adjacent.vertices[i+2]===adjacent.vertices[i+13]) {
    assert.equal(adjacent.vertices[i],-40);
    assert.equal(adjacent.vertices[i+11],120);
  }
});

test("perspective grid fades toward the far range and keeps orthographic opacity unchanged", () => {
  const m=perspective(20), plane=visibleWorkingPlane(m,0);
  const faded=spatialGrid([plane],m,1200,750,16,minor,major,true),
    normal=spatialGrid([plane],m,1200,750,16,minor,major);
  assert.equal(faded.lineCount,normal.lineCount);
  let diminished=0;
  for(let i=8;i<faded.vertices.length;i+=11) {
    assert(faded.vertices[i]>=0 && faded.vertices[i]<=normal.vertices[i]);
    if(faded.vertices[i]<normal.vertices[i]-.01) diminished++;
  }
  assert(diminished>0);
  const ortho=matrix(), s=visibleWorkingPlane(ortho,0);
  assert.deepEqual(spatialGrid([s],ortho,800,600,16,minor,major,true).vertices,
    spatialGrid([s],ortho,800,600,16,minor,major).vertices);
  assert.equal(spatialGrid([s],ortho,0,600,16,minor,major,true).lineCount,0);
});

test("low pitch uses the gap between projected parallel lines to avoid dense crossing patterns", () => {
  function lowPitch(degrees) {
    const m=new Float32Array(16),k=.001/Math.sqrt(2),a=degrees*Math.PI/180;
    m[0]=k;m[8]=k;m[1]=k*Math.sin(a);m[9]=-k*Math.sin(a);
    m[5]=.001*Math.cos(a);m[15]=1;return m;
  }
  const surface={x:-20000,y:-20000,width:40000,depth:40000,elevation:0},
    low=spatialGrid([surface],lowPitch(1),1200,750,16,minor,major),
    high=spatialGrid([surface],lowPitch(45),1200,750,16,minor,major);
  assert(low.step>high.step*4);
  assert(low.lineCount>0 && low.lineCount<=512);
  // Each of the two projected line families must remain at least 12 CSS px apart.
  const m=lowPitch(1),ux=m[0]*1200/2,uy=m[1]*750/2,vx=-m[8]*1200/2,vy=-m[9]*750/2,
    gap=Math.abs(ux*vy-uy*vx)/Math.max(Math.hypot(ux,uy),Math.hypot(vx,vy));
  assert(gap*low.step>=12);
});
