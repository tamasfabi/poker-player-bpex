# Opponent profiles and our leaks (Lean Poker, tournament 6ad1f731…)

Source: `python3 tools/analyze.py --since 12:50 --version <player>=<version>` over the 35 games finished
12:50–13:03 UTC (the period in which all four bots run real code; before 12:50 every bot except
nontechyk/nontekik was a default folding player). All numbers are from the public game logs
(hole cards of every player are visible). Sample sizes are given as `n=`; anything with n<15 is a hint, not a fact.
Hand references are `game <id> round <r>`; reproduce with `python3 tools/analyze.py --dump <id> <r>`.

## 1. Game structure that matters for strategy

* 4 bots, 1000 chips each, 4000 total. Blind level increases every 10 rounds:
  SB 2,3,5,10,15,20,30,40,50,70,100,150,200,300,500,1000,2000 (BB = 2x). BB per round: r0 4, r30 20, r60 60, r80 100, r100 200, r120 400.
* Average stack (1000) in BB: r0 250bb, r40 33bb, r60 17bb, r80 10bb, r100 5bb. Deep-stack poker exists only
  for the first ~40 rounds; from round ~60 every stack is a push/fold stack. Median game since 12:50: 96 rounds (min 20, max 150).
* 7 games (12:50–12:52) were cut at round 20–23 with chips still on the table and ranked by stack; since then all games run to a
  single survivor. Being ahead early is still worth something, but it is not the normal end condition.
* Engine quirks seen in the logs: any bet above `current_buy_in` is accepted as a "raise" (nontechyk raises by +1bb from the blinds,
  i.e. to 1.5bb); a betting round continues as long as someone re-raises, so two bots can min-raise each other all the way to all-in
  (raise wars, see 5.3). A disqualification (unreachable, invalid/negative response) removes the whole stack from the table
  (nontekik lost 11 x 1000 that way; we lost 994 once, `6ad21cfc214edff8d0a5d635 round 19`, HTTP 503).

## 2. nontechyk — "tight-aggressive equity bot" v8 (leader). n=832 hands, 35 games (v7 behaves the same; v9 just appeared)

| stat | value |
|---|---|
| VPIP / PFR | 51.5% / 42.8% (not tight at all; opens Q4o, 62o, 52o, 83o, T2o) |
| open size | 78% of all preflop raises are "to <2bb" (adds exactly 1bb, e.g. SB 0.5bb -> 1.5bb); 3-4bb otherwise. Steal success only 40% (n=305) |
| flop c-bet | 100% (128/128), median size 0.20 pot; 299/336 bets are <= 1/3 pot. **Zero postflop raises in 832 hands** |
| fold to 3-bet | 67% (24/36); v7: 84% (16/19) |
| fold to postflop bet/raise | 66% (40/61); vs bpex raise 62.5% (n=16) |
| fold BB to raise-to 3-5bb | 81% (n=63); to 5-10bb 62% (n=13) |
| facing an all-in preflop | calls/raises 33% (12/36) with K9o, Q2s, K8s, 33, J2o, K2s, KJo, KK, QQ… – pot-odds driven, but calls KJo@9bb, K2s@11bb, 33@6bb too. Vs bpex shoves: called 5/12 (42%): Q2s, QQ, KJo, Q9s, KJo |
| facing an all-in postflop | folds 76% (19/25) |
| own preflop shoves | 23 (2.9%), range includes junk when very deep or very short: K9o@78bb, Q2s@47bb, Q5o@159bb, Q3o@11bb |
| showdown win rate | **41.6%** (42/101); showdown holdings: A5o x4, A4o x3, 83o x3, Q9o x3, 62o, 65o, 96o… |
| where it wins / loses | +20001 uncontested (330 pots, our folds), +10772 showdowns won; -5592 showdowns lost, -5456 all-in lost |

How it reacts to us: folds 74% to our preflop raises (n=27), re-raises 18.5%; folds 62.5% to our postflop raises (n=16); calls our all-ins 42% (n=12).

**Exploits**
1. **Defend the BB against its 1.5bb raise with any two cards** (call 0.5bb into ~3bb; even 72o has the odds). Our v1 bot folded 79% here (see 5.1).
2. **Attack the 20%-pot c-bet.** It c-bets 100% and never raises postflop, so a raise (2.5-3x its bet) folds it 62-66%, and when it continues we are
   against a bot with a 41.6% showdown win rate. Call down with any pair / ace-high on dry boards; raise with any pair, draw or two overcards.
3. **3-bet its opens to 4-5x** (fold 67-84%). Its 3-bets of us are rare (3.0-18.5%), so when it does re-raise (or bets >0.75 pot postflop, only 11 times
   in 832 hands) it has something: don't 4-bet light, fold medium hands.
