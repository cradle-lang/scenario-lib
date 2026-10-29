import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {exists, templateUnder} from './config-references.mjs';

const safeSegment = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) && value !== '.' && value !== '..';

export async function resolveHeuristicReferences(entryRoot, libraryRoot, references, cveLibraryRoot) {
  if (!references.length) return [];
  const directories = [];
  for (const folder of ['heuristics', 'heuristic']) {
    const base = path.join(entryRoot, folder);
    const info = await exists(base);
    if (!info) continue;
    if (!info.isDirectory()) throw new Error(`${base}: expected a regular heuristics directory`);
    directories.push({base, source: `scenario/${folder}`});
  }
  const unique = new Map();
  for (const reference of references) {
    if (!safeSegment(reference.framework) || !safeSegment(reference.value)) throw new Error('Unsafe heuristic framework/value');
    const framework = reference.framework.toLowerCase();
    unique.set(`${framework}/${reference.value}`, {framework, value: reference.value});
  }
  const result = [];
  for (const [identity, {framework, value}] of [...unique].sort(([a], [b]) => a.localeCompare(b))) {
    const item = {framework, value, source: null, template: null, manifest: null, configs: [], error: null};
    result.push(item);
    try {
      const shared = framework === 'cve' ? cveLibraryRoot : path.join(libraryRoot, 'heuristics');
      if (!shared) throw new Error('Provide --cve-library <cradle-lib-cve checkout>.');
      for (const {base, source, frameworkPath = path.join(base, framework)} of [
        ...directories,
        {base: shared, frameworkPath: framework === 'cve' ? shared : path.join(shared, framework), source: framework === 'cve' ? 'cradle-lib-cve' : 'cradle-lib/heuristics'},
      ]) {
        const info = await exists(frameworkPath);
        if (!info) continue;
        if (!info.isDirectory()) throw new Error(`${frameworkPath}: expected a regular framework directory`);
        // If a local module exists but is malformed, do not fall back to the shared module.
        const template = await templateUnder(frameworkPath, value);
        if (!template) continue;
        item.source = source;
        item.template = path.relative(base, template).split(path.sep).join('/');
        const filename = path.join(frameworkPath, value, 'manifest.json');
        if (!(await exists(filename))?.isFile()) throw new Error(`${identity}: missing regular manifest.json`);
        let manifest;
        try {manifest = JSON.parse(await readFile(filename, 'utf8'));} catch {throw new Error(`${identity}: invalid manifest.json`);}
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.framework !== framework || manifest.value !== value) throw new Error(`${identity}: manifest framework/value must match the module path`);
        const os = manifest.os ?? null;
        const version = manifest.os_version ?? null;
        if ((os === null) !== (version === null) || (os !== null && (typeof os !== 'string' || !os.trim() || typeof version !== 'string' || !version.trim()))) throw new Error(`${identity}: manifest os and os_version must both be non-empty strings or both be null/omitted`);
        const configs = manifest.configs === undefined ? [] : manifest.configs;
        if (!Array.isArray(configs) || !configs.every(safeSegment)) throw new Error(`${identity}: manifest configs must be an array of safe configuration names`);
        item.manifest = {framework, value, os, os_version: version};
        item.configs = [...new Set(configs)];
        break;
      }
      if (!item.source) item.error = `Missing heuristic: ${identity}`;
    } catch (error) {item.error = error.message;}
  }
  return result;
}
