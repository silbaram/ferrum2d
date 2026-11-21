import assert from "node:assert/strict";
import { test } from "node:test";
import { studioSourceModule } from "./placement-physics-summary-source.mjs";
const { placementFlatTextureRoles: roles, placementDocumentTextures: references, collectPlacementAssetUsage: collect,
  createScenePlacementViewer, resolveSceneAuthoringDocument, readPlacementAuthoredComponents: read, preservePlacementComponentMetadata: preserve,
  createPlacementInspectorOriginals: originals } = await studioSourceModule(`
 export {placementFlatTextureRoles} from './apps/studio/src/placementFlatLighting.ts';
 export {placementDocumentTextures} from './apps/studio/src/placementDocumentTextures.ts';
 export {collectPlacementAssetUsage} from './apps/studio/src/placementAssetUsage.ts';
 export {readPlacementAuthoredComponents,preservePlacementComponentMetadata} from './apps/studio/src/placementComponentEdits.ts';
 export {createPlacementInspectorOriginals} from './apps/studio/src/placementInspectorOriginals.ts';
 export {createScenePlacementViewer,resolveSceneAuthoringDocument} from '@ferrum2d/ferrum-web/authoring';
`);
const component = () => ({ visual: { kind: "sprite", asset: "hero", normalTexture: "normal", width: 20, height: 24,
  lighting: { mode: "opaque" }, surface: { emissionTexture: "glow", specularTexture: "spec", roughnessTexture: "rough" } },
  collider: "none", layer: "wall" });
function fixture() {
 return { format: "ferrum2d.consumer.scene-authoring", version: 1, lighting: { profile: "lit", enabled: false },
  componentTemplates: { "solid/~": component() }, physics: { space: "planar-xy", gravity: [0,0,0], lengthUnit: 1,
   collisionTilemap: { columns: 1, rows: 1, tileWidth: 16, tileHeight: 16, tiles: [1], definitions: [{ id: 1, visual: { texture: "tiles" } }] } },
  sceneComposition: { initialFragment: "main", prefabs: { object: { props: { components: { template: "solid/~" } } } },
   fragments: { main: { instances: [{ id: "a", prefab: "object", x: 30, y: 40 },{ id: "b", prefab: "object", x: 80, y: 40 }] } } },
  behaviorRecipes: { entities: {} } };
}

test("local template and graphical tile textures use authored color/data roles across cold preview", () => {
 const document = fixture(), before = structuredClone(document), result = roles([document]);
 assert.deepEqual([...result], [["hero","color"],["normal","data"],["glow","color"],["spec","data"],["rough","data"],["tiles","color"]]);
 const refs = references(document);
 assert.equal(refs[0].path,"/componentTemplates/solid~1~0/visual/asset");
 assert.equal(refs.at(-1).path,"/physics/collisionTilemap/definitions/0/visual/texture");
 assert.deepEqual(document,before);
 document.physics.collisionTilemap.definitions[0].visual.texture="normal";
 assert.throws(()=>roles([document]),/both color and lighting data/);
});

test("catalog and tile asset use retains original pointers, once per authored source across shared instances", async () => {
 const document=fixture(),before=structuredClone(document);
 const report=await collect({ catalog:{label:"project",scenes:[],truncated:false}, assets:[],open:[{scene:"native.json",source:"draft",document}],current:()=>true });
 for(const id of ["hero","normal","glow","spec","rough"]){
  const asset=report.assets.find(asset=>asset.id===id);assert(asset);assert.equal(asset.references.length,1);
  assert(asset.references[0].pointer.startsWith("/componentTemplates/solid~1~0/visual/"));
  assert.equal(asset.references[0].owner,"solid/~");
 }
 assert.equal(report.assets.find(asset=>asset.id==="tiles").references[0].pointer,"/physics/collisionTilemap/definitions/0/visual/texture");
 assert(!report.issues.some(issue=>issue.code==="unresolved"));
 assert.deepEqual(document,before);
});

test("Studio keeps template raw authored ownership and explicitly rejects component metadata detachment", () => {
 const document=fixture(),viewer=createScenePlacementViewer({document,viewport:{cssWidth:200,cssHeight:100}});
 viewer.selectInstance("a");
 assert.deepEqual(read(document,"main","a"),{template:"solid/~"});
 assert.throws(()=>preserve(read(document,"main","a"),component()),/read-only/);
 assert.throws(()=>viewer.updateInstanceComponents("a",component()),/read-only/);
 assert.equal(viewer.exportPatch(),undefined);
 assert.equal(viewer.state().selected.visual.width,20);
});


test("template inspector originals show resolved component/body values with read-only restore boundaries", () => {
 const document=fixture();document.physics.space="spatial";delete document.physics.collisionTilemap;
 document.componentTemplates["solid/~"].body={kind:"dynamic",elevation:12,collider:{shape:{type:"box",halfExtents:[1,1,1]}}};
 const viewer=createScenePlacementViewer({document,viewport:{cssWidth:200,cssHeight:100}});viewer.selectInstance("a");
 const original=originals(resolveSceneAuthoringDocument(document),{normalize:value=>value,primitive:"#ffffff",point:"#ffffff"});
 assert.deepEqual(original.read("component:visualWidth",viewer.state()),{value:"20",canRestore:false});
 assert.deepEqual(original.read("spatial:elevation",viewer.state(),{kind:"model",id:"a"}),{value:"12",canRestore:false});
 assert.equal(original.read("transform:x",viewer.state()).canRestore,true);
 assert.throws(()=>original.plan("component:visualWidth",viewer.state(),undefined,document),/No restorable/);
});
