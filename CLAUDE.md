# poker-player-bpex

Lean Poker bot (TypeScript) for team **bpex** in the Apex Lab tournament.
API docs: https://www.leanpoker.org/docs/api/player

## Deploy

Every push to `main` on GitHub (`tamasfabi/poker-player-bpex`) is deployed automatically by Lean Poker to Heroku
(~20 s). Bump `VERSION` in `src/index.ts` on every strategy change so the dashboard shows which version is playing.

Check what is live:

```bash
curl -s -X POST -d action=version https://young-ocean-02354-82ccab7adf12.herokuapp.com/
```

A crash or timeout means we fold every hand, so always run `npm run build` and the sanity checks before pushing.

## Layout

- `src/index.ts`: express server (`bet_request`, `showdown`, `version`, `check`). Don't touch it unless you have to.
- `src/Player.ts`: strategy. `decide(gameState)` returns the bet; `betRequest` wraps it in try/catch and calls the callback exactly once.
- `src/hand.ts`: 5–7 card hand evaluator (`evaluate`), draws, Chen preflop score.
- `src/types.ts`: game state types.
- `tools/standings.py`: tournament points and our recent games.
- `tools/analyze.py`: opponent profiling from game logs (see `docs/opponents.md`).
- `sim/`: local tournament simulator for A/B testing strategies (see `sim/README.md`).
- `docs/GUIDE.md`: strategy notes and the workflow for improving the bot.

## Testing a change before deploying (deploys are risky: a 503 mid-game disqualifies us)

1. `npm run build && node tools/spots.js`: hand-picked spots from real logs (labels say what we want).
2. Simulator, realistic field (models of the real bots in `sim/bots/real.js`):
   `node sim/baselines/build.js HEAD vX` to snapshot the live version, then compare
   `node sim/run.js --games 4000 --players bpex,nontechyk,megistekik,nontekik --seed 11 --workers 12`
   against the same command with `--players vX,... --bot vX=sim/baselines/vX/Player.js`. Use 2+ seeds; ship only if
   the gain exceeds the ±0.07 confidence interval.
3. `node tools/replay.js old=sim/baselines/vX/Player.js new=out/Player.js --since HH:MM`: replays every real decision;
   all-in call/fold spots are scored exactly from the revealed hole cards. Raises/bluffs can't be scored there.
4. After deploying, watch the first ~5 live games with `tools/standings.py`; roll back immediately if it regresses.

The sim's opponent models are approximations: they did not reproduce v1.5's live regression (more raising/bluffing
got punished by the real, adapting bots), so treat aggression changes with extra suspicion.

`tsconfig.json` only compiles `src/**`, so tooling outside `src/` can't break the deploy build.

## Bet semantics

- `toCall = current_buy_in - me.bet`
- Return 0 to check/fold, `toCall` to call, `>= toCall + minimum_raise` to raise, `>= stack` for all-in.
- Anything between call and min-raise counts as a call; below call means fold.

## Tournament data

- Dashboard: https://live.leanpoker.org/tournament/6ad1f731e9d3abe3c2580703
- API (use `curl --compressed -H 'Accept: application/json'`):
  - `/api/tournament/<tid>`: teams, points, deployments
  - `/api/tournament/<tid>/game`: games with ranking per team
  - `/api/tournament/<tid>/game/<gid>/log`: full hand history including **all players' hole cards**
