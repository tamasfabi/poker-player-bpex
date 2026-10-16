#!/usr/bin/env node
'use strict';
// Snapshot a past version of the strategy as an A/B baseline:
//   node sim/baselines/build.js <git-rev> <name>     e.g.  node sim/baselines/build.js 779fe59 v1.1
// Extracts src/*.ts (except index.ts) at that revision into sim/baselines/<name>/src and compiles
// them with the repo's typescript into sim/baselines/<name>/Player.js. Then:
//   node sim/run.js --bot v1.1=sim/baselines/v1.1/Player.js --players bpex,v1.1,tag,raiser
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [rev, name] = process.argv.slice(2);
if (!rev || !name) { console.error('usage: node sim/baselines/build.js <git-rev> <name>'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..', '..');
const dir = path.join(__dirname, name);
const srcDir = path.join(dir, 'src');
fs.mkdirSync(srcDir, { recursive: true });
const files = execSync(`git ls-tree --name-only ${rev} src/`, { cwd: ROOT }).toString().split('\n')
  .filter(f => f.endsWith('.ts') && !f.endsWith('index.ts'));
for (const f of files) fs.writeFileSync(path.join(srcDir, path.basename(f)), execSync(`git show ${rev}:${f}`, { cwd: ROOT }));
const sha = execSync(`git rev-parse ${rev}`, { cwd: ROOT }).toString().trim();
const subject = execSync(`git log -1 --format=%s ${rev}`, { cwd: ROOT }).toString().trim();
fs.writeFileSync(path.join(dir, 'VERSION'), `${sha}\n${subject}\n`);
const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');
execSync(`"${tsc}" --module commonjs --target ES2021 --skipLibCheck --outDir "${dir}" ${files.map(f => `"${path.join(srcDir, path.basename(f))}"`).join(' ')}`, { cwd: ROOT, stdio: 'inherit' });
console.log(`built ${name} from ${sha.slice(0, 7)} (${subject}) -> ${path.relative(ROOT, path.join(dir, 'Player.js'))}`);
