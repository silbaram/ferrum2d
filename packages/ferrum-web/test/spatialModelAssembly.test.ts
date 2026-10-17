import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { addSpatialModelAssembly, resolveSceneAuthoringDocument, type SceneAuthoringDocumentSpec, type SpatialModelAssemblySpec } from "../src/authoring.js";
import { instantiateSceneFragment } from "../src/sceneComposition.js";

const base = (): SceneAuthoringDocumentSpec => ({
  format: "ferrum2d.consumer.scene-authoring", version: 1,
  sceneComposition: { prefabs: {} }, behaviorRecipes: { entities: {} },
  spatial: { camera: { projection: "orthographic", position: { x: 0, y: -200, elevation: 200 }, target: { x: 0, y: 0, elevation: 0 }, height: 300 }, billboards: {}, terrain: [] },
});
const source = (): SpatialModelAssemblySpec => ({
  id: "house", x: 100, y: 200, elevation: 16, scale: 2,
  model: { asset: "building", contentId: "a".repeat(64) },
  colliders: [{ id: "wall", x: 20, y: 40, halfWidth: 2, halfDepth: 8, elevation: 32, height: 48, floorId: 7 }],
  terrain: [
    { id: "ramp", x: 0, y: 0, width: 8, depth: 16, elevation: 0, endElevation: 32, kind: "ramp" },
    { id: "upper", x: 0, y: 16, width: 8, depth: 16, elevation: 32, baseElevation: 24, kind: "bridge", floorId: 7 },
  ], connections: [{ from: "ramp", to: "upper" }],
});

test("moving assembly declares native derived proxies and child models without double elevation",()=>{
  const assembly=source();delete assembly.terrain;delete assembly.connections;assembly.motion='kinematic';
  assembly.children=[{id:'weapon',x:5,y:0,elevation:3,model:{asset:'weapon',contentId:'b'.repeat(64)},colliders:[{id:'mount',x:0,y:0,elevation:0,halfWidth:1,halfDepth:1,height:1}]}];
  const result=addSpatialModelAssembly(base(),assembly);
  equal(result.spatial!.models!.house.elevation,0);
  deepEqual(result.spatial!.attachments!['house/colliders/wall'],{parent:'house',x:40,y:80,elevation:64,yawDegrees:0,inheritFloor:false});
  deepEqual(result.spatial!.attachments!['house/children/weapon'],{parent:'house',x:10,y:0,elevation:6,yawDegrees:0,inheritFloor:true});
  equal(result.spatial!.attachments!['house/children/weapon/colliders/mount'].parent,'house/children/weapon');
  const instances=instantiateSceneFragment(result.sceneComposition);
  const root=instances.find(i=>i.id==='house')!.props.components as {body:{type:string;heightSpan:{elevation:number}}};
  equal(root.body.type,'kinematic');equal(root.body.heightSpan.elevation,16);
  const child=instances.find(i=>i.id==='house/children/weapon')!.props.components as {body:{type:string}};
  equal(child.body.type,'static');
  const invalid=source();invalid.motion='kinematic';throws(()=>addSpatialModelAssembly(base(),invalid),/moving terrain/);
});

test("model assembly compiles stable world proxies and leaves source JSON unchanged", () => {
  const document = base(), assembly = source(), before = JSON.stringify([document, assembly]);
  const result = addSpatialModelAssembly(document, assembly);
  equal(JSON.stringify([document, assembly]), before);
  deepEqual(result.spatial!.models!.house, { ...assembly.model, elevation: 16, yawDegrees: 0, scale: 2 });
  const instances = instantiateSceneFragment(result.sceneComposition);
  const wall = instances.find(i => i.id === "house/colliders/wall")!;
  equal(wall.x, 140); equal(wall.y, 280);
  const components = wall.props.components as Record<string, unknown>;
  deepEqual(components.collider, { type: "aabb", halfWidth: 4, halfHeight: 16, isTrigger: false });
  deepEqual(components.body, { type: "static", heightSpan: { floorId: 7, elevation: 80, height: 96 } });
  const ramp = result.spatial!.terrain[0];
  equal(ramp.render, false); equal(ramp.elevation, 16); equal(ramp.endElevation, 80); equal(ramp.depth, 32);
  deepEqual(result.spatial!.connections, [{ from: "house/terrain/ramp", to: "house/terrain/upper" }]);
  deepEqual(addSpatialModelAssembly(base(), source()), result);
  ok(resolveSceneAuthoringDocument(JSON.parse(JSON.stringify(result)), { validateComponents: true, validateBindings: true }));
});

