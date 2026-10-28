import {lstat, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';

const aliases = {
  'ubuntu-focal-auditd': 'linux-auditd', 'ubuntu-focal-mail': 'linux-mail',
  'ubuntu-focal-python3': 'linux-python3', 'ubuntu-focal-smb': 'linux-smb',
  'ubuntu-focal-mysql': 'linux-mysql', 'ubuntu-focal-apache2': 'linux-apache2',
  'ubuntu-focal-netcat': 'linux-netcat', 'ubuntu-focal-docker': 'linux-docker',
  'win-custom-routing': 'win-routing',
};
const builtins = new Set(['linux-routing', 'win-routing']);
const localFolders = ['configs', 'config', 'configurations', 'configuration'];
const safeName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const within = (root, filename) => {
  const relative = path.relative(root, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

// Read lexical references only; cxc validate remains the syntax/structure authority.
// Strings and all three CRADLE comment forms are consumed before identifiers.
function tokens(source) {
  const result = [];
  let offset = 0;
  let line = 1;
  const consume = (length) => {line += (source.slice(offset, offset + length).match(/\n/g) || []).length; offset += length;};
  while (offset < source.length) {
    const rest = source.slice(offset);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {consume(whitespace[0].length); continue;}
    if (rest.startsWith('//') || rest.startsWith('#')) {const end = rest.indexOf('\n'); consume(end < 0 ? rest.length : end); continue;}
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      if (end < 0) throw new Error(`Unterminated block comment at line ${line}`);
      consume(end + 2); continue;
    }
    if (rest[0] === '"') {
      const quoted = rest.match(/^"(?:\\["\\ntr]|[^"\\])*"/);
      if (!quoted) throw new Error(`Unterminated/invalid string at line ${line}`);
      // CRADLE permits literal newlines inside strings, unlike JSON.
      const value = quoted[0].slice(1, -1).replace(/\\(["\\ntr])/g, (_, char) => ({n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\'}[char]));
      result.push({type: 'string', value, line}); consume(quoted[0].length); continue;
    }
    const identifier = rest.match(/^[A-Za-z][A-Za-z0-9_-]*/);
    const value = identifier ? identifier[0] : rest[0];
    result.push({type: identifier ? 'identifier' : 'punctuation', value, line});
    consume(value.length);
  }
  return result;
}

export async function collectContentReferences(entryRoot, {entrypoint = 'scenario.cradle'} = {}) {
  const root = await realpath(entryRoot);
  const visited = new Set();
  const references = {configs: [], heuristics: []};
  async function visit(filename) {
    const resolved = await realpath(filename);
    if (!within(root, resolved)) throw new Error(`CRADLE include/source escapes the scenario folder: ${filename}`);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (!(await lstat(resolved)).isFile()) throw new Error(`CRADLE source is not a regular file: ${filename}`);
    const stream = tokens(await readFile(resolved, 'utf8'));
    for (let i = 0; i < stream.length; i++) {
      const token = stream[i];
      if (token.type !== 'identifier') continue;
      if (token.value === 'include' && stream[i + 1]?.type === 'string') {
        await visit(path.resolve(path.dirname(resolved), stream[i + 1].value));
      }
      if (token.value === 'config' && stream[i + 1]?.value === '(') {
        const name = stream[i + 2];
        if (name?.type !== 'string' || stream[i + 3]?.value !== ')') throw new Error(`${resolved}:${token.line}: config() must have one literal string argument`);
        if (!safeName.test(name.value) || name.value === '.' || name.value === '..') throw new Error(`${resolved}:${token.line}: unsafe config name`);
        references.configs.push({name: name.value, file: path.relative(root, resolved).split(path.sep).join('/'), line: token.line});
      }
      if (token.value === 'heuristic' && stream[i + 1]?.value === '(') {
        const framework = stream[i + 2];
        const value = stream[i + 4];
        if (framework?.type !== 'string' || stream[i + 3]?.value !== ',' || value?.type !== 'string' || stream[i + 5]?.value !== ')') throw new Error(`${resolved}:${token.line}: heuristic() must have two literal string arguments`);
        if (![framework.value, value.value].every((part) => safeName.test(part) && part !== '.' && part !== '..')) throw new Error(`${resolved}:${token.line}: unsafe heuristic framework/value`);
        references.heuristics.push({framework: framework.value.toLowerCase(), value: value.value, file: path.relative(root, resolved).split(path.sep).join('/'), line: token.line});
      }
    }
  }
  await visit(path.resolve(root, entrypoint));
  return references;
}

export async function collectConfigReferences(entryRoot) {
  return (await collectContentReferences(entryRoot)).configs;
}

export async function exists(filename) {
  try {return await lstat(filename);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}

export async function templateUnder(base, name) {
  // No symlinked directories/templates: don't resolve outside checked-out content.
  const module = path.join(base, name);
  const info = await exists(module);
  if (!info) return null;
  if (!info.isDirectory()) throw new Error(`${module}: expected a regular module directory`);
  const ansible = path.join(module, 'ansible');
  if (!(await exists(ansible))?.isDirectory()) throw new Error(`${module}: missing regular ansible directory`);
  for (const extension of ['j2', 'yml', 'yaml']) {
    const filename = path.join(ansible, `${name}.${extension}`);
    const stat = await exists(filename);
    if (!stat) continue;
    if (!stat.isFile() || !stat.size) throw new Error(`${filename}: module template must be a non-empty regular file`);
    return filename;
  }
  throw new Error(`${module}: missing ansible/${name}.j2 (or .yml/.yaml)`);
}

export async function resolveConfigReferences(entryRoot, libraryRoot, references) {
  const sharedConfigs = path.join(libraryRoot, 'configs');
  if (!(await lstat(sharedConfigs)).isDirectory()) throw new Error('cradle-lib must contain a regular configs directory');
  const directories = [];
  for (const folder of localFolders) {
    const directory = path.join(entryRoot, folder);
    const info = await exists(directory);
    if (!info) continue;
    if (!info.isDirectory()) throw new Error(`${directory}: expected a regular config directory`);
    directories.push({base: directory, source: `scenario/${folder}`});
  }
  directories.push({base: sharedConfigs, source: 'cradle-lib/configs'});
  const resolutions = [];
  for (const original of [...new Set(references.map((reference) => reference.name))].sort()) {
    const name = Object.hasOwn(aliases, original) ? aliases[original] : original;
    const requiredBy = [...new Set(references.filter((ref) => ref.name === original).map((ref) => ref.requiredBy || (ref.file ? `${ref.file}:${ref.line}` : 'source')))];
    const resolution = {name: original, canonical: name, source: null, template: null, requiredBy};
    if (builtins.has(name)) resolution.source = 'cxc built-in';
    else {
      for (const {base, source} of directories) {
        const template = await templateUnder(base, name);
        if (template) {resolution.source = source; resolution.template = path.relative(base, template).split(path.sep).join('/'); break;}
      }
    }
    resolutions.push(resolution);
  }
  return resolutions;
}
