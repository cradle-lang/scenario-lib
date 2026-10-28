import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parseDocument} from 'yaml';
import {completeArticle, llmConfig, loadLlmEnv} from './llm-client.mjs';
import {collectScenarioContext, generateScenarioArticle, prepareArticle} from './generate-scenario-article.mjs';
import {createLibraryEntry, parseLibraryArgs} from './new-library-entry.mjs';

const validArticle = `---
title: Railway
description: A railway training range.
source: Not documented
category: Training
tags: [Railway]
requirements: See supplied README.
draft: false
id: unwanted-id
---

## What is included

[Setup](./scripts/setup.sh)

## Validation evidence

Not verified. No compilation or runtime tests were run by this generator.
`;
const reply = (text = validArticle, finish = 'stop') => new Response(JSON.stringify({choices: [{finish_reason: finish, message: {content: text}}]}), {headers: {'Content-Type': 'application/json'}});

async function fixture(t, article = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'llm-article-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const directory = path.join(root, 'scenarios/railway');
  await mkdir(path.join(directory, 'scripts'), {recursive: true});
  await mkdir(path.join(directory, 'artifact'), {recursive: true});
  await writeFile(path.join(directory, 'scenario.cradle'), 'scenario Railway {}');
  await writeFile(path.join(directory, 'README.md'), 'Railway exercise.');
  await writeFile(path.join(directory, 'scripts/setup.sh'), 'echo setup');
  await writeFile(path.join(directory, 'artifact/data.bin'), Buffer.from([0, 128, 255]));
  await writeFile(path.join(directory, 'image.png'), Buffer.from([0, 128, 255]));
  await writeFile(path.join(directory, 'cradle.toml'), 'excluded_toml = true');
  await writeFile(path.join(directory, '.env'), 'PRIVATE_FILE=do-not-send');
  if (article) await writeFile(path.join(directory, 'index.md'), 'Original article');
  await writeFile(path.join(root, '.env'), 'SERVER=https://example.test/v1\nREMOTE_LLM_MODEL=test-model\nREMOTE_LLM_API_KEY=test-secret\n');
  return {root, directory};
}

test('loads CTI-demo .env names, preserves shell overrides, and selects remote credentials', async (t) => {
  const {root} = await fixture(t);
  const env = {REMOTE_LLM_MODEL: 'shell-model', OPENAI_API_KEY: 'wrong-provider'};
  await loadLlmEnv(path.join(root, '.env'), env);
  assert.equal(env.REMOTE_LLM_MODEL, 'shell-model');
  assert.deepEqual(llmConfig(env), {baseUrl: 'https://example.test/v1', apiKey: 'test-secret', model: 'shell-model', remote: true});
  assert.throws(() => llmConfig({}), /OPENAI_API_KEY/);
  assert.throws(() => llmConfig({LOCAL_LLM_MODEL: 'local-hf-model'}), /Serve the local model/);
});

test('discovers a remote model and sends the expected authenticated chat request', async () => {
  const requests = [];
  const result = await completeArticle([{role: 'user', content: 'Write an article'}], {
    env: {SERVER: 'https://example.test/v1/', REMOTE_LLM_API_KEY: 'test-secret'},
    fetchImpl: async (url, options) => {
      requests.push({url, options});
      return url.endsWith('/models') ? new Response(JSON.stringify({data: [{id: 'discovered-model'}]})) : reply();
    },
  });
  assert.equal(result.model, 'discovered-model');
  assert.equal(requests[0].url, 'https://example.test/v1/models');
  assert.equal(requests[1].url, 'https://example.test/v1/chat/completions');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-secret');
  assert.equal(JSON.parse(requests[1].options.body).model, 'discovered-model');
});

