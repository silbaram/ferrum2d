import {
  booleanValue,
  rejectUnknownKeys,
  requiredObject,
} from "../physicsSpecValidation.js";
import type { ResolvedPhysicsDebugSpec } from "../physicsSpecTypes.js";
import { DEBUG_KEYS } from "./keys.js";

export function physicsDebugSpec(value: unknown, path: string): ResolvedPhysicsDebugSpec {
  if (value === undefined || value === false) {
    return disabledDebugSpec();
  }
  if (value === true) {
    return enabledDebugSpec();
  }
  const object = requiredObject(value, path);
  rejectUnknownKeys(object, path, DEBUG_KEYS);
  return {
    enabled: true,
    colliders: booleanValue(object.colliders, `${path}.colliders`, false),
    contacts: booleanValue(object.contacts, `${path}.contacts`, false),
    manifolds: booleanValue(object.manifolds, `${path}.manifolds`, false),
    broadphase: booleanValue(object.broadphase, `${path}.broadphase`, false),
    joints: booleanValue(object.joints, `${path}.joints`, false),
    sleeping: booleanValue(object.sleeping, `${path}.sleeping`, false),
    layers: booleanValue(object.layers, `${path}.layers`, false),
    ccd: booleanValue(object.ccd, `${path}.ccd`, false),
  };
}

function disabledDebugSpec(): ResolvedPhysicsDebugSpec {
  return {
    enabled: false,
    colliders: false,
    contacts: false,
    manifolds: false,
    broadphase: false,
    joints: false,
    sleeping: false,
    layers: false,
    ccd: false,
  };
}

function enabledDebugSpec(): ResolvedPhysicsDebugSpec {
  return {
    enabled: true,
    colliders: true,
    contacts: true,
    manifolds: true,
    broadphase: true,
    joints: true,
    sleeping: true,
    layers: true,
    ccd: true,
  };
}
