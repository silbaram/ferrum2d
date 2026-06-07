import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  compileWeaponProfiles,
  projectile,
  weapon,
} from "../src/projectileAuthoring.js";

test("projectile builder serializes configured values", () => {
  const definition = projectile("standard")
    .speed(480)
    .damage(3)
    .lifetime(1.2)
    .aim("targetPlayer")
    .collisionTarget("player")
    .tileImpact("despawn")
    .build();

  equal(definition.id, "standard");
  equal(definition.speed, 480);
  equal(definition.damage, 3);
  equal(definition.lifetimeSeconds, 1.2);
  equal(definition.aim, "targetPlayer");
  equal(definition.collisionTarget, "player");
  equal(definition.tileImpact, "despawn");
});

test("weapon builder compiles to a projectileAction recipe", () => {
  const document = compileWeaponProfiles([
    weapon("primary")
      .action("shoot")
      .actionId(7)
      .cooldown(0.3)
      .fire(projectile("standard")
        .speed(640)
        .damage(2)
        .lifetime(1.6)
        .aim("input")
        .collisionTarget("enemies")
        .tileImpact("passThrough")),
  ], { path: "gameSpec" });

  const entity = document.entities.primary;
  equal(entity.recipes.length, 1);
  const recipe = entity.recipes[0];
  equal(recipe.kind, "projectileAction");
  if (recipe.kind !== "projectileAction") {
    throw new Error(`Expected projectileAction recipe, got ${recipe.kind}`);
  }
  equal(recipe.action, "shoot");
  equal(recipe.actionId, 7);
  equal(recipe.cooldownSeconds, 0.3);
  equal(recipe.speed, 640);
  equal(recipe.damage, 2);
  equal(recipe.lifetimeSeconds, 1.6);
  equal(recipe.aim, "input");
  equal(recipe.collisionTarget, "enemies");
  equal(recipe.tileImpact, "passThrough");
});

test("compileWeaponProfiles resolves actionIds map by action name", () => {
  const document = compileWeaponProfiles([
    weapon("primary").action("shoot").cooldown(0.3).fire(projectile("standard").speed(640)),
    weapon("secondary").action("burst").actionId(7).fire(projectile("standard").damage(2)),
  ], {
    path: "gameSpec",
    actionIds: {
      shoot: 4,
      burst: 8,
    },
  });

  const primary = document.entities.primary.recipes[0];
  const secondary = document.entities.secondary.recipes[0];

  if (primary.kind !== "projectileAction" || secondary.kind !== "projectileAction") {
    throw new Error("Expected all compiled variants to be projectileAction.");
  }

  equal(primary.actionId, 4);
  equal(secondary.actionId, 7);
});

test("compileWeaponProfiles applies behavior recipe defaults for omitted values", () => {
  const document = compileWeaponProfiles([
    weapon("auto").fire(projectile("standard")),
  ]);

  const recipe = document.entities.auto.recipes[0];
  if (recipe.kind !== "projectileAction") {
    throw new Error(`Expected projectileAction recipe, got ${recipe.kind}`);
  }
  equal(recipe.action, "auto");
  equal(recipe.cooldownSeconds, 0);
  equal(recipe.speed, 360);
  equal(recipe.damage, 1);
  equal(recipe.lifetimeSeconds, 1);
  equal(recipe.aim, "input");
  equal(recipe.collisionTarget, "enemies");
  equal(recipe.tileImpact, "despawn");
});

test("compileWeaponProfiles supports common projectile variants", () => {
  const document = compileWeaponProfiles([
    weapon("standard").cooldown(0.08).fire(projectile("standard").speed(720).damage(1).lifetime(1.6)),
    weapon("piercing").fire(projectile("piercing").speed(520).collisionTarget("enemies").tileImpact("passThrough")),
    weapon("bounce").fire(projectile("bounce").speed(420).damage(2).lifetime(1.0).tileImpact("bounce")),
  ]);

  const standard = document.entities.standard.recipes[0];
  const piercing = document.entities.piercing.recipes[0];
  const bounce = document.entities.bounce.recipes[0];

  if (standard.kind !== "projectileAction" || piercing.kind !== "projectileAction" || bounce.kind !== "projectileAction") {
    throw new Error("Expected all compiled variant recipes to be projectileAction.");
  }

  equal(standard.tileImpact, "despawn");
  equal(standard.cooldownSeconds, 0.08);
  equal(standard.speed, 720);

  equal(piercing.tileImpact, "passThrough");
  equal(piercing.collisionTarget, "enemies");

  equal(bounce.tileImpact, "bounce");
  equal(bounce.speed, 420);
  equal(bounce.damage, 2);
});