test("cardinal placement rotates rectangular extents and ramp direction without AABB inflation", () => {
  const expected = [
    [100,200,16,32,"y",16,80,140,280,4,16],
    [68,200,32,16,"x",80,16,20,240,16,4],
    [84,168,16,32,"y",80,16,60,120,4,16],
    [100,184,32,16,"x",16,80,180,160,16,4],
  ];
  for (const yawDegrees of [0,90,180,270,-90,-180,-270,360,-360]) {
    const result = addSpatialModelAssembly(base(), { ...source(), yawDegrees });
    const ramp = result.spatial!.terrain[0], wall = instantiateSceneFragment(result.sceneComposition)[1];
    const collider = (wall.props.components as { collider: { halfWidth: number; halfHeight: number } }).collider;
    deepEqual([ramp.x,ramp.y,ramp.width,ramp.depth,ramp.rampAxis,ramp.elevation,ramp.endElevation,wall.x,wall.y,collider.halfWidth,collider.halfHeight], expected[((yawDegrees/90)%4+4)%4]);
  }
});

test("local X ramps rotate into Y ramps and preserve their high endpoint", () => {
  const assembly = source();
  assembly.terrain = [{ id:"ramp", x:0,y:0,width:16,depth:8,elevation:0,endElevation:32,kind:"ramp",rampAxis:"x" }];
  assembly.connections = [];
  const ramp = addSpatialModelAssembly(base(), { ...assembly, yawDegrees: 90 }).spatial!.terrain[0];
  equal(ramp.rampAxis, "y"); equal(ramp.elevation, 16); equal(ramp.endElevation, 80);
});

test("assembly rejects unsupported transforms, malformed proxies and generated ID collisions", () => {
  for (const patch of [{yawDegrees:45}, {yawDegrees:NaN}, {scale:0}, {scale:-1}, {scale:Infinity}, {x:1e40}, {rotationX:30}, {model:{...source().model,scale:2}}])
    throws(() => addSpatialModelAssembly(base(), {...source(),...patch} as SpatialModelAssemblySpec), /spatialModelAssembly/);
  for (const patch of [{halfWidth:0}, {halfWidth:1e-300}, {halfWidth:1e39}, {halfDepth:-1}, {height:0}, {floorId:1.5}, {floorId:65536}, {elevation:Infinity}, {unexpected:1}]) {
    const a=source(); a.colliders=[{...a.colliders![0],...patch}];
    throws(() => addSpatialModelAssembly(base(),a));
  }
  const duplicate=source(); duplicate.colliders=[duplicate.colliders![0],duplicate.colliders![0]];
  throws(()=>addSpatialModelAssembly(base(),duplicate), /duplicate/);
  const placed=addSpatialModelAssembly(base(),source());
  throws(()=>addSpatialModelAssembly(placed,source()), /already exists/);
  throws(()=>addSpatialModelAssembly(placed,{...source(),id:"other"}), /overlap/);
  const visible=source(); visible.terrain=[{...visible.terrain![0],render:true}]; visible.connections=[];
  throws(()=>addSpatialModelAssembly(base(),visible), /invisible/);
  const tooMany=source(); tooMany.colliders=Array.from({length:257},()=>source().colliders![0]);
  throws(()=>addSpatialModelAssembly(base(),tooMany), /256/);
});

test("assembly preserves existing fragment includes, recipe bindings and independent instances", () => {
  const document=base(); document.sceneComposition={initialFragment:"level",prefabs:{object:{props:{components:{sprite:{texture:0,width:1,height:1},collider:"none",layer:"wall"}}}},fragments:{level:{include:[{fragment:"shared",idPrefix:"existing/"}]},shared:{instances:[{id:"marker",prefab:"object",x:400}]}}};
  const result=addSpatialModelAssembly(document,source());
  const instances=instantiateSceneFragment(result.sceneComposition);
  deepEqual(instances.map(i=>i.id),["existing/marker","house","house/colliders/wall"]);
  equal(instances[0].x,400);
  deepEqual(result.sceneComposition.fragments!.level.include,document.sceneComposition.fragments!.level.include);
});

