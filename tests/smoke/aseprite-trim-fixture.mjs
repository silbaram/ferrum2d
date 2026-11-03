import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodePng, encodePngRgba } from '../../scripts/tools/pack-textures.mjs';
export const trimHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function asTrimmed(data, version = 0) {
  for (const frame of Object.values(data.json.frames)) {
    frame.trimmed = true;
    frame.sourceSize = { w: 24, h: 24 };
    frame.spriteSourceSize = { x: 4 + (version ? 1 : 0), y: 3 + (version ? 1 : 0), w: frame.frame.w, h: frame.frame.h };
  }
  return data;
}
export function trimFixture(version = 0) {
  const pixels = new Uint8Array(32 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([17, 23, 37, 0], i);
  const frames = {
    'hero-idle.png': { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: version ? 90 : 100 },
    'hero-walk.png': { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: version ? 180 : 200 },
  };
  for (const [index, frame] of Object.values(frames).entries()) {
    frame.rotated = false;
    const r = frame.frame;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const color = index ? [30, 200, 40, 255] : version ? [20, 70, 220, 255] : [220, 30, 20, 255];
      pixels.set(x === 0 && y === 0 ? [91, 92, 93, 0] : color, ((r.y + y) * 32 + r.x + x) * 4);
    }
  }
  return asTrimmed({ png: encodePngRgba(32, 16, pixels), json: { frames, meta: { image: 'hero.png', size: { w: 32, h: 16 }, frameTags: [{ name: 'run', from: 0, to: 1 }, { name: 'rest', from: 0, to: 0 }] } } }, version);
}
/** Independent fixed-geometry oracle for the two 24px source canvases. */
export function verifyTrimBundle(bundle) {
  let restored = 0;
  for (const rev of bundle.revisions.filter(r => r.sourcePng)) {
    const file = suffix => Buffer.from(bundle.files.find(f => f.path === rev.assetId + suffix).base64, 'base64');
    const jsonBytes = file('.json'), packed = file('.source.png'), png = file('.png');
    assert.equal(trimHash(jsonBytes), rev.jsonSha256); assert.equal(trimHash(packed), rev.sourcePng.sha256); assert.equal(trimHash(png), rev.pngSha256);
    const raw = JSON.parse(jsonBytes), source = decodePng(packed), actual = decodePng(png);
    assert.equal(rev.assetId, `aseprite.${rev.logicalId}.${trimHash(JSON.stringify([rev.identityDocument, rev.logicalId, rev.jsonSha256, rev.sourcePng.sha256])).slice(0,24)}`);
    assert.equal(actual.width, 24); assert.equal(actual.height, 48);
    const expected = new Uint8Array(24 * 48 * 4);
    const names = Object.keys(raw.frames).sort();
    for (const [index, name] of names.entries()) {
      const frame = raw.frames[name], rect = frame.frame, offset = frame.spriteSourceSize;
      const evidence = rev.frames.find(frame => frame.id === name);
      assert.deepEqual([evidence.x,evidence.y,evidence.width,evidence.height], [0,index*24,24,24]);
      assert.deepEqual(evidence.uv, {u0:0,v0:index/2,u1:1,v1:(index+1)/2});
      for (let y=0;y<rect.h;y++) for (let x=0;x<rect.w;x++) expected.set(source.pixels.subarray(((rect.y+y)*source.width+rect.x+x)*4,((rect.y+y)*source.width+rect.x+x+1)*4),(((index*24+offset.y+y)*24+offset.x+x)*4));
    }
    assert.deepEqual(actual.pixels,expected);restored++;
  }
  assert(restored>0,'trim source sidecars are required');
  return {restoredAtlases:restored,originalIdentity:true,sourcePngPreserved:true,restoredPixelsAndPadding:true};
}
