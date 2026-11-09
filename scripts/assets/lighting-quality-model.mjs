/** Self-authored, deterministic diffuse frame + HDR emissive window. No external assets. */
export function lightingQualityModel() {
  const buffers = [], bufferViews = [], accessors = [];
  let byteLength = 0;
  function attribute(values, type, components, min, max) {
    const data = Buffer.from(new Float32Array(values).buffer);
    const bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
    buffers.push(data); byteLength += data.length;
    accessors.push({ bufferView, componentType: 5126, count: values.length / components, type, ...(min ? { min, max } : {}) });
    return accessors.length - 1;
  }
  function panel(halfWidth, bottom, top, z, material) {
    const positions = [-halfWidth,bottom,z, halfWidth,bottom,z, halfWidth,top,z, -halfWidth,bottom,z, halfWidth,top,z, -halfWidth,top,z];
    return { attributes: {
      POSITION: attribute(positions, "VEC3", 3, [-halfWidth,bottom,z], [halfWidth,top,z]),
      NORMAL: attribute(Array.from({ length: 6 }, () => [0,0,1]).flat(), "VEC3", 3),
      TEXCOORD_0: attribute([0,0,1,0,1,1,0,0,1,1,0,1], "VEC2", 2),
    }, material };
  }
  const primitives = [panel(16, 0, 40, -.5, 0), panel(10, 8, 32, 0, 1)];
  const doc = {
    asset: { version: "2.0", generator: "Ferrum2D lighting quality fixture" },
    extensionsUsed: ["KHR_materials_emissive_strength"],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials: [
      { name: "Diffuse frame", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.15,.18,.2,1], metallicFactor: 0 } },
      { name: "Emissive window", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.03,.02,.01,1], metallicFactor: 0 },
        emissiveFactor: [1,.3,.05], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } } },
    ],
    buffers: [{ byteLength }], bufferViews, accessors,
  };
  const source = Buffer.from(JSON.stringify(doc)), json = Buffer.alloc((source.length + 3) & ~3, 32);
  source.copy(json);
  const bin = Buffer.concat(buffers), glb = Buffer.alloc(28 + json.length + bin.length);
  [0x46546c67,2,glb.length,json.length,0x4e4f534a].forEach((value, i) => glb.writeUInt32LE(value, i * 4));
  json.copy(glb, 20); glb.writeUInt32LE(bin.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(glb, 28 + json.length);
  return glb;
}
