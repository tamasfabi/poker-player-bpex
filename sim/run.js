#!/usr/bin/env node
'use strict';
// CLI: node sim/run.js --games 2000 --players bpex,tag,maniac,station --seed 1
// See sim/README.md for all options.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { resolveSpecs } = require('./loader');
const { runGames } = require('./runner');
const { DEFAULT_BLINDS, DEFAULT_BLIND_PERIOD } = require('./engine/game');
const { BUILTIN } = require('./bots');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = {
    games: 500, players: 'bpex,tag,maniac,station', seed: 1, workers: Math.max(1, Math.min(os.cpus().length, 12)),
    bots: {}, blinds: null, blindPeriod: DEFAULT_BLIND_PERIOD, strict: false, stack: 1000, points: '5,3,0,0', maxRounds: 5000,
    log: null, json: false, showdown: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--games': case '-g': o.games = parseInt(next(), 10); break;
      case '--players': case '-p': o.players = next(); break;
      case '--seed': case '-s': o.seed = parseInt(next(), 10); break;
      case '--workers': case '-w': o.workers = parseInt(next(), 10); break;
      case '--bot': { const [name, p] = next().split('='); if (!p) throw new Error('--bot expects name=path'); o.bots[name] = p; break; }
      case '--blinds': o.blinds = next().split(',').map(Number); break;
      case '--blind-period': o.blindPeriod = parseInt(next(), 10); break;
      case '--stack': o.stack = parseInt(next(), 10); break;
      case '--points': o.points = next(); break;
      case '--max-rounds': o.maxRounds = parseInt(next(), 10); break;
      case '--log': o.log = parseInt(next(), 10); break;
      case '--json': o.json = true; break;
      case '--strict-min-raise': o.strict = true; break;
      case '--showdown': o.showdown = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  return o;
}

function usage() {
  console.log(`Usage: node sim/run.js [options]
  --games N            number of sit'n'gos (default 500)
  --players a,b,c,d    seat list; names: bpex (out/Player.js), ${Object.keys(BUILTIN).join(', ')}, or a path to a .js module
  --bot name=path      define/override a name as a strategy module, e.g. --bot v11=sim/baselines/v1.1/Player.js
  --seed N             base seed (default 1); results are deterministic for a given seed and player list
  --workers N          worker threads (default: cpu count, max 12)
  --blinds 2,3,5,...   small blind levels (default ${DEFAULT_BLINDS.join(',')})
  --blind-period N     hands per blind level (default 10)
  --strict-min-raise   treat bets below call+minimum_raise as calls (API docs); default mirrors the live engine, which accepts any bet above the call as a raise
  --stack N            starting stack (default 1000)
  --points 5,3,0,0     points by finishing place (default 5,3,0,0)
  --log G              play game G alone, printing the full hand history
  --showdown           also call showdown(gs) on strategy modules (slower)
  --json               machine-readable output
Env: SIM_EQUITY=fast|orig|off (default fast), SIM_EQUITY_ITERS=N  (patch src/equity.ts Monte Carlo inside the sim)
Bots:
${Object.entries(BUILTIN).map(([k, v]) => `  ${k.padEnd(9)} ${v.desc}`).join('\n')}`);
}

function checkBuildFreshness() {
  try {
    const out = fs.statSync(path.join(ROOT, 'out', 'Player.js')).mtimeMs;
    for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
      if (fs.statSync(path.join(ROOT, 'src', f)).mtimeMs > out) {
        console.error(`warning: src/${f} is newer than out/Player.js - run \`npm run build\``);
        break;
      }
    }
  } catch (e) {
    console.error('warning: out/Player.js not found - run `npm run build` first');
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { usage(); return; }
  const names = o.players.split(',').map(s => s.trim()).filter(Boolean);
  if (names.length < 2) throw new Error('need at least 2 players');
  const specs = resolveSpecs(names, o.bots);
  if (specs.some(s => s.kind === 'module' && s.path === path.join(ROOT, 'out', 'Player.js'))) checkBuildFreshness();
  const config = {
    startingStack: o.stack, blindLevels: o.blinds || DEFAULT_BLINDS, blindPeriod: o.blindPeriod,
    maxRounds: o.maxRounds, callShowdown: o.showdown, strictMinRaise: o.strict,
  };
  const pointsTable = o.points.split(',').map(Number);
  const n = specs.length;

  if (o.log != null) {
    runGames(specs, [o.log], o.seed, config, line => console.log(line));
    return;
  }

  const t0 = Date.now();
  const workers = Math.max(1, Math.min(o.workers, o.games));
  const buckets = Array.from({ length: workers }, () => []);
  for (let g = 0; g < o.games; g++) buckets[g % workers].push(g);

  let results;
  if (workers === 1) {
    results = runGames(specs, buckets[0], o.seed, config, null);
  } else {
    results = (await Promise.all(buckets.map(gameIndices => new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { specs, gameIndices, seed: o.seed, config } });
      w.on('message', m => (m.ok ? resolve(m.results) : reject(new Error(m.error))));
      w.on('error', reject);
      w.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
    })))).flat();
  }
  const secs = (Date.now() - t0) / 1000;

  // aggregate
  const stats = specs.map(s => ({ label: s.label, points: 0, sq: 0, places: new Array(n).fill(0), posSum: 0, errors: 0 }));
  let hands = 0;
  for (const r of results) {
    hands += r.hands;
    for (let i = 0; i < n; i++) {
      const place = r.positions[i];
      const pts = pointsTable[place - 1] || 0;
      const st = stats[i];
      st.points += pts; st.sq += pts * pts; st.places[place - 1]++; st.posSum += place; st.errors += r.errors[i];
    }
  }
  const G = results.length;
  const rows = stats.map(st => {
    const avg = st.points / G;
    const sd = Math.sqrt(Math.max(0, st.sq / G - avg * avg));
    return {
      label: st.label, avgPoints: avg, ci95: 1.96 * sd / Math.sqrt(G), winPct: 100 * st.places[0] / G,
      placePct: st.places.map(c => 100 * c / G), avgPlace: st.posSum / G, errors: st.errors,
    };
  });

  if (o.json) {
    console.log(JSON.stringify({ games: G, seed: o.seed, players: names, hands, seconds: secs, rows }, null, 2));
    return;
  }
  console.log(`${G} games, ${hands} hands (${(hands / G).toFixed(1)}/game), seed ${o.seed}, ${secs.toFixed(1)}s, ${workers} workers`);
  const ord = i => `${i}${['th', 'st', 'nd', 'rd'][i % 10 <= 3 && Math.floor(i / 10) !== 1 ? i % 10 : 0]}%`;
  const head = ['player', 'avg pts', '±95%', 'win%', ...Array.from({ length: n }, (_, i) => ord(i + 1)), 'avg pos', 'errors'];
  const lines = rows.map(r => [
    r.label, r.avgPoints.toFixed(3), r.ci95.toFixed(3), r.winPct.toFixed(1),
    ...r.placePct.map(p => p.toFixed(1)), r.avgPlace.toFixed(2), String(r.errors),
  ]);
  const widths = head.map((h, c) => Math.max(h.length, ...lines.map(l => l[c].length)));
  const fmt = cols => cols.map((v, c) => (c === 0 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join('  ');
  console.log(fmt(head));
  for (const l of lines) console.log(fmt(l));
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
