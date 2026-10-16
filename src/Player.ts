import { chenScore } from "./hand";
import { equity } from "./equity";
import { observe, raiseFrequency } from "./opponents";
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function decide(gs: GameState): number {
  const me = gs.players[gs.in_action];
  const hole = me.hole_cards ?? [];
  const board = gs.community_cards ?? [];
  if (hole.length < 2) return 0;
  observe(gs);

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
  const raise = (extra: number) => Math.min(stack, toCall + Math.max(gs.minimum_raise, Math.floor(extra)));
  const allIn = () => stack;

  if (board.length === 0) {
    // Fewer players left -> blinds come around faster and average hands are stronger, so play wider
    const playersLeft = gs.players.filter(p => p.status !== "out").length;
    const chen = chenScore(hole) + (playersLeft <= 2 ? 3 : playersLeft === 3 ? 1 : 0);
    const raised = gs.current_buy_in > bb;

    if (!raised) {
      if (effectiveBlinds <= 15) {
        // Push/fold: the shorter the effective stack, the wider we shove
        const shoveAt = effectiveBlinds <= 3 ? -99 : effectiveBlinds <= 6 ? 5 : effectiveBlinds <= 10 ? 6 : 7;
        return chen >= shoveAt ? allIn() : check();
      }
      // Button and small blind only have the blinds left to act: steal wider, the bots fold ~80% to raises
      const lateSeat = isLateSeat(gs);
      if (chen >= 12) return raise(gs.pot + 3 * bb);
      if (chen >= 10) return raise(3 * bb);
      if (chen >= 8 || (lateSeat && chen >= 4)) return raise(2 * bb);
      if (chen >= 6 && toCall < bb) return call();
      return check();
    }

    // Facing a raise: equity against the raiser's likely range vs the price
    const freq = aggressor ? raiseFrequency(aggressor) : 0.25;
    const bigRaise = !aggressor || aggressor.stack === 0 || gs.current_buy_in >= 10 * bb;
    const range = clamp(freq * (bigRaise ? 0.7 : 1), 0.08, 1);
    const callers = opponents.filter(p => p !== aggressor && p.bet === gs.current_buy_in).length;
    const eq = equity(hole, board, 1 + callers, { aggressorRange: range });

    if (eq >= 0.62 && stack > 40 * bb) return raise(gs.pot);
    // Habitual small raisers fold most of their range to a 3-bet
    const smallRaise = gs.current_buy_in <= 3 * bb;
    if (smallRaise && freq >= 0.35 && callers === 0 && (eq >= 0.45 || (eq >= 0.35 && Math.random() < 0.35))) {
      return effectiveBlinds <= 25 ? allIn() : raise(2 * gs.current_buy_in);
    }
    if (eq >= potOdds + 0.04) return effectiveBlinds <= 25 ? allIn() : call();
    return check();
  }

  // Postflop
  const isRiver = board.length === 5;
  if (toCall === 0) {
    const eq = equity(hole, board, opponents.length);
    if (eq >= 0.75) return raise(gs.pot * 0.75);
    if (eq >= 0.55 && opponents.length <= 2) return raise(gs.pot * 0.5);
    // Mixed semi-bluff heads-up so we are harder to profile
    if (opponents.length === 1 && !isRiver && eq >= 0.3 && Math.random() < 0.3) return raise(gs.pot * 0.5);
    return check();
  }

  // Facing a bet: the bigger the bet relative to the pot, the stronger the bettor's range
  const betRatio = toCall / Math.max(gs.pot - toCall, 1);
  const baseRange = betRatio <= 0.4 ? 0.55 : betRatio <= 0.8 ? 0.35 : betRatio <= 1.3 ? 0.22 : 0.12;
  const freq = aggressor ? raiseFrequency(aggressor) : 0.25;
  const range = clamp(baseRange * (0.6 + freq), 0.08, 1);
  const eq = equity(hole, board, opponents.length, { aggressorRange: range });

  if (eq >= 0.7) return toCall >= stack * 0.4 ? allIn() : raise(gs.pot);
  // Small stabs (e.g. auto c-bets) heads-up: raise for value, sometimes as a bluff against frequent bettors
  if (betRatio <= 0.4 && opponents.length === 1 && toCall < stack * 0.2) {
    if (eq >= 0.55) return raise(gs.pot);
    if (!isRiver && freq >= 0.35 && eq >= 0.25 && Math.random() < 0.3) return raise(gs.pot);
  }
  if (eq >= potOdds + 0.03) return call();
  return check();
}

// We act after everyone except the blinds: on the button, or in the small blind
function isLateSeat(gs: GameState): boolean {
  const n = gs.players.length;
  if (!gs.players[gs.dealer]) return false;
  const next = (i: number) => {
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (gs.players[j].status !== "out") return j;
    }
    return i;
  };
  const smallBlind = next(gs.dealer);
  return gs.in_action === gs.dealer || gs.in_action === smallBlind;
}

export default Player;
