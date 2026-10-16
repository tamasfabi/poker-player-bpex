# sim - local Lean Poker sit'n'go simulator

Plain Node.js (no build step, no new dependencies). Plays thousands of 4-player sit'n'gos
between our compiled strategy (`out/Player.js`) and opponent archetypes, and reports
tournament points so strategy changes can be A/B tested before deploying.

```
npm run build                                  # compile src/ -> out/ (the sim imports out/Player.js)
node sim/run.js --games 2000 --players bpex,tag,maniac,station --seed 1
node sim/test/hand.test.js                     # evaluator + engine checks
```

## Rules mirrored

- 4 (any number >= 2) players, 1000 chips each. Small blind schedule as observed in the live logs
  (docs/opponents.md): `2,3,5,10,15,20,30,40,50,70,100,150,200,300,500,1000,2000`, rising every 10 hands
  (`--blinds`, `--blind-period`).
- `game_state` exactly as the Lean Poker API: `players[]` with `id,name,status,version,stack,bet`
  (`hole_cards` only for the player in action), `in_action`, `dealer`, `small_blind`, `current_buy_in`,
  `pot`, `minimum_raise`, `community_cards`, `round`, `bet_index`, `orbits`, `game_id`, `tournament_id`.
  Bets and pot are cumulative over the hand (never reset per street).
- Returned bet: `< toCall` = fold (0 with nothing to call = check); `>= stack` = all-in; `> toCall` = raise
  (the live engine accepts any amount above the call as a raise, e.g. nontechyk's +1bb "raise" to 1.5bb, and
  every raise reopens the action, so min-raise wars are possible); `== toCall` = call. Pass `--strict-min-raise`
  to follow the API docs instead (bets below `toCall + minimum_raise` are calls). Non-numbers / exceptions = fold.
- Side pots from cumulative bets, uncalled chips refunded, odd chips to the first winner after the dealer.
  Showdowns are scored with `src/hand.ts` (`out/hand.js`) `evaluate`.
- Heads-up: dealer posts the small blind and acts first preflop. Blinds move to the next player with chips.
- Knockout order decides ranking (several busts in one hand: bigger starting stack ranks higher).
  Points default `5,3,0,0` (`--points`).

## Players

| name      | behaviour |
|-----------|-----------|
| `bpex`    | our strategy, `out/Player.js` (run `npm run build` first) |
| `nontechyk` | model of the live leader (docs/opponents.md): opens 45% of hands to 1.5bb, c-bets 100% at 20% pot on every street, never raises postflop, folds ~67% to 3-bets / ~66% to postflop raises, calls all-ins wide when the price is right |
| `megistekik` | model of megistekik: tight 21% opens to 3bb, no limps, 84% half-pot c-bets, bets or folds (never calls), folds 92% to all-ins, shoves Ax/KT+/QJ/55+ at <= 15bb, min-re-raises with premiums |
| `nontekik` | model of nontekik: limping calling station, BB defence by raise size, calls 73% of postflop bets, over-bet shoves with any pair, calls preflop all-ins ~11% |
| `tag`     | generic tight-aggressive Monte Carlo equity bot: raises on high equity, calls by pot odds, push/fold short |
| `loosetag`| looser/more passive `tag` |
| `raiser`  | generic hand-strength raiser: big raises with pairs / two broadway cards, bets any pair postflop |
| `maniac`  | shoves every hand |
| `station` | calls everything, never raises |
| `folder`  | always returns 0 (folds to any bet, checks otherwise) |
| `random`  | random fold / call / raise |
| `path.js` | any compiled strategy module; or name it with `--bot name=path` |

A strategy module may export a `Player` class with `betRequest(gs, cb)` (callback must be called
synchronously, like the stock player), an object with `betRequest`, or a plain `(gs) => number` function.

## A/B testing two versions of Player

Snapshot any git revision as a baseline (compiled into `sim/baselines/<name>/Player.js`; v1.1, v1.3 and
v1.5 are already there):

```
node sim/baselines/build.js 779fe59 v1.1
node sim/run.js --games 2000 --players bpex,nontechyk,megistekik,nontekik
node sim/run.js --games 2000 --players v1.3,nontechyk,megistekik,nontekik --bot v1.3=sim/baselines/v1.3/Player.js
```

Comparing each version in the same field (same seed) is the cleanest A/B; seating two versions at the same
table also works but they then also play against each other.

Seating is rotated every game (game g shifts the seat list by g), so every player sits in every
position equally often. Each game gets its own RNG stream and `Math.random` is swapped for a seeded PRNG
while a game runs, so a given `--seed` + player list + `--workers` count reproduces exactly (fields containing
`tag` currently still vary slightly with the worker count; fields of strategy modules and the real-opponent
models do not). Use the same seed for both arms of an A/B comparison and look at the `±95%` column
(1.96 standard errors of avg points); 2000 games gives roughly ±0.1 points.

## Speed

~1 s per 1000 games per core with the stock bots; 2000 games finish in a couple of seconds on a laptop
with worker threads (default: one worker per CPU, max 12).

`src/equity.ts` (Monte Carlo with the slow 21-combination evaluator, 15-60 ms per call) would dominate.
The sim therefore patches the `equity` export of any `equity.js` module a strategy loads:

- `SIM_EQUITY=fast` (default): same Monte Carlo semantics (ties split, `aggressorRange` top-X% holdings
  ranked by made hand / Chen score) on a bitwise 7-card evaluator; identical iteration count.
- `SIM_EQUITY=orig`: original code, optionally with `SIM_EQUITY_ITERS=N` iterations.
- `SIM_EQUITY=off`: untouched (slow but exact).

`src/` is never modified. If `src/equity.ts` changes its signature, update `patchEquityModules` in
`sim/loader.js` (it currently understands `(hole, board, opponents, iterations)` and
`(hole, board, opponents, { aggressorRange, iterations, timeBudgetMs })`).

## Options

```
--games N            sit'n'gos to play (default 500)
--players a,b,c,d    seat list (default bpex,tag,maniac,station)
--bot name=path      define a name as a strategy module
--seed N             base seed (default 1)
--workers N          worker threads
--blinds 2,3,5,...   small blind levels      --blind-period N   hands per level (10)
--strict-min-raise   API-doc betting rules instead of the live engine's "any bet above the call is a raise"
--stack N            starting stack (1000)   --points 5,3,0,0   points per place
--log G              play game G alone and print every action, board, showdown and pot
--showdown           also call showdown(gs) on strategy modules
--json               machine-readable output
```

`--log` is the quickest way to see why the bot did something:
`node sim/run.js --log 3 --players bpex,tag,maniac,station | less`.

## Layout

```
sim/run.js              CLI, worker fan-out, report
sim/runner.js           runs a list of games in-process (seating rotation, per-game RNG)
sim/worker.js           worker_threads entry
sim/loader.js           builds bots from names/paths, patches equity.js for speed
sim/engine/game.js      hold'em sit'n'go engine (betting, side pots, eliminations)
sim/engine/cards.js     card encoding, fast 5-7 card evaluator, Monte Carlo equity
sim/engine/rng.js       seeded PRNG
sim/bots/real.js        models of the live opponents (nontechyk, megistekik, nontekik)
sim/bots/*.js           generic archetypes (tag, raiser, maniac, station, folder, random)
sim/baselines/          snapshots of old strategy versions for A/B (build.js)
sim/test/hand.test.js   checks for src/hand.ts and the engine
```
