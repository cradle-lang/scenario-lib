import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
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

test('exports a snapshot with its thumbnail bytes, metadata and draft status', async (t) => {
  const {root, entry} = await fixture(t);
  const bundle = await exportWebsite({sourceRoot: root, revision});
  assert.equal(bundle.sourceRevision, revision);
  assert.equal(bundle.sourceRepository, 'cradle-lang/scenario-lib');
  assert.deepEqual(Object.keys(bundle.scenarios[0]).sort(), ['article', 'assets', 'id', 'spec']);
  assert.deepEqual(bundle.scenarios[0].assets, [{path: 'picture.png', base64: Buffer.from([0, 128, 255]).toString('base64')}]);
  assert.equal(bundle.scenarios[0].id, 'railway');
  assert.equal(bundle.scenarios[0].spec, await readFile(path.join(entry, 'scenario.cradle'), 'utf8'));
  assert.equal(bundle.catalog[0].id, bundle.scenarios[0].id);
  assert.equal(bundle.catalog[0].title, 'Railway');
  assert.equal(bundle.catalog[0].draft, true);
  assert.deepEqual(bundle.catalog[0].tags, []);
  assert.equal(bundle.catalog[0].source, 'Not documented');
  assert.equal(bundle.catalog[0].category, 'Community');
  assert.equal(bundle.catalog[0].sourceUrl, `https://github.com/cradle-lang/scenario-lib/tree/${revision}/scenarios/railway`);
  const article = bundle.scenarios[0].article;
  const data = parseDocument(article.match(/^---\n([\s\S]*?)\n---/)[1]).toJS();
  assert.equal(data.draft, true);
  assert.equal(data.thumbnail, './picture.png');
  assert.equal(data.thumbnailAlt, 'Diagram');
  assert.equal(data.sourceUrl, bundle.catalog[0].sourceUrl);
  assert.match(article, /\[Source\]\(\.\/scenario\.cradle\)/);
  assert.ok(article.includes(`/blob/${revision}/scenarios/railway/README.md`));
  assert.ok(article.includes(`/tree/${revision}/scenarios/railway/configs`));
  assert.match(article, /\[Diagram \(source image\)\]/);
  assert.doesNotMatch(article, /!\[Diagram\]/);
});

test('rejects missing or unsafe thumbnail files and missing alt text', async t => {
  const {root, entry} = await fixture(t);
  const original = await readFile(path.join(entry, 'index.md'), 'utf8');
  for (const thumbnail of ['./missing.png', '../outside.png', 'C:/outside.png', './configs/setup.yml']) {
    await writeFile(path.join(entry, 'index.md'), original.replace('./picture.png', thumbnail));
    await assert.rejects(exportWebsite({sourceRoot: root, revision}));
  }
  await writeFile(path.join(entry, 'index.md'), original.replace('thumbnailAlt: Diagram\n', ''));
  await assert.rejects(exportWebsite({sourceRoot: root, revision}), /thumbnail/);
});

test('bundles all scenario folders including drafts, excluding only validation-smoke-test', async (t) => {
  const {root, entry} = await fixture(t);
  for (const id of ['published', 'validation-smoke-test-extra']) {
    await cp(entry, path.join(root, 'scenarios', id), {recursive: true});
  }
  const published = path.join(root, 'scenarios/published/index.md');
  await writeFile(published, (await readFile(published, 'utf8')).replace('draft: true', 'draft: false'));
  // Excluded content must not be read/exported, even if it lacks website files.
  await mkdir(path.join(root, 'scenarios/validation-smoke-test'));
  await writeFile(path.join(root, 'scenarios/validation-smoke-test/scenario.cradle'), 'smoke-test source must never be sent');
  await mkdir(path.join(root, 'other/ignored'), {recursive: true});
  const bundle = await exportWebsite({sourceRoot: root, revision});
  assert.deepEqual(bundle.scenarios.map(({id}) => id), ['published', 'railway', 'validation-smoke-test-extra']);
  assert.deepEqual(bundle.catalog.map(({id}) => id), bundle.scenarios.map(({id}) => id));
  assert.deepEqual(bundle.catalog.filter(entry => !entry.draft).map(({id}) => id), ['published']);
  assert.match(bundle.scenarios.find(({id}) => id === 'published').article, /draft: false/);
  assert.match(bundle.scenarios.find(({id}) => id === 'railway').article, /draft: true/);
  for (const scenario of bundle.scenarios) {
    assert.deepEqual(Object.keys(scenario).sort(), ['article', 'assets', 'id', 'spec']);
    assert.equal(scenario.spec, await readFile(path.join(root, 'scenarios', scenario.id, 'scenario.cradle'), 'utf8'));
    assert.match(scenario.article, /title: Railway/);
  }
  assert.doesNotMatch(JSON.stringify(bundle), /smoke-test source must never be sent/);
});

