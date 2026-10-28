import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
const [output] = process.argv.slice(2);
const escape = (value) => value.trim().replace(/[&<>`\r\n]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '`': '&#96;', '\r': ' ', '\n': ' '}[char]));
const compiler = escape(await readFile(path.join(output, 'compiler-version.txt'), 'utf8'));
const revision = escape(await readFile(path.join(output, 'revision.txt'), 'utf8'));
await writeFile(path.join(output, 'report.md'), `## Scenario validation and compilation\n\nValidation: **Passed**. Compilation: **Passed**.\n\nSource revision: ${revision}\n\nCompiler: ${compiler}\n\nNo infrastructure was provisioned or events executed. Images, configurations, and artifact availability require runtime verification. Compiled YAML is temporary runner output.\n`);
