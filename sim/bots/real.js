'use strict';
// Models of the three real opponents, built from the frequencies in docs/opponents.md.
// Randomness comes from ctx.rng (seeded per game by the runner).
const { view } = require('./util');
const { evalCards, category, chenInt } = require('../engine/cards');

const T = 8, J = 9, Q = 10, K = 11, A = 12; // rank indexes (2 = 0)

// Preflop hand percentile 0..1 (1 = best) by Chen score; used to pick "top X%" ranges.
// Chen scores range roughly -1..20; cumulative share of 169 hand classes weighted by combos.
const CHEN_PCT = (() => {
  const buckets = new Map();
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
    const s = chenInt(a, b);
    buckets.set(s, (buckets.get(s) || 0) + 1);
  }
  const scores = [...buckets.keys()].sort((x, y) => y - x);
  const pct = new Map();
  let acc = 0;
  for (const s of scores) { acc += buckets.get(s); pct.set(s, acc / 1326); } // share of hands at least this good
  return pct;
})();
// fraction of hands that are at least as good as this one (0.05 = top 5%)
function topShare(hole) { return CHEN_PCT.get(chenInt(hole[0], hole[1])); }

function madeHand(v) {
  const cards = [...v.hole, ...v.board];
  const sc = evalCards(cards, cards.length);
  const cat = category(sc);
  const boardTop = Math.max(...v.board.map(c => c >> 2));
  const r1 = v.hole[0] >> 2, r2 = v.hole[1] >> 2;
  const pocketPair = r1 === r2;
  const pairRank = cat === 1 ? (sc >> 16) & 15 : -1;
  const topPair = cat === 1 && (pairRank >= boardTop) && (pocketPair || r1 === pairRank || r2 === pairRank);
  const holeHits = pocketPair || v.board.some(c => (c >> 2) === r1 || (c >> 2) === r2);
  const usesHole = cat >= 3 ? true : cat === 2 ? holeHits : cat === 1 ? (pocketPair || r1 === pairRank || r2 === pairRank) : false;
  // crude draw detection: 4 to a flush or 4 to a straight using a hole card
  let suitCount = [0, 0, 0, 0];
  for (const c of cards) suitCount[c & 3]++;
  const flushDraw = v.board.length < 5 && v.hole.some(h => suitCount[h & 3] === 4);
  let mask = 0; for (const c of cards) mask |= 1 << (c >> 2);
  let straightDraw = false;
  if (v.board.length < 5) for (let lo = 0; lo <= 9 && !straightDraw; lo++) {
    const w = (mask >> lo) & 0x1f;
    let bits = 0; for (let b = 0; b < 5; b++) if (w & (1 << b)) bits++;
    if (bits === 4 && v.hole.some(h => ((h >> 2) >= lo && (h >> 2) < lo + 5))) straightDraw = true;
  }
  return { cat, usesHole, topPair, pairPlus: cat >= 1 && usesHole, twoPairPlus: cat >= 2 && usesHole, draw: flushDraw || straightDraw };
}

