import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {collectContentReferences} from './config-references.mjs';
import {resolveHeuristicReferences} from './heuristic-references.mjs';
import {validateSources} from './validate-sources.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'heuristic-validation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = path.join(root, 'source/scenarios/example');
  const library = path.join(root, 'shared');
  await mkdir(entry, {recursive: true});
  for (const folder of ['configs', 'heuristics']) await mkdir(path.join(library, folder), {recursive: true});
  await writeFile(path.join(entry, 'README.md'), '---\nid: example\ntitle: Example\ndescription: Example\nentrypoint: scenario.cradle\n---\n');
  return {root, entry, library, source: path.join(root, 'source')};
}
const reference = {framework: 'cve', value: 'CVE-2021-41773'};
async function heuristic(base, {framework = 'cve', value = 'CVE-2021-41773', configs = ['linux-auditd'], ...fields} = {}) {
  const directory = path.join(base, framework, value);
  await mkdir(path.join(directory, 'ansible'), {recursive: true});
  await writeFile(path.join(directory, 'ansible', `${value}.j2`), '- name: Set up heuristic\n');
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({framework, value, os: 'ubuntu', os_version: '20.04', configs, ...fields}));
  return directory;
}

test('finds heuristic pairs in includes, ignoring comments and quoted examples', async (t) => {
  const {entry} = await fixture(t);
  await writeFile(path.join(entry, 'scenario.cradle'), `// heuristic("cve", "comment")\n# heuristic("cve", "comment")\n/* heuristic("cve", "comment") */\nmetadata() > description("heuristic(\\\"cve\\\", \\\"quoted\\\")").\ninstance("pc") > heuristic("CVE", "CVE-2021-41773").\ninclude "extra.cradle".\n`);
  await writeFile(path.join(entry, 'extra.cradle'), 'instance("pc") > heuristic("ttp", "T1053.003"), config("linux-auditd").');
  const result = await collectContentReferences(entry);
  assert.deepEqual(result.heuristics.map(({framework, value}) => ({framework, value})), [reference, {framework: 'ttp', value: 'T1053.003'}]);
  assert.equal(result.configs[0].name, 'linux-auditd');
  assert.equal(result.heuristics[1].file, 'extra.cradle');
});

test('rejects traversal and nonliteral heuristic arguments before looking up content', async (t) => {
  const {entry} = await fixture(t);
  for (const call of ['heuristic("../cve", "CVE-2021-41773")', 'heuristic("cve", "../outside")', 'heuristic("cve", variable)']) {
    await writeFile(path.join(entry, 'scenario.cradle'), `instance("pc") > ${call}.`);
    await assert.rejects(collectContentReferences(entry), /unsafe heuristic|literal string/);
  }
});

test('prefers bundled heuristic modules and reports absent shared modules', async (t) => {
  const {entry, library} = await fixture(t);
  await heuristic(path.join(library, 'heuristics'));
  await heuristic(path.join(entry, 'heuristics'), {configs: ['local-dependency']});
  const result = await resolveHeuristicReferences(entry, library, [reference, reference, {framework: 'ttp', value: 'T1105'}]);
  assert.equal(result.length, 2);
  assert.equal(result[0].source, 'scenario/heuristics');
  assert.deepEqual(result[0].configs, ['local-dependency']);
  assert.equal(result[0].manifest.os, 'ubuntu');
  assert.match(result[1].error, /Missing heuristic: ttp\/T1105/);
});

test('rejects malformed/mismatched manifests, incomplete OS pairs and missing templates without fallback', async (t) => {
  const {entry, library} = await fixture(t);
  await heuristic(path.join(library, 'heuristics'));
  const directory = await heuristic(path.join(entry, 'heuristics'));
  const resolve = async () => (await resolveHeuristicReferences(entry, library, [reference]))[0];
  await writeFile(path.join(directory, 'manifest.json'), '{invalid json');
  assert.match((await resolve()).error, /invalid manifest/);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({...reference, framework: 'ttp', configs: []}));
  assert.match((await resolve()).error, /must match/);
  await heuristic(path.join(entry, 'heuristics'), {os_version: null});
  assert.match((await resolve()).error, /both/);
  await heuristic(path.join(entry, 'heuristics'), {configs: ['../escape']});
  assert.match((await resolve()).error, /safe configuration/);
  await heuristic(path.join(entry, 'heuristics'));
  await rm(path.join(directory, 'manifest.json'));
  assert.match((await resolve()).error, /missing regular manifest/);
  await heuristic(path.join(entry, 'heuristics'));
  await rm(path.join(directory, 'ansible', `${reference.value}.j2`));
  assert.match((await resolve()).error, /missing ansible/);
});

test('supports classification manifests with no OS/config requirements', async (t) => {
  const {entry, library} = await fixture(t);
  const directory = await heuristic(path.join(library, 'heuristics'), {os: null, os_version: null, configs: []});
  const manifest = path.join(directory, 'manifest.json');
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  delete data.configs;
  await writeFile(manifest, JSON.stringify(data));
  const [result] = await resolveHeuristicReferences(entry, library, [reference]);
  assert.equal(result.error, null);
  assert.deepEqual(result.configs, []);
  assert.equal(result.manifest.os, null);
});

test('fails on configs implied by heuristic manifests and records dependency provenance', async (t) => {
  const {root, entry, library, source} = await fixture(t);
  await writeFile(path.join(entry, 'scenario.cradle'), 'instance("pc") > heuristic("cve", "CVE-2021-41773").');
  await heuristic(path.join(library, 'heuristics'));
  const options = {sourceRoot: source, libraryRoot: library, output: path.join(root, 'output'), run: () => ({status: 0, stdout: 'ok\n'})};
  const result = await validateSources(options);
  assert.equal(result.failed, 1);
  assert.equal(result.report.scenarios[0].heuristics[0].source, 'cradle-lib/heuristics');
  assert.match(result.report.scenarios[0].errors.join(' '), /Missing config: linux-auditd/);
  assert.deepEqual(result.report.scenarios[0].configs[0].requiredBy, ['heuristic cve/CVE-2021-41773']);
  assert.match(result.markdown, /\| Heuristic \|/);
  await mkdir(path.join(library, 'configs/linux-auditd/ansible'), {recursive: true});
  await writeFile(path.join(library, 'configs/linux-auditd/ansible/linux-auditd.j2'), '- name: Audit\n');
  assert.equal((await validateSources(options)).failed, 0);
  const config = await readFile(path.join(root, 'output/example/compiler-context/config.toml'), 'utf8');
  assert.ok(config.includes(JSON.stringify(path.join(library, 'heuristics'))));
});
