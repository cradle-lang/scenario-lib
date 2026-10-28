import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createLibraryEntry, parseLibraryArgs} from './new-library-entry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(path.join(root, '.library-import-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const source = path.join(directory, 'source with spaces');
  const destinationRoot = path.join(directory, 'site');
  await mkdir(source);
  return {directory, source, destinationRoot};
}

test('imports nested assets byte-for-byte, normalizes the specification, and creates a draft', async (t) => {
  const {source, destinationRoot} = await fixture(t);
  await writeFile(path.join(source, 'my-range.cradle'), 'scenario Example {}\n');
  await mkdir(path.join(source, 'configs', 'ansible'), {recursive: true});
  await writeFile(path.join(source, 'configs', 'ansible', 'setup.j2'), '{{ config }}\n');
  await mkdir(path.join(source, 'artifacts'));
  const binary = Buffer.from([0, 255, 128, 1, 10, 13]);
  await writeFile(path.join(source, 'artifacts', 'data.bin'), binary);
  await mkdir(path.join(source, 'configs', '__pycache__'));
  await writeFile(path.join(source, 'configs', '__pycache__', 'cache.pyc'), 'cache');
  for (const excluded of ['.git', 'node_modules']) await mkdir(path.join(source, excluded));
  const relative = await createLibraryEntry('scenario', 'my-range', {root: destinationRoot, from: source});
  const destination = path.join(destinationRoot, relative);
  assert.equal(await readFile(path.join(destination, 'scenario.cradle'), 'utf8'), 'scenario Example {}\n');
  assert.equal(await readFile(path.join(source, 'my-range.cradle'), 'utf8'), 'scenario Example {}\n');
  assert.equal(await readFile(path.join(destination, 'configs/ansible/setup.j2'), 'utf8'), '{{ config }}\n');
  assert.deepEqual(await readFile(path.join(destination, 'artifacts/data.bin')), binary);
  assert.match(await readFile(path.join(destination, 'index.md'), 'utf8'), /title: "My Range"[\s\S]*draft: true/);
  assert.deepEqual((await readdir(destination)).sort(), ['artifacts', 'configs', 'index.md', 'scenario.cradle']);
  assert.deepEqual(await readdir(path.join(destination, 'configs')), ['ansible']);
  await assert.rejects(createLibraryEntry('scenario', 'my-range', {root: destinationRoot, from: source}), /already exists/);
  assert.deepEqual(await readFile(path.join(destination, 'artifacts/data.bin')), binary);
});

test('preserves authored articles and canonical specifications with additional source files', async (t) => {
  const {source, destinationRoot} = await fixture(t);
  const article = '---\ntitle: Authored\ndraft: true\n---\nCustom text\n';
  await writeFile(path.join(source, 'index.mdx'), article);
  await writeFile(path.join(source, 'scenario.cradle'), 'main');
  await writeFile(path.join(source, 'extra.cradle'), 'supporting');
  await createLibraryEntry('scenario', 'authored', {root: destinationRoot, from: source});
  const destination = path.join(destinationRoot, 'scenarios/authored');
  assert.equal(await readFile(path.join(destination, 'index.mdx'), 'utf8'), article);
  assert.equal(await readFile(path.join(destination, 'extra.cradle'), 'utf8'), 'supporting');
  assert.ok(!(await readdir(destination)).includes('index.md'));
});

test('imports selected scenario contents, omits TOML and unrelated files, and preserves an optional article', async (t) => {
  const {source, destinationRoot} = await fixture(t);
  await writeFile(path.join(source, 'Railway.cradle'), 'scenario Railway {}');
  for (const folder of ['config', 'artifact', 'scripts', 'images', 'heuristics', 'unrelated']) {
    await mkdir(path.join(source, folder));
    await writeFile(path.join(source, folder, 'content.bin'), Buffer.from([0, 128, 255]));
    await writeFile(path.join(source, folder, 'settings.TOML'), 'skip = true');
  }
  for (const filename of ['cradle.toml', 'notes.txt', 'README.md', 'index.md', 'topology.png', 'setup.sh']) {
    await writeFile(path.join(source, filename), `Contents of ${filename}`);
  }
  await createLibraryEntry('scenario', 'railway', {root: destinationRoot, from: source});
  const destination = path.join(destinationRoot, 'scenarios/railway');
  assert.deepEqual((await readdir(destination)).sort(), ['README.md', 'artifact', 'config', 'heuristics', 'images', 'index.md', 'scenario.cradle', 'scripts', 'setup.sh', 'topology.png'].sort());
  for (const folder of ['config', 'artifact', 'scripts', 'images', 'heuristics']) {
    assert.deepEqual(await readdir(path.join(destination, folder)), ['content.bin']);
    assert.deepEqual(await readFile(path.join(destination, folder, 'content.bin')), Buffer.from([0, 128, 255]));
  }
  assert.equal(await readFile(path.join(destination, 'index.md'), 'utf8'), 'Contents of index.md');
  assert.equal(await readFile(path.join(source, 'cradle.toml'), 'utf8'), 'Contents of cradle.toml');
});