// ---------------------------------------------------------------------------
// nontechyk: "tight-aggressive equity bot" that is actually loose. VPIP 51 / PFR 43, opens to 1.5bb
// (adds 1bb), c-bets 100% at 20% pot on every street, never raises postflop, folds 67% to 3-bets and
// 66% to postflop raises, calls all-ins wide when pot odds are good.
function nontechyk(ctx) {
  let myRaiseRound = -1;
  return {
    bet: gs => {
      const v = view(gs);
      if (v.hole.length < 2) return 0;
      const { toCall, pot, bb, stack } = v;
      const share = topShare(v.hole); // 0..1, lower = better
      const rnd = ctx.rng();
      const facingAllIn = toCall >= stack || gs.players.some((p, i) => i !== gs.in_action && p.status === 'active' && p.stack === 0 && p.bet === gs.current_buy_in);

      if (v.board.length === 0) {
        const unraised = gs.current_buy_in <= bb;
        if (unraised) {
          if (share <= 0.45) {
            myRaiseRound = gs.round;
            // 78%: "raise" by adding 1bb to the blind (to 1.5bb; the live engine accepts it), else 3bb
            return rnd < 0.78 ? Math.min(stack, toCall + Math.max(1, Math.floor(bb / 2))) : v.raise(3 * bb);
          }
          if (toCall === 0) return 0;
          return toCall <= bb && share <= 0.6 ? v.call() : 0;
        }
        // facing a raise
        if (facingAllIn || toCall >= stack * 0.5) {
          // pot-odds driven, wide: continue when hand share beats price (K9o/Q2s calls happen when short)
          const need = v.potOdds;
          return share <= Math.max(0.2, 0.9 - need * 1.6) ? v.allIn() : 0;
        }
        if (myRaiseRound === gs.round) {
          // facing a 3-bet of our open: fold 67%
          if (share <= 0.08) return v.raise(pot);
          return share <= 0.33 || (rnd < 0.1) ? v.call() : 0;
        }
        if (share <= 0.06) return v.raise(pot);
        if (share <= 0.35 && toCall <= 6 * bb) return v.call();
        if (toCall <= bb) return v.call();
        return 0;
      }

      // postflop
      const h = madeHand(v);
      if (toCall === 0) return Math.min(stack, Math.max(1, Math.floor(pot * 0.2))); // 100% c-bet, 20% pot, every street
      if (facingAllIn || toCall >= stack * 0.5) {
        // folds 76% of postflop all-ins
        return h.twoPairPlus || (h.topPair && rnd < 0.5) ? v.call() : 0;
      }
      // never raises postflop; folds 66% to bets/raises
      if (h.twoPairPlus) return v.call();
      if (h.topPair || h.draw) return rnd < 0.8 ? v.call() : 0;
      if (h.pairPlus) return rnd < 0.5 ? v.call() : 0;
      return rnd < 0.15 && toCall <= pot * 0.3 ? v.call() : 0;
    },
  };
}

