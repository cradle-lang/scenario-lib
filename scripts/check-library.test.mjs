import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {readLibrary} from './check-library.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'scenario-library-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const kind of ['scenarios', 'configurations', 'heuristics']) await mkdir(path.join(root, ...(kind === 'scenarios' ? [] : ['library']), kind), {recursive: true});
  return root;
}
async function entry(root, kind, id, metadata, body = '') {
  const directory = path.join(root, ...(kind === 'scenarios' ? [] : ['library']), kind, id);
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, 'index.md'), `---\ntitle: Example\ndescription: Example description\n${metadata}\n---\n${body}\n`);
  return directory;
}
const metadata = 'source: Original author\ncategory: Training\nrequirements: Testbed\ntags: [Training]\ndraft: false';
async function scenario(root, id = 'example', extra = '', body = '[Download](./scenario.cradle)') {
  const directory = await entry(root, 'scenarios', id, `${metadata}\n${extra}`, body);
  await writeFile(path.join(directory, 'scenario.cradle'), 'scenario Example {}\n');
  return directory;
}

test('discovers all kinds, excludes drafts, and preserves portable source paths', async (t) => {
  const root = await fixture(t);
  await scenario(root);
  await entry(root, 'scenarios', 'unfinished', 'draft: true');
  await entry(root, 'configurations', 'router', 'config: linux-router\nos: Linux');
  await entry(root, 'heuristics', 'mapping', 'framework: CWE\nidentifier: CWE-89');
  const result = await readLibrary(root);
  assert.deepEqual(result.scenarios.map((item) => item.id), ['example']);
  assert.equal(result.scenarios[0].sourcePath, 'scenarios/example/scenario.cradle');
  assert.equal(result.configurations[0].config, 'linux-router');
  assert.equal(result.heuristics[0].framework, 'cwe');
});
test('rejects publication of the comment-only scaffold and missing download link', async (t) => {
  const root = await fixture(t);
  const directory = await scenario(root);
  await writeFile(path.join(directory, 'scenario.cradle'), '// TODO replace\n/* placeholder */');
  await assert.rejects(readLibrary(root), /comment-only/);
  await scenario(root, 'example', '', 'No download');
  await assert.rejects(readLibrary(root), /link the specification/);
});
test('rejects broken attachments and escaping paths, supports images and fenced examples', async (t) => {
  const root = await fixture(t);
  await scenario(root, 'example', '', '[Download](./scenario.cradle)\n[Missing](./missing.sh)');
  await assert.rejects(readLibrary(root), /missing linked file/);
  await scenario(root, 'example', '', '[Download](./scenario.cradle)\n[Outside](../secret.txt)');
  await assert.rejects(readLibrary(root), /stay inside/);
  const directory = await scenario(root, 'example', 'thumbnail: ./image.png\nthumbnailAlt: Network diagram', '[Download](./scenario.cradle)\n![Diagram](./image.png)\n```md\n[Example](./nonexistent.md)\n```');
  await writeFile(path.join(directory, 'image.png'), Buffer.from([1, 2, 3]));
  assert.equal((await readLibrary(root)).scenarios[0].thumbnailAlt, 'Network diagram');
});
test('rejects duplicate resource identity even with different folder IDs', async (t) => {
  const root = await fixture(t);
  await entry(root, 'heuristics', 'first', 'framework: CWE\nidentifier: CWE-89');
  await entry(root, 'heuristics', 'second', 'framework: cwe\nidentifier: cwe-89');
  await assert.rejects(readLibrary(root), /duplicate/);
});
test('accepts SVG and AVIF local artwork thumbnails', async (t) => {
  const root = await fixture(t);
  for (const extension of ['svg', 'avif']) {
    const directory = await scenario(root, 'example', `thumbnail: ./preview.${extension}\nthumbnailAlt: Supplied artwork`);
    await writeFile(path.join(directory, `preview.${extension}`), extension === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : Buffer.from([1, 2, 3]));
    assert.equal((await readLibrary(root)).scenarios[0].thumbnailAlt, 'Supplied artwork');
  }
});
test('reports invalid YAML, nonboolean drafts, duplicate articles and missing metadata', async (t) => {
  const root = await fixture(t);
  const directory = await entry(root, 'configurations', 'example', 'draft: "false"');
  await assert.rejects(readLibrary(root), /draft must/);
  await entry(root, 'configurations', 'example', 'config: example\nos: Plan9');
  await assert.rejects(readLibrary(root), /invalid os/);
  await entry(root, 'configurations', 'example', 'os: Linux');
  await assert.rejects(readLibrary(root), /config must/);
  await entry(root, 'configurations', 'example', 'title: Duplicate');
  await assert.rejects(readLibrary(root), /unique|already defined/i);
  await entry(root, 'configurations', 'example', 'draft: true');
  await writeFile(path.join(directory, 'index.mdx'), 'duplicate');
  await assert.rejects(readLibrary(root), /exactly one/);
});

test('compiler resolver selects published source from another checkout and rejects traversal/drafts', async (t) => {
  const root = await fixture(t);
  const directory = await scenario(root);
  await entry(root, 'scenarios', 'unfinished', 'draft: true');
  const script = fileURLToPath(new URL('./resolve-library-scenario.mjs', import.meta.url));
  const run = (id) => spawnSync(process.execPath, [script, id, root], {encoding: 'utf8'});
  const valid = run('example');
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), path.join(directory, 'scenario.cradle'));
  for (const id of ['../example', 'unfinished', 'missing']) assert.notEqual(run(id).status, 0);
});