test('rejects ambiguous/missing/empty specifications and duplicate articles before creating the entry', async (t) => {
  const {source, destinationRoot} = await fixture(t);
  const options = {root: destinationRoot, from: source};
  await assert.rejects(createLibraryEntry('scenario', 'invalid', options), /top-level .cradle/);
  await writeFile(path.join(source, 'one.cradle'), 'one');
  await writeFile(path.join(source, 'two.cradle'), 'two');
  await assert.rejects(createLibraryEntry('scenario', 'invalid', options), /multiple/);
  await writeFile(path.join(source, 'scenario.cradle'), ' \n');
  await assert.rejects(createLibraryEntry('scenario', 'invalid', options), /must not be empty/);
  await writeFile(path.join(source, 'scenario.cradle'), 'main');
  await writeFile(path.join(source, 'index.md'), 'article');
  await writeFile(path.join(source, 'index.mdx'), 'article');
  await assert.rejects(createLibraryEntry('scenario', 'invalid', options), /at most one article/);
  await assert.rejects(readdir(path.join(destinationRoot, 'scenarios/invalid')), {code: 'ENOENT'});
  await assert.rejects(createLibraryEntry('scenario', 'invalid', {root: destinationRoot, from: path.join(source, 'one.cradle')}), /directory/);
});

test('rejects overlapping directories and invalid slugs', async (t) => {
  const {source} = await fixture(t);
  await writeFile(path.join(source, 'scenario.cradle'), 'main');
  await assert.rejects(createLibraryEntry('scenario', 'nested', {root: source, from: source}), /contain one another/);
  await assert.rejects(createLibraryEntry('scenario', '../escape', {root: source, from: source}), /lowercase/);
});

test('keeps scaffold-only behavior and imports configuration/heuristic assets with MDX support', async (t) => {
  const {source, destinationRoot} = await fixture(t);
  await createLibraryEntry('scenario', 'scaffold', {root: destinationRoot, mdx: true});
  assert.match(await readFile(path.join(destinationRoot, 'scenarios/scaffold/index.mdx'), 'utf8'), /draft: true/);
  await readFile(path.join(destinationRoot, 'scenarios/scaffold/scenario.cradle'));
  await writeFile(path.join(source, 'manifest.json'), '{"framework":"cve"}\n');
  await createLibraryEntry('heuristic', 'example', {root: destinationRoot, from: source, mdx: true});
  assert.equal(await readFile(path.join(destinationRoot, 'library/heuristics/example/manifest.json'), 'utf8'), '{"framework":"cve"}\n');
  await createLibraryEntry('configuration', 'my-config', {root: destinationRoot, from: source});
  assert.match(await readFile(path.join(destinationRoot, 'library/configurations/my-config/index.md'), 'utf8'), /config: my-config/);
  const markdown = '---\ntitle: Original\n---\n';
  await writeFile(path.join(source, 'index.md'), markdown);
  await createLibraryEntry('configuration', 'authored', {root: destinationRoot, from: source, mdx: true});
  assert.equal(await readFile(path.join(destinationRoot, 'library/configurations/authored/index.mdx'), 'utf8'), markdown);
});

test('parses CLI flags in either order and rejects incomplete/repeated/unknown options', () => {
  for (const flags of [['--mdx', '--from', 'source path'], ['--from', 'source path', '--mdx']]) {
    assert.deepEqual(parseLibraryArgs(['scenario', 'example', ...flags]), {kind: 'scenario', slug: 'example', options: {mdx: true, from: 'source path'}});
  }
  for (const flags of [['--from'], ['--from', '--mdx'], ['--unknown'], ['--mdx', '--mdx'], ['--from', 'one', '--from', 'two']]) {
    assert.throws(() => parseLibraryArgs(['scenario', 'example', ...flags]), /option/);
  }
});

test('CLI imports a relative source directory containing spaces', async (t) => {
  const {directory, source} = await fixture(t);
  await writeFile(path.join(source, 'my-range.cradle'), 'main');
  // Copy just the command/templates into an isolated site so the CLI cannot add a real entry.
  const {cp} = await import('node:fs/promises');
  await cp(path.join(root, 'scripts/new-library-entry.mjs'), path.join(directory, 'scripts/new-library-entry.mjs'), {recursive: true});
  await cp(path.join(root, 'library/_templates'), path.join(directory, 'library/_templates'), {recursive: true});
  const result = spawnSync(process.execPath, [path.join(directory, 'scripts/new-library-entry.mjs'), 'scenario', 'cli-range', '--from', './source with spaces', '--mdx'], {cwd: directory, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(directory, 'scenarios/cli-range/scenario.cradle'), 'utf8'), 'main');
  assert.match(result.stdout, /Created scenarios\/cli-range/);
});
