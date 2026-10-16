'use strict';
// Registry of built-in archetypes. Each factory: (ctx, options) => { bet(gs), showdown?(gs) }.
// ctx.rng is a seeded PRNG swapped per game by the runner.
const { folder, maniac, station, random } = require('./simple');
const { raiser } = require('./raiser');
const { tag } = require('./tag');
const { nontechyk, megistekik, nontekik } = require('./real');

const BUILTIN = {
  folder: { make: folder, desc: 'always 0: folds to any bet, checks otherwise' },
  maniac: { make: maniac, desc: 'shoves every hand' },
  station: { make: station, desc: 'calling station: always calls, never raises' },
  tag: { make: tag, desc: 'tight-aggressive Monte Carlo equity bot (~nontechyk)' },
  loosetag: { make: (ctx) => tag(ctx, { aggression: 0.7 }), desc: 'looser/more passive variant of tag' },
  raiser: { make: raiser, desc: 'hand-strength raiser: big raises with pairs/high cards (~megistekik)' },
  random: { make: random, desc: 'random fold/call/raise' },
  nontechyk: { make: nontechyk, desc: 'model of the real leader: 45% opens to 1.5bb, 100% 20%-pot c-bets, never raises postflop, folds 2/3 to raises' },
  megistekik: { make: megistekik, desc: 'model of megistekik: tight 3bb opens, 84% half-pot c-bets, bet-or-fold, folds 92% to all-ins, shoves wide <=15bb' },
  nontekik: { make: nontekik, desc: 'model of nontekik: limping calling station, calls 73% of bets, over-bet shoves with any pair' },
};

module.exports = { BUILTIN };
