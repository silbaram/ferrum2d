#!/usr/bin/env node
// Original, deterministic art for the example site's "벽돌 깨기" game demo. No downloaded assets.
import {exampleFolder, image as imageIn, random} from './site-art-kit.mjs';

const root = await exampleFolder('breakout');
const image = (width, height) => imageIn(root, width, height);

// Field: 576 × 352 inside the walls (world 32..608 × 32..384), drawn at 1:1. Deep blue, a faint dot grid,
// a few stars, and a soft shade along the walls.
{
  const field = image(576, 352), next = random(1977);
  for (let y = 0; y < 352; y++) {
    const t = y / 351;
    const c = [Math.round(20 - 8 * t), Math.round(30 - 10 * t), Math.round(46 - 14 * t), 255];
    field.rect(0, y, 576, 1, c);
  }
  for (let y = 8; y < 352; y += 16) for (let x = 8; x < 576; x += 16) field.point(x, y, [70, 100, 130, 70]);
  for (let n = 0; n < 40; n++) {
    const x = Math.floor(next() * 576), y = Math.floor(next() * 300), bright = next();
    field.point(x, y, [180, 210, 255, Math.round(60 + bright * 120)]);
    if (bright > 0.85) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) field.point(x + dx, y + dy, [180, 210, 255, 50]);
  }
  for (let y = 0; y < 352; y++) for (let x = 0; x < 576; x++) {
    const edge = Math.min(x, y, 575 - x);
    if (edge < 12) field.point(x, y, [4, 8, 14, Math.round(120 * (1 - edge / 12) ** 2)]);
  }
  await field.save('field');
}

// Wall: a 16 × 16 nine-slice (4px borders), indigo steel lit from the top left.
{
  const wall = image(16, 16);
  wall.rect(0, 0, 16, 16, '0b0f24');
  wall.rect(1, 1, 14, 14, '3b4577');
  wall.rect(1, 1, 14, 1, '9aa6e0'); wall.rect(1, 2, 14, 2, '5d6aa6');
  wall.rect(1, 1, 1, 14, '6f7cbb');
  wall.rect(1, 12, 14, 2, '2a3260'); wall.rect(1, 14, 14, 1, '1b2148');
  wall.rect(14, 2, 1, 12, '303970');
  for (const [x, y] of [[2, 2], [13, 2], [2, 12], [13, 12]]) wall.point(x, y, 'c9d1ff');
  await wall.save('wall');
}

// Brick: 52 × 18, drawn light so a tint gives each row its color while keeping the bevel.
{
  const brick = image(52, 18);
  brick.rect(0, 0, 52, 18, [0, 0, 0, 150]);
  brick.rect(1, 1, 50, 16, 'd6dbe2');
  brick.rect(1, 1, 50, 2, 'ffffff'); brick.rect(1, 1, 2, 16, 'f1f4f7');
  brick.rect(1, 14, 50, 3, '9ea6b0'); brick.rect(49, 3, 2, 12, 'b3bac3');
  brick.rect(4, 4, 6, 1, 'ffffff'); brick.rect(4, 5, 2, 1, 'ffffff');
  await brick.save('brick');
}

// Paddle: a 24 × 12 nine-slice (6px ends, 4px top and bottom), forge amber with rounded ends.
{
  const paddle = image(24, 12);
  const inside = (x, y) => {
    const cx = x < 6 ? 6 : x > 17 ? 17 : x, dx = x - cx, dy = y - 5.5;
    return dx * dx + dy * dy <= 30;
  };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) if (inside(x + 0.5, y + 0.5)) paddle.point(x, y, '3a2410');
  for (let y = 1; y < 11; y++) for (let x = 1; x < 23; x++) {
    if (!inside(x + 0.5, y + 0.5) || !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5)) continue;
    paddle.point(x, y, y < 3 ? 'ffe2a6' : y < 5 ? 'ffc678' : y < 8 ? 'f5a742' : 'c98a3a');
  }
  await paddle.save('paddle');
}

// Ball: 12 × 12, pale cyan with a shine.
{
  const ball = image(12, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const dx = x - 5.5, dy = y - 5.5, d = Math.hypot(dx, dy);
    if (d > 5.9) continue;
    const light = 0.55 + 0.45 * Math.max(0, 1 - Math.hypot(dx + 2, dy + 2) / 7);
    ball.point(x, y, d > 5 ? [30, 60, 80, 255] : [Math.round(190 + 65 * light), Math.round(230 + 25 * light), 255, 255]);
  }
  ball.rect(3, 3, 2, 1, 'ffffff'); ball.point(3, 4, 'ffffff');
  await ball.save('ball');
}

// Miss line: 576 × 8 at the bottom of the field, a red glow that fades upward.
{
  const miss = image(576, 8);
  for (let y = 0; y < 8; y++) miss.rect(0, y, 576, 1, [255, 90, 90, Math.round(150 * (y / 7) ** 2)]);
  for (let x = 0; x < 576; x += 12) miss.rect(x, 7, 6, 1, [255, 140, 130, 230]);
  await miss.save('miss');
}

console.log('Breakout example art: field, wall, brick, paddle, ball and the miss line.');
