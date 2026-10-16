const { Player } = require((process.argv[2] || require("path").join(__dirname, "..")) + "/out/Player.js");
const c = s => ({ rank: s.slice(0, -1), suit: { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[s.slice(-1)] });
const cs = str => str ? str.split(' ').map(c) : [];
const P = (name, stack, bet, status = 'active', hole) => ({ name, stack, bet, status, ...(hole ? { hole_cards: cs(hole) } : {}) });
const spot = (label, gs) => { const t = Date.now(); new Player().betRequest({ game_id: 'g' + Math.random(), round: 1, minimum_raise: gs.small_blind * 2, ...gs }, b => console.log(label.padEnd(45), '=>', b, `(${Date.now() - t}ms)`)); };
// 1. 99 on 4-flush straight board vs all-in
spot('99 vs shove on 6d5d4d7d8c (want fold)', { small_blind: 3, current_buy_in: 998, pot: 1092, community_cards: cs('6d 5d 4d 7d 8c'), in_action: 1,
  players: [P('nontekik', 0, 998), P('bpex', 919, 31, 'active', '9c 9d'), P('nontechyk', 1000, 0, 'folded')] });
spot('TT vs shove on Kd4c4dAd9c (want fold)', { small_blind: 2, current_buy_in: 1000, pot: 1086, community_cards: cs('Kd 4c 4d Ad 9c'), in_action: 1,
  players: [P('nontekik', 0, 1000), P('bpex', 945, 0, 'active', '10c 10s'), P('nontechyk', 953, 0)] });
spot('A4o SB vs short BB (want shove)', { small_blind: 200, current_buy_in: 400, pot: 600, community_cards: [], in_action: 0,
  players: [P('bpex', 2624, 200, 'active', 'As 4h'), P('megistekik', 598, 400), P('nontekik', 78, 0, 'folded')] });
spot('73o SB deep vs deep BB (want fold)', { small_blind: 10, current_buy_in: 20, pot: 30, community_cards: [], in_action: 0,
  players: [P('bpex', 990, 10, 'active', '7h 3s'), P('a', 980, 20), P('b', 1000, 0), P('c', 1000, 0)] });
spot('AA vs preflop shove (want call)', { small_blind: 10, current_buy_in: 1000, pot: 1030, community_cards: [], in_action: 1,
  players: [P('a', 0, 1000), P('bpex', 990, 10, 'active', 'Ah As'), P('b', 980, 20), P('c', 1000, 0, 'folded')] });
spot('72o vs preflop shove (want fold)', { small_blind: 10, current_buy_in: 1000, pot: 1030, community_cards: [], in_action: 1,
  players: [P('a', 0, 1000), P('bpex', 990, 10, 'active', '7h 2s'), P('b', 980, 20), P('c', 1000, 0, 'folded')] });
spot('set vs half pot bet (want raise)', { small_blind: 10, current_buy_in: 50, pot: 150, community_cards: cs('9h 9d 4c'), in_action: 1,
  players: [P('a', 900, 50), P('bpex', 950, 0, 'active', '9s Kd'), P('b', 1000, 0, 'folded')] });
spot('river nothing vs pot bet (want fold)', { small_blind: 10, current_buy_in: 200, pot: 400, community_cards: cs('Kh 9d 4c 2s 7h'), in_action: 1,
  players: [P('a', 700, 200), P('bpex', 800, 0, 'active', 'Qs Jd')] });
spot('top pair vs small bet (want call)', { small_blind: 10, current_buy_in: 30, pot: 130, community_cards: cs('Kh 9d 4c'), in_action: 1,
  players: [P('a', 900, 30), P('bpex', 900, 0, 'active', 'Ks Qd')] });
spot('open 4-way AKs 100bb (want raise)', { small_blind: 5, current_buy_in: 10, pot: 15, community_cards: [], in_action: 3,
  players: [P('a', 995, 5), P('b', 990, 10), P('c', 1000, 0, 'folded'), P('bpex', 1000, 0, 'active', 'Ah Kh')] });
spot('K7o on button unopened (want steal)', { small_blind: 10, current_buy_in: 20, pot: 30, dealer: 3, community_cards: [], in_action: 3,
  players: [P('a', 990, 10), P('b', 980, 20), P('c', 1000, 0, 'folded'), P('bpex', 1000, 0, 'active', 'Kh 7d')] });
spot('K7o UTG 4-way (want fold)', { small_blind: 10, current_buy_in: 20, pot: 30, dealer: 0, community_cards: [], in_action: 3,
  players: [P('a', 1000, 0), P('b', 990, 10), P('c', 980, 20), P('bpex', 1000, 0, 'active', 'Kh 7d')] });
// teach the bot that 'nt' raises a lot, then face its min-raise
{
  const pl = new Player();
  for (let r = 0; r < 30; r++) pl.betRequest({ game_id: 'train', round: r, small_blind: 10, current_buy_in: 40, pot: 70, minimum_raise: 20, dealer: 0, community_cards: [], in_action: 2,
    players: [P('nt', 960, 40), P('x', 980, 20, 'folded'), P('bpex', 1000, 10, 'active', '7h 2s')] }, () => {});
  let threeBets = 0;
  for (let k = 0; k < 40; k++) pl.betRequest({ game_id: 'train', round: 100 + k, small_blind: 10, current_buy_in: 40, pot: 70, minimum_raise: 20, dealer: 0, community_cards: [], in_action: 2,
    players: [P('nt', 960, 40), P('x', 980, 20, 'folded'), P('bpex', 990, 10, 'active', 'Kh 9d')] }, b => { if (b > 30) threeBets++; });
  console.log('K9o SB vs habitual min-raiser: 3-bet rate'.padEnd(45), '=>', threeBets + '/40');
}
spot('2nd pair vs nontekik river shove (want call)', { small_blind: 10, current_buy_in: 600, pot: 900, dealer: 0, community_cards: cs('Kh 9d 4c 2s 7h'), in_action: 1,
  players: [P('nontekik', 0, 600), P('bpex', 1000, 100, 'active', '9s Qd')] });
spot('2nd pair vs megistekik river shove (want fold)', { small_blind: 10, current_buy_in: 600, pot: 900, dealer: 0, community_cards: cs('Kh 9d 4c 2s 7h'), in_action: 1,
  players: [P('megistekik', 0, 600), P('bpex', 1000, 100, 'active', '9s Qd')] });
spot('bubble: AJo vs shove, 3 left (want fold)', { small_blind: 50, current_buy_in: 1500, pot: 1650, dealer: 0, community_cards: [], in_action: 1,
  players: [P('a', 0, 1500), P('bpex', 1450, 50, 'active', 'Ah Jd'), P('b', 900, 100), P('c', 0, 0, 'out')] });
{ let bl = 0; for (let k = 0; k < 200; k++) new Player().betRequest({ game_id: 'b', round: k, small_blind: 10, current_buy_in: 40, pot: 120, minimum_raise: 20, dealer: 0, community_cards: cs('Kh 9d 4c'), in_action: 1,
    players: [P('nontekik', 900, 40), P('bpex', 900, 40, 'active', '6s 5d')] }, b => { if (b > 0) bl++; });
  console.log('bluff rate vs nontekik (want 0)'.padEnd(45), '=>', bl + '/200'); }
{ let bl = 0; for (let k = 0; k < 200; k++) new Player().betRequest({ game_id: 'b', round: k, small_blind: 10, current_buy_in: 40, pot: 120, minimum_raise: 20, dealer: 0, community_cards: cs('Kh 9d 4c'), in_action: 1,
    players: [P('megistekik', 900, 40), P('bpex', 900, 40, 'active', '6s 5d')] }, b => { if (b > 0) bl++; });
  console.log('bluff rate vs megistekik (want ~40%)'.padEnd(45), '=>', bl + '/200'); }
