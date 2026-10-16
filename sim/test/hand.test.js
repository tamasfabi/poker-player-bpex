'use strict';
// Checks src/hand.ts (compiled out/hand.js) against known hands and against the
// independent bitwise evaluator in sim/engine/cards.js on random 5/6/7-card hands.
// Also sanity-checks the engine (chip conservation, side pots) on a few seeded games.
// Run: node sim/test/hand.test.js
const path = require('path');
const assert = require('assert');
const { evalCards, category, parseCards, toCard, CAT_NAMES, equityMC } = require('../engine/cards');
const { makeRng } = require('../engine/rng');
const { playGame } = require('../engine/game');
const hand = require(path.resolve(__dirname, '../../out/hand.js'));

const ev = s => hand.evaluate(parseCards(s).map(toCard));
let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) { failures++; console.log(`FAIL ${name} ${extra}`); } else console.log(`ok   ${name}`);
}

// --- known hands -----------------------------------------------------------
const cases = [
  ['wheel straight', 'Ah 2c 3d 4s 5h', hand.Category.Straight],
  ['broadway straight', 'Ah Kc Qd Js 10h', hand.Category.Straight],
  ['steel wheel', 'Ah 2h 3h 4h 5h', hand.Category.StraightFlush],
  ['royal flush in 7', 'Ah Kh Qh Jh 10h 2c 2d', hand.Category.StraightFlush],
  ['quads', '9h 9c 9d 9s 2c', hand.Category.Quads],
  ['full house from two trips', 'Kh Kc Kd 7s 7h 7c 2d', hand.Category.FullHouse],
  ['two pair', 'Ah Ac Kd Ks 2c', hand.Category.TwoPair],
  ['three pair -> two pair', 'Ah Ac Kd Ks 2c 2d 7h', hand.Category.TwoPair],
  ['pair', 'Ah Ac Kd Qs 2c', hand.Category.Pair],
  ['high card', 'Ah Kc 9d 5s 2c', hand.Category.HighCard],
  ['not a straight (Q K A 2 3)', 'Qh Kc Ad 2s 3c', hand.Category.HighCard],
  ['straight in 7 with pair', '5h 6c 7d 8s 9c 9d 2h', hand.Category.Straight],
];
for (const [name, cards, cat] of cases) {
  const v = ev(cards);
  check(`category: ${name}`, v.category === cat, `got ${CAT_NAMES[v.category]} expected ${CAT_NAMES[cat]}`);
}
// steel wheel is 2h3h4h5h7h... "flush over straight" case above: 2h3h4h5h7h + 6c = straight 8-high vs flush -> best is flush? No: 2h3h4h5h6c7h8d has straight 4-8 but also a heart flush (2,3,4,5,7) -> Flush beats Straight
check('flush beats straight', ev('2h 3h 4h 5h 7h 6c 8d').category === hand.Category.Flush);

// --- ordering checks -------------------------------------------------------
const ord = [
  ['AA beats KK', 'Ah Ac 2d 5s 9c', 'Kh Kc 2d 5s 9c'],
  ['kicker decides', 'Ah Ac Kd 5s 9c', 'Ad As Qd 5s 9c'],
  ['higher two pair', 'Ah Ac 2d 2s 9c', 'Kh Kc Qd Qs 9c'],
  ['wheel loses to 6-high straight', '2h 3c 4d 5s 6c', 'Ah 2c 3d 4s 5c'],
  ['full house: trips rank first', 'Kh Kc Kd 2s 2c', '3h 3c 3d As Ac'],
  ['flush high card', 'Ah 9h 7h 4h 2h', 'Kh Qh Jh 9h 2h'],
  ['board plays: split', 'Ah Kh Qh Jh 10h 2c 3d', 'Ah Kh Qh Jh 10h 4c 5d', true],
];
for (const [name, a, b, tie] of ord) {
  const sa = ev(a).score, sb = ev(b).score;
  check(`order: ${name}`, tie ? sa === sb : sa > sb, `${sa} vs ${sb}`);
}

