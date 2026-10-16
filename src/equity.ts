import { chenScore, evaluate } from "./hand";
import { Card, Rank, Suit } from "./types";

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];

const key = (c: Card) => c.rank + c.suit;

// The strongest `fraction` of possible holdings given the current board.
// Postflop holdings are ranked by their made hand, preflop by Chen score.
function topRange(deck: Card[], board: Card[], fraction: number): Card[][] {
  const combos: { cards: Card[]; score: number }[] = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const cards = [deck[i], deck[j]];
      const score = board.length >= 3 ? evaluate(cards.concat(board)).score : chenScore(cards);
      combos.push({ cards, score });
    }
  }
  combos.sort((a, b) => b.score - a.score);
  const keep = Math.max(20, Math.round(combos.length * fraction));
  return combos.slice(0, keep).map(c => c.cards);
}

export type EquityOptions = {
  // Restrict the first opponent (the aggressor) to the top fraction of holdings
  aggressorRange?: number;
  iterations?: number;
  timeBudgetMs?: number;
};

// Monte Carlo equity of our hand against `opponents` hands. Ties count as a split.
export function equity(hole: Card[], board: Card[], opponents: number, options: EquityOptions = {}): number {
  if (opponents <= 0) return 1;
  const { aggressorRange, iterations = 600, timeBudgetMs = 250 } = options;
  const used = new Set([...hole, ...board].map(key));
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) if (!used.has(rank + suit)) deck.push({ rank, suit });

  const start = Date.now();
  const range = aggressorRange !== undefined && aggressorRange < 1 ? topRange(deck, board, aggressorRange) : null;

  const missingBoard = 5 - board.length;
  let score = 0;
  let runs = 0;

  for (let i = 0; i < iterations; i++) {
    if ((i & 31) === 0 && Date.now() - start > timeBudgetMs) break;
    const hands: Card[][] = [];
    const taken = new Set<string>();
    if (range) {
      const hand = range[Math.floor(Math.random() * range.length)];
      hands.push(hand);
      hand.forEach(c => taken.add(key(c)));
    }
    // Draw the remaining cards from the deck, skipping the aggressor's
    const rest = deck.filter(c => !taken.has(key(c)));
    const needed = missingBoard + 2 * (opponents - hands.length);
    for (let j = 0; j < needed; j++) {
      const k = j + Math.floor(Math.random() * (rest.length - j));
      const tmp = rest[j]; rest[j] = rest[k]; rest[k] = tmp;
    }
    const fullBoard = board.concat(rest.slice(0, missingBoard));
    for (let o = hands.length, off = missingBoard; o < opponents; o++, off += 2) hands.push([rest[off], rest[off + 1]]);

    const mine = evaluate(hole.concat(fullBoard)).score;
    let best = 0;
    let tiedWithBest = 0;
    for (const hand of hands) {
      const theirs = evaluate(hand.concat(fullBoard)).score;
      if (theirs > best) { best = theirs; tiedWithBest = 1; }
      else if (theirs === best) tiedWithBest++;
    }
    if (mine > best) score += 1;
    else if (mine === best) score += 1 / (tiedWithBest + 1);
    runs++;
  }
  return runs === 0 ? 0.5 : score / runs;
}
