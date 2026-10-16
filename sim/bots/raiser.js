'use strict';
// (e) Hand-strength raiser (approximates "megistekik"): raises big with pairs and
// high cards preflop, bets any pair or better postflop, otherwise check/fold.
const { view } = require('./util');
const { evalCards, category } = require('../engine/cards');

function raiser() {
  return {
    bet: gs => {
      const v = view(gs);
      if (v.hole.length < 2) return 0;
      const r1 = v.rank(v.hole[0]), r2 = v.rank(v.hole[1]);
      const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
      const T = 8, A = 12; // rank indexes: 2=0 ... T=8, J=9, Q=10, K=11, A=12

      if (v.board.length === 0) {
        if (r1 === r2) {
          if (hi >= T) return v.toCall > 4 * v.bb ? v.allIn() : v.raise(Math.max(6 * v.bb, v.pot));
          return v.toCall > 8 * v.bb ? v.call() : v.raise(4 * v.bb);
        }
        if (lo >= T) return v.toCall > 10 * v.bb ? (hi === A ? v.call() : 0) : v.raise(3 * v.bb);
        if (hi === A) return v.toCall <= 2 * v.bb ? v.call() : 0;
        if (hi >= 11 && v.toCall <= v.bb) return v.call();
        return 0;
      }
      const cards = [...v.hole, ...v.board];
      const sc = evalCards(cards, cards.length);
      const cat = category(sc);
      const boardCat = v.board.length >= 5 ? category(evalCards(v.board, 5)) : -1;
      if (cat >= 2 && cat > boardCat) return v.toCall >= v.stack * 0.6 ? v.allIn() : v.raise(v.pot);
      if (cat === 1) {
        if (v.toCall === 0) return v.raise(v.pot * 0.5);
        return v.toCall <= v.pot * 0.5 ? v.call() : 0;
      }
      return v.toCall <= v.bb ? v.call() : 0;
    },
  };
}

module.exports = { raiser };
