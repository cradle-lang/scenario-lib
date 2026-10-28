import {lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument, stringify} from 'yaml';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {readScenario, websiteArticle} from './scenario-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'cradle-lang/scenario-lib';
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const inside = (parent, child) => {const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);};

export async function exportArticle(article, {sourceRoot, entryRoot, revision, entrypoint = path.join(entryRoot, 'scenario.cradle')}) {
  const match = article.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${entryRoot}: article needs YAML front matter`);
  const document = parseDocument(match[1], {uniqueKeys: true});
  if (document.errors.length) throw new Error(`${entryRoot}: invalid article YAML`);
  const data = document.toJS({maxAliasCount: 50});
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Article front matter must be a mapping');
  for (const key of ['title', 'description']) if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`Article requires ${key}`);
  if (data.draft !== undefined && typeof data.draft !== 'boolean') throw new Error('Article draft must be a boolean');
  // The website copy contains exactly two files. Keep source artwork in the
  // library and let the website select its built-in card illustration.
  delete data.thumbnail;
  delete data.thumbnailAlt;
  const sourceUrl = `https://github.com/${repository}/tree/${revision}/${path.relative(sourceRoot, entryRoot).split(path.sep).map(encodeURIComponent).join('/')}`;
  if (!data.sourceUrl) data.sourceUrl = sourceUrl;
  const body = article.replace(/^\uFEFF/, '').slice(match[0].length);
  const tree = fromMarkdown(body);
  const replacements = [];
  const definitions = new Map();
  const mapped = new Map();
  const labelText = (node) => node.type === 'image' ? node.alt || 'Image' : node.value ?? (node.children || []).map(labelText).join('');
  const escapedLabel = (text) => text.replace(/[\\\[\]]/g, '\\$&');
  async function mapUrl(url) {
    if (mapped.has(url)) return mapped.get(url);
    if (/^(?:https?:|mailto:|#|\/)/i.test(url)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error(`Unsupported article link protocol: ${url.split(':')[0]}`);
    const target = url.match(/^([^?#]*)([?#].*)?$/);
    let decoded;
    try {decoded = decodeURIComponent(target[1]);} catch {throw new Error('Invalid URL encoding in article link');}
    const filename = path.resolve(entryRoot, decoded);
    if (!inside(sourceRoot, filename)) throw new Error('Article link escapes the source repository');
    const info = await lstat(filename).catch(() => null);
    if (!info || info.isSymbolicLink() || !inside(sourceRoot, await realpath(filename))) throw new Error(`Missing/unsafe linked source file: ${url}`);
    if (filename === entrypoint && filename !== path.join(entryRoot, 'scenario.cradle')) return `./scenario.cradle${target[2] || ''}`;
    if (filename === entrypoint || filename === path.join(entryRoot, 'index.md')) return null;
    const relative = path.relative(sourceRoot, filename).split(path.sep).map(encodeURIComponent).join('/');
    const result = `https://github.com/${repository}/${info.isDirectory() ? 'tree' : 'blob'}/${revision}/${relative}${target[2] || ''}`;
    mapped.set(url, result);
    return result;
  }
  function indexDefinitions(node) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    for (const child of node.children || []) indexDefinitions(child);
  }
  indexDefinitions(tree);
  async function visit(node) {
    let text;
    if (node.type === 'link' || node.type === 'image') {
      const url = await mapUrl(node.url);
      if (url) {
        const label = escapedLabel(labelText(node) || 'Source file');
        // A private-repository image cannot be embedded in the public website.
        text = `[${label}${node.type === 'image' ? ' (source image)' : ''}](<${url}>)`;
      }
    } else if (node.type === 'definition') {
      const url = await mapUrl(node.url);
      if (url) text = `[${node.label || node.identifier}]: <${url}>${node.title ? ` ${JSON.stringify(node.title)}` : ''}`;
    } else if (node.type === 'imageReference' && definitions.has(node.identifier)) {
      if (await mapUrl(definitions.get(node.identifier))) text = `[${escapedLabel(node.alt || 'Image')} (source image)][${node.label || node.identifier}]`;
    } else if (node.type === 'html' && /(?:src|href)\s*=\s*["'](?!https?:|mailto:|#|\/)/i.test(node.value)) {
      throw new Error('Use Markdown links/images for local attachments before website export; relative HTML assets cannot be copied.');
    }
    if (text !== undefined) replacements.push({start: node.position.start.offset, end: node.position.end.offset, text});
    else for (const child of node.children || []) await visit(child);
  }
  await visit(tree);
  let rewritten = body;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, replacement.start) + replacement.text + rewritten.slice(replacement.end);
  if (!/\]\(\s*<?\.\/scenario\.cradle>?\s*\)/.test(rewritten)) rewritten += '\n\n[Download the specification](./scenario.cradle).\n';
  return `---\n${stringify(data)}---\n${rewritten.trimEnd()}\n\n[Full scenario folder and supporting files](<${sourceUrl}>). Supporting files remain in the source repository and may require GitHub access.\n`;
}

export async function exportWebsite({sourceRoot = root, revision} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(revision || '')) throw new Error('Website export requires the full source commit SHA');
  sourceRoot = path.resolve(sourceRoot);
  const directory = path.join(sourceRoot, 'scenarios');
  for (const parent of [directory]) if (!(await lstat(parent)).isDirectory()) throw new Error('Scenario parent must be a regular directory');
  const bundle = {schemaVersion: 1, sourceRepository: repository, sourceRevision: revision, scenarios: []};
  for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.gitkeep') continue;
    if (!entry.isDirectory() || !slug.test(entry.name)) throw new Error(`Invalid scenario folder: ${entry.name}`);
    const entryRoot = path.join(directory, entry.name);
    if ((await readdir(entryRoot)).includes('index.mdx')) throw new Error(`${entry.name}: website sync needs index.md (use index.md rather than MDX)`);
    const scenario = await readScenario(entryRoot);
    const spec = await readFile(scenario.entrypoint, 'utf8');
    if (!spec.trim()) throw new Error(`${entry.name}: empty CRADLE source`);
    const article = await exportArticle(websiteArticle(scenario), {sourceRoot, entryRoot, revision, entrypoint: scenario.entrypoint});
    bundle.scenarios.push({id: entry.name, spec, article});
  }
  return bundle;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const revision = process.env.SOURCE_REVISION || process.env.GITHUB_SHA;
    const bundle = await exportWebsite({revision, sourceRoot: process.env.SOURCE_ROOT || root});
    const output = path.join(root, 'website-export/bundle.json');
    await mkdir(path.dirname(output), {recursive: true});
    await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`);
    console.log(`Exported ${bundle.scenarios.length} scenario(s), each containing only scenario.cradle and index.md.`);
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