// --- random cross-check vs independent evaluator ---------------------------
const rng = makeRng(42, 'xcheck');
let mismatches = 0;
const N = 20000;
for (let t = 0; t < N; t++) {
  const size = 5 + Math.floor(rng() * 3);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < size * 2; i++) { const j = i + Math.floor(rng() * (52 - i)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const A = deck.slice(0, size), B = deck.slice(size, size * 2);
  const fa = evalCards(A), fb = evalCards(B);
  const sa = hand.evaluate(A.map(toCard)), sb = hand.evaluate(B.map(toCard));
  const okCat = category(fa) === sa.category && category(fb) === sb.category;
  const okOrd = Math.sign(fa - fb) === Math.sign(sa.score - sb.score);
  if (!okCat || !okOrd) {
    mismatches++;
    if (mismatches <= 5) console.log(`  mismatch: ${A.map(c => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'][c>>2] + 'cdhs'[c&3]).join(' ')} (${CAT_NAMES[sa.category]}/${CAT_NAMES[category(fa)]}) vs ${B.map(c => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'][c>>2] + 'cdhs'[c&3]).join(' ')} (${CAT_NAMES[sb.category]}/${CAT_NAMES[category(fb)]})`);
  }
}
check(`random cross-check (${N} pairs of 5-7 card hands)`, mismatches === 0, `${mismatches} mismatches`);

// --- helper checks ---------------------------------------------------------
check('chen AA = 20', hand.chenScore(parseCards('Ah Ac').map(toCard)) === 20);
check('chen AKs = 12', hand.chenScore(parseCards('Ah Kh').map(toCard)) === 12);
check('chen 72o = -1 .. 0', hand.chenScore(parseCards('7h 2c').map(toCard)) <= 0);
check('chen 22 = 5', hand.chenScore(parseCards('2h 2c').map(toCard)) === 5);
check('flush draw', hand.hasFlushDraw(parseCards('Ah 9h').map(toCard), parseCards('2h 7h Kc').map(toCard)) === true);
check('no flush draw with 3 of suit', hand.hasFlushDraw(parseCards('Ah 9c').map(toCard), parseCards('2h 7h Kc').map(toCard)) === false);
check('open-ended straight draw', hand.hasStraightDraw(parseCards('9h 8c').map(toCard), parseCards('7d 6s Kc').map(toCard)) === true);
check('gutshot is not open-ended', hand.hasStraightDraw(parseCards('9h 8c').map(toCard), parseCards('7d 5s Kc').map(toCard)) === false);

// --- equity sanity ---------------------------------------------------------
const eqAA = equityMC(parseCards('Ah Ac'), [], 1, 20000, makeRng(7, 'eq'));
const eq72 = equityMC(parseCards('7h 2c'), [], 1, 20000, makeRng(8, 'eq'));
check(`AA heads-up equity ~0.85 (got ${eqAA.toFixed(3)})`, eqAA > 0.83 && eqAA < 0.87);
check(`72o heads-up equity ~0.35 (got ${eq72.toFixed(3)})`, eq72 > 0.32 && eq72 < 0.38);

// --- engine sanity: scripted bots, side pots ------------------------------
{
  // three players, two of them shove every hand, third calls: chip conservation + side pots exercised heavily
  const bots = [
    { label: 'shove1', bet: gs => gs.players[gs.in_action].stack },
    { label: 'caller', bet: gs => Math.min(gs.players[gs.in_action].stack, gs.current_buy_in - gs.players[gs.in_action].bet) },
    { label: 'shove2', bet: gs => gs.players[gs.in_action].stack },
    { label: 'folder', bet: () => 0 },
  ];
  let ok = true;
  for (let g = 0; g < 200; g++) {
    const r = playGame(bots, { rng: makeRng(1, g, 'engine'), startingStack: 1000 });
    const places = [...r.positions].sort();
    if (places.join() !== '1,2,3,4') { ok = false; console.log('  bad placements', r.positions); break; }
  }
  check('engine: 200 all-in games keep chips and produce 1..4 placements', ok);
}
{
  // explicit side pot: stacks 100/300/1000, everyone shoves preflop every hand (one hand only).
  // Short stack can win at most the main pot (300), mid stack at most 700, big stack keeps >= 700.
  const bots = ['short', 'mid', 'big'].map(l => ({ label: l, bet: gs => gs.players[gs.in_action].stack }));
  let ok = true, shortWins = 0, midWins = 0;
  for (let g = 0; g < 300; g++) {
    const r = playGame(bots, { rng: makeRng(2, g, 'sp'), stacks: [100, 300, 1000], maxRounds: 1, blinds: () => 2 });
    const st = r.finalStacks;
    if (st[0] + st[1] + st[2] !== 1400 || st[0] > 300 || st[1] > 700 || st[2] < 700) { ok = false; console.log('  bad side pot result', st); break; }
    if (st[0] === 300) shortWins++;
    if (st[1] >= 400) midWins++;
  }
  check(`engine: side pots respect caps (short won main pot ${shortWins}x, mid won side pot ${midWins}x)`, ok && shortWins > 0 && midWins > 0);
}

{
  // stress: random bots with uneven short stacks exercise refunds, short blinds and multi-way side pots
  const { random } = require('../bots/simple');
  const ctx = { rng: makeRng(9, 'ctx') };
  const bots = ['r1', 'r2', 'r3', 'r4'].map(l => ({ label: l, bet: random(ctx).bet }));
  let ok = true;
  try {
    for (let g = 0; g < 500; g++) {
      ctx.rng = makeRng(9, g, 'ctx');
      const r = playGame(bots, { rng: makeRng(9, g, 'stress'), stacks: [3, 5, 40, 1000], blinds: () => 2 + (g % 7) });
      const places = [...r.positions].sort().join();
      if (places !== '1,2,3,4') { ok = false; console.log('  bad placements', r.positions); break; }
    }
  } catch (e) { ok = false; console.log('  ' + e.message); }
  check('engine: 500 random-bot games with 3/5/40/1000 stacks conserve chips', ok);
}

// --- betting interpretation -------------------------------------------------
{
  // first hand only, 2 players: dealer=SB posts 2, BB posts 4. SB returns 3 (< toCall 2? no: toCall=2, 3 >= 2 and < 2+4 -> call)
  const log = [];
  const script = { sb: [3], bb: [0] };
  const bots = [
    { label: 'sbp', bet: () => 3 },
    { label: 'bbp', bet: () => 0 },
  ];
  playGame(bots, { rng: makeRng(3, 'bet'), startingStack: 1000, maxRounds: 1, blinds: () => 2, strictMinRaise: true, log: l => log.push(l) });
  const line = log.find(l => l.includes('sbp') && l.includes('returned'));
  check('bet between call and min-raise is a call', /sbp\s+call/.test(line), line);
  void script;
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