4. **Do not bluff-shove into it when it has pot odds** (short stacks, it calls J2o/K9o for <3bb). Shove for value instead: our 66+/A8+/KT+ shoves are
   called by Q2s/KJo/Q9s type hands and are big favourites.
5. Call its preflop shoves wider than normal: 77+, A9o+, A5s+, KQ, KJs are ahead of a range that contains Q5o/K9o/Q2s/Q3o.

## 3. megistekik — "ultragood_python_player" v0.4 (v0.5 deploying). n=653 hands

| stat | value |
|---|---|
| VPIP / PFR | 23.5% / 21.5%, 0 limps; opens ATo+, KTo+, QJo, 55+, A2s+ (ATo x11, AKo x8, AQo x7, KTo x6) |
| open size | 3bb (80 of 123 opens), 3.5-4bb otherwise, steal success 52% |
| flop c-bet | 84% (26/31), always exactly 50% pot (77/77 bets in 0.34-0.75 pot). AF 6.2: 77 bets vs 13 calls – it bets or folds, it almost never calls |
| fold to 3-bet | 40% (2/5), calls the rest |
| fold to postflop bet/raise | 68% (23/34) |
| facing an all-in preflop | folds 89% (16/18); **vs bpex 11/12 fold (92%)**; calls only with 99, QQ (and 4 earlier with JJ/KK/AK) |
| facing an all-in postflop | **folds 10/10** |
| own preflop shoves | **45 (7.4% of decisions)** when stack <= ~15bb: any Ax (A3o, A4o, A6o, A7o, A8o…), KTo/KQ, QJs, 55, AK/QQ/AA. Won 41/45, 38 of them uncontested |
| showdown win rate | 48% (28/58) |
| raise wars | min-re-raises back without limit: `6ad21d15214edff8d0a5d636 round 13` AQo 4-bet war vs our AKo to all-in (won), `6ad21d2e214edff8d0a5d637 round 5` river war with a set |

How it reacts to us: folds 78% to our preflop raise (n=58), re-raises 10%; folds 60% to our postflop raise (n=15); folds 92% to our all-ins (n=12).

**Exploits**
1. **3-bet-shove over its 3bb open with effective stacks 10-25bb** (and open-shove into its blinds when it is 10-20bb deep): it folds 92% to all-ins
   and only continues with roughly TT+/AK. Expected gain ~4.5bb per attempt uncontested; stop if it starts calling.
2. **Raise its 50%-pot c-bet, preferably all-in when stacks allow**: 0/10 all-in calls postflop, 68% fold to any raise. Flat-calling its bets is
   the worst option (it keeps barrelling 50% pot).
3. **Call its short-stack shoves wide**: vs its shove range (any Ax, KT+, QJ, 55+) 66+/A8+/KQ/KJs are favourites; A3o/A6o-type hands are 40% of it.
4. **Never enter a min-raise war with it.** If it re-raises our 3-bet, treat it as "at least AQ/TT": either shove with QQ+/AK or fold; cap the number of
   re-raises per street to 1 in the bot.
5. Its BB folds 62-100% to any raise size: raise its blind every orbit from the SB/button with anything playable.

## 4. nontekik — v0.2.0 (v0.3.0 "ranges" just appeared, n=74), often `ERROR: Unreachable`. n=1945 hands

| stat | value |
|---|---|
| VPIP / PFR | 44% / 6%, 339 limps (calling station) |
| BB defence | calls 86% vs raise <2bb, 69% vs 2-3bb, 35% vs 3-5bb; folds 88% vs >10bb |
| postflop | AF 0.37; **calls 73% of bets, folds 12%** (80/667); calls 58% of nontechyk's preflop raises and 73% of its postflop bets |
| postflop shoves | 142 (!) over-bet shoves, 131 won small pots uncontested; when called they were often weak (ATo -1368, A2o -1129, QJo -1057, J9o -951, KK/turn -912) |
| facing all-in preflop | calls 11% (9/83), with K8s, 93s, T8s, T9o, AKo, KK; vs bpex all-ins folds 84% (n=50) |
| showdown | 46.5% won (185/398); **117 mucked losses = -25113 chips** (pays off value bets) |
| results | 4th in 16/35 games, 11 disqualifications (-11000). v0.3.0 (n=74): VPIP 54%, PFR 0%, folds 90% to >10bb raises |

**Exploits**: never bluff it; value-bet top pair or better on all three streets with 75-100% pot (it calls); isolate its limps with any strong hand (it
folds to raises >10bb, so keep the isolation raise 3-5bb if you want it to call, shove if you want it out); when it over-bet-shoves postflop call with
top pair good kicker or better (its called shoves lost more often than not). Most of its chips currently flow to nontechyk – taking them ourselves
is the cheapest way to deny the leader.

## 5. Our leaks (bpex v1 "tight aggressive", d3d6204; n=1278 hands, 14 games, 2.57 points/game)

