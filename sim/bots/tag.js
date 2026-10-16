'use strict';
// (d) Tight-aggressive Monte Carlo equity bot (approximates "nontechyk").
// Estimates equity vs N random hands (N = opponents still in the hand); raises when
// equity is high, calls when equity beats pot odds with a margin, folds otherwise.
// Preflop equities are cached per (hand class, opponents).
const { view } = require('./util');
const { equityMC } = require('../engine/cards');
const { makeRng } = require('../engine/rng');

const PREFLOP_SAMPLES = 400;
const POSTFLOP_SAMPLES = 120;

function tag(ctx, options = {}) {
  const preSamples = options.preflopSamples || PREFLOP_SAMPLES;
  const postSamples = options.postflopSamples || POSTFLOP_SAMPLES;
  const aggression = options.aggression == null ? 1 : options.aggression; // scales thresholds
  const cache = new Map();

  function preflopEquity(hole, nOpp) {
    const r1 = hole[0] >> 2, r2 = hole[1] >> 2;
    const suited = (hole[0] & 3) === (hole[1] & 3);
    const key = (Math.max(r1, r2) * 13 + Math.min(r1, r2)) * 2 * 10 + (suited ? 10 : 0) + nOpp;
    let e = cache.get(key);
    if (e == null) {
      // fixed per-key seed so the cache is identical however games are split across workers
      e = equityMC(hole, [], nOpp, preSamples, makeRng(424242, 'tag-preflop', key));
      cache.set(key, e);
    }
    return e;
  }

  return {
    bet: gs => {
      const v = view(gs);
      if (v.hole.length < 2) return 0;
      const nOpp = Math.max(1, v.opponents);
      const { toCall, pot, bb, stack } = v;
      const bbs = stack / bb;
      const margin = 0.04 / aggression;

      if (v.board.length === 0) {
        const eq = preflopEquity(v.hole, nOpp);
        // random-hand equity baseline is 1/(nOpp+1); express strength relative to it
        const base = 1 / (nOpp + 1);
        const strong = base + 0.22 * aggression;   // e.g. heads-up ~0.72, 3 opp ~0.47
        const good = base + 0.10 * aggression;     // heads-up ~0.60, 3 opp ~0.35
        if (bbs <= 10) {
          if (eq >= good) return v.allIn();
          if (toCall === 0) return 0;
          return eq >= v.potOdds + margin && toCall <= stack * 0.3 ? v.call() : 0;
        }
        if (eq >= strong) {
          if (toCall > stack * 0.4) return v.allIn();
          return v.raise(Math.max(3 * bb, pot));
        }
        if (eq >= good) {
          if (toCall === 0 || toCall <= 2 * bb) return v.raise(3 * bb);
          if (toCall <= 6 * bb) return v.call();
          return eq >= v.potOdds + 0.12 && toCall <= stack * 0.25 ? v.call() : 0;
        }
        if (toCall === 0) return 0;
        if (toCall <= bb && eq >= base) return v.call();
        return 0;
      }

      const eq = equityMC(v.hole, v.board, nOpp, postSamples, ctx.rng);
      const base = 1 / (nOpp + 1);
      const nuts = Math.min(0.92, base + 0.5 * aggression);
      const strong = Math.min(0.85, base + 0.32 * aggression);
      if (eq >= nuts) return toCall >= stack * 0.4 ? v.allIn() : v.raise(pot);
      if (eq >= strong) {
        if (toCall === 0) return v.raise(pot * 0.66);
        if (toCall <= pot * 0.5) return v.raise(pot * 0.75);
        return eq >= v.potOdds + margin ? v.call() : 0;
      }
      if (toCall === 0) return 0;
      if (eq >= v.potOdds + margin) return v.call();
      return 0;
    },
  };
}

module.exports = { tag };