test('collects source/readme/scripts with image names only and excludes TOML, hidden and binary content', async (t) => {
  const {directory} = await fixture(t);
  const context = await collectScenarioContext(directory);
  assert.ok(context.inventory.includes('image.png'));
  assert.ok(!context.inventory.includes('cradle.toml'));
  assert.ok(!context.inventory.includes('.env'));
  assert.ok(context.contents.some((item) => item.path === 'scenario.cradle'));
  assert.ok(context.contents.some((item) => item.path === 'scripts/setup.sh'));
  assert.ok(!context.contents.some((item) => /\.(png|bin)$/.test(item.path)));
  await writeFile(path.join(directory, 'README.md'), '\\"'.repeat(30000));
  const bounded = await collectScenarioContext(directory, 5000);
  assert.ok(bounded.contents.some((item) => item.truncated));
  assert.ok(JSON.stringify(bounded).length < 5500);
});

test('generates a validated draft and preserves source assets', async (t) => {
  const {root, directory} = await fixture(t);
  let request;
  const result = await generateScenarioArticle('railway', {
    sourceRoot: root, overwrite: true, env: {},
    fetchImpl: async (url, options) => {request = {url, options}; return reply();},
  });
  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  const prompt = JSON.parse(request.options.body);
  assert.match(prompt.messages[0].content, /untrusted reference data/);
  const sent = JSON.parse(prompt.messages[1].content);
  assert.ok(sent.contents.some((file) => file.text === 'scenario Railway {}'));
  const article = await readFile(result.filename, 'utf8');
  const data = parseDocument(article.match(/^---\n([\s\S]*?)\n---/)[1]).toJS();
  assert.equal(data.draft, true);
  assert.equal(data.id, undefined);
  assert.match(article, /article generator did not run compiler/);
  assert.match(article, /\[Download the specification\]\(\.\/scenario\.cradle\)/);
  assert.equal(await readFile(path.join(directory, 'scenario.cradle'), 'utf8'), 'scenario Railway {}');
  assert.ok(!(await readdir(directory)).some((file) => file.endsWith('.tmp')));
});

