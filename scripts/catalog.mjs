import {lstat, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listScenarioEntries, readScenario, optionalStat} from './scenario-layout.mjs';
import {templateUnder} from './config-references.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const inside = (parent, child) => {const relative=path.relative(parent,child);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`);};

export async function refreshExistingCatalog(sourceRoot = root) {
  const filename = path.join(sourceRoot, 'catalog.json');
  if (!(await optionalStat(filename))) return false;
  await writeFile(filename, JSON.stringify(await readCatalog(sourceRoot), null, 2) + '\n');
  return true;
}

export async function readCatalog(sourceRoot = root) {
  sourceRoot = path.resolve(sourceRoot);
  const scenarios = [];
  for (const {id, entryRoot} of await listScenarioEntries(sourceRoot)) {
    const scenario = await readScenario(entryRoot);
    const data = scenario.metadata;
    for (const key of ['title','description']) if(typeof data[key]!=='string'||!data[key].trim())throw new Error(`${id}: missing ${key}`);
    if(!Array.isArray(data.tags)||!data.tags.length||!data.tags.every(tag=>typeof tag==='string'&&tag.trim()))throw new Error(`${id}: tags must be a non-empty list`);
    for(const folder of ['configs','config','configurations','configuration']) {
      const directory=path.join(entryRoot,folder), info=await optionalStat(directory);
      if(!info)continue;
      if(!info.isDirectory())throw new Error(`${id}: ${folder} must be a regular directory`);
      for(const module of await readdir(directory,{withFileTypes:true})) {
        if(module.name.startsWith('_')||module.name==='README.md')continue;
        if(!module.isDirectory())throw new Error(`${id}: invalid config module ${module.name}`);
        await templateUnder(directory,module.name);
      }
    }
    const source=await readFile(scenario.entrypoint,'utf8');
    const repository=source.match(/repositoryLocal\("([^"]*)"\)/)?.[1]||'';
    for(const match of source.matchAll(/location\("\$\{uriLocal\}\/([^"]+)"\)/g)) {
      const filename=path.resolve(entryRoot,repository,match[1]);
      if(!inside(entryRoot,filename)||!(await lstat(filename)).isFile()||!inside(await realpath(entryRoot),await realpath(filename)))throw new Error(`${id}: missing or escaping local object ${match[1]}`);
    }
    const entry={id,title:data.title,description:data.description,tags:data.tags,version:data.version??'0.1.0',entrypoint:scenario.entrypointName,path:`scenarios/${id}`};
    if(data.draft!==undefined){if(typeof data.draft!=='boolean')throw new Error(`${id}: draft must be boolean`);entry.draft=data.draft;}
    if(data.preview){const preview=path.resolve(entryRoot,data.preview);if(!inside(entryRoot,preview)||!(await lstat(preview)).isFile())throw new Error(`${id}: missing/unsafe preview`);entry.preview=data.preview;}
    scenarios.push(entry);
  }
  return {schema_version:1,scenarios};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.some(arg=>arg!=='--update')||args.length>1)throw new Error('Usage: node scripts/catalog.mjs [--update]');
    const expected=await readCatalog(), filename=path.join(root,'catalog.json');
    if(args.includes('--update'))await writeFile(filename,JSON.stringify(expected,null,2)+'\n');
    else if(JSON.stringify(JSON.parse(await readFile(filename,'utf8')))!==JSON.stringify(expected))throw new Error('catalog.json is stale; run npm run catalog:update');
    console.log(`${args.includes('--update')?'Updated':'Validated'} catalogue: ${expected.scenarios.length} scenario(s).`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
