import path from 'node:path';
import {readLibrary} from './check-library.mjs';

const [id, sourceRoot] = process.argv.slice(2);
if (!sourceRoot || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? '')) throw new Error('Provide a scenario folder ID and source checkout.');
const catalog = await readLibrary(sourceRoot);
const scenario = catalog.scenarios.find((entry) => entry.id === id);
if (!scenario) throw new Error(`Published scenario not found: ${id}`);
console.log(path.resolve(sourceRoot, scenario.sourcePath));
