import {cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const kinds = {scenario: 'scenarios', configuration: 'configurations', heuristic: 'heuristics'};
const excluded = new Set(['.git', 'node_modules', '__pycache__']);
const scenarioFolders = new Set(['config', 'configs', 'configuration', 'configurations', 'heuristic', 'heuristics', 'artifact', 'artifacts', 'script', 'scripts', 'img', 'imgs', 'image', 'images']);

function shouldImport(filename, source, kind) {
  const parts = path.relative(source, filename).split(path.sep);
  if (parts.some((part) => excluded.has(part) || /\.toml$/i.test(part))) return false;
  if (kind !== 'scenario') return true;
  const top = parts[0].toLowerCase();
  return scenarioFolders.has(top) || (parts.length === 1 && (
    /\.cradle$/i.test(top) || /^readme(?:\.(?:md|mdx|txt|rst))?$/.test(top) ||
    /^index\.mdx?$/.test(top) || /\.(?:png|jpe?g|webp|gif|svg|avif|bmp|tiff?|ico)$/.test(top) ||
    /\.(?:sh|bash|ps1|bat|cmd|py|js|mjs)$/.test(top)
  ));
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function validateTree(directory, source, kind) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (!shouldImport(filename, source, kind)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Cannot import symbolic link: ${filename}. Replace it with the actual file or directory.`);
    if (entry.isDirectory()) await validateTree(filename, source, kind);
    else if (!entry.isFile()) throw new Error(`Cannot import a non-regular file: ${filename}`);
  }
}

export function parseLibraryArgs(args) {
  const [kind, slug, ...flags] = args;
  const options = {mdx: false};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--mdx' && !options.mdx) options.mdx = true;
    else if (flags[i] === '--generate-index' && !options.generateIndex) options.generateIndex = true;
    else if (flags[i] === '--from' && options.from === undefined && flags[i + 1] && !flags[i + 1].startsWith('--')) options.from = flags[++i];
    else throw new Error(`Unknown, repeated or incomplete option: ${flags[i]}. Use --mdx, --generate-index and/or --from <directory>.`);
  }
  return {kind, slug, options};
}

export async function createLibraryEntry(kind, slug, {root = siteRoot, mdx = false, from, generateIndex = false} = {}) {
  if (!Object.hasOwn(kinds, kind) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) {
    throw new Error('Use scenario, configuration or heuristic, followed by a lowercase folder name with hyphens.');
  }
  if (generateIndex && (kind !== 'scenario' || from === undefined)) throw new Error('--generate-index requires scenario and --from <directory> with working source.');
  const relative = kind === 'scenario' ? `scenarios/${slug}` : `library/${kinds[kind]}/${slug}`;
  const destination = path.resolve(root, relative);
  // Check before inspecting a source so an existing entry is never changed.
  if (await lstat(destination).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  })) throw Object.assign(new Error('EEXIST: That library entry already exists; its files have not been changed.'), {code: 'EEXIST'});

  let source;
  let specification;
  let importedArticle;
  if (from !== undefined) {
    source = await realpath(path.resolve(from));
    if (!(await lstat(source)).isDirectory()) throw new Error('--from must point to a directory.');
    // Resolve existing ancestors, including junctions, before comparing paths.
    let ancestor = path.dirname(destination);
    const suffix = [path.basename(destination)];
    while (!(await lstat(ancestor).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }))) {
      suffix.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
    const resolvedDestination = path.join(await realpath(ancestor), ...suffix);
    if (contains(source, resolvedDestination) || contains(resolvedDestination, source)) {
      throw new Error('Source and destination directories must not contain one another.');
    }
    await validateTree(source, source, kind);
    const files = await readdir(source, {withFileTypes: true});
    const articles = files.filter((file) => /^index\.mdx?$/.test(file.name));
    if (articles.length > 1 || articles.some((file) => !file.isFile())) throw new Error('The source must contain at most one article: index.md or index.mdx.');
    importedArticle = articles[0]?.name;
    if (kind === 'scenario') {
      const canonical = files.find((file) => file.name === 'scenario.cradle');
      const candidates = files.filter((file) => file.isFile() && file.name.endsWith('.cradle'));
      if (canonical && !canonical.isFile()) throw new Error('scenario.cradle must be a file.');
      if (canonical) specification = canonical.name;
      else if (candidates.length === 1) specification = candidates[0].name;
      else throw new Error('The source must contain one top-level .cradle file, or name the main specification scenario.cradle when there are multiple.');
      if (!(await readFile(path.join(source, specification), 'utf8')).trim()) throw new Error('The main scenario specification must not be empty.');
    }
  }

  await mkdir(path.dirname(destination), {recursive: true});
  // Reserve a new entry, failing if another process created it in the meantime.
  await mkdir(destination);
  try {
    if (source) {
      for (const file of await readdir(source)) {
        if (!shouldImport(path.join(source, file), source, kind)) continue;
        await cp(path.join(source, file), path.join(destination, file), {
          recursive: true, force: false, errorOnExist: true,
          filter: (filename) => shouldImport(filename, source, kind),
        });
      }
      if (specification && specification !== 'scenario.cradle') {
        await rename(path.join(destination, specification), path.join(destination, 'scenario.cradle'));
      }
    }
    if (!importedArticle) {
      const template = path.join(siteRoot, 'library/_templates', kind);
      for (const file of await readdir(template)) {
        if (source && file === 'scenario.cradle') continue;
        await cp(path.join(template, file), path.join(destination, file), {recursive: true, force: false, errorOnExist: true});
      }
      const article = path.join(destination, 'index.md');
      let markdown = await readFile(article, 'utf8');
      const title = slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
      markdown = markdown.replace(/^title: .+$/m, `title: ${JSON.stringify(title)}`);
      if (kind === 'configuration') markdown = markdown.replace(/^config: .+$/m, `config: ${slug}`);
      await writeFile(article, markdown);
    }
    if (mdx && importedArticle !== 'index.mdx') await rename(path.join(destination, 'index.md'), path.join(destination, 'index.mdx'));
  } catch (error) {
    // Only remove the new directory reserved by this invocation.
    await rm(destination, {recursive: true, force: true});
    throw error;
  }
  if (generateIndex && !importedArticle) {
    try {
      const {generateScenarioArticle} = await import('./generate-scenario-article.mjs');
      const result = await generateScenarioArticle(slug, {sourceRoot: root, overwrite: true});
      console.log(`Generated draft article with ${result.model}; ${result.omitted} text files omitted, ${result.truncated} truncated. Review before publication.`);
    } catch (error) {
      throw new Error(`Created ${relative}, but article generation failed: ${error.message} Copied files and starter article are preserved. Retry: npm run library:describe -- ${slug} --force`);
    }
  } else if (generateIndex && importedArticle) console.log('Preserved the imported article; use library:describe with --force to regenerate it.');
  return relative;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {kind, slug, options} = parseLibraryArgs(process.argv.slice(2));
    const relative = await createLibraryEntry(kind, slug, options);
    if (kind === 'scenario' && await lstat(path.join(siteRoot, 'catalog.json')).catch(() => null)) {
      try {await (await import('./catalog.mjs')).refreshExistingCatalog(siteRoot);}
      catch (error) {console.warn(`Entry created; catalogue refresh needs attention: ${error.message}`);}
    }
    console.log(`Created ${relative}. Review index.md/index.mdx and linked files; generated articles start as drafts. Set draft: false when ready.`);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'That library entry already exists; its files have not been changed.' : error.message);
    console.error('Usage: npm run library:new -- <scenario|configuration|heuristic> <lowercase-folder-name> [--mdx] [--from <directory>] [--generate-index]');
    process.exitCode = 1;
  }
}
