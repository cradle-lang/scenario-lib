import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {readLibrary} from './check-library.mjs';
import {readCatalog} from './catalog.mjs';
import {exportWebsite} from './export-website.mjs';
import {listScenarioEntries, readScenario} from './scenario-layout.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'scenario-layout-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'scenarios/hello-world');
  await mkdir(path.join(directory,'objects'),{recursive:true});
  await writeFile(path.join(directory,'README.md'),'---\nschema_version: 1\nid: hello-world\ntitle: Hello World\ndescription: A portable example.\ntags: [Example]\nversion: 0.1.0\nentrypoint: HelloWorld.cradle\n---\n\n[Specification](./HelloWorld.cradle)\n');
  await writeFile(path.join(directory,'HelloWorld.cradle'),'metadata() > name("HelloWorld"), repositoryLocal(".").\nobject("hello") > location("${uriLocal}/objects/hello.sh").\n');
  await writeFile(path.join(directory,'objects/hello.sh'),'echo hello\n');
  return {root,directory};
}
test('native README metadata and named entrypoints work across catalogue, article checks and export',async t=>{
  const {root}=await fixture(t);
  const library=await readLibrary(root);
  assert.equal(library.scenarios[0].sourcePath,'scenarios/hello-world/HelloWorld.cradle');
  const catalog=await readCatalog(root);
  assert.equal(catalog.scenarios[0].entrypoint,'HelloWorld.cradle');
  const bundle=await exportWebsite({sourceRoot:root,revision:'a'.repeat(40)});
  assert.equal(bundle.sourceRepository,'cradle-lang/scenario-lib');
  assert.match(bundle.scenarios[0].article,/\[Specification\]\(<\.\/scenario\.cradle>\)/);
  assert.doesNotMatch(bundle.scenarios[0].article,/^id:/m);
  assert.match(bundle.scenarios[0].article,/source: Not documented/);
});
test('an authored index.md overrides article metadata without losing the native entrypoint',async t=>{
  const {root,directory}=await fixture(t);
  await writeFile(path.join(directory,'index.md'),'---\ntitle: Authored title\ndescription: Authored description\nsource: Author\ncategory: Testing\ntags: [Testing]\nrequirements: Not documented\ndraft: true\n---\nAuthored article\n');
  const scenario=await readScenario(directory);
  assert.equal(scenario.metadata.title,'Authored title');
  assert.equal(scenario.entrypointName,'HelloWorld.cradle');
  assert.equal((await readLibrary(root)).scenarios.length,0);
  const [entry]=(await exportWebsite({sourceRoot:root,revision:'a'.repeat(40)})).scenarios;
  assert.match(entry.article,/draft: true/);
  assert.match(entry.article,/Authored article/);
});
test('scenarios is the only discovery root and local object paths cannot escape it',async t=>{
  const {root,directory}=await fixture(t);
  await mkdir(path.join(root,'library/scenarios/ignored'),{recursive:true});
  assert.deepEqual((await listScenarioEntries(root)).map(entry=>entry.id),['hello-world']);
  await writeFile(path.join(directory,'HelloWorld.cradle'),'metadata() > repositoryLocal(".").\nobject("bad") > location("${uriLocal}/../../../outside.sh").');
  await assert.rejects(readCatalog(root),/escaping local object/);
});
test('native README schema versions are checked before export',async t=>{
  const {directory}=await fixture(t);
  const filename=path.join(directory,'README.md');
  await writeFile(filename,(await readFile(filename,'utf8')).replace('schema_version: 1','schema_version: 99'));
  await assert.rejects(readScenario(directory),/unsupported schema_version/);
});
