import {lstat, readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {parseDocument, stringify} from 'yaml';

export const sourceRepository = 'cradle-lang/scenario-lib';
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const inside = (parent, child) => {const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);};
export async function optionalStat(filename) {
  try {return await lstat(filename);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
export function frontMatter(article, filename) {
  const text = article.replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${filename}: missing YAML front matter`);
  const document = parseDocument(match[1], {uniqueKeys: true});
  if (document.errors.length) throw new Error(`${filename}: ${document.errors.map(error => error.message).join('; ')}`);
  const metadata = document.toJS({maxAliasCount: 50});
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error(`${filename}: front matter must be a mapping`);
  return {metadata, body: text.slice(match[0].length)};
}
export async function listScenarioEntries(sourceRoot) {
  const result = [];
  const seen = new Set();
  for (const relative of ['scenarios']) {
    const directory = path.resolve(sourceRoot, relative);
    const info = await optionalStat(directory);
    if (!info) continue;
    if (!info.isDirectory()) throw new Error(`${relative}: expected a regular directory`);
    if (relative.startsWith('library/') && !(await lstat(path.resolve(sourceRoot, 'library'))).isDirectory()) throw new Error('library must be a regular directory');
    for (const folder of await readdir(directory, {withFileTypes: true})) {
      if (folder.name === '.gitkeep') continue;
      if (!folder.isDirectory() || !slug.test(folder.name)) throw new Error(`Invalid scenario folder: ${folder.name}`);
      if (seen.has(folder.name)) throw new Error(`Duplicate scenario ID: ${folder.name}`);
      seen.add(folder.name);
      result.push({id: folder.name, entryRoot: path.join(directory, folder.name), native: relative === 'scenarios'});
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
export async function readScenario(entryRoot, {requireEntrypoint = true} = {}) {
  const id = path.basename(entryRoot);
  let readmeMetadata = {};
  let readmeMarkdown;
  const readme = path.join(entryRoot, 'README.md');
  const readmeInfo = await optionalStat(readme);
  if (readmeInfo) {
    if (!readmeInfo.isFile()) throw new Error(`${readme}: must be a regular file`);
    readmeMarkdown = await readFile(readme, 'utf8');
    if (readmeMarkdown.replace(/^\uFEFF/, '').startsWith('---')) {
      readmeMetadata = frontMatter(readmeMarkdown, readme).metadata;
      if (readmeMetadata.schema_version !== undefined && readmeMetadata.schema_version !== 1) throw new Error(`${readme}: unsupported schema_version`);
      if (readmeMetadata.schema_version === 1 && readmeMetadata.id !== id) throw new Error(`${readme}: id must match the folder`);
      if (readmeMetadata.id !== undefined && readmeMetadata.id !== id) throw new Error(`${readme}: id must match the folder`);
    }
  }
  const articles = (await readdir(entryRoot)).filter((name) => /^index\.mdx?$/.test(name));
  if (articles.length > 1) throw new Error(`${entryRoot}: keep exactly one index.md or index.mdx`);
  let articlePath = readme;
  let markdown = readmeMarkdown;
  let articleMetadata = {};
  if (articles.length) {
    articlePath = path.join(entryRoot, articles[0]);
    if (!(await lstat(articlePath)).isFile()) throw new Error(`${articlePath}: must be a regular file`);
    markdown = await readFile(articlePath, 'utf8');
    articleMetadata = frontMatter(markdown, articlePath).metadata;
    if (articleMetadata.id !== undefined || articleMetadata.slug !== undefined) throw new Error(`${articlePath}: remove id/slug; the folder supplies the ID`);
  } else if (!readmeMarkdown || !Object.keys(readmeMetadata).length) throw new Error(`${entryRoot}: add an index.md article or a README.md with metadata`);
  const metadata = {...readmeMetadata, ...articleMetadata};
  let entrypointName = metadata.entrypoint;
  if (entrypointName === undefined) {
    if ((await optionalStat(path.join(entryRoot, 'scenario.cradle')))?.isFile()) entrypointName = 'scenario.cradle';
    else {
      const files = (await readdir(entryRoot, {withFileTypes: true})).filter((file) => file.isFile() && file.name.endsWith('.cradle'));
      if (files.length === 1) entrypointName = files[0].name;
    }
  }
  if (entrypointName === undefined && !requireEntrypoint) return {id, metadata, entrypoint: null, entrypointName: null, articlePath, markdown};
  if (typeof entrypointName !== 'string' || !entrypointName.endsWith('.cradle') || path.isAbsolute(entrypointName)) throw new Error(`${entryRoot}: specify one relative .cradle entrypoint`);
  const entrypoint = path.resolve(entryRoot, entrypointName);
  if (!inside(path.resolve(entryRoot), entrypoint) || !(await lstat(entrypoint)).isFile() || !inside(await realpath(entryRoot), await realpath(entrypoint))) throw new Error(`${entryRoot}: missing or unsafe CRADLE entrypoint`);
  return {id, metadata, entrypoint, entrypointName, articlePath, markdown};
}
export function websiteArticle(scenario) {
  const {metadata, body} = frontMatter(scenario.markdown, scenario.articlePath);
  const data = {...scenario.metadata, ...metadata};
  for (const key of ['id', 'slug', 'schema_version', 'entrypoint', 'preview', 'version']) delete data[key];
  data.source ??= 'Not documented';
  data.category ??= 'Community';
  data.requirements ??= 'See the article and source README for runtime dependencies and local deployment settings.';
  return `---\n${stringify(data)}---\n${body}`;
}
