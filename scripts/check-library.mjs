import {lstat, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';
import {readScenario, websiteArticle, optionalStat} from './scenario-layout.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
const kinds = ['scenarios', 'configurations', 'heuristics'];
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

async function inspectTree(directory) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`${filename}: symbolic links are not supported`);
    if (item.isDirectory()) await inspectTree(filename);
    else if (!item.isFile()) throw new Error(`${filename}: expected a regular file`);
  }
}

export async function readLibrary(sourceRoot = root) {
  const legacy = await optionalStat(path.join(sourceRoot, 'library'));
  if (legacy && !legacy.isDirectory()) throw new Error('library must be a regular directory');
  const result = {scenarios: [], configurations: [], heuristics: []};
  for (const kind of kinds) {
    const directory = path.join(sourceRoot, ...(kind === 'scenarios' ? [] : ['library']), kind);
    const info = await optionalStat(directory);
    if (!info) continue;
    if (!info.isDirectory()) throw new Error(`${directory}: expected a regular directory`);
    const folders = await readdir(directory, {withFileTypes: true});
    for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
      if (folder.name === '.gitkeep') continue;
      const entryRoot = path.join(directory, folder.name);
      const articleError = (message) => {throw new Error(`${entryRoot}: ${message}`);};
      if (!folder.isDirectory() || !slug.test(folder.name)) articleError('expected a lowercase entry directory using letters, digits and hyphens');
      await inspectTree(entryRoot);
      let scenario;
      let articlePath;
      let article;
      if (kind === 'scenarios') {
        scenario = await readScenario(entryRoot, {requireEntrypoint: false});
        articlePath = scenario.articlePath;
        article = path.basename(articlePath) === 'README.md' ? websiteArticle(scenario) : scenario.markdown;
      } else {
        const indexes = (await readdir(entryRoot)).filter(name => /^index\.mdx?$/.test(name));
        if (indexes.length !== 1) articleError('add exactly one index.md or index.mdx');
        articlePath = path.join(entryRoot, indexes[0]);
        article = await readFile(articlePath, 'utf8');
      }
      const match = article.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) articleError('article must start with YAML front matter');
      const document = parseDocument(match[1], {uniqueKeys: true});
      if (document.errors.length) articleError(document.errors.map(error => error.message).join('; '));
      const data = document.toJS({maxAliasCount: 50});
      if (!data || typeof data !== 'object' || Array.isArray(data)) articleError('front matter must be a mapping');
      const required = (key) => {
        if (typeof data[key] !== 'string' || !data[key].trim()) articleError(`${key} must be a non-empty string`);
        return data[key].trim();
      };
      const title = required('title');
      const description = required('description');
      if (data.id !== undefined || data.slug !== undefined) articleError('remove id/slug; the folder determines the ID');
      if (data.draft !== undefined && typeof data.draft !== 'boolean') articleError('draft must be true or false');
      if (data.draft === true) continue;
      const asset = async (target, {fileOnly = true} = {}) => {
        let decoded;
        try {decoded = decodeURIComponent(target.split(/[?#]/)[0]);} catch {articleError(`invalid URL encoding: ${target}`);}
        const filename = path.resolve(entryRoot, decoded);
        if (!decoded || !inside(entryRoot, filename)) articleError(`asset must stay inside the entry: ${target}`);
        const info = await lstat(filename).catch(() => null);
        if (!info || (!info.isFile() && (fileOnly || !info.isDirectory()))) articleError(`missing linked file: ${target}`);
        return path.relative(sourceRoot, filename).split(path.sep).join('/');
      };
      const entry = {id: folder.name, title, description, article: path.relative(sourceRoot, articlePath).split(path.sep).join('/')};
      if (data.sourceUrl !== undefined) {
        const url = required('sourceUrl');
        if (!/^https:\/\//.test(url)) articleError('sourceUrl must use HTTPS');
        entry.sourceUrl = url;
      }
      if (kind === 'scenarios') {
        for (const key of ['source', 'category', 'requirements']) entry[key] = required(key);
        if (!Array.isArray(data.tags) || !data.tags.length || !data.tags.every((tag) => typeof tag === 'string' && tag.trim())) articleError('tags must be a non-empty list of strings');
        entry.tags = data.tags;
        if (!scenario.entrypoint) articleError('add a .cradle entrypoint');
        const sourceLink = './' + path.relative(entryRoot, scenario.entrypoint).split(path.sep).join('/');
        entry.sourcePath = await asset(sourceLink);
        const specification = await readFile(scenario.entrypoint, 'utf8');
        if (!specification.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '').trim()) articleError('replace the empty/comment-only scenario.cradle stub');
        if (path.basename(articlePath) !== 'README.md' && !article.includes(`](${sourceLink})`) && !article.includes(`](<${sourceLink}>)`)) articleError(`link the specification using [Download the specification](${sourceLink})`);
        entry.artwork = data.artwork ?? 'auto';
        if (!['auto', 'network', 'enterprise', 'monitoring'].includes(entry.artwork)) articleError('invalid artwork choice');
        if (data.thumbnail !== undefined) {
          const thumbnail = required('thumbnail');
          if (!/\.(png|jpe?g|webp|gif)$/i.test(thumbnail)) articleError('thumbnail must be PNG, JPEG, WebP or GIF');
          entry.thumbnail = await asset(thumbnail);
          entry.thumbnailAlt = required('thumbnailAlt');
        }
        if (data.deployment !== undefined) articleError('remove deployment metadata; this library validates and compiles only');
      } else if (kind === 'configurations') {
        entry.config = required('config');
        entry.os = required('os');
        if (!['Linux', 'Windows', 'Cross-platform', 'Unspecified'].includes(entry.os)) articleError('invalid os value');
        entry.category = data.category ?? 'Other';
      } else {
        entry.framework = required('framework').toLowerCase();
        entry.identifier = required('identifier');
      }
      // Check ordinary inline Markdown file/image links. MDX is retained as source,
      // never evaluated. Reference-style links and MDX imports need author review.
      const body = article.slice(match[0].length).replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '');
      for (const link of body.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
        const target = link[1] ?? link[2];
        if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
        await asset(target, {fileOnly: false});
      }
      result[kind].push(entry);
    }
    const keys = result[kind].map((entry) => kind === 'configurations' ? entry.config : kind === 'heuristics' ? `${entry.framework}:${entry.identifier.toLowerCase()}` : entry.id);
    if (new Set(keys).size !== keys.length) throw new Error(`library/${kind}: duplicate configuration key or heuristic framework/identifier`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const catalog = await readLibrary();
    if (process.argv.includes('--catalog')) {
      await mkdir(path.join(root, 'dist'), {recursive: true});
      await writeFile(path.join(root, 'dist/catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
    }
    console.log(`Checked library: ${kinds.map((kind) => `${catalog[kind].length} published ${kind}`).join(', ')}. Drafts excluded.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
