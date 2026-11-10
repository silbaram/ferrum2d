import type { SpatialModelPrimitive } from "./spatialModel.js";
import { IDENTITY_SPATIAL_UV } from "./spatialTextureTransform.js";

/** Private GPU material v2: legacy144-byte prefix plus bounded specular factors and three UV transforms. */
export const SPATIAL_MODEL_MATERIAL_BYTES = 272;
export const spatialModelMaterialWGSL = `
struct Material{color:vec4f,emission:vec4f,params:vec4f,baseUv:mat2x4f,normalUv:mat2x4f,emissionUv:mat2x4f,specular:vec4f,surface:vec4f,roughnessUv:mat2x4f,specularUv:mat2x4f,specularColorUv:mat2x4f};
fn modelUv(uv:vec2f,rows:mat2x4f)->vec2f{
 let p=vec3f(uv,1.);return vec2f(dot(rows[0].xyz,p),dot(rows[1].xyz,p));
}
`;

/** Cold resource upload; no per-frame material allocation. */
export function spatialModelMaterialValues(primitive: SpatialModelPrimitive): Float32Array {
  const values = new Float32Array(SPATIAL_MODEL_MATERIAL_BYTES / 4);
  values.set([...primitive.color, ...primitive.emissiveFactor, 0, primitive.alphaCutoff,
    Number(!!primitive.unlit), primitive.normal?.scale ?? 1, Number(!!primitive.normal)]);
  [primitive.uvTransform, primitive.normal?.uvTransform, primitive.emissive?.uvTransform].forEach((value, i) => {
    const m = value ?? IDENTITY_SPATIAL_UV;
    values.set([m[0], m[3], m[6], 0, m[1], m[4], m[7], 0], 12 + i * 8);
  });
  const specular=primitive.specular;
  values.set([...(specular?.color ?? [1,1,1]),specular?.factor ?? 0,specular?.roughness ?? 1,Number(!!specular),0,0],36);
  [specular?.roughnessTexture,specular?.texture,specular?.colorTexture].forEach((texture,i)=>{
    const m=texture?.uvTransform??IDENTITY_SPATIAL_UV;
    values.set([m[0],m[3],m[6],0,m[1],m[4],m[7],0],44+i*8);
  });
  return values;
}
