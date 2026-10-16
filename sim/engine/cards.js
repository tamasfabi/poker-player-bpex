'use strict';
// Card encoding: integer 0..51 = rank*4 + suit, rank 0..12 (2..A), suit 0..3.
// Conversions to/from the Lean Poker {rank, suit} objects, plus a fast 5-7 card
// evaluator used for Monte Carlo (showdowns in the engine use src/hand.ts instead).

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const SUIT_CHAR = ['c', 'd', 'h', 's'];

const CARD_OBJS = [];
for (let c = 0; c < 52; c++) CARD_OBJS.push(Object.freeze({ rank: RANKS[c >> 2], suit: SUITS[c & 3] }));

function toCard(c) { return CARD_OBJS[c]; }
function fromCard(card) {
  const r = RANKS.indexOf(card.rank);
  const s = SUITS.indexOf(card.suit);
  if (r < 0 || s < 0) throw new Error(`bad card ${JSON.stringify(card)}`);
  return r * 4 + s;
}
function cardStr(c) { return RANKS[c >> 2] + SUIT_CHAR[c & 3]; }
function cardsStr(cards) { return Array.from(cards).map(cardStr).join(' '); }

// Parse "Ah Td 9c" style strings (handy in tests).
function parseCards(s) {
  return s.trim().split(/\s+/).map(tok => {
    const suit = SUIT_CHAR.indexOf(tok[tok.length - 1]);
    const rank = RANKS.indexOf(tok.slice(0, -1));
    if (suit < 0 || rank < 0) throw new Error(`bad card token ${tok}`);
    return rank * 4 + suit;
  });
}

function newDeck() {
  const d = new Int32Array(52);
  for (let i = 0; i < 52; i++) d[i] = i;
  return d;
}

function shuffle(deck, rng) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Fast evaluator. Score = category << 20 | up to five 4-bit rank indexes (desc).
// Categories match src/hand.ts: 0 high card ... 8 straight flush.
// Valid for 5, 6 or 7 cards.

const CAT_NAMES = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];

const counts = new Uint8Array(13);
const suitMask = new Int32Array(4);

function popcount(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function highestBit(mask) { return 31 - Math.clz32(mask); } // -1 for 0

function straightTop(mask) {
  // shift so bit0 = ace-low, bit i+1 = rank i
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let h = 13; h >= 4; h--) if (((m >> (h - 4)) & 0x1f) === 0x1f) return h - 1;
  return -1;
}
function top5(mask) {
  let v = 0, n = 0;
  for (let r = 12; r >= 0 && n < 5; r--) if (mask & (1 << r)) { v = (v << 4) | r; n++; }
  while (n < 5) { v <<= 4; n++; }
  return v;
}

function evalCards(cards, n = cards.length) {
  counts.fill(0); suitMask.fill(0);
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    counts[r]++; suitMask[s] |= 1 << r; rankMask |= 1 << r;
  }
  let flushMask = 0;
  for (let s = 0; s < 4; s++) if (popcount(suitMask[s]) >= 5) { flushMask = suitMask[s]; break; }
  if (flushMask) {
    const st = straightTop(flushMask);
    if (st >= 0) return (8 << 20) | (st << 16);
  }
  let quad = -1, trips = -1, trips2 = -1, pair1 = -1, pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = counts[r];
    if (c === 4) quad = r;
    else if (c === 3) { if (trips < 0) trips = r; else if (trips2 < 0) trips2 = r; }
    else if (c === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; }
  }
  if (quad >= 0) {
    const kick = highestBit(rankMask & ~(1 << quad));
    return (7 << 20) | (quad << 16) | (Math.max(kick, 0) << 12);
  }
  if (trips >= 0 && (trips2 >= 0 || pair1 >= 0)) {
    const p = Math.max(trips2, pair1);
    return (6 << 20) | (trips << 16) | (p << 12);
  }
  if (flushMask) return (5 << 20) | top5(flushMask);
  const st = straightTop(rankMask);
  if (st >= 0) return (4 << 20) | (st << 16);
  if (trips >= 0) {
    let rest = rankMask & ~(1 << trips);
    const k1 = highestBit(rest); rest &= ~(1 << k1);
    const k2 = highestBit(rest);
    return (3 << 20) | (trips << 16) | (k1 << 12) | (k2 << 8);
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const k = highestBit(rankMask & ~(1 << pair1) & ~(1 << pair2));
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (k << 8);
  }
  if (pair1 >= 0) {
    let rest = rankMask & ~(1 << pair1);
    const k1 = highestBit(rest); rest &= ~(1 << k1);
    const k2 = highestBit(rest); rest &= ~(1 << k2);
    const k3 = highestBit(rest);
    return (1 << 20) | (pair1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4);
  }
  return top5(rankMask);
}

function category(score) { return score >> 20; }

// ---------------------------------------------------------------------------
// Monte Carlo equity of `hole` (2 ints) + `board` (0..5 ints) vs nOpp random hands.

const mcDeck = new Int32Array(52);
const mcBuf = new Int32Array(7);
const knownMask = new Uint8Array(52);

