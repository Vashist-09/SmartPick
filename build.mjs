import { mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const file of ['src/app.js', 'src/data.js', 'src/live.js']) execFileSync(process.execPath, ['--check', file], {stdio:'inherit'});
await mkdir('dist/src', {recursive:true});
for (const file of ['index.html','src/app.js','src/data.js','src/live.js','src/styles.css']) await copyFile(file, `dist/${file}`);
console.log('Static app built in dist/');
