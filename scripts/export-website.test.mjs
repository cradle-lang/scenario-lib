import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parseDocument} from 'yaml';
import {exportWebsite} from './export-website.mjs';

const revision = 'a'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'website-export-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = path.join(root, 'scenarios/railway');
  await mkdir(path.join(entry, 'configs'), {recursive: true});
  await writeFile(path.join(entry, 'scenario.cradle'), 'metadata() > name("Railway").\n');
  await writeFile(path.join(entry, 'README.md'), 'Source README');
  await writeFile(path.join(entry, 'picture.png'), Buffer.from([0, 128, 255]));
  await writeFile(path.join(entry, 'configs/setup.yml'), '- name: Setup\n');
  await writeFile(path.join(entry, 'index.md'), '---\ntitle: Railway\ndescription: Example\ndraft: true\nthumbnail: ./picture.png\nthumbnailAlt: Diagram\n---\n\n[Source](./scenario.cradle)\n[README](./README.md)\n[Configs](./configs/)\n![Diagram](./picture.png)\n');
  return {root, entry};
}

test('exports a named two-file snapshot, preserving source bytes and draft status', async (t) => {
  const {root, entry} = await fixture(t);
  const bundle = await exportWebsite({sourceRoot: root, revision});
  assert.equal(bundle.sourceRevision, revision);
  assert.equal(bundle.sourceRepository, 'cradle-lang/scenario-lib');
  assert.deepEqual(Object.keys(bundle.scenarios[0]).sort(), ['article', 'id', 'spec']);
  assert.equal(bundle.scenarios[0].id, 'railway');
  assert.equal(bundle.scenarios[0].spec, await readFile(path.join(entry, 'scenario.cradle'), 'utf8'));
  const article = bundle.scenarios[0].article;
  const data = parseDocument(article.match(/^---\n([\s\S]*?)\n---/)[1]).toJS();
  assert.equal(data.draft, true);
  assert.equal(data.thumbnail, undefined);
  assert.equal(data.thumbnailAlt, undefined);
  assert.match(article, /\[Source\]\(\.\/scenario\.cradle\)/);
  assert.ok(article.includes(`/blob/${revision}/scenarios/railway/README.md`));
  assert.ok(article.includes(`/tree/${revision}/scenarios/railway/configs`));
  assert.match(article, /\[Diagram \(source image\)\]/);
  assert.doesNotMatch(article, /!\[Diagram\]/);
});

test('rewrites reference links/images without touching code fences or external links', async (t) => {
  const {root, entry} = await fixture(t);
  await writeFile(path.join(entry, 'index.md'), '---\ntitle: Railway\ndescription: Example\n---\n\n[Guide][readme]\n![Diagram][picture]\n\n[readme]: ./README.md\n[picture]: ./picture.png\n\n[External](https://example.com)\n\n```md\n[Example](./not-real.txt)\n```\n');
  const {article} = (await exportWebsite({sourceRoot: root, revision})).scenarios[0];
  assert.ok(article.includes(`[readme]: <https://github.com/cradle-lang/scenario-lib/blob/${revision}/scenarios/railway/README.md>`));
  assert.match(article, /\[Diagram \(source image\)\]\[picture\]/);
  assert.match(article, /\[External\]\(https:\/\/example.com\)/);
  assert.match(article, /\[Example\]\(\.\/not-real.txt\)/);
  assert.match(article, /\[Download the specification\]\(\.\/scenario\.cradle\)/);
});

test('rejects missing attachments, escaping links and unsupported HTML local assets', async (t) => {
  const {root, entry} = await fixture(t);
  const article = (body) => `---\ntitle: Railway\ndescription: Example\n---\n${body}\n`;
  for (const body of ['[Missing](./missing.txt)', '[Outside](../../../../secret.txt)', '<img src="./picture.png" />']) {
    await writeFile(path.join(entry, 'index.md'), article(body));
    await assert.rejects(exportWebsite({sourceRoot: root, revision}));
  }
});

test('requires a full revision and an index.md article for the website contract', async (t) => {
  const {root, entry} = await fixture(t);
  await assert.rejects(exportWebsite({sourceRoot: root, revision: 'main'}), /full source commit/);
  await rm(path.join(entry, 'index.md'));
  await writeFile(path.join(entry, 'index.mdx'), 'MDX source');
  await assert.rejects(exportWebsite({sourceRoot: root, revision}), /use index.md rather than MDX/);
});
