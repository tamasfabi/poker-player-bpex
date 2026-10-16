---
title: Profiling Lean Poker opponents from tournament game logs
author: Marton
date: 2026-10-16
branch: main
cost: { minutes: 1, tokens: 1855 }
touches:
  - src/Player.ts
  - CLAUDE.md
  - resources/docs
  - docs/GUIDE.md
---

## Decided

The `/api/tournament/<tid>/game/<gid>/log` endpoint is the single highest-value
data source in this project: every log entry carries a `game_state` with **all
four players' hole cards**, so opponent ranges can be read exactly rather than
inferred. Profiling the last 24 finished games (~1700 hands) is enough to
characterise every bot at the table.

The three opponents resolve to clear archetypes, and the actionable axis is
**bet size**, not hand category. Measured fold-to-bet by price (fraction of pot):
nontekik folds 8/18/42% at <=0.2p / 0.2-0.4p / 0.4-0.7p (calling station);
megistekik folds 11/60/72% (tight, folds to normal bets); nontechyk folds
~48-50% up to 0.7p and 100% above it (small n=7, but it is a pot-odds bot, so
the direction is structural). Our own bot folds 27/62/88% — the biggest folder
at the table.

A preflop open raise of >=2BB takes the pot down uncontested **76-84%** of the
time for every team that tries it. That makes stealing the largest single
untapped edge, ahead of any postflop tuning.

## Tried and ruled out

Naive log parsing gives badly wrong stats. Two traps:

1. The engine logs a **blind post as a `(raise)`** of exactly sb/bb. Counting
   those inflates PFR enormously — nontechyk reads as 42% PFR instead of its
   true 10%, flipping it from "loose-aggressive" to its actual "loose-passive
   preflop, hyper-aggressive postflop".
2. Consecutive log entries by the same player are *not* always one split
   decision. I first assumed a `(call)` followed by a `(raise)` from the same
   player was the engine splitting one `toCall + overage` return value. It is
   not — those are separate streets, with nontechyk leading 1BB into each new
   board. Merge entries only when `(game_id, round, len(community_cards),
   on_turn)` all match.

`time_used` is **cumulative per game**, not per decision. Treating it as
per-call makes it look like we are near a timeout (p95 ~4.4s); divided by the
decision count it is ~10-20ms. There is no timeout problem.

## Watch out

`CLAUDE.md` and `docs/GUIDE.md` document `tools/analyze.py`, `docs/opponents.md`
and `sim/` as if they exist. They do not — only `tools/standings.py` is real.
So the documented "data -> hypothesis -> simulate -> deploy" workflow currently
has neither a data step nor a simulator, and any plan that leans on them needs
them built first.

The log's `game_state` omits `minimum_raise`, `bet_index` and `in_action`, which
the live `bet_request` payload does include. Code shared between a log replayer
and the live bot must not assume those fields are present.

Tournament `points` are cumulative across every version a team ever deployed, so
the standings understate us: 72 of our games were played by the default folding
player at 1.50 ppg. Judge a strategy change by per-version or per-commit ppg,
never by the leaderboard. Game `status` in the game-list API is `"done"`, not
`"finished"` — filtering on the wrong string silently yields zero games.