test("assembly retains supported minimum model scale and rejects collapsed f32 surface bounds", () => {
  const tiny=source(); tiny.colliders=[]; tiny.connections=[]; tiny.terrain=[];
  equal(addSpatialModelAssembly(base(),{...tiny,scale:0.0001}).spatial!.models!.house.scale,0.0001);
  throws(()=>addSpatialModelAssembly(base(),{...source(),x:1e30,colliders:[]}), /transformed.width/);
});

test("decimal model placements preserve seams using the compiled world f32 bounds", () => {
  const input = source();
  input.x = -100.1; input.y = 0; input.scale = 3.7; input.colliders = []; input.connections = [];
  const x = -3.7, width = 103.7;
  input.terrain = [
    {id:"a",x,y:0,width,depth:10,elevation:0},
    {id:"b",x:x+width,y:0,width,depth:10,elevation:0},
  ];
  const placed = addSpatialModelAssembly(base(), input), [a,b] = placed.spatial!.terrain;
  // The authored double sum has a tiny overlap, but the actual native edge is shared.
  ok(a.x+a.width>b.x);
  equal(Math.fround(Math.fround(a.x)+Math.fround(a.width)),Math.fround(b.x));
  ok(resolveSceneAuthoringDocument(JSON.parse(JSON.stringify(placed)), {validateComponents:true}));
});

test("local terrain IDs and connection fields cannot escape assembly validation", () => {
  const input=source(); input.terrain=[{...input.terrain![0],id:"x".repeat(129)}]; input.connections=[];
  throws(()=>addSpatialModelAssembly(base(),input), /128/);
  const missing=source(); missing.connections=[{to:"upper"} as never];
  throws(()=>addSpatialModelAssembly(base(),missing), /connections.0.from/);
});

const minimal = (id: string): SpatialModelAssemblySpec => ({
  id, x: 0, y: 0, model: source().model,
});

test("nested assemblies match independently authored world models, colliders, ramps and links", () => {
  const detail = { ...source(), id:"detail", x:40, y:100, elevation:4, yawDegrees:-90, scale:2 };
  const annex = { ...source(), id:"annex", x:100, y:-40, elevation:8, yawDegrees:90, scale:.5, children:[detail] };
  const input = { ...minimal("house"), x:100, y:200, elevation:16, yawDegrees:90, scale:2, children:[annex] };
  const document = base(), before = JSON.stringify([document,input]);
  const nested = addSpatialModelAssembly(document,input);
  let flat = addSpatialModelAssembly(base(),{...input,children:undefined});
  flat = addSpatialModelAssembly(flat,{...annex,id:"house/children/annex",x:180,y:400,elevation:32,yawDegrees:180,scale:1,children:undefined});
  flat = addSpatialModelAssembly(flat,{...detail,id:"house/children/annex/children/detail",x:140,y:300,elevation:36,yawDegrees:90,scale:2});
  deepEqual(nested,flat);
  equal(JSON.stringify([document,input]),before);
  const restored = JSON.parse(JSON.stringify(nested));
  deepEqual(resolveSceneAuthoringDocument(restored,{validateComponents:true,validateBindings:true}),resolveSceneAuthoringDocument(flat,{validateComponents:true,validateBindings:true}));
  equal(restored.version,1);
  ok(!("children" in restored.spatial.models.house));
});

test("child local transforms compose with every signed cardinal parent rotation", () => {
  const expected = [[120,240],[60,220],[80,160],[140,180]];
  for (const yaw of [0,90,180,270,-90,-180,-270,360,-360]) {
    const input={...minimal("p"),x:100,y:200,elevation:8,yawDegrees:yaw,scale:2,
      children:[{...minimal("c"),x:10,y:20,elevation:4,yawDegrees:90,scale:.5}]};
    const placed=addSpatialModelAssembly(base(),input);
    const child=instantiateSceneFragment(placed.sceneComposition).find(i=>i.id==="p/children/c")!;
    deepEqual([child.x,child.y],expected[((yaw/90)%4+4)%4]);
    const model=placed.spatial!.models![child.id];
    deepEqual([model.elevation,model.scale,model.yawDegrees],[16,1,((yaw+90)%360+360)%360]);
  }
});