test("weapon builder requires fire() before build", () => {
  expectError(
    () => {
      weapon("missing-shot").build();
    },
    "fire() must be called",
  );
});

test("weapon builder rejects non-positive actionId", () => {
  expectError(
    () => {
      weapon("standard").actionId(0).fire(projectile("standard"));
    },
    "must be a positive integer",
  );
  expectError(
    () => {
      weapon("standard").actionId(1.5).fire(projectile("standard"));
    },
    "must be a positive integer",
  );
  expectError(
    () => {
      compileWeaponProfiles([
        {
          id: "standard",
          action: "shoot",
          actionId: -2,
          cooldownSeconds: 0.1,
          projectile: { id: "standard", speed: 10, damage: 1, lifetimeSeconds: 1 },
        },
      ]);
    },
    "must be a positive integer",
  );
});

test("compileWeaponProfiles validates actionIds map", () => {
  expectError(
    () => {
      compileWeaponProfiles([
        weapon("primary").fire(projectile("standard")),
      ], {
        actionIds: [] as unknown as Record<string, number>,
      });
    },
    "actionIds must be a record of action name to positive integer",
  );

  expectError(
    () => {
      compileWeaponProfiles([
        weapon("primary").fire(projectile("standard")),
      ], {
        actionIds: {
          primary: 0,
        },
      });
    },
    "must be a positive integer",
  );

  expectError(
    () => {
      compileWeaponProfiles([
        weapon("primary").fire(projectile("standard")),
      ], {
        actionIds: {
          "": 3,
        },
      });
    },
    "action names must be non-empty strings",
  );
});

test("compileWeaponProfiles requires map entry when actionIds is provided", () => {
  expectError(
    () => {
      compileWeaponProfiles([
        weapon("primary").action("shoot").fire(projectile("standard")),
      ], {
        actionIds: {
          burst: 3,
        },
      });
    },
    "missing action id for weapon 'primary'",
  );
});

test("projectile numeric fields require positive finite values", () => {
  expectError(
    () => {
      projectile("rounds").speed(0);
    },
    "must be a positive finite number",
  );
  expectError(
    () => {
      compileWeaponProfiles([
        weapon("primary").fire(projectile("rounds").damage(-1)),
      ]);
    },
    "must be a positive finite number",
  );
});

test("compileWeaponProfiles validates raw definitions and deduplicates weapon ids", () => {
  expectError(
    () => {
      compileWeaponProfiles([
        {
          id: "",
          action: "shoot",
          projectile: { id: "rounds" },
        },
      ]);
    },
    "weapon id must be a non-empty string",
  );

  expectError(
    () => {
      compileWeaponProfiles([
        {
          id: "standard",
          action: "",
          projectile: { id: "rounds" },
        },
      ]);
    },
    "weapon action must be a non-empty string",
  );

  expectError(
    () => {
      compileWeaponProfiles([
        {
          id: "dup",
          action: "shoot",
          projectile: { id: "rounds" },
        },
        {
          id: "dup",
          action: "burst",
          projectile: { id: "rounds2" },
        },
      ]);
    },
    "duplicate weapon id 'dup'",
  );

  expectError(
    () => {
      compileWeaponProfiles([
        {
          id: "standard",
          action: "shoot",
          cooldownSeconds: -0.1,
          projectile: { id: "rounds" },
        },
      ]);
    },
    "must be a non-negative finite number",
  );

  expectError(
    () => {
      compileWeaponProfiles([
        {
          id: "standard",
          action: "shoot",
          projectile: { id: "" },
        },
      ]);
    },
    "projectile id must be a non-empty string",
  );
});

function expectError(fn: () => void, expectedMessage: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }
    throw new Error(`Expected error containing: ${expectedMessage}`);
  }
  throw new Error(`Expected error containing: ${expectedMessage}`);
}
