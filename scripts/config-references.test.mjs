import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {collectConfigReferences, resolveConfigReferences} from './config-references.mjs';
import {validateSources} from './validate-sources.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'config-validation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = path.join(root, 'source/scenarios/example');
  const library = path.join(root, 'shared');
  const cveLibrary = path.join(root, 'shared-cve');
  await mkdir(cveLibrary);
  await mkdir(entry, {recursive: true});
  await mkdir(path.join(library, 'configs'), {recursive: true});
  await writeFile(path.join(entry, 'README.md'), '---\nid: example\ntitle: Example\ndescription: Example\nentrypoint: scenario.cradle\n---\n');
  return {root, entry, library, cveLibrary, source: path.join(root, 'source')};
}
async function module(base, name, extension = 'j2', content = '- name: Task\n') {
  const directory = path.join(base, name, 'ansible');
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, `${name}.${extension}`), content);
}

test('finds actual calls including includes, ignoring comments, strings and lookalike names', async (t) => {
  const {entry} = await fixture(t);
  await writeFile(path.join(entry, 'scenario.cradle'), `// config("comment-one")\n# config("comment-two")\n/* config("comment-three") */\nmetadata() > description("config(\\\"quoted\\\")").\ninstance("pc") > config /* gap */ ("linux-python3"), otherconfig("ignore").\ninclude "extra.cradle".\ninclude "extra.cradle".\n`);
  await writeFile(path.join(entry, 'extra.cradle'), 'instance("other") > config("custom").');
  const refs = await collectConfigReferences(entry);
  assert.deepEqual(refs.map((ref) => ref.name), ['linux-python3', 'custom']);
  assert.equal(refs[1].file, 'extra.cradle');
  assert.equal(refs[0].line, 5);
});

test('rejects includes outside the scenario and unsafe/nonliteral configuration names', async (t) => {
  const {root, entry} = await fixture(t);
  await writeFile(path.join(root, 'outside.cradle'), 'metadata() > name("Outside").');
  await writeFile(path.join(entry, 'scenario.cradle'), `include "${path.relative(entry, path.join(root, 'outside.cradle')).split(path.sep).join('/')}".`);
  await assert.rejects(collectConfigReferences(entry), /escapes/);
  await writeFile(path.join(entry, 'scenario.cradle'), 'instance("pc") > config("../outside").');
  await assert.rejects(collectConfigReferences(entry), /unsafe config/);
  await writeFile(path.join(entry, 'scenario.cradle'), 'instance("pc") > config(variable).');
  await assert.rejects(collectConfigReferences(entry), /literal string/);
});

test('resolves local overrides, shared configs, legacy aliases and compiler built-ins', async (t) => {
  const {entry, library} = await fixture(t);
  await module(path.join(entry, 'configs'), 'custom');
  await module(path.join(entry, 'configs'), 'linux-python3', 'yaml');
  await module(path.join(library, 'configs'), 'linux-python3');
  await module(path.join(library, 'configs'), 'linux-auditd');
  const result = await resolveConfigReferences(entry, library, ['custom', 'linux-python3', 'ubuntu-focal-auditd', 'linux-routing', 'win-custom-routing', 'unknown'].map((name) => ({name})));
  const byName = Object.fromEntries(result.map((item) => [item.name, item]));
  assert.equal(byName.custom.source, 'scenario/configs');
  assert.equal(byName['linux-python3'].source, 'scenario/configs');
  assert.match(byName['linux-python3'].template, /\.yaml$/);
  assert.equal(byName['ubuntu-focal-auditd'].canonical, 'linux-auditd');
  assert.equal(byName['ubuntu-focal-auditd'].source, 'cradle-lib/configs');
  assert.equal(byName['linux-routing'].source, 'cxc built-in');
  assert.equal(byName['win-custom-routing'].source, 'cxc built-in');
  assert.equal(byName.unknown.source, null);
});

test('rejects broken local modules instead of silently falling back to cradle-lib', async (t) => {
  const {entry, library} = await fixture(t);
  await mkdir(path.join(entry, 'configs/custom'), {recursive: true});
  await module(path.join(library, 'configs'), 'custom');
  await assert.rejects(resolveConfigReferences(entry, library, [{name: 'custom'}]), /missing regular ansible/);
  await module(path.join(entry, 'configs'), 'custom', 'j2', '');
  await assert.rejects(resolveConfigReferences(entry, library, [{name: 'custom'}]), /non-empty/);
});

test('runs cxc validate for drafts, reports missing configs, and continues after syntax failures', async (t) => {
  const {root, entry, library, cveLibrary, source} = await fixture(t);
  await writeFile(path.join(entry, 'scenario.cradle'), 'instance("pc") > config("missing").');
  await writeFile(path.join(entry, 'index.md'), '---\ndraft: true\n---\n');
  const next = path.join(source, 'scenarios/second');
  await mkdir(next);
  await writeFile(path.join(next, 'README.md'), '---\nid: second\ntitle: Second\ndescription: Example\nentrypoint: scenario.cradle\n---\n');
  await writeFile(path.join(next, 'scenario.cradle'), 'instance("pc") > config("linux-routing").');
  const calls = [];
  const result = await validateSources({sourceRoot: source, libraryRoot: library, cveLibraryRoot: cveLibrary, output: path.join(root, 'output'), run: (command, args, options) => {
    calls.push({command, args, options});
    if (args[0] === '--version') return {status: 0, stdout: 'cxc test-version'};
    return args[2].includes(`${path.sep}example${path.sep}`) ? {status: 1, stderr: 'Syntax error\n'} : {status: 0, stdout: 'Valid\n'};
  }});
  assert.equal(calls[1].command, 'cxc');
  assert.deepEqual(calls[1].args, ['validate', '-i', path.join(entry, 'scenario.cradle')]);
  assert.equal(calls[1].options.cwd, path.join(root, 'output/example/compiler-context'));
  assert.match(await readFile(path.join(calls[1].options.cwd, 'config.toml'), 'utf8'), /heuristics_dir = /);
  assert.equal(result.failed, 1);
  assert.equal(result.report.scenarios.length, 2);
  assert.equal(result.report.scenarios[0].validation, 'failed');
  assert.match(result.report.scenarios[0].errors.join(' '), /Missing config: missing/);
  assert.equal(result.report.scenarios[1].validation, 'passed');
  assert.match(await readFile(path.join(root, 'output/validation.md'), 'utf8'), /Draft scenarios are included/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'output/validation.json'), 'utf8')).compiler, 'cxc test-version');
});

test('selects one scenario, refuses an unknown ID, and reports an unavailable compiler', async (t) => {
  const {root, entry, library, cveLibrary, source} = await fixture(t);
  await writeFile(path.join(entry, 'scenario.cradle'), 'metadata() > name("Example").');
  const options = {sourceRoot: source, libraryRoot: library, cveLibraryRoot: cveLibrary, output: path.join(root, 'output'), scenario: 'example'};
  const success = await validateSources({...options, run: () => ({status: 0, stdout: 'ok'})});
  assert.equal(success.failed, 0);
  await assert.rejects(validateSources({...options, scenario: '../escape'}), /folder ID/);
  await assert.rejects(validateSources({...options, scenario: 'missing'}), /not found/);
  await assert.rejects(validateSources({...options, run: () => ({error: {code: 'ENOENT'}})}), /cxc is unavailable/);
});
