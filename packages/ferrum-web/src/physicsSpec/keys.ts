export const PHYSICS_KEYS = new Set([
  "mode",
  "gravity",
  "continuous",
  "solver",
  "materials",
  "layers",
  "bodies",
  "joints",
  "debug",
]);

export const SOLVER_KEYS = new Set(["fixedTimestep", "stepSeconds", "velocityIterations", "positionIterations", "sleep"]);
export const MATERIAL_KEYS = new Set(["friction", "restitution", "density"]);
export const LAYER_KEYS = new Set(["mask"]);

export const BODY_KEYS = new Set([
  "type",
  "position",
  "rotationRadians",
  "velocity",
  "angularVelocityRadiansPerSecond",
  "mass",
  "inertia",
  "material",
  "layer",
  "collider",
  "colliders",
  "gravityScale",
  "linearDamping",
  "angularDamping",
  "enabled",
  "canSleep",
]);

export const COLLIDER_BASE_KEYS = new Set(["shape", "offset", "material", "layer", "trigger", "enabled"]);

export const JOINT_KEYS = new Set([
  "type",
  "bodyA",
  "bodyB",
  "anchor",
  "localAnchorA",
  "localAnchorB",
  "groundAnchorA",
  "groundAnchorB",
  "localAxisA",
  "restLength",
  "maxLength",
  "stiffness",
  "damping",
  "enabled",
  "limit",
  "motor",
  "ratio",
  "referenceAngle",
  "breakDistance",
  "breakAngle",
]);

export const LIMIT_KEYS = new Set(["enabled", "lower", "upper"]);
export const MOTOR_KEYS = new Set(["enabled", "speed", "maxForce", "maxTorque"]);
export const DEBUG_KEYS = new Set(["colliders", "contacts", "manifolds", "broadphase", "joints", "sleeping", "layers", "ccd"]);