// ---------------------------------------------------------------------------
// megistekik: tight (PFR 21%), opens 3bb with ATo+/KTo+/QJo/55+/A2s+, no limps, c-bets 84% at 50% pot,
// bets or folds (almost never calls), folds 92% to all-ins and 68% to postflop raises,
// shoves any Ax / KT+ / QJ / 55+ when <= 15bb, min-re-raises back with premiums.
function megistekik(ctx) {
  const inOpenRange = hole => {
    const r1 = hole[0] >> 2, r2 = hole[1] >> 2, hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const suited = (hole[0] & 3) === (hole[1] & 3);
    if (r1 === r2) return hi >= 3; // 55+
    if (hi === A) return suited || lo >= T;
    if (hi === K) return lo >= T;
    if (hi === Q) return lo === J;
    return false;
  };
  const premium = hole => {
    const r1 = hole[0] >> 2, r2 = hole[1] >> 2, hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    return (r1 === r2 && hi >= T) || (hi === A && lo >= Q);
  };
  const shoveRange = hole => {
    const r1 = hole[0] >> 2, r2 = hole[1] >> 2, hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    if (r1 === r2) return hi >= 3;
    if (hi === A) return true;
    if (hi === K) return lo >= T;
    if (hi === Q) return lo === J;
    return false;
  };
  let openedRound = -1;
  return {
    bet: gs => {
      const v = view(gs);
      if (v.hole.length < 2) return 0;
      const { toCall, pot, bb, stack } = v;
      const rnd = ctx.rng();
      const facingAllIn = toCall >= stack || gs.players.some((p, i) => i !== gs.in_action && p.status === 'active' && p.stack === 0 && p.bet === gs.current_buy_in);

      if (v.board.length === 0) {
        const unraised = gs.current_buy_in <= bb;
        if (unraised) {
          if (stack <= 15 * bb) return shoveRange(v.hole) ? v.allIn() : 0;
          if (inOpenRange(v.hole)) { openedRound = gs.round; return v.raise(3 * bb); }
          return 0; // never limps; BB check happens via toCall === 0 -> 0
        }
        if (facingAllIn || toCall >= stack * 0.5) {
          return (premium(v.hole) && (rnd < 0.9 || (v.hole[0] >> 2) >= Q)) ? v.allIn() : 0; // ~92% fold
        }
        if (openedRound === gs.round) {
          // facing a 3-bet: fold 40%, otherwise continue; premiums re-raise (min-raise war)
          if (premium(v.hole)) return v.raise(gs.minimum_raise);
          return rnd < 0.6 && inOpenRange(v.hole) ? v.call() : 0;
        }
        if (premium(v.hole)) return v.raise(3 * toCall);
        if (inOpenRange(v.hole) && toCall <= 4 * bb) return v.call();
        return 0;
      }

      const h = madeHand(v);
      if (toCall === 0) {
        if (v.board.length === 3) return rnd < 0.84 ? v.raise(pot * 0.5) : 0; // 84% c-bet, 50% pot
        return (h.pairPlus || h.draw || rnd < 0.5) ? v.raise(pot * 0.5) : 0;
      }
      if (facingAllIn || toCall >= stack * 0.5) return h.twoPairPlus && h.cat >= 3 ? v.call() : 0; // folds all-ins
      // bet or fold, never call: 68% fold to raises
      if (h.twoPairPlus) return v.raise(pot);
      if (h.topPair) return rnd < 0.6 ? v.raise(pot * 0.5) : 0;
      if (h.pairPlus || h.draw) return rnd < 0.25 ? v.raise(pot * 0.5) : 0;
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// nontekik: calling station. VPIP 44 / PFR 6, limps a lot, BB defence by raise size, calls 73% of postflop
// bets, folds 12%, over-bet shoves postflop with any pair, calls preflop all-ins 11%.
function nontekik(ctx) {
  const premium = hole => {
    const r1 = hole[0] >> 2, r2 = hole[1] >> 2, hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    return (r1 === r2 && hi >= Q) || (hi === A && lo === K);
  };
  return {
    bet: gs => {
      const v = view(gs);
      if (v.hole.length < 2) return 0;
      const { toCall, pot, bb, stack } = v;
      const rnd = ctx.rng();
      const share = topShare(v.hole);
      const facingAllIn = toCall >= stack || gs.players.some((p, i) => i !== gs.in_action && p.status === 'active' && p.stack === 0 && p.bet === gs.current_buy_in);

      if (v.board.length === 0) {
        if (premium(v.hole)) return toCall >= stack * 0.5 ? v.allIn() : v.raise(3 * bb);
        if (facingAllIn || toCall >= stack * 0.5) {
          return share <= 0.08 || rnd < 0.06 ? v.allIn() : 0; // ~11% call
        }
        const sizeBB = toCall / bb;
        if (toCall === 0) return 0;
        let p;
        if (sizeBB <= 2) p = 0.86; else if (sizeBB <= 3) p = 0.69; else if (sizeBB <= 5) p = 0.35; else if (sizeBB <= 10) p = 0.2; else p = 0.12;
        // weight toward playable hands
        const playable = share <= 0.6;
        return rnd < p * (playable ? 1.15 : 0.6) ? v.call() : 0;
      }

      const h = madeHand(v);
      if (toCall === 0) {
        if (h.pairPlus && rnd < 0.25) return v.allIn(); // over-bet shoves with any pair
        if (h.twoPairPlus && rnd < 0.5) return v.raise(pot * 0.75);
        return 0;
      }
      if (facingAllIn || toCall >= stack * 0.5) {
        if (h.twoPairPlus) return v.call();
        if (h.topPair) return rnd < 0.5 ? v.call() : 0;
        return h.pairPlus && rnd < 0.2 ? v.call() : 0;
      }
      if (h.pairPlus && rnd < 0.2) return v.allIn();
      if (h.pairPlus || h.draw) return v.call();
      return rnd < 0.65 ? v.call() : 0; // calls 73% / folds 12% overall
    },
  };
}

module.exports = { nontechyk, megistekik, nontekik };
