"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.raiseFrequency = exports.observe = void 0;
const priors_1 = require("./priors");
const stats = new Map();
const keyOf = (p) => `${p.name}|${p.version}`;
function observe(gs) {
    if ((gs.community_cards ?? []).length > 0)
        return;
    const bb = gs.small_blind * 2;
    const hand = `${gs.game_id}:${gs.round}`;
    if (stats.size > 200)
        stats.clear();
    gs.players.forEach((p, i) => {
        if (i === gs.in_action || p.status === "out")
            return;
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
exports.observe = observe;
// Share of hands this opponent raises preflop: what we have seen, blended with the known profile
// (worth 20 hands) so we exploit from the first hand and adapt when they change versions.
function raiseFrequency(p) {
    const s = stats.get(keyOf(p)) ?? { seen: 0, raised: 0 };
    const prior = (0, priors_1.profileOf)(p.name).preflopRaise;
    return (s.raised + prior * 20) / (s.seen + 20);
}
exports.raiseFrequency = raiseFrequency;
