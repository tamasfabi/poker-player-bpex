import { profileOf } from "./priors";
import { GameState, PlayerState } from "./types";

// Memory of how often each opponent raises preflop. The server process lives across requests and
// games, so stats are kept per opponent name + version. We only see the table on our own turn, so
// this undercounts somewhat.
type Stats = { seen: number; raised: number; lastHand: string; raisedThisHand: boolean };

const stats = new Map<string, Stats>();

const keyOf = (p: PlayerState) => `${p.name}|${p.version}`;

export function observe(gs: GameState): void {
  if ((gs.community_cards ?? []).length > 0) return;
  const bb = gs.small_blind * 2;
  const hand = `${gs.game_id}:${gs.round}`;
  if (stats.size > 200) stats.clear();
  gs.players.forEach((p, i) => {
    if (i === gs.in_action || p.status === "out") return;
    const s = stats.get(keyOf(p)) ?? { seen: 0, raised: 0, lastHand: "", raisedThisHand: false };
    if (s.lastHand !== hand) {
      s.lastHand = hand;
      s.seen++;
      s.raisedThisHand = false;
    }
    if (p.bet > bb && !s.raisedThisHand) {
      s.raised++;
      s.raisedThisHand = true;
    }
    stats.set(keyOf(p), s);
  });
}

// Share of hands this opponent raises preflop: what we have seen, blended with the known profile
// (worth 20 hands) so we exploit from the first hand and adapt when they change versions.
export function raiseFrequency(p: PlayerState): number {
  const s = stats.get(keyOf(p)) ?? { seen: 0, raised: 0 };
  const prior = profileOf(p.name).preflopRaise;
  return (s.raised + prior * 20) / (s.seen + 20);
}