test("a descendant's walk surfaces can complete the scene actor contract", () => {
  const document=base();
  document.sceneComposition={initialFragment:"main",prefabs:{actor:{}},fragments:{main:{instances:[{
    id:"actor",prefab:"actor",props:{components:{visual:{kind:"sprite",texture:1,width:16,height:24},
      collider:{type:"aabb",halfWidth:2,halfHeight:2,isTrigger:false},body:{type:"kinematic",heightSpan:{floorId:0,elevation:0,height:8}},layer:"player"}},
  }]}}};
  document.spatial={...document.spatial!,billboards:{actor:{}},actor:{instanceId:"actor",speed:64}};
  const result=addSpatialModelAssembly(document,{...minimal("parent"),children:[source()]});
  equal(result.spatial!.terrain.length,2);
  ok(resolveSceneAuthoringDocument(result,{validateComponents:true,validateBindings:true}));
});

test("shared child definitions have independent namespaces without a false cycle", () => {
  const child={...minimal("__proto__"),x:10};
  const input={...minimal("village"),children:[
    {...minimal("left"),x:-200,children:[child]},
    {...minimal("right"),x:200,children:[child]},
  ]};
  const placed=addSpatialModelAssembly(base(),input);
  const instances=instantiateSceneFragment(placed.sceneComposition);
  deepEqual(instances.filter(i=>i.id.endsWith("/__proto__")).map(i=>[i.id,i.x]),[
    ["village/children/left/children/__proto__",-190],
    ["village/children/right/children/__proto__",210],
  ]);
  equal(Object.keys(placed.spatial!.models!).length,5);
});

test("hierarchy bounds reject cycles, excessive depth and invalid child arrays", () => {
  const cyclic=minimal("root");cyclic.children=[cyclic];
  throws(()=>addSpatialModelAssembly(base(),cyclic),/children.0.children.*cyclic/);
  let deep=minimal("a");
  for(let i=1;i<8;i++)deep={...minimal("a"),children:[deep]};
  equal(Object.keys(addSpatialModelAssembly(base(),deep).spatial!.models!).length,8);
  throws(()=>addSpatialModelAssembly(base(),{...minimal("a"),children:[deep]}),/maximum assembly depth is 8/);
  for(const children of [null,{},1,Array(64).fill(minimal("child"))])
    throws(()=>addSpatialModelAssembly(base(),{...minimal("root"),children} as SpatialModelAssemblySpec),/children.*array/);
});

test("assembly count includes all branches and the existing scene model budget", () => {
  const children=Array.from({length:63},(_,i)=>minimal(`c${i}`));
  equal(Object.keys(addSpatialModelAssembly(base(),{...minimal("root"),children}).spatial!.models!).length,64);
  const oversized=[{...children[0],children:[minimal("grandchild")]},...children.slice(1)];
  throws(()=>addSpatialModelAssembly(base(),{...minimal("root"),children:oversized}),/maximum 64 assemblies/);
  const existing=addSpatialModelAssembly(base(),minimal("existing"));
  const model=existing.spatial!.models!.existing;
  existing.spatial!.models=Object.fromEntries(Array.from({length:961},(_,i)=>[`existing${i}`,model]));
  throws(()=>addSpatialModelAssembly(existing,{...minimal("root"),children}),/maximum 1024 instances/);
});

test("bad child transforms and collisions fail without mutating the input scene or hierarchy", () => {
  for(const [scale,child] of [
    [10000,{...minimal("c"),scale:2}],
    [.0001,{...minimal("c"),scale:.5}],
    [1,{...minimal("c"),yawDegrees:NaN}],
    [10000,{...minimal("c"),x:1e38}],
  ] as const) {
    const document=base(),input={...minimal("root"),scale,children:[child]},before=JSON.stringify([document,input]);
    throws(()=>addSpatialModelAssembly(document,input),/children.0/);
    equal(JSON.stringify([document,input]),before);
  }
  const duplicates={...minimal("root"),children:[minimal("same"),minimal("same")]};
  throws(()=>addSpatialModelAssembly(base(),duplicates),/children.1.id.*already exists/);
  const document=addSpatialModelAssembly(base(),minimal("root/children/taken")),before=JSON.stringify(document);
  throws(()=>addSpatialModelAssembly(document,{...minimal("root"),children:[minimal("taken")]}),/children.0.id.*already exists/);
  equal(JSON.stringify(document),before);
});

test("proxy arrays cannot silently omit sparse or null authored collisions", () => {
  const bad = [{colliders:Array(1)}, {colliders:null}, {terrain:null}, {connections:null},
    {terrain:Array(1)}, {connections:Array(1)}];
  for(const patch of bad) {
    const document=base(),input={...minimal("root"),children:[{...minimal("child"),...patch}]} as SpatialModelAssemblySpec;
    const before=JSON.stringify([document,input]);
    throws(()=>addSpatialModelAssembly(document,input), /spatialModelAssembly|spatial/);
    equal(JSON.stringify([document,input]),before);
  }
});

