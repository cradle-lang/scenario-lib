import {appendFile, lstat, mkdir, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {collectContentReferences, resolveConfigReferences, exists} from './config-references.mjs';
import {resolveHeuristicReferences} from './heuristic-references.mjs';
import {readScenario} from './scenario-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const escape = (value) => String(value).replace(/[&<>|`\r\n]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '`': '&#96;', '\r': ' ', '\n': ' '}[char]));
const gitRevision = (directory) => {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding: 'utf8', timeout: 10000});
  return result.status === 0 ? result.stdout.trim() : 'uncommitted/local content';
};

async function compilerContext(entryRoot, libraryRoot, cveLibraryRoot, output, id) {
  const layers = async (folders, shared) => {
    const result = [];
    for (const folder of folders) {
      const directory = path.join(entryRoot, folder);
      const info = await exists(directory);
      if (!info) continue;
      if (!info.isDirectory()) throw new Error(`${directory}: expected a regular content directory`);
      result.push(directory);
    }
    result.push(shared);
    return result;
  };
  const directory = path.join(output, id, 'compiler-context');
  await mkdir(directory, {recursive: true});
  // CXC expects <root>/<framework>/<value>, but cradle-lib-cve has modules
  // directly at its root. Build a framework view without copying module content.
  const sharedHeuristics = path.join(directory, 'shared-heuristics');
  await rm(sharedHeuristics, {recursive: true, force: true});
  await mkdir(sharedHeuristics);
  await symlink(cveLibraryRoot, path.join(sharedHeuristics, 'cve'), 'dir');
  const libraryHeuristics = path.join(libraryRoot, 'heuristics');
  if ((await exists(libraryHeuristics))?.isDirectory()) {
    for (const framework of await readdir(libraryHeuristics, {withFileTypes: true})) {
      if (framework.name !== 'cve' && framework.isDirectory()) {
        await symlink(path.join(libraryHeuristics, framework.name), path.join(sharedHeuristics, framework.name), 'dir');
      }
    }
  }
  const configs = await layers(['configs', 'config', 'configurations', 'configuration'], path.join(libraryRoot, 'configs'));
  const heuristics = await layers(['heuristics', 'heuristic'], sharedHeuristics);
  // cxc loads config.toml from its working directory. Input remains an absolute
  // source path so include statements resolve beside their authoring file.
  await writeFile(path.join(directory, 'config.toml'), [
    `config_dir = ${JSON.stringify(configs[0])}`,
    `extra_config_dirs = ${JSON.stringify(configs.slice(1))}`,
    `heuristics_dir = ${JSON.stringify(heuristics[0])}`,
    `extra_heuristics_dirs = ${JSON.stringify(heuristics.slice(1))}`,
  ].join('\n') + '\n');
  return directory;
}

export async function validateSources({sourceRoot = root, libraryRoot, cveLibraryRoot, scenario = '', output = path.join(root, 'scenario-output'), run = spawnSync} = {}) {
  if (!libraryRoot) throw new Error('Provide --library <cradle-lib checkout>.');
  if (!cveLibraryRoot) throw new Error('Provide --cve-library <cradle-lib-cve checkout>.');
  sourceRoot = path.resolve(sourceRoot);
  libraryRoot = path.resolve(libraryRoot);
  cveLibraryRoot = path.resolve(cveLibraryRoot);
  output = path.resolve(output);
  if (scenario && !slug.test(scenario)) throw new Error('Scenario must be a lowercase folder ID.');
  const directory = path.join(sourceRoot, 'scenarios');
  for (const parent of [directory, libraryRoot, cveLibraryRoot]) {
    if (!(await lstat(parent)).isDirectory()) throw new Error(`${parent}: expected a regular directory`);
  }
  const folders = (await readdir(directory, {withFileTypes: true})).filter((entry) => entry.name !== '.gitkeep');
  for (const entry of folders) if (!entry.isDirectory() || !slug.test(entry.name)) throw new Error(`Invalid scenario folder: ${entry.name}`);
  const ids = folders.map((entry) => entry.name).filter((id) => !scenario || id === scenario).sort();
  if (scenario && !ids.length) throw new Error(`Scenario not found: ${scenario}`);
  await mkdir(output, {recursive: true});
  const version = run('cxc', ['--version'], {encoding: 'utf8', timeout: 30000});
  if (version.error || version.status !== 0) throw new Error('cxc is unavailable; install CradleXC before running source validation.');
  const report = {compiler: version.stdout.trim(), sourceRevision: gitRevision(sourceRoot), libraryRevision: gitRevision(libraryRoot), cveLibraryRevision: gitRevision(cveLibraryRoot), scenarios: []};
  for (const id of ids) {
    const entryRoot = path.join(directory, id);
    const item = {id, validation: 'not run', configs: [], heuristics: [], errors: []};
    report.scenarios.push(item);
    console.log(`Validating ${id}`);
    try {
      // Preflight includes before cxc reads them; then cxc validates the source itself.
      const scenario = await readScenario(entryRoot);
      const references = await collectContentReferences(entryRoot, {entrypoint: scenario.entrypoint});
      const workingDirectory = await compilerContext(entryRoot, libraryRoot, cveLibraryRoot, output, id);
      const result = run('cxc', ['validate', '-i', scenario.entrypoint], {
        cwd: workingDirectory, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      item.validation = !result.error && result.status === 0 ? 'passed' : 'failed';
      if (item.validation === 'failed') item.errors.push(result.error ? `cxc validate failed: ${result.error.code || result.error.message}` : `cxc validate exited with code ${result.status}`);
      try {
        item.heuristics = await resolveHeuristicReferences(entryRoot, libraryRoot, references.heuristics, cveLibraryRoot);
        for (const heuristic of item.heuristics) {
          if (heuristic.error) item.errors.push(heuristic.error);
          console.log(`  heuristic ${heuristic.framework}/${heuristic.value}: ${heuristic.error || heuristic.source}`);
        }
      } catch (error) {item.errors.push(error.message);}
      const impliedConfigs = item.heuristics.filter((item) => !item.error).flatMap((heuristic) => heuristic.configs.map((name) => ({name, requiredBy: `heuristic ${heuristic.framework}/${heuristic.value}`})));
      item.configs = await resolveConfigReferences(entryRoot, libraryRoot, [...references.configs, ...impliedConfigs]);
      for (const config of item.configs) {
        if (!config.source) item.errors.push(`Missing config: ${config.name} (canonical: ${config.canonical})`);
        console.log(`  ${config.name}: ${config.source || 'MISSING'}`);
      }
    } catch (error) {item.errors.push(error.message);}
    for (const error of item.errors) console.error(`${id}: ${error}`);
  }
  const failed = report.scenarios.filter((scenario) => scenario.errors.length).length;
  const markdown = [
    '## CRADLE source, configuration and heuristic validation',
    `Compiler: ${escape(report.compiler)}`,
    `Source revision: ${escape(report.sourceRevision)}`,
    `cradle-lib revision: ${escape(report.libraryRevision)}`,
    `cradle-lib-cve revision: ${escape(report.cveLibraryRevision)}`,
    `${ids.length} scenario(s) checked; ${failed} failed. Draft scenarios are included.`,
    ...report.scenarios.flatMap((item) => [
      `### ${escape(item.id)}`,
      `cxc validate: **${item.validation}**`,
      ['| Config | Canonical name | Resolved from | Required by |', '| --- | --- | --- | --- |',
        ...item.configs.map((config) => `| ${escape(config.name)} | ${escape(config.canonical)} | ${escape(config.source || 'MISSING')} | ${escape(config.requiredBy.join(', '))} |`)].join('\n'),
      ['| Heuristic | Resolved from | Implied configs | Status |', '| --- | --- | --- | --- |',
        ...item.heuristics.map((heuristic) => `| ${escape(`${heuristic.framework}/${heuristic.value}`)} | ${escape(heuristic.source || 'MISSING')} | ${escape(heuristic.configs.join(', ') || 'None')} | ${escape(heuristic.error || 'Passed')} |`)].join('\n'),
      ...item.errors.map((error) => `- ${escape(error)}`),
    ]),
    'Checks confirm CRADLE syntax/structure, named configuration and heuristic template availability, heuristic manifests and their implied config references. Templates, entry scripts and artifacts are not executed. No infrastructure is provisioned. Runtime behavior and template rendering are not certified.',
  ].join('\n\n') + '\n';
  await writeFile(path.join(output, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(output, 'validation.md'), markdown);
  return {report, markdown, failed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    const flags = {'--source': 'sourceRoot', '--library': 'libraryRoot', '--cve-library': 'cveLibraryRoot', '--scenario': 'scenario', '--output': 'output'};
    for (let i = 0; i < args.length; i += 2) {
      const key = flags[args[i]];
      if (!key || options[key] !== undefined || args[i + 1] === undefined) throw new Error('Usage: npm run library:validate -- --library <cradle-lib checkout> --cve-library <cradle-lib-cve checkout> [--scenario <id>] [--source <checkout>] [--output <directory>]');
      options[key] = args[i + 1];
    }
    const result = await validateSources(options);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, result.markdown);
    if (result.failed) process.exitCode = 1;
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
