"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.raiseFrequency = exports.observe = void 0;
const games = new Map();
function table(gameId) {
    let t = games.get(gameId);
    if (!t) {
        if (games.size > 20)
            games.clear();
        t = new Map();
        games.set(gameId, t);
    }
    return t;
}
function observe(gs) {
    if ((gs.community_cards ?? []).length > 0)
        return;
    const bb = gs.small_blind * 2;
    const t = table(gs.game_id);
    gs.players.forEach((p, i) => {
        if (i === gs.in_action || p.status === "out")
            return;
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
    });
}
exports.observe = observe;
// Share of hands this opponent raises preflop, with a prior of 1 raise in 4 hands.
function raiseFrequency(gs, name) {
    const s = table(gs.game_id).get(name);
    if (!s)
        return 0.25;
    return (s.raised + 1) / (s.seen + 4);
}
exports.raiseFrequency = raiseFrequency;
