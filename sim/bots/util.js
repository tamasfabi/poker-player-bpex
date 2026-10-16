'use strict';
const { fromCard } = require('../engine/cards');

// Common view of a Lean Poker game state for the archetype bots.
function view(gs) {
  const me = gs.players[gs.in_action];
  const hole = (me.hole_cards || []).map(fromCard);
  const board = (gs.community_cards || []).map(fromCard);
  const bb = gs.small_blind * 2;
  const toCall = Math.max(0, gs.current_buy_in - me.bet);
  const stack = me.stack;
  let opponents = 0;
  for (let i = 0; i < gs.players.length; i++) {
    if (i !== gs.in_action && gs.players[i].status === 'active') opponents++;
  }
  const raiseTo = extra => Math.min(stack, toCall + Math.max(gs.minimum_raise, Math.floor(extra)));
  return {
    me, hole, board, bb, toCall, stack, opponents, pot: gs.pot,
    potOdds: toCall / (gs.pot + toCall || 1),
    call: () => Math.min(toCall, stack),
    raise: raiseTo,
    allIn: () => stack,
    rank: c => c >> 2, // 0..12
  };
}

module.exports = { view };