test('catalog supports metadata filters and normalized article/source search without parsing files', async (t) => {
  const {root, entry} = await fixture(t);
  await writeFile(path.join(entry, 'index.md'), '---\ntitle: Railway Lab\ndescription: Investigate network activity\nsource: Community Lab\ncategory: Networking\ntags: [" Linux ", CVE, Linux]\nrequirements: Ubuntu host\n---\nA **Distinctive** article keyword.\n[Guide](https://example.com/should-not-be-indexed)\n');
  await writeFile(path.join(entry, 'scenario.cradle'), 'instance("host") > heuristic("cve", "CVE-2021-41773").\n');
  const bundle = await exportWebsite({sourceRoot: root, revision});
  const [item] = bundle.catalog;
  assert.equal(item.draft, false);
  assert.deepEqual(item.tags, ['Linux', 'CVE']);
  assert.equal(item.requirements, 'Ubuntu host');
  assert.deepEqual(bundle.catalog.filter(item => item.category === 'Networking' && item.source === 'Community Lab' && item.tags.includes('Linux')).map(({id}) => id), ['railway']);
  for (const query of ['railway lab', 'distinctive', 'ubuntu host', 'cve-2021-41773']) {
    assert.equal(bundle.catalog.filter(item => item.searchText.includes(query)).length, 1);
  }
  assert.equal(item.searchText, item.searchText.normalize('NFKC').toLowerCase());
  assert.doesNotMatch(item.searchText, /\n|\s{2}|should-not-be-indexed|full scenario folder and supporting files/);
  assert.equal(item.article, undefined);
  assert.equal(item.spec, undefined);
  assert.equal(JSON.stringify(await exportWebsite({sourceRoot: root, revision})), JSON.stringify(bundle));
});

test('rejects malformed filter metadata instead of producing an inconsistent catalog', async (t) => {
  const {root, entry} = await fixture(t);
  for (const field of ['tags: linux', 'tags: [linux, 123]', 'category: [Networking]', 'source: 123']) {
    await writeFile(path.join(entry, 'index.md'), `---\ntitle: Railway\ndescription: Example\n${field}\n---\nArticle\n`);
    await assert.rejects(exportWebsite({sourceRoot: root, revision}), /catalog/);
  }
});

test('replaces stale article source URLs with the exported scenario folder', async (t) => {
  const {root, entry} = await fixture(t);
  const filename = path.join(entry, 'index.md');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('title: Railway', 'sourceUrl: https://github.com/old/repository\ntitle: Railway'));
  const bundle = await exportWebsite({sourceRoot: root, revision});
  const metadata = parseDocument(bundle.scenarios[0].article.match(/^---\n([\s\S]*?)\n---/)[1]).toJS();
  assert.equal(metadata.sourceUrl, bundle.catalog[0].sourceUrl);
  assert.equal(metadata.sourceUrl, `https://github.com/cradle-lang/scenario-lib/tree/${revision}/scenarios/railway`);
  assert.doesNotMatch(bundle.scenarios[0].article, /github.com\/old\/repository/);
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

test('rejects poor exported Markdown before producing a website handoff', async t => {
  const {root, entry} = await fixture(t);
  await writeFile(path.join(entry, 'index.md'), '---\ntitle: Railway\ndescription: Example\n---\n\n```\nunlabeled code block\n```\n');
  await assert.rejects(exportWebsite({sourceRoot: root, revision}), /scenarios\/railway\/index.md:\d+ MD040/);
});
