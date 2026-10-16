'use strict';
// Builds bot instances from specs:
//   builtin name  (see bots/index.js)          -> { kind: 'builtin', name }
//   path to a compiled strategy module (.js)   -> { kind: 'module', path }
// A strategy module may export a Player class (betRequest(gs, cb) / showdown(gs)),
// an object with betRequest, or a plain function (gs) => number. The callback must be
// invoked synchronously (the stock Player does).
//
// Any `equity.js` module the strategy pulls in (src/equity.ts compiled) is patched so
// the simulator runs fast: SIM_EQUITY=fast (default) swaps in the bitwise Monte Carlo
// evaluator with identical semantics; SIM_EQUITY=orig keeps the original code but
// honours SIM_EQUITY_ITERS; SIM_EQUITY=off leaves it untouched. SIM_EQUITY_ITERS
// overrides the iteration count in both patched modes.

const path = require('path');
const fs = require('fs');
const { BUILTIN } = require('./bots');
const { equityMC, equityMCRange, fromCard } = require('./engine/cards');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PLAYER = path.join(ROOT, 'out', 'Player.js');

function patchEquityModules() {
  const mode = process.env.SIM_EQUITY || 'fast';
  if (mode === 'off') return;
  const iters = process.env.SIM_EQUITY_ITERS ? parseInt(process.env.SIM_EQUITY_ITERS, 10) : null;
  for (const mod of Object.values(require.cache)) {
    if (!mod || !mod.exports || typeof mod.exports.equity !== 'function') continue;
    if (!/equity\.js$/.test(mod.filename) || mod.exports.__simPatched) continue;
    const orig = mod.exports.equity;
    let patched;
    if (mode === 'fast') {
      // supports both signatures: (hole, board, opponents, iterations) and (hole, board, opponents, { aggressorRange, iterations })
      patched = function equity(hole, board, opponents, optsOrIters) {
        if (opponents <= 0) return 1;
        let iterations = 600, aggressorRange;
        if (typeof optsOrIters === 'number') iterations = optsOrIters;
        else if (optsOrIters && typeof optsOrIters === 'object') {
          if (optsOrIters.iterations) iterations = optsOrIters.iterations;
          aggressorRange = optsOrIters.aggressorRange;
        }
        const h = hole.map(fromCard), b = board.map(fromCard), n = iters || iterations;
        if (aggressorRange !== undefined && aggressorRange < 1) return equityMCRange(h, b, opponents, n, Math.random, aggressorRange);
        return equityMC(h, b, opponents, n, Math.random);
      };
    } else {
      patched = function equity(hole, board, opponents, optsOrIters, ...rest) {
        if (iters) {
          if (optsOrIters && typeof optsOrIters === 'object') optsOrIters = { ...optsOrIters, iterations: iters };
          else optsOrIters = iters;
        }
        return orig(hole, board, opponents, optsOrIters, ...rest);
      };
    }
    patched.__simPatched = true;
    mod.exports.equity = patched;
    mod.exports.__simPatched = true;
  }
}

function wrapModule(modPath, label) {
  const abs = path.resolve(process.cwd(), modPath);
  if (!fs.existsSync(abs)) throw new Error(`strategy module not found: ${abs} (did you run npm run build?)`);
  const mod = require(abs);
  patchEquityModules();
  let cand = mod.Player || mod.default || mod;
  if (cand && cand.default && !cand.betRequest && typeof cand !== 'function') cand = cand.default;
  let inst;
  if (typeof cand === 'function' && cand.prototype && typeof cand.prototype.betRequest === 'function') inst = new cand();
  else if (cand && typeof cand.betRequest === 'function') inst = cand;
  else if (typeof cand === 'function') return { label, version: label, bet: gs => cand(gs) };
  else throw new Error(`cannot find a Player class / betRequest / function in ${abs}`);
  return {
    label,
    version: label,
    bet: gs => {
      let result, called = false;
      inst.betRequest(gs, b => { result = b; called = true; });
      if (!called) throw new Error(`${label}.betRequest did not call back synchronously`);
      return result;
    },
    showdown: typeof inst.showdown === 'function' ? gs => inst.showdown(gs) : undefined,
  };
}

/**
 * @param {Array<{label:string, kind:'builtin'|'module', name?:string, path?:string}>} specs
 * @param {{rng:Function}} ctx shared context; runner swaps ctx.rng per game
 */
function buildBots(specs, ctx) {
  return specs.map(spec => {
    if (spec.kind === 'module') return wrapModule(spec.path, spec.label);
    const def = BUILTIN[spec.name];
    if (!def) throw new Error(`unknown bot "${spec.name}" (builtins: ${Object.keys(BUILTIN).join(', ')})`);
    const b = def.make(ctx, spec.options || {});
    return { label: spec.label, version: spec.name, bet: b.bet, showdown: b.showdown };
  });
}

// Turn CLI names into specs. `custom` maps a name -> module path (from --bot name=path).
// "bpex" defaults to the compiled out/Player.js.
function resolveSpecs(names, custom = {}) {
  const seen = new Map();
  return names.map(name => {
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    const label = count === 1 ? name : `${name}#${count}`;
    if (custom[name]) return { label, kind: 'module', path: custom[name] };
    if (name === 'bpex') return { label, kind: 'module', path: DEFAULT_PLAYER };
    if (BUILTIN[name]) return { label, kind: 'builtin', name };
    if (/[\\/]|\.js$/.test(name)) return { label: path.basename(name, '.js'), kind: 'module', path: name };
    throw new Error(`unknown player "${name}". Builtins: bpex, ${Object.keys(BUILTIN).join(', ')}; or --bot name=path/to/Player.js`);
  });
}

module.exports = { buildBots, resolveSpecs, patchEquityModules, DEFAULT_PLAYER };
