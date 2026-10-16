import { GameState } from "./types";

// Per-game memory of how often each opponent raises preflop. The server process lives across
// requests, so this builds up over a sit'n'go. We only see the table on our own turn, so it undercounts.
type Stats = { seen: number; raised: number; lastRound: number; raisedThisRound: boolean };

const games = new Map<string, Map<string, Stats>>();

function table(gameId: string): Map<string, Stats> {
  let t = games.get(gameId);
  if (!t) {
    if (games.size > 20) games.clear();
    t = new Map();
    games.set(gameId, t);
  }
  return t;
}

export function observe(gs: GameState): void {
  if ((gs.community_cards ?? []).length > 0) return;
  const bb = gs.small_blind * 2;
  const t = table(gs.game_id);
  gs.players.forEach((p, i) => {
    if (i === gs.in_action || p.status === "out") return;
    const s = t.get(p.name) ?? { seen: 0, raised: 0, lastRound: -1, raisedThisRound: false };
    if (s.lastRound !== gs.round) {
      s.lastRound = gs.round;
      s.seen++;
      s.raisedThisRound = false;
    }
    if (p.bet > bb && !s.raisedThisRound) {
      s.raised++;
      s.raisedThisRound = true;
    }
    t.set(p.name, s);

    // Preflop all-ins, remembered across games per bot version
    const key = `${p.name}|${p.version}`;
    const hand = `${gs.game_id}:${gs.round}`;
    const sh = shoves.get(key) ?? { seen: 0, shoved: 0, lastHand: "", counted: false };
    if (sh.lastHand !== hand) {
      sh.lastHand = hand;
      sh.seen++;
      sh.counted = false;
    }
    if (p.stack === 0 && p.bet > bb && !sh.counted) {
      sh.shoved++;
      sh.counted = true;
    }
    if (shoves.size > 200) shoves.clear();
    shoves.set(key, sh);
  });
}

type ShoveStats = { seen: number; shoved: number; lastHand: string; counted: boolean };
const shoves = new Map<string, ShoveStats>();

// How wide an opponent's preflop all-in range is: bots that shove often shove junk too.
// A shove in ~3% of hands maps to roughly the top 23%; ~13% (a re-steal bot) to roughly the top half.
export function shoveRange(p: { name: string; version: string }): number {
  const s = shoves.get(`${p.name}|${p.version}`);
  const freq = s ? (s.shoved + 0.5) / (s.seen + 20) : 0.025;
  return Math.min(0.7, Math.max(0.15, 0.15 + 2.5 * freq));
}

// Share of hands this opponent raises preflop, with a prior of 1 raise in 4 hands.
export function raiseFrequency(gs: GameState, name: string): number {
  const s = table(gs.game_id).get(name);
  if (!s) return 0.25;
  return (s.raised + 1) / (s.seen + 4);
}
