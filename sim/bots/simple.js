'use strict';
// Simple archetypes: folder, maniac, calling station, random.
const { view } = require('./util');

// (a) folds to any bet, checks when it can
function folder() {
  return { bet: () => 0 };
}

// (b) shoves every hand
function maniac() {
  return { bet: gs => gs.players[gs.in_action].stack };
}

// (c) always calls, never raises
function station() {
  return { bet: gs => { const v = view(gs); return v.call(); } };
}

// (f) random: fold/check 35%, call 45%, raise 20% (random size, occasionally shove)
function random(ctx) {
  return {
    bet: gs => {
      const v = view(gs);
      const r = ctx.rng();
      if (r < 0.35) return 0;
      if (r < 0.8) return v.call();
      if (r < 0.85) return v.allIn();
      return v.raise(Math.max(v.bb, v.pot * (0.5 + ctx.rng() * 1.5)));
    },
  };
}

module.exports = { folder, maniac, station, random };
