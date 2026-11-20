/** Small actual public-loader input: adjacent A/B/A material ranges must retain
 * triangle order and the non-adjacent A primitives share their JSON color array. */
export function nativeFileModelFixture(): ArrayBuffer {
    const json = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [0, 1, 0].map(material => ({ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material })) }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [.2, .4, .6, 1], metallicFactor: 0 } }, { pbrMetallicRoughness: { baseColorFactor: [.7, .6, .5, 1], metallicFactor: 0 } }], buffers: [{ byteLength: 84 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 12 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 2, componentType: 5125, count: 3, type: "SCALAR" }] };
    const text = new TextEncoder().encode(JSON.stringify(json).replace('"baseColorFactor":[0.2', '"baseColorFactor":[-0')), padded = Math.ceil(text.length / 4) * 4, bytes = new ArrayBuffer(28 + padded + 84), d = new DataView(bytes);
    [0x46546c67, 2, bytes.byteLength, padded, 0x4e4f534a].forEach((x, i) => d.setUint32(i * 4, x, true));
    new Uint8Array(bytes, 20, padded).fill(32);
    new Uint8Array(bytes, 20, text.length).set(text);
    d.setUint32(20 + padded, 84, true);
    d.setUint32(24 + padded, 0x004e4942, true);
    new Float32Array(bytes, 28 + padded, 18).set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    new Uint32Array(bytes, 28 + padded + 72, 3).set([0, 1, 2]);
    return bytes;
}