const invalidWorldBoxes = [
  {x:16777216,halfWidth:.25}, {y:16777216,halfDepth:.25}, {elevation:16777216,height:1},
  {x:3e38,halfWidth:1e38}, {y:-3e38,halfDepth:1e38}, {halfWidth:2e38},
];

test("world AABB bounds and height intervals must remain finite and nonzero after f32 placement", () => {
  const wall={id:"wall",x:0,y:0,halfWidth:1,halfDepth:1,elevation:0,height:1};
  for(const patch of invalidWorldBoxes)
    throws(()=>addSpatialModelAssembly(base(),{...minimal("root"),children:[{...minimal("child"),colliders:[{...wall,...patch}]}]}),/children.0.colliders.0.*world AABB/);
  const valid=addSpatialModelAssembly(base(),{...minimal("root"),children:[{...minimal("child"),colliders:[{...wall,x:16777216,halfWidth:4,elevation:16777216,height:4}]}]});
  ok(resolveSceneAuthoringDocument(JSON.parse(JSON.stringify(valid)),{validateComponents:true}));
});

test("invalid child proxies preserve the active real native scene and saved progress", async () => {
  const {readFile}=await import("node:fs/promises");
  const {createEngine,loadSpatialGlb,captureGameStateSnapshot}=await import("../src/core.js");
  const {applyDataSceneAuthoringDocument}=await import("../src/authoring.js");
  const previousFetch=globalThis.fetch;
  globalThis.fetch=(async(input,options)=>String(input).startsWith("file:")
    ? new Response(Uint8Array.from(await readFile(new URL(String(input)))).buffer,{headers:{"Content-Type":"application/wasm"}})
    : previousFetch(input,options)) as typeof fetch;
  const engine=await createEngine(()=>{});
  try {
    const file=await readFile(new URL("../../../../examples/data-scene-native/assets/building.glb",import.meta.url));
    const asset=await loadSpatialGlb(Uint8Array.from(file).buffer,{materialProfile:"diffuse"});
    ok(engine.registerDataSceneSpatialModel("building",asset));
    const model={asset:"building",contentId:asset.contentId};
    const document=addSpatialModelAssembly(base(),{...minimal("old"),model});
    const handle=applyDataSceneAuthoringDocument(engine,document).entityHandles.old;engine.pauseDataScene();
    const snapshot=()=>captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:JSON.parse(JSON.stringify(document))}).snapshotHash;
    const before=snapshot(),wall={id:"wall",x:0,y:0,halfWidth:1,halfDepth:1,elevation:0,height:1};
    const patches=[{colliders:Array(1)},{colliders:null},{terrain:null},{connections:null},...invalidWorldBoxes.map(p=>({colliders:[{...wall,...p}]}))];
    for(const patch of patches) {
      throws(()=>applyDataSceneAuthoringDocument(engine,addSpatialModelAssembly(base(),{...minimal("root"),model,children:[{...minimal("child"),model,...patch}]} as SpatialModelAssemblySpec)));
      ok(engine.gameplayEntityExists(handle));equal(engine.dataSceneState(),"paused");equal(snapshot(),before);
    }
  } finally {engine.destroy();globalThis.fetch=previousFetch;}
});

test("free angle model assemblies emit exact OBB dimensions and native moving proxies",()=>{
  const a=source();a.terrain=[];a.connections=[];
  const placed=addSpatialModelAssembly(base(),{...a,yawDegrees:37});
  const wall=instantiateSceneFragment(placed.sceneComposition).find(i=>i.id==='house/colliders/wall')!;
  const c=(wall.props.components as {collider:{type:string;halfWidth:number;halfHeight:number;rotationRadians:number}}).collider;
  equal(c.type,'orientedBox');equal(c.halfWidth,4);equal(c.halfHeight,16);equal(c.rotationRadians,37*Math.PI/180);
  const moved=addSpatialModelAssembly(base(),{...a,motion:'kinematic',yawDegrees:37});
  ok(moved.spatial!.attachments!['house/colliders/wall']);
  throws(()=>addSpatialModelAssembly(base(),{...source(),yawDegrees:37}),/walk surfaces require/);
});
