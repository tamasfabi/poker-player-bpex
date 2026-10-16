import { Category, chenScore, evaluate, hasFlushDraw, hasStraightDraw, rankValue } from "./hand";
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

  const hand = evaluate([...hole, ...board]);
  const boardHand = evaluate(board);
  const usesHole = hand.category > boardHand.category || (hand.category === boardHand.category && hand.score > boardHand.score && hand.category >= Category.Straight);
  const isRiver = board.length === 5;

  if (usesHole && hand.category >= Category.Straight) {
    return toCall > 0 && toCall >= stack * 0.5 ? allIn() : raise(gs.pot);
  }
  if (usesHole && hand.category >= Category.TwoPair) {
    return toCall > stack * 0.5 ? call() : raise(gs.pot * 0.75);
  }
  if (usesHole && hand.category === Category.Pair) {
    const pairRank = hand.ranks[0];
    const topBoard = Math.max(...board.map(rankValue));
    if (pairRank >= topBoard) {
      return toCall === 0 ? raise(gs.pot * 0.5) : callIfCheap(Math.max(gs.pot * 0.6, stack * 0.2));
    }
    return callIfCheap(gs.pot * 0.25);
  }
  if (!isRiver && (hasFlushDraw(hole, board) || hasStraightDraw(hole, board))) {
    return callIfCheap(gs.pot * 0.35);
  }
  return check();
}

export default Player;
