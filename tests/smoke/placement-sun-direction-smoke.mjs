import assert from "node:assert/strict";

/** The UI describes both legacy coordinate conventions without rewriting either. */
export async function smokePlacementSunDirection({ page, mode, open, edit, source, paint }) {
  const spatial = mode === "spatial", field = page.locator('[data-placement-lighting-field="sun-direction"]');
  const before = await source();
  const light = doc => spatial ? doc.spatial.environment.lighting.directional : doc.lighting.directionalLight;
  const original = light(before), length = spatial ? Math.hypot(original.direction.x, original.direction.y) : 1;
  for (const locale of ["ko", "en"]) {
    await page.locator('[data-placement-language]').selectOption(locale); await open();
    assert.equal(await field.getAttribute("aria-label"), spatial
      ? locale === "ko" ? "태양 방위 (°)" : "Sun Azimuth (°)"
      : locale === "ko" ? "그림자 방향 (°)" : "Shadow Direction (°)");
    assert.match(await page.locator('[data-placement-sun-meaning]').textContent(), locale === "ko" ? /반대/ : /opposite/);
    assert.deepEqual(await source(), before, "Opening lighting and changing language must not rewrite the sun");
  }
  for (const angle of [0, 90, -90, 180]) {
    await edit("sun-direction", angle);
    const changed = await source(), sun = light(changed), radians = angle * Math.PI / 180;
    assert(Math.abs((spatial ? sun.direction.x : sun.directionX) - Math.cos(radians) * length) < 1e-8);
    assert(Math.abs((spatial ? sun.direction.y : sun.directionY) - Math.sin(radians) * length) < 1e-8);
    if (spatial) assert.equal(sun.direction.elevation, original.direction.elevation);
    const expected = structuredClone(before);
    if (spatial) light(expected).direction = sun.direction;
    else { light(expected).directionX = sun.directionX; light(expected).directionY = sun.directionY; }
    assert.deepEqual(changed, expected, "Azimuth edits must preserve camera, lights, shadow bias and coverage");
    const bearing = await page.locator('[data-placement-sun-bearing]').textContent();
    const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
    assert.equal(bearing, `Sun ${wrap(angle + (spatial ? 0 : 180))}° · Shadow ${wrap(angle + (spatial ? 180 : 0))}°`);
    await page.locator('[data-placement-action="undo"]').click(); await paint();
    assert.deepEqual(await source(), before, "Undo restores the original vector exactly");
    await page.locator('[data-placement-action="redo"]').click(); await paint();
    assert.deepEqual(await source(), changed);
    await page.locator('[data-placement-action="undo"]').click(); await paint();
  }
  if (spatial) {
    await edit("sun-height", 90);
    assert.equal(await page.locator('[data-placement-sun-bearing]').textContent(), "No horizontal direction");
    await page.locator('[data-placement-action="undo"]').click(); await paint();
    assert.deepEqual(await source(), before);
  } else {
    await edit("sun-normal-elevation", 30);
    const normal = await source();
    assert(Math.abs(light(normal).elevationRadians - Math.PI / 6) < 1e-8);
    assert.equal(light(normal).shadowLengthScale, original.shadowLengthScale);
    assert.equal(light(normal).directionX, original.directionX);
    assert.equal(light(normal).directionY, original.directionY);
    await edit("sun-shadow-length", 1.5);
    const lengthEdit = await source();
    assert.equal(light(lengthEdit).shadowLengthScale, 1.5);
    assert.equal(light(lengthEdit).elevationRadians, light(normal).elevationRadians);
    await page.locator('[data-placement-action="undo"]').click(); await paint();
    assert.deepEqual(await source(), normal);
    await page.locator('[data-placement-action="undo"]').click(); await paint();
    assert.deepEqual(await source(), before);
  }
  await open();
  return { worldAxes: true, locales: 2, angles: 4, oppositeShadow: true, originalVectorUndoRedo: true, vertical: spatial };
}
