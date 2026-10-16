#!/usr/bin/env node
'use strict';
// Counterfactual replay of real tournament decisions.
//
// For every spot in the cached game logs (tools/.cache, filled by tools/analyze.py) where bpex had
// to act, rebuild the game state it saw and ask one or more strategy versions what they would do.
// A full game cannot be replayed (once we act differently, the opponents' later actions are
// unknown), but "terminal" spots can be scored exactly: when every other player still in the hand
// is all-in, calling leads straight to showdown and the log reveals everyone's hole cards.
//
//   node tools/replay.js                                   # current build (out/Player.js)
//   node tools/replay.js v1.3=sim/baselines/v1.3/Player.js cur=out/Player.js
//   node tools/replay.js --since 13:00 --player bpex ...   # only games finished after 13:00 UTC

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const { evaluate } = require(path.join(ROOT, 'out', 'hand.js'));

const args = process.argv.slice(2);
let since = null;
let hero = 'bpex';
const specs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since') since = args[++i];
  else if (args[i] === '--player') hero = args[++i];
  else specs.push(args[i]);
}
if (specs.length === 0) specs.push('current=out/Player.js');
const versions = specs.map(s => {
  const [name, file] = s.includes('=') ? s.split('=') : [path.basename(path.dirname(s)), s];
  return { name, Player: require(path.resolve(ROOT, file)).Player };
});

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const key = c => c.rank + c.suit;

// Exact-ish showdown equity of `mine` against known opponent hands, sampling the missing board.
function showdownEquity(mine, others, board, samples = 1500) {
  const used = new Set([...mine, ...others.flat(), ...board].map(key));
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) if (!used.has(r + s)) deck.push({ rank: r, suit: s });
  const missing = 5 - board.length;
  const n = missing === 0 ? 1 : samples;
  let score = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < missing; j++) {
      const k = j + Math.floor(Math.random() * (deck.length - j));
      [deck[j], deck[k]] = [deck[k], deck[j]];
    }
    const full = board.concat(deck.slice(0, missing));
    const me = evaluate(mine.concat(full)).score;
    const best = Math.max(...others.map(h => evaluate(h.concat(full)).score));
    const ties = others.filter(h => evaluate(h.concat(full)).score === best).length;
    if (me > best) score += 1;
    else if (me === best) score += 1 / (ties + 1);
  }
  return score / n;
}

function classify(bet, toCall, stack, minRaise) {
  if (bet >= stack && stack > 0) return bet > toCall ? 'allin' : 'call';
  if (bet < toCall) return toCall === 0 ? 'check' : 'fold';
  if (bet === 0) return 'check';
  if (bet === toCall) return 'call';
  return bet >= toCall + minRaise ? 'raise' : 'call';
}

const games = JSON.parse(fs.readFileSync(path.join(CACHE, 'games.json'), 'utf8'))
  .filter(g => g.status === 'done' && (!since || (g.finished || '').slice(11, 16) >= since))
  .sort((a, b) => (a.finished || '').localeCompare(b.finished || ''));

const totals = versions.map(() => ({ decisions: 0, actions: {}, terminal: 0, ev: 0, folds: 0, calls: 0 }));
const disagreements = [];
let logged = { ev: 0, n: 0 };

