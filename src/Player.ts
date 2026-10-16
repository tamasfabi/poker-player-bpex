import { chenScore } from "./hand";
import { equity } from "./equity";
import { GameState } from "./types";

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

function decide(gs: GameState): number {
  const me = gs.players[gs.in_action];
  const hole = me.hole_cards ?? [];
  const board = gs.community_cards ?? [];
  if (hole.length < 2) return 0;

  const bb = gs.small_blind * 2;
  const toCall = Math.max(0, gs.current_buy_in - me.bet);
  const stack = me.stack;

  const check = () => 0;
  const call = () => Math.min(toCall, stack);
  const raise = (extra: number) => Math.min(stack, toCall + Math.max(gs.minimum_raise, Math.floor(extra)));
  const allIn = () => stack;
  const callIfCheap = (limit: number) => (toCall <= limit ? call() : check());

  if (board.length === 0) {
    // Fewer players left -> blinds come around faster and average hands are stronger, so play wider
    const playersLeft = gs.players.filter(p => p.status !== "out").length;
    const chen = chenScore(hole) + (playersLeft <= 2 ? 3 : playersLeft === 3 ? 1 : 0);
    const stackInBlinds = stack / bb;
    const facingShove = toCall >= stack * 0.4;

    if (stackInBlinds <= 15) {
      // Push/fold: the shorter we are, the wider we shove
      const shoveAt = stackInBlinds <= 6 ? 6 : stackInBlinds <= 10 ? 7 : 8;
      if (chen >= shoveAt) return allIn();
      return callIfCheap(0);
    }
    if (facingShove) return chen >= 11 ? allIn() : check();
    if (chen >= 12) return toCall > 6 * bb ? allIn() : raise(gs.pot + 3 * bb);
    if (chen >= 10) return toCall <= 6 * bb ? raise(3 * bb) : callIfCheap(stack * 0.35);
    if (chen >= 8) return toCall <= bb ? raise(2 * bb) : callIfCheap(Math.max(3 * bb, stack * 0.06));
    if (chen >= 6) return callIfCheap(bb);
    return check();
  }

  // Postflop: Monte Carlo equity against the opponents still in the hand, compared with pot odds
  const opponents = gs.players.filter((p, i) => i !== gs.in_action && p.status === "active").length;
  const eq = equity(hole, board, opponents);
  const potOdds = toCall / (gs.pot + toCall);
  // Someone who bets holds a stronger than random hand: demand more equity the bigger the bet
  const betPressure = toCall === 0 ? 0 : Math.min(0.25, 0.08 + (toCall / Math.max(gs.pot, 1)) * 0.15);
  const adjusted = eq - betPressure;
  const isRiver = board.length === 5;

  if (adjusted >= 0.8) return toCall >= stack * 0.4 ? allIn() : raise(gs.pot);
  if (adjusted >= 0.65) {
    if (toCall === 0) return raise(gs.pot * 0.6);
    return toCall <= gs.pot * 0.5 ? raise(gs.pot * 0.75) : call();
  }
  if (toCall === 0) {
    if (adjusted >= 0.5 && opponents <= 2) return raise(gs.pot * 0.5);
    // Mixed semi-bluff heads-up so we are harder to profile
    if (opponents === 1 && !isRiver && eq >= 0.3 && Math.random() < 0.3) return raise(gs.pot * 0.5);
    return check();
  }
  if (adjusted >= potOdds + 0.03) return call();
  return check();
}

export default Player;
