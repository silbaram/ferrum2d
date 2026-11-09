import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function loadExampleCatalog(root = process.cwd()) {
  const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const catalog = read('examples/shared/exampleCatalog.json');
  const features = read('examples/shared/featureCatalog.json');
  const topics = read('examples/shared/featureTopics.json');
  const physics = read('examples/shared/physicsExamples.json');
  const scenarioIds = new Set(read('examples/physics-sandbox/public/catalog.json').scenarios.map(item => item.id));
  assert.equal(new Set(topics.map(item => item.id)).size, topics.length, 'Duplicate topic');
  assert.equal(new Set(physics.map(item => item.id)).size, physics.length, 'Duplicate physics link');
  assert.equal(physics.length, scenarioIds.size, 'Every physics scenario needs a topic entry');
  for (const item of physics) assert(scenarioIds.has(item.id) && item.title?.trim() && item.summary?.trim(), `Invalid physics entry ${item.id}`);
  const commands = read('package.json').scripts;
  assert(Array.isArray(catalog) && catalog.length > 0, 'Example catalog must not be empty');
  assert(Array.isArray(features) && features.length > 0, 'Feature catalog must not be empty');
  const ids = new Set(), paths = new Set(), featureIds = new Set(features.map(item => item.id));
  assert.equal(featureIds.size, features.length, 'Feature ids must be unique');
  for (const feature of features) {
    assert(topics.some(topic => topic.id === feature.topic && topic.title === feature.group), `Invalid topic ${feature.id}`);
    assert(Array.isArray(feature.tags) && feature.tags.length > 0 && feature.tags.every(tag => ['2D', 'HD-2D'].includes(tag)), `Invalid dimension ${feature.id}`);
    assert.match(feature.id, /^[a-z][a-z0-9-]*$/);
    assert(existsSync(resolve(root, `examples/starter-runtime/public/features/${feature.id}.json`)), `Missing ${feature.id} scene`);
    const lesson = feature.lesson;
    assert(lesson && typeof lesson.useCase === 'string' && lesson.useCase.trim(), `Missing ${feature.id} learning use case`);
    assert(typeof lesson.scenario === 'string' && lesson.scenario.trim(), `Missing ${feature.id} learning scenario`);
    for (const [field, minimum] of [['steps',2],['legend',2]]) {
      assert(Array.isArray(lesson[field]) && lesson[field].length >= minimum && lesson[field].length <= 4, `${feature.id} needs 2–4 learning ${field}`);
      assert(lesson[field].every(text => typeof text === 'string' && text.trim()), `${feature.id} has empty learning ${field}`);
    }
    assert(Array.isArray(lesson.roles) && lesson.roles.length <= 5 && Array.isArray(lesson.actions), `${feature.id} has invalid lesson roles/actions`);
    const scene = read(`examples/starter-runtime/public/features/${feature.id}.json`);
    const entityIds = new Set(Object.values(scene.sceneComposition?.fragments ?? {}).flatMap(fragment => (fragment.instances ?? []).map(instance => instance.id)));
    for (const role of lesson.roles) {
      assert(typeof role.entity === 'string' && typeof role.label === 'string' && role.label.trim(), `${feature.id} has invalid role label`);
      assert(!role.entity || role.entity === '$player' || entityIds.has(role.entity), `${feature.id} unknown lesson role ${role.entity}`);
      assert(['actor','geometry','target'].includes(role.tone), `${feature.id} invalid role tone`);
      assert(['x','y','dx','dy'].every(key => Number.isFinite(role[key])), `${feature.id} role coordinates must be finite`);
    }
    assert(lesson.actions.every(selector => typeof selector === 'string' && /^\[data-(?:control|target|move|light|chunk)(?:=|\])/.test(selector)), `${feature.id} invalid lesson action selector`);
  }
  for (const item of catalog) {
    assert.match(item.id, /^[a-z][a-z0-9-]*$/);
    assert(!ids.has(item.id), `Duplicate example ${item.id}`); ids.add(item.id);
    assert(['lab', 'game', 'tool', 'reference'].includes(item.kind), `Invalid role ${item.id}`);
    for (const key of ['title', 'summary', 'action', 'observe']) assert(typeof item[key] === 'string' && item[key].trim(), `Missing ${item.id}.${key}`);
    assert.match(item.path, /^[a-z][a-z0-9-]*\/(?:\?mode=[a-z]+)?$/);
    assert(!paths.has(item.path), `Duplicate route ${item.path}`); paths.add(item.path);
    assert.match(item.source, /^(?:examples|apps)\/[a-z][a-z0-9-]*\/dist$/);
    assert(existsSync(resolve(root, dirname(item.source), 'package.json')), `Missing source package ${item.id}`);
    assert.match(item.command, /^pnpm dev:[a-z-]+$/);
    assert(commands[item.command.slice(5)], `Unknown command ${item.command}`);
    assert(Array.isArray(item.features) && new Set(item.features).size === item.features.length);
    for (const id of item.features) assert(featureIds.has(id), `Unknown related feature ${item.id}/${id}`);
    if (item.kind !== 'reference') {
      assert.equal(item.path, `${item.id}/`, 'Public paths remain stable');
      assert(item.features.length > 0, `Public example needs a learning link: ${item.id}`);
    }
  }
  assert(catalog.some(item => item.id === 'starter-runtime' && item.kind === 'lab'), 'The feature lab must remain a public entry');
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = loadExampleCatalog();
  console.log(JSON.stringify({ok: true, public: catalog.filter(item => item.kind !== 'reference').length, references: catalog.filter(item => item.kind === 'reference').length}));
}
