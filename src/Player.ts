// bpex maniac: shove-first aggression. See README.md for the rules this file implements:
// push/fold any two from 20bb down, 6.5bb opens deeper, call all-ins with QQ+/AK only,
// big postflop bets only with two pair or better.
import { chenScore } from "./hand";
import { equity } from "./equity";
import { observe, raiseFrequency, shoveRange } from "./opponents";
import { measuredShoveRange, watch } from "./livelog";
import { GameState, PlayerState } from "./types";

export class Player {
  public betRequest(gameState: GameState, betCallback: (bet: number) => void): void {
    let bet = 0;
    try {
      bet = decide(gameState);
    } catch (e) {
      console.error("betRequest failed", e);
    }
    betCallback(Math.max(0, Math.floor(bet)));
  }

  public showdown(gameState: GameState): void {}
}

// Open-raise to 3bb: big enough that nontekik's BB stops defending (it only resteals its top 30% once its call > 1.5bb)
const OPEN_TO = 3;
// How often we stab 3/4 pot heads-up after the opponent checks to us (all three bots check only weak hands)
const STAB = 0.6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Streets on which we already raised, so we never get dragged into endless min-raise wars
const raisedStreets = new Set<string>();

function decide(gs: GameState): number {
  const me = gs.players[gs.in_action];
  const hole = me.hole_cards ?? [];
  const board = gs.community_cards ?? [];
  if (hole.length < 2) return 0;
  observe(gs);
  try {
    watch(gs);
  } catch (e) {
    console.error("livelog watch failed", e);
  }

  const bb = gs.small_blind * 2;
  const toCall = Math.max(0, gs.current_buy_in - me.bet);
  const stack = me.stack;
  const opponents = gs.players.filter((p, i) => i !== gs.in_action && p.status === "active");
  // The opponent who made the current biggest bet
  const aggressor: PlayerState | undefined = opponents.reduce<PlayerState | undefined>((a, p) => (!a || p.bet > a.bet ? p : a), undefined);
  // Chips we can actually win or lose: the biggest stack still in against us
  const effective = Math.min(stack + me.bet, Math.max(0, ...opponents.map(p => p.stack + p.bet)));
  const effectiveBlinds = effective / bb;
  const potOdds = toCall / (gs.pot + toCall);

  const check = () => 0;
  const call = () => Math.min(toCall, stack);
  const streetKey = `${gs.game_id}:${gs.round}:${board.length}`;
  const reRaised = raisedStreets.has(streetKey);
  const raise = (extra: number) => {
    // Second raise on the same street: only all-in with a monster, otherwise just call
    if (reRaised) return equityCache >= 0.8 ? stack : Math.min(toCall, stack);
    if (raisedStreets.size > 5000) raisedStreets.clear();
    raisedStreets.add(streetKey);
    return Math.min(stack, toCall + Math.max(gs.minimum_raise, Math.floor(extra)));
  };
  let equityCache = 0;
  const allIn = () => stack;

  if (board.length === 0) {
    // Fewer players left -> blinds come around faster and average hands are stronger, so play wider
    const playersLeft = gs.players.filter(p => p.status !== "out").length;
    const chen = chenScore(hole) + (playersLeft <= 2 ? 3 : playersLeft === 3 ? 1 : 0);
    const raised = gs.current_buy_in > bb;

    if (!raised) {
      if (effectiveBlinds <= 10) {
        // Push/fold: the shorter the effective stack, the wider we shove
        const shoveAt = effectiveBlinds <= 3 ? -99 : effectiveBlinds <= 6 ? 4 : 5;
        return chen >= shoveAt ? allIn() : check();
      }
      if (chen >= 12) return raise(gs.pot + 3 * bb);
      // Wide steal: the bots fold most hands to a raise and play weakly postflop
      if (chen >= 3) return raise(OPEN_TO * bb - gs.current_buy_in);
      return check();
    }

    // Facing a raise: equity against the raiser's likely range vs the price
    const freq = aggressor ? raiseFrequency(gs, aggressor.name) : 0.25;
    const bigRaise = !aggressor || aggressor.stack === 0 || gs.current_buy_in >= 10 * bb;
    let range = clamp(freq * (bigRaise ? 0.7 : 1), 0.08, 1);
    if (aggressor && aggressor.stack === 0) range = Math.max(range, shoveRange(aggressor));
    // Better than any guess: the hands this opponent actually shoved at this depth, read from finished hands
    const measured = aggressor && aggressor.stack === 0 ? measuredShoveRange(aggressor.name, aggressor.bet / bb) : undefined;
    if (measured !== undefined) range = measured;
    const callers = opponents.filter(p => p !== aggressor && p.bet === gs.current_buy_in).length;
    const eq = equity(hole, board, 1 + callers, { aggressorRange: range });
    equityCache = eq;

    if (eq >= 0.62 && stack > 40 * bb) return raise(gs.pot);
    if (eq >= potOdds + 0.04) return effectiveBlinds <= 15 || toCall >= stack * 0.35 ? allIn() : call();
    return check();
  }

  // Postflop
  const isRiver = board.length === 5;
  if (toCall === 0) {
    const eq = equity(hole, board, opponents.length);
    equityCache = eq;
    if (eq >= 0.75) return raise(gs.pot * 0.75);
    if (eq >= 0.55 && opponents.length <= 2) return raise(gs.pot * 0.5);
    // Heads-up and the opponent checked to us: its checking range is weak, a 3/4-pot stab folds most of it
    if (opponents.length === 1) {
      const n = gs.players.length;
      const dist = (i: number) => (i - gs.dealer - 1 + 2 * n) % n;
      const oppIdx = gs.players.indexOf(opponents[0]);
      if (dist(oppIdx) < dist(gs.in_action) && Math.random() < STAB) return raise(gs.pot * 0.75);
    }
    // Mixed semi-bluff heads-up so we are harder to profile
    if (opponents.length === 1 && !isRiver && eq >= 0.3 && Math.random() < 0.3) return raise(gs.pot * 0.5);
    return check();
  }

  // Facing a bet: the bigger the bet relative to the pot, the stronger the bettor's range
  const betRatio = toCall / Math.max(gs.pot - toCall, 1);
  const baseRange = betRatio <= 0.4 ? 0.55 : betRatio <= 0.8 ? 0.35 : betRatio <= 1.3 ? 0.22 : 0.12;
  const freq = aggressor ? raiseFrequency(gs, aggressor.name) : 0.25;
  let range = clamp(baseRange * (0.6 + freq), 0.08, 1);
  // nontekik bluffs ~0.75-pot bets heads-up with air, so its bets there are wider than their size says
  if (aggressor?.name === "nontekik" && opponents.length === 1 && betRatio <= 1) range = Math.min(1, range * 1.6);
  const eq = equity(hole, board, opponents.length, { aggressorRange: range });
  equityCache = eq;

  if (eq >= 0.7) return toCall >= stack * 0.4 ? allIn() : raise(gs.pot);
  if (eq >= potOdds + 0.03) return call();
  return check();
}

export default Player;