for (const g of games) {
  const file = path.join(CACHE, `log_${g.id}.json`);
  if (!fs.existsSync(file)) continue;
  const log = JSON.parse(fs.readFileSync(file, 'utf8'));
  const players = versions.map(v => new v.Player());
  let prev = null;
  let lastRaise = 0;
  let prevBuyIn = 0;
  let betsInHand = 0;
  for (const e of log) {
    const gs = e.game_state;
    if (!e.type) { prev = e; lastRaise = gs.big_blind || gs.small_blind * 2; prevBuyIn = 0; betsInHand = 0; continue; }
    if (e.type === 'card_deal' && /community/.test(e.message || '')) lastRaise = gs.small_blind * 2;
    if (e.type === 'bet' && prev && gs.players[e.on_turn] && gs.players[e.on_turn].name === hero
        && !/disqualified/.test(e.message)) {
      const before = prev.game_state;
      const idx = e.on_turn;
      const me = before.players[idx];
      const bb = before.small_blind * 2;
      const toCall = Math.max(0, before.current_buy_in - me.bet);
      // The first two bet events of a hand are the blind posts
      const isBlindPost = betsInHand < 2;
      if (!isBlindPost && me.hole_cards && me.hole_cards.length === 2 && me.stack > 0) {
        const state = {
          ...before,
          in_action: idx,
          minimum_raise: Math.max(bb, lastRaise),
          bet_index: 0,
          players: before.players.map((p, i) => (i === idx ? p : { ...p, hole_cards: [] })),
        };
        // Terminal spot: everyone else still in is all-in, so calling goes straight to showdown
        const others = before.players.filter((p, i) => i !== idx && p.status === 'active');
        const terminal = toCall > 0 && others.length > 0 && others.every(p => p.stack === 0);
        let callEv = 0;
        if (terminal) {
          const callAmt = Math.min(toCall, me.stack);
          const eq = showdownEquity(me.hole_cards, others.map(p => p.hole_cards), before.community_cards || []);
          callEv = eq * (before.pot + callAmt) - callAmt;
          const loggedAction = /\((call|allin)\)/.test(e.message) ? 'call' : 'fold';
          logged.n++;
          if (loggedAction === 'call') logged.ev += callEv;
        }
        const acts = versions.map((v, k) => {
          let bet = 0;
          players[k].betRequest(JSON.parse(JSON.stringify(state)), b => { bet = b; });
          const act = classify(bet, toCall, me.stack, state.minimum_raise);
          const t = totals[k];
          t.decisions++;
          t.actions[act] = (t.actions[act] || 0) + 1;
          if (terminal) {
            t.terminal++;
            if (act === 'fold') t.folds++; else { t.calls++; t.ev += callEv; }
          }
          return { act, bet };
        });
        if (versions.length > 1 && new Set(acts.map(a => a.act === 'allin' ? 'raise' : a.act)).size > 1) {
          disagreements.push({ game: g.id, round: before.round, sb: before.small_blind, stack: me.stack, toCall,
            pot: before.pot, hole: me.hole_cards.map(key).join(' '), board: (before.community_cards || []).map(key).join(' '),
            terminal, callEv: Math.round(callEv), acts: acts.map((a, k) => `${versions[k].name}:${a.act}${a.act === 'raise' || a.act === 'allin' ? a.bet : ''}`).join(' ') });
        }
      }
    }
    if (e.type === 'bet') betsInHand++;
    if (gs.current_buy_in > prevBuyIn) { lastRaise = Math.max(lastRaise, gs.current_buy_in - prevBuyIn); prevBuyIn = gs.current_buy_in; }
    prev = e;
  }
}

console.log(`games: ${games.length}  hero: ${hero}`);
console.log(`terminal spots (facing all-in, showdown known): ${logged.n}, logged play EV: ${Math.round(logged.ev)} chips`);
versions.forEach((v, k) => {
  const t = totals[k];
  const acts = Object.entries(t.actions).map(([a, n]) => `${a} ${(100 * n / t.decisions).toFixed(1)}%`).join(', ');
  console.log(`${v.name.padEnd(10)} decisions ${t.decisions}  [${acts}]`);
  console.log(`${''.padEnd(10)} terminal: called ${t.calls}/${t.terminal}, EV of its calls vs folding: ${Math.round(t.ev)} chips`);
});
if (disagreements.length) {
  const term = disagreements.filter(d => d.terminal);
  console.log(`\ndisagreements: ${disagreements.length} (terminal ${term.length}); terminal ones by |EV|:`);
  term.sort((a, b) => Math.abs(b.callEv) - Math.abs(a.callEv)).slice(0, 15)
    .forEach(d => console.log(`  ${d.game.slice(-6)} r${d.round} sb${d.sb} ${d.hole} | ${d.board} stack ${d.stack} call ${d.toCall} pot ${d.pot} callEV ${d.callEv}  ${d.acts}`));
}