function equityMC(hole, board, nOpp, samples, rng) {
  if (nOpp <= 0) return 1;
  let deckLen = 0;
  knownMask.fill(0);
  for (const c of hole) knownMask[c] = 1;
  for (const c of board) knownMask[c] = 1;
  for (let c = 0; c < 52; c++) if (!knownMask[c]) mcDeck[deckLen++] = c;
  const bl = board.length;
  const missing = 5 - bl;
  const need = missing + 2 * nOpp;
  for (let i = 0; i < bl; i++) mcBuf[2 + i] = board[i];
  let total = 0;
  for (let s = 0; s < samples; s++) {
    for (let j = 0; j < need; j++) {
      const k = j + Math.floor(rng() * (deckLen - j));
      const t = mcDeck[j]; mcDeck[j] = mcDeck[k]; mcDeck[k] = t;
    }
    for (let i = 0; i < missing; i++) mcBuf[2 + bl + i] = mcDeck[i];
    mcBuf[0] = hole[0]; mcBuf[1] = hole[1];
    const hero = evalCards(mcBuf, 7);
    let ties = 1, lose = false;
    for (let o = 0; o < nOpp; o++) {
      mcBuf[0] = mcDeck[missing + 2 * o]; mcBuf[1] = mcDeck[missing + 2 * o + 1];
      const sc = evalCards(mcBuf, 7);
      if (sc > hero) { lose = true; break; }
      if (sc === hero) ties++;
    }
    if (!lose) total += 1 / ties;
  }
  return total / samples;
}

module.exports = {
  RANKS, SUITS, CARD_OBJS, toCard, fromCard, cardStr, cardsStr, parseCards, newDeck, shuffle,
  evalCards, category, CAT_NAMES, equityMC,
};

// ---------------------------------------------------------------------------
// Range-aware Monte Carlo mirroring src/equity.ts `aggressorRange`: the first
// opponent's hand is drawn from the strongest `fraction` of holdings (ranked by made
// hand postflop, by Chen score preflop); the rest are random.

function chenInt(c1, c2) {
  const v1 = (c1 >> 2) + 2, v2 = (c2 >> 2) + 2;
  const a = Math.max(v1, v2), b = Math.min(v1, v2);
  const points = v => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  let score = points(a);
  if (a === b) score = Math.max(5, score * 2);
  else {
    const gap = a - b - 1;
    if ((c1 & 3) === (c2 & 3)) score += 2;
    score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && a < 12) score += 1;
  }
  return Math.ceil(score);
}

const rangeCache = new Map();
const rangeBuf = new Int32Array(7);

function topRange(deck, deckLen, board, fraction) {
  const key = fraction + '|' + board.join(',') + '|' + Array.prototype.join.call(deck.subarray(0, deckLen), ',');
  const hit = rangeCache.get(key);
  if (hit) return hit;
  const combos = [];
  const bl = board.length;
  for (let i = 0; i < bl; i++) rangeBuf[2 + i] = board[i];
  for (let i = 0; i < deckLen; i++) {
    for (let j = i + 1; j < deckLen; j++) {
      let score;
      if (bl >= 3) { rangeBuf[0] = deck[i]; rangeBuf[1] = deck[j]; score = evalCards(rangeBuf, 2 + bl); }
      else score = chenInt(deck[i], deck[j]);
      combos.push({ a: deck[i], b: deck[j], score });
    }
  }
  combos.sort((x, y) => y.score - x.score);
  const keep = Math.max(20, Math.round(combos.length * fraction));
  const out = new Int32Array(keep * 2);
  for (let k = 0; k < keep; k++) { out[2 * k] = combos[k].a; out[2 * k + 1] = combos[k].b; }
  if (rangeCache.size > 512) rangeCache.clear();
  rangeCache.set(key, out);
  return out;
}

const sortedDeck = new Int32Array(52);

function equityMCRange(hole, board, nOpp, samples, rng, fraction) {
  if (nOpp <= 0) return 1;
  knownMask.fill(0);
  for (const c of hole) knownMask[c] = 1;
  for (const c of board) knownMask[c] = 1;
  let deckLen = 0;
  for (let c = 0; c < 52; c++) if (!knownMask[c]) sortedDeck[deckLen++] = c;
  const range = topRange(sortedDeck, deckLen, board, fraction);
  const rangeN = range.length >> 1;
  for (let i = 0; i < deckLen; i++) mcDeck[i] = sortedDeck[i];
  const bl = board.length;
  const missing = 5 - bl;
  const need = missing + 2 * (nOpp - 1);
  for (let i = 0; i < bl; i++) mcBuf[2 + i] = board[i];
  let total = 0;
  for (let s = 0; s < samples; s++) {
    const ri = Math.floor(rng() * rangeN);
    const a0 = range[2 * ri], a1 = range[2 * ri + 1];
    // move the aggressor's two cards to the end of the deck so they are not drawn
    let end = deckLen;
    for (let i = 0; i < end; i++) {
      if (mcDeck[i] === a0 || mcDeck[i] === a1) { end--; const t = mcDeck[i]; mcDeck[i] = mcDeck[end]; mcDeck[end] = t; i--; }
    }
    for (let j = 0; j < need; j++) {
      const k = j + Math.floor(rng() * (end - j));
      const t = mcDeck[j]; mcDeck[j] = mcDeck[k]; mcDeck[k] = t;
    }
    for (let i = 0; i < missing; i++) mcBuf[2 + bl + i] = mcDeck[i];
    mcBuf[0] = hole[0]; mcBuf[1] = hole[1];
    const hero = evalCards(mcBuf, 7);
    let ties = 1, lose = false;
    mcBuf[0] = a0; mcBuf[1] = a1;
    const sa = evalCards(mcBuf, 7);
    if (sa > hero) lose = true; else if (sa === hero) ties++;
    for (let o = 1; o < nOpp && !lose; o++) {
      mcBuf[0] = mcDeck[missing + 2 * (o - 1)]; mcBuf[1] = mcDeck[missing + 2 * (o - 1) + 1];
      const sc = evalCards(mcBuf, 7);
      if (sc > hero) { lose = true; break; }
      if (sc === hero) ties++;
    }
    if (!lose) total += 1 / ties;
  }
  return total / samples;
}

module.exports.equityMCRange = equityMCRange;
module.exports.chenInt = chenInt;
