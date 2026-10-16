import { evaluate } from "./hand";
import { Card, Rank, Suit } from "./types";

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];

const key = (c: Card) => c.rank + c.suit;

// Monte Carlo equity of our hand against `opponents` random hands.
// Ties count as a split. Stops after `iterations` or `timeBudgetMs`, whichever comes first.
export function equity(hole: Card[], board: Card[], opponents: number, iterations = 600, timeBudgetMs = 250): number {
  if (opponents <= 0) return 1;
  const used = new Set([...hole, ...board].map(key));
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) if (!used.has(rank + suit)) deck.push({ rank, suit });

  const missingBoard = 5 - board.length;
  const needed = missingBoard + 2 * opponents;
  const start = Date.now();
  let score = 0;
  let runs = 0;

  for (let i = 0; i < iterations; i++) {
    if ((i & 31) === 0 && Date.now() - start > timeBudgetMs) break;
    // Partial Fisher-Yates: shuffle only the cards we need to the front
    for (let j = 0; j < needed; j++) {
      const k = j + Math.floor(Math.random() * (deck.length - j));
      const tmp = deck[j]; deck[j] = deck[k]; deck[k] = tmp;
    }
    const fullBoard = board.concat(deck.slice(0, missingBoard));
    const mine = evaluate(hole.concat(fullBoard)).score;
    let best = 0;
    let tiedWithBest = 0;
    for (let o = 0; o < opponents; o++) {
      const off = missingBoard + 2 * o;
      const theirs = evaluate([deck[off], deck[off + 1], ...fullBoard]).score;
      if (theirs > best) { best = theirs; tiedWithBest = 1; }
      else if (theirs === best) tiedWithBest++;
    }
    if (mine > best) score += 1;
    else if (mine === best) score += 1 / (tiedWithBest + 1);
    runs++;
  }
  return runs === 0 ? 0.5 : score / runs;
}
