import { chenScore } from "./hand";
import { Card, GameState, Rank, Suit } from "./types";

// Lean Poker publishes every finished hand of a running game (all hole cards included) at
// /log?fragment=<round>. We pull only rounds that are already over (below the round we are asked
// about), in the background, and learn from the cards what hands each opponent shoves preflop.

const BASE = "https://live.leanpoker.org/api/tournament";
const REAL_ID = /^[0-9a-f]{24}$/;

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];

// Share of all 1326 starting hands that rank above a hand (by Chen score, ties counted half)
let percentileByScore: Map<number, number> | null = null;
function percentile(hole: Card[]): number {
  if (!percentileByScore) {
    const deck: Card[] = [];
    for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
    const scores: number[] = [];
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) scores.push(chenScore([deck[i], deck[j]]));
    const counts = new Map<number, number>();
    scores.forEach(s => counts.set(s, (counts.get(s) ?? 0) + 1));
    percentileByScore = new Map();
    let above = 0;
    for (const s of [...counts.keys()].sort((a, b) => b - a)) {
      const n = counts.get(s)!;
      percentileByScore.set(s, (above + n / 2) / scores.length);
      above += n;
    }
  }
  return percentileByScore.get(chenScore(hole)) ?? 0.5;
}

type Game = { next: number; busy: boolean };
const games = new Map<string, Game>();
// Opponent name + stack-depth bucket -> percentiles of the hands it shoved preflop (most recent last).
// Shove ranges depend heavily on depth: short stacks shove almost anything.
const shoveSamples = new Map<string, number[]>();
const depthBucket = (blinds: number) => (blinds <= 8 ? 0 : blinds <= 15 ? 1 : blinds <= 30 ? 2 : 3);

type LogEvent = {
  type?: string;
  message?: string;
  on_turn?: number;
  game_state?: { current_buy_in: number; small_blind: number; community_cards?: Card[]; players: { name: string; stack: number; bet: number; hole_cards?: Card[] }[] };
};

export function feed(fragment: LogEvent[], me: string): void {
  let prev: LogEvent["game_state"] | undefined;
  for (const e of fragment) {
    const gs = e.game_state;
    if (e.type === "bet" && prev && gs && e.on_turn !== undefined && (prev.community_cards ?? []).length === 0) {
      const p = gs.players[e.on_turn];
      const before = prev.players[e.on_turn];
      const toCall = Math.max(0, prev.current_buy_in - before.bet);
      const added = p.bet - before.bet;
      if (p && p.name !== me && p.stack === 0 && added > toCall && (p.hole_cards ?? []).length === 2) {
        const key = `${p.name}:${depthBucket(p.bet / (2 * prev.small_blind))}`;
        const list = shoveSamples.get(key) ?? [];
        list.push(percentile(p.hole_cards!));
        shoveSamples.set(key, list.slice(-30));
      }
    }
    if (gs) prev = gs;
  }
}

async function pull(tid: string, gid: string, upTo: number, me: string): Promise<void> {
  const g = games.get(gid)!;
  g.busy = true;
  try {
    while (g.next < upTo) {
      const res = await fetch(`${BASE}/${tid}/game/${gid}/log?fragment=${g.next}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) break;
      feed((await res.json()) as LogEvent[], me);
      g.next++;
    }
  } catch {
    // network trouble: try again on the next request
  } finally {
    g.busy = false;
  }
}

// Called on every bet request; never waits for the network.
export function watch(gs: GameState): void {
  if (process.env.BPEX_OFFLINE || !REAL_ID.test(gs.tournament_id ?? "") || !REAL_ID.test(gs.game_id ?? "")) return;
  let g = games.get(gs.game_id);
  if (!g) {
    if (games.size > 50) games.clear();
    g = { next: Math.max(0, gs.round - 30), busy: false };
    games.set(gs.game_id, g);
  }
  // Only hands that are already over: everything below the round in progress
  if (!g.busy && g.next < gs.round) void pull(gs.tournament_id, gs.game_id, gs.round, gs.players[gs.in_action]?.name ?? "");
}

// Width of an opponent's preflop shove range measured from its shown cards, or undefined with too few samples.
export function measuredShoveRange(name: string, shoveInBlinds: number): number | undefined {
  const s = shoveSamples.get(`${name}:${depthBucket(shoveInBlinds)}`);
  if (!s || s.length < 5) return undefined;
  const sorted = [...s].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.min(0.85, Math.max(0.05, p90));
}