test('accepts articles following model reasoning, introductory text and Markdown wrappers', async (t) => {
  const {directory} = await fixture(t);
  for (const text of [
    `<think>Check the supplied specification first.</think>\n${validArticle}`,
    `Here is the requested article:\n\n${validArticle}`,
    `Here is the article:\n\n\`\`\`markdown\n${validArticle}\n\`\`\``,
    `\uFEFF\`\`\`md\n${validArticle}\n\`\`\``,
  ]) {
    const article = await prepareArticle(text, directory);
    assert.ok(article.startsWith('---\ntitle: Railway'));
    assert.doesNotMatch(article, /<think>|Here is|\n```$/);
  }
  await assert.rejects(prepareArticle('# Article without front matter', directory), /missing YAML/);
});

test('requests a single format correction when the first response lacks front matter', async (t) => {
  const {root} = await fixture(t);
  const requests = [];
  const result = await generateScenarioArticle('railway', {
    sourceRoot: root, overwrite: true, env: {},
    fetchImpl: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1 ? reply('# Railway\n\nArticle without YAML.') : reply(validArticle);
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-2).role, 'assistant');
  assert.match(requests[1].messages.at(-1).content, /missing YAML front matter/);
  assert.match(await readFile(result.filename, 'utf8'), /title: Railway/);
});

test('preserves articles on refusal, HTTP errors, malformed output, missing links and truncated responses', async (t) => {
  const {root, directory} = await fixture(t);
  const run = (fetchImpl, overwrite = true) => generateScenarioArticle('railway', {sourceRoot: root, overwrite, env: {}, fetchImpl});
  await assert.rejects(run(() => {throw new Error('must not request');}, false), /already exists/);
  for (const fetchImpl of [
    async () => new Response('secret-error-body', {status: 401}),
    async () => reply('not an article'),
    async () => reply(validArticle.replace('./scripts/setup.sh', '../outside.sh')),
    async () => reply(validArticle.replace('./scripts/setup.sh', './missing.sh')),
    async () => reply(validArticle, 'length'),
    async () => new Response('invalid json'),
  ]) {
    await assert.rejects(run(fetchImpl));
    assert.equal(await readFile(path.join(directory, 'index.md'), 'utf8'), 'Original article');
  }
});

test('does not overwrite edits made while generation is running', async (t) => {
  const {root, directory} = await fixture(t);
  await assert.rejects(generateScenarioArticle('railway', {
    sourceRoot: root, overwrite: true, env: {},
    fetchImpl: async () => {await writeFile(path.join(directory, 'index.md'), 'Newer user edit'); return reply();},
  }), /changed during generation/);
  assert.equal(await readFile(path.join(directory, 'index.md'), 'utf8'), 'Newer user edit');
});

test('creates a missing article without --force and accepts the import generation flag', async (t) => {
  const {root} = await fixture(t, false);
  const result = await generateScenarioArticle('railway', {sourceRoot: root, env: {}, fetchImpl: async () => reply()});
  assert.match(await readFile(result.filename, 'utf8'), /title: Railway/);
  assert.equal(parseLibraryArgs(['scenario', 'railway', '--from', 'source', '--generate-index']).options.generateIndex, true);
  assert.throws(() => parseLibraryArgs(['scenario', 'railway', '--generate-index', '--generate-index']), /repeated/);
});

test('generates a native README scenario article using its named CRADLE entrypoint', async (t) => {
  const {root} = await fixture(t);
  const directory = path.join(root, 'scenarios/native');
  await mkdir(directory);
  await writeFile(path.join(directory, 'README.md'), '---\nid: native\ntitle: Native\ndescription: Native example\nentrypoint: HelloWorld.cradle\n---\nNative source\n');
  await writeFile(path.join(directory, 'HelloWorld.cradle'), 'metadata() > name("Native").');
  const result = await generateScenarioArticle('native', {sourceRoot: root, env: {}, fetchImpl: async (url, options) => {
    const prompt = JSON.parse(options.body);
    assert.match(prompt.messages[0].content, /HelloWorld\.cradle/);
    return reply(validArticle.replace('[Setup](./scripts/setup.sh)', 'No setup script is supplied.'));
  }});
  const article = await readFile(result.filename, 'utf8');
  assert.match(article, /\[Download the specification\]\(\.\/HelloWorld\.cradle\)/);
  assert.doesNotMatch(article, /\.\/scenario\.cradle/);
});

test('import can generate a draft, preserves authored articles, and retains copied files on API failure', async (t) => {
  const {root} = await fixture(t);
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'scripts'), {recursive: true});
  await writeFile(path.join(source, 'range.cradle'), 'scenario Railway {}');
  await writeFile(path.join(source, 'scripts/setup.sh'), 'echo setup');
  const keys = ['SERVER', 'REMOTE_LLM_MODEL', 'REMOTE_LLM_API_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {for (const key of keys) {if(previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}});
  process.env.SERVER = 'https://example.test/v1';
  process.env.REMOTE_LLM_MODEL = 'test-model';
  process.env.REMOTE_LLM_API_KEY = 'test-secret';
  const request = t.mock.method(globalThis, 'fetch', async () => reply());
  await createLibraryEntry('scenario', 'generated', {root, from: source, generateIndex: true});
  assert.match(await readFile(path.join(root, 'scenarios/generated/index.md'), 'utf8'), /title: Railway/);
  assert.equal(request.mock.callCount(), 1);
  await writeFile(path.join(source, 'index.md'), 'Authored article');
  await createLibraryEntry('scenario', 'authored', {root, from: source, generateIndex: true});
  assert.equal(request.mock.callCount(), 1);
  assert.equal(await readFile(path.join(root, 'scenarios/authored/index.md'), 'utf8'), 'Authored article');
  await rm(path.join(source, 'index.md'));
  request.mock.mockImplementation(async () => new Response('', {status: 503}));
  await assert.rejects(createLibraryEntry('scenario', 'failed', {root, from: source, generateIndex: true}), /Copied files and starter article are preserved/);
  assert.equal(await readFile(path.join(root, 'scenarios/failed/scenario.cradle'), 'utf8'), 'scenario Railway {}');
  assert.match(await readFile(path.join(root, 'scenarios/failed/index.md'), 'utf8'), /draft: true/);
});
