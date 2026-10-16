#!/usr/bin/env node
'use strict';
// Packs the strategy (src/*.ts except index.ts/types.ts, which are not in the public repo) into one
// compressed module, dist/engine.js, that src/index.ts loads. Run after changing the strategy:
//   node tools/pack.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && f !== 'index.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpex-pack-'));
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'tsc'), [
  '--module', 'commonjs', '--target', 'ES2021', '--strict', '--skipLibCheck', '--removeComments', '--outDir', tmp,
  ...files.map(f => path.join(SRC, f)),
], { stdio: 'inherit' });

const modules = files.map(f => {
  const name = './' + f.replace(/\.ts$/, '');
  const code = fs.readFileSync(path.join(tmp, f.replace(/\.ts$/, '.js')), 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '');
  return `${JSON.stringify(name)}:function(module,exports,require){${code}\n}`;
});
const bundle = `const M={${modules.join(',')}},C={};` +
  `function R(n){if(M[n]){if(!C[n]){const m={exports:{}};C[n]=m;M[n](m,m.exports,R);}return C[n].exports;}return require(n);}` +
  `module.exports=R("./Player");`;
const blob = zlib.deflateRawSync(Buffer.from(bundle), { level: 9 }).toString('base64');

const out = `"use strict";const z=require("zlib");const m={exports:{}};` +
  `new Function("module","exports","require",z.inflateRawSync(Buffer.from(${JSON.stringify(blob)},"base64")).toString())(m,m.exports,require);` +
  `module.exports=m.exports;\n`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'engine.js'), out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`packed ${files.length} modules -> dist/engine.js (${out.length} bytes)`);