Chips by situation: preflop folds from the blinds **-26284** (596 hands, -20.6 chips/hand vs nontechyk -6.7 and megistekik -12.8 per hand),
fold on flop -2308 (80), all-in showdowns lost -1524, DQ -994; won uncontested +16406 (199), showdowns won +13475 (43/63 = 68%).

1. **Folding the big blind to tiny raises.** BB facing raise-to <2bb: fold 79% (140/177), 6180 chips surrendered to 0.5bb calls at 6:1.
   Examples: `6ad21d92214edff8d0a5d63b round 69` ATo folds to 90 at BB 60 (call 30 into 150); `6ad21df6214edff8d0a5d63f round 96` T9o folds to 210
   at BB 140; `6ad21e0f214edff8d0a5d640 round 143` T9o folds to 1125 at BB 1000 (call 125 into 2125, pot 1/3 of our stack).
   Fix: with to_call <= 1bb (or <= 10% of pot) never fold preflop; vs nontechyk's 1.5bb raise call with everything.
2. **Folding the small blind heads-up.** 109 first-in SB folds heads-up, 8662 chips surrendered. `6ad21e0f214edff8d0a5d640 rounds 120-148`:
   folding K8o, T9o, 98o, 87s, Q6o for 200-500 each (SB 200-500, stacks 2000-3500) while megistekik checks behind; `6ad21d79214edff8d0a5d63a
   rounds 34-44` T2s, 52s, K4s, K3o. Heads-up the SB is the button: open-raise/shove at least 70-80% of hands; with <15bb shove any Ax, Kx, pair,
   suited connector; never open-fold hands better than 72o when SB >= 1/8 of the stack.
3. **Unbounded min-raise war.** `6ad21d15214edff8d0a5d636 round 13`: AKo re-raised 28 times by 18 chips each vs megistekik's AQo until all-in
   for 981 at blinds 3/6 (lost to a Q on the river). Cap re-raises per street; after a 4-bet decide between all-in and fold based on equity vs a
   TT+/AQ+ range (AKo is fine to shove here, but it should happen in one action, and with 98o/ATo it should be a fold).
4. **Preflop passivity.** PFR 4.5% vs VPIP 18.6%: 117 limps, 39 opens, 3-bets only 43 times in 1191 decisions. Limping hands over to
   nontechyk's 1.5bb raise + 100% c-bet. (v1.3 is at PFR 25%.)
5. **Too tight versus all-ins.** Fold 87.5% to nontechyk's shoves (n=16) and 92% to megistekik's preflop raises (n=77) although their ranges are
   wide (section 2/3). Call nontechyk's shoves with 77+/A9+/KQ, megistekik's short shoves with 66+/A8+/KQ.
6. **Postflop vs nontechyk.** Fold 37% to its 20%-pot c-bets (n=100) and raise only 20%; against a 100% c-bet the fold should be ~0% with any
   pair/draw/overcards and the raise frequency much higher.
7. **Availability.** One 503 disqualification (-994, `6ad21cfc214edff8d0a5d635 round 19`) and the `Default TypeScript folding player` version
   showing up for the first 1-18 hands of every game right after a deploy (e.g. `6ad21cca214edff8d0a5d633`: 18 of 20 hands auto-folded). Deploy
   between our games if possible and keep the dyno warm; a negative or non-integer bet response is also a DQ (nontekik was disqualified 26 times that way over the whole tournament).
8. **Note on v1.3 "range-aware equity"** (n=404, 5 games, 4 wins): shoves 17% of preflop decisions with any two (93s@50bb, 43o@17bb, 97o@20bb,
   87s@22bb -1079); 54/65 won because the field folds to all-ins 60-92%, but 11 all-in showdowns lost -3744, and nontechyk calls our shoves 42%.
   Keep shoving at megistekik/nontekik (fold 84-92%), shove only for value against nontechyk when it has odds to call, and keep the any-two shoves
   to stacks <= 12bb.

## 6. One-page plan

* Rounds 0-40 (deep): 3-bet nontechyk's opens to 4-5x and attack its 20%-pot c-bets; open 3-4bb into megistekik/nontechyk blinds (they fold
  62-100%); value-bet nontekik, never bluff it; cap re-raises to one per street.
* Rounds 40-80 (10-30bb): 3-bet-shove megistekik's 3bb opens with any ace/pair/broadway (92% fold); open-shove heads-up or 3-handed from the
  SB/button at <15bb with a wide range; call megistekik's shoves with 66+/A8+/KQ and nontechyk's with 77+/A9+/KQ.
* Rounds 80+ (<10bb): pure push/fold, any two cards from the SB heads-up, call with top ~40% when getting 2:1.
* Always: defend the BB when to_call <= 1bb; never open-fold the SB heads-up; keep the server warm.
