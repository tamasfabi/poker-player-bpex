'use strict';
// Runs a batch of games in-process. Used directly (logging mode) and by worker.js.
const { playGame, makeBlindSchedule } = require('./engine/game');
const { makeRng } = require('./engine/rng');
const { buildBots } = require('./loader');

function runGames(specs, gameIndices, seed, config, log) {
  const ctx = { rng: Math.random };
  const bots = buildBots(specs, ctx);
  const n = bots.length;
  const blinds = makeBlindSchedule(config.blindLevels, config.blindPeriod);
  const results = [];
  const realRandom = Math.random;
  for (const g of gameIndices) {
    // deterministic per game, independent of worker split
    const dealRng = makeRng(seed, g, 'deal');
    ctx.rng = makeRng(seed, g, 'bots');
    Math.random = makeRng(seed, g, 'math'); // strategies using Math.random become reproducible
    const rot = g % n;
    const seated = [];
    for (let s = 0; s < n; s++) seated.push(bots[(s + rot) % n]);
    const r = playGame(seated, {
      rng: dealRng,
      startingStack: config.startingStack,
      blinds,
      maxRounds: config.maxRounds,
      callShowdown: config.callShowdown,
      strictMinRaise: config.strictMinRaise,
      log,
      gameId: `game-${g}`,
      tournamentId: `sim-${seed}`,
    });
    const positions = new Array(n), errors = new Array(n);
    for (let s = 0; s < n; s++) { positions[(s + rot) % n] = r.positions[s]; errors[(s + rot) % n] = r.errors[s]; }
    results.push({ g, positions, hands: r.hands, errors });
  }
  Math.random = realRandom;
  return results;
}

module.exports = { runGames };
