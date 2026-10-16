'use strict';
// No-limit hold'em sit'n'go engine mirroring Lean Poker semantics:
//  - players[].bet and pot are cumulative for the whole hand (never reset per street)
//  - current_buy_in = largest bet, minimum_raise = size of the last raise (starts at big blind)
//  - returned bet: < toCall -> fold (0 with nothing to call = check); >= toCall + minimum_raise -> raise;
//    otherwise -> call; >= stack -> all-in
//  - side pots from cumulative bets, uncalled chips returned, odd chips to first winner after dealer
// Showdowns use src/hand.ts (compiled out/hand.js) `evaluate`.

const path = require('path');
const { toCard, newDeck, shuffle, cardsStr, CAT_NAMES } = require('./cards');

const ROOT = path.resolve(__dirname, '..', '..');
let srcHand = null;
function getSrcHand() {
  if (!srcHand) srcHand = require(path.join(ROOT, 'out', 'hand.js'));
  return srcHand;
}

// Observed in the real tournament logs (docs/opponents.md): small blind rises every 10 rounds
const DEFAULT_BLINDS = [2, 3, 5, 10, 15, 20, 30, 40, 50, 70, 100, 150, 200, 300, 500, 1000, 2000];
const DEFAULT_BLIND_PERIOD = 10;

function makeBlindSchedule(levels = DEFAULT_BLINDS, period = DEFAULT_BLIND_PERIOD) {
  return function smallBlind(round) {
    const idx = Math.floor(round / period);
    if (idx < levels.length) return levels[idx];
    let sb = levels[levels.length - 1];
    for (let i = levels.length; i <= idx; i++) sb *= 2;
    return sb;
  };
}

const STREET_NAMES = ['preflop', 'flop', 'turn', 'river'];

/**
 * Play one sit'n'go.
 * @param {Array<{label:string, bet:(gs)=>number, showdown?:(gs)=>void, version?:string}>} bots seat order
 * @param {object} opts { rng, startingStack, blinds (fn round->sb), maxRounds, log (fn|null), gameId, tournamentId }
 * @returns {{positions:number[], hands:number, errors:number[]}} positions[seat] = 1..n finishing place
 */
function playGame(bots, opts) {
  const n = bots.length;
  const rng = opts.rng;
  const blind = opts.blinds || makeBlindSchedule();
  const log = opts.log || null;
  const maxRounds = opts.maxRounds || 5000;
  const strictMinRaise = !!opts.strictMinRaise;
  const srcHandMod = getSrcHand();

  const stacks = opts.stacks ? Int32Array.from(opts.stacks) : new Int32Array(n).fill(opts.startingStack || 1000);
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  const positions = new Array(n).fill(0);
  const errors = new Array(n).fill(0);
  let dealer = -1;
  let orbits = 0;
  let round = 0;
  let aliveCount = n;

  const deck = newDeck();
  const bets = new Int32Array(n);
  const startStacks = new Int32Array(n);
  const inHand = new Uint8Array(n);
  const folded = new Uint8Array(n);
  const hole = Array.from({ length: n }, () => new Int32Array(2));
  const holeCards = new Array(n);
  let board = [];
  let boardCards = [];
  let pot = 0, buyIn = 0, minRaise = 0, betIndex = 0, sb = 0;

  const nextAlive = from => {
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (stacks[i] > 0) return i;
    }
    return from;
  };
  // next seat (after `from`) that is in the hand, not folded and still has chips
  const nextCanAct = from => {
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (inHand[i] && !folded[i] && stacks[i] > 0) return i;
    }
    return -1;
  };

  function buildState(inAction, revealAll) {
    const players = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = {
        id: i,
        name: bots[i].label,
        status: !inHand[i] ? 'out' : folded[i] ? 'folded' : 'active',
        version: bots[i].version || bots[i].label,
        stack: stacks[i],
        bet: bets[i],
      };
      if (i === inAction || (revealAll && inHand[i] && !folded[i])) p.hole_cards = holeCards[i];
      players[i] = p;
    }
    return {
      tournament_id: opts.tournamentId || 'sim',
      game_id: opts.gameId || 'sim-game',
      round,
      bet_index: betIndex,
      small_blind: sb,
      current_buy_in: buyIn,
      pot,
      minimum_raise: minRaise,
      dealer,
      orbits,
      in_action: inAction,
      players,
      community_cards: boardCards,
    };
  }

  function post(i, amount) {
    const a = Math.min(amount, stacks[i]);
    stacks[i] -= a; bets[i] += a; pot += a;
    return a;
  }

  function act(i) {
    const toCall = buyIn - bets[i];
    const stack = stacks[i];
    let raw;
    try {
      raw = bots[i].bet(buildState(i, false));
    } catch (e) {
      errors[i]++;
      if (log) log(`  ! ${bots[i].label} threw: ${e && e.message}`);
      raw = 0;
    }
    betIndex++;
    let bet = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    if (bet < 0) bet = 0;
    let amount, type, fullRaise = false;
    if (bet >= stack) { amount = stack; type = 'all-in'; }
    else if (bet < toCall) { amount = 0; type = toCall === 0 ? 'check' : 'fold'; }
    else if (bet >= toCall + minRaise) { amount = bet; type = 'raise'; }
    // Real Lean Poker engine quirk (docs/opponents.md): any bet above current_buy_in is accepted as a raise
    else if (bet > toCall && !strictMinRaise) { amount = bet; type = 'raise'; }
    else { amount = toCall; type = toCall === 0 ? 'check' : 'call'; }

    if (type === 'fold') {
      folded[i] = 1;
    } else {
      stacks[i] -= amount; bets[i] += amount; pot += amount;
      if (bets[i] > buyIn) {
        const inc = bets[i] - buyIn;
        buyIn = bets[i];
        if (inc >= minRaise) minRaise = inc;
        if (inc >= minRaise || !strictMinRaise) fullRaise = true; // any accepted raise reopens the action
      }
    }
    if (log) {
      log(`  ${bots[i].label.padEnd(10)} ${type.padEnd(6)} returned ${String(raw).padStart(5)} -> +${amount} (bet ${bets[i]}, stack ${stacks[i]}, pot ${pot}, buy-in ${buyIn})`);
    }
    return fullRaise;
  }

  function notFoldedCount() {
    let c = 0;
    for (let i = 0; i < n; i++) if (inHand[i] && !folded[i]) c++;
    return c;
  }
  function canActCount() {
    let c = 0;
    for (let i = 0; i < n; i++) if (inHand[i] && !folded[i] && stacks[i] > 0) c++;
    return c;
  }

  function bettingRound(firstAfter) {
    let queue = [];
    let i = firstAfter;
    for (let k = 0; k < n; k++) {
      i = nextCanAct(i);
      if (i < 0 || queue.includes(i)) break;
      queue.push(i);
    }
    while (queue.length) {
      const p = queue.shift();
      if (folded[p] || stacks[p] === 0) continue;
      if (notFoldedCount() === 1) return;
      if (canActCount() === 1 && bets[p] >= buyIn) return; // everyone else all-in and matched
      const fullRaise = act(p);
      if (fullRaise) {
        queue = [];
        let j = p;
        for (let k = 0; k < n; k++) {
          j = nextCanAct(j);
          if (j < 0 || j === p || queue.includes(j)) break;
          queue.push(j);
        }
      }
    }
  }

  function awardPots() {
    const showdown = notFoldedCount() > 1;
    const scores = new Float64Array(n);
    if (showdown) {
      for (let i = 0; i < n; i++) {
        if (inHand[i] && !folded[i]) {
          const hv = srcHandMod.evaluate([...holeCards[i], ...boardCards]);
          scores[i] = hv.score;
          if (log) log(`  showdown ${bots[i].label.padEnd(10)} ${cardsStr(hole[i])}  ${CAT_NAMES[hv.category]}`);
        }
      }
    }
    const levels = [...new Set(Array.from(bets).filter(b => b > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const level of levels) {
      let portion = 0;
      const eligible = [];
      for (let i = 0; i < n; i++) {
        if (!inHand[i]) continue;
        portion += Math.max(0, Math.min(bets[i], level) - prev);
        if (!folded[i] && bets[i] >= level) eligible.push(i);
      }
      if (eligible.length === 0) {
        // nobody left in the hand reached this layer (e.g. a short all-in blind): refund contributors
        for (let i = 0; i < n; i++) if (inHand[i]) stacks[i] += Math.max(0, Math.min(bets[i], level) - prev);
        prev = level;
        continue;
      }
      prev = level;
      if (portion === 0) continue;
      let winners;
      if (eligible.length === 1) winners = eligible;
      else {
        let best = -1;
        for (const i of eligible) if (scores[i] > best) best = scores[i];
        winners = eligible.filter(i => scores[i] === best);
      }
      const share = Math.floor(portion / winners.length);
      let rem = portion - share * winners.length;
      // odd chips go to winners in order after the dealer
      winners.sort((a, b) => ((a - dealer - 1 + n) % n) - ((b - dealer - 1 + n) % n));
      for (const w of winners) {
        const extra = rem > 0 ? 1 : 0; rem -= extra;
        stacks[w] += share + extra;
        if (log) log(`  pot ${portion}: ${bots[w].label} wins ${share + extra}`);
      }
    }
    pot = 0;
    return showdown;
  }

  function playHand() {
    sb = blind(round);
    const bb = sb * 2;
    // dealer button moves to the next player with chips
    if (dealer < 0) dealer = opts.firstDealer != null ? opts.firstDealer : 0;
    else {
      const nd = nextAlive(dealer);
      if (nd <= dealer) orbits++;
      dealer = nd;
    }
    bets.fill(0); folded.fill(0); inHand.fill(0);
    pot = 0; betIndex = 0; buyIn = bb; minRaise = bb;
    board = []; boardCards = [];
    for (let i = 0; i < n; i++) { startStacks[i] = stacks[i]; inHand[i] = stacks[i] > 0 ? 1 : 0; }

    const sbSeat = aliveCount === 2 ? dealer : nextAlive(dealer);
    const bbSeat = nextAlive(sbSeat);
    post(sbSeat, sb); post(bbSeat, bb);

    shuffle(deck, rng);
    let di = 0;
    for (let i = 0; i < n; i++) {
      if (!inHand[i]) continue;
      hole[i][0] = deck[di++]; hole[i][1] = deck[di++];
      holeCards[i] = [toCard(hole[i][0]), toCard(hole[i][1])];
    }
    if (log) {
      log(`\n=== round ${round}  sb ${sb}  dealer ${bots[dealer].label}  orbits ${orbits}`);
      for (let i = 0; i < n; i++) if (inHand[i]) log(`  ${bots[i].label.padEnd(10)} stack ${startStacks[i]}  ${cardsStr(hole[i])}${i === sbSeat ? '  (SB)' : i === bbSeat ? '  (BB)' : ''}`);
    }

    for (let street = 0; street < 4; street++) {
      const target = [0, 3, 4, 5][street];
      while (board.length < target) board.push(deck[di++]);
      if (street > 0) {
        boardCards = board.map(toCard);
        if (log) log(`  -- ${STREET_NAMES[street]}: ${cardsStr(board)}`);
      }
      if (notFoldedCount() === 1) break;
      if (canActCount() >= 2 || (canActCount() === 1 && someoneOwes())) {
        bettingRound(street === 0 ? bbSeat : dealer);
      }
    }
    const showdown = awardPots();

    // eliminations: lowest starting stack gets the worst place
    const busted = [];
    for (let i = 0; i < n; i++) if (inHand[i] && stacks[i] === 0) busted.push(i);
    busted.sort((a, b) => startStacks[a] - startStacks[b]);
    for (const i of busted) {
      positions[i] = aliveCount--;
      if (log) log(`  ${bots[i].label} eliminated, finishes #${positions[i]}`);
    }
    if (aliveCount === 1) for (let i = 0; i < n; i++) if (stacks[i] > 0) positions[i] = 1;

    if (opts.callShowdown) {
      let gs = null;
      for (let i = 0; i < n; i++) {
        if (bots[i].showdown && inHand[i]) {
          if (!gs) gs = buildState(-1, showdown);
          try { bots[i].showdown(gs); } catch (e) { errors[i]++; }
        }
      }
    }
    round++;
  }

  function someoneOwes() {
    for (let i = 0; i < n; i++) if (inHand[i] && !folded[i] && stacks[i] > 0 && bets[i] < buyIn) return true;
    return false;
  }

  while (aliveCount > 1 && round < maxRounds) playHand();
  if (aliveCount > 1) {
    // safety valve: rank remaining players by stack
    const rest = [];
    for (let i = 0; i < n; i++) if (positions[i] === 0) rest.push(i);
    rest.sort((a, b) => stacks[b] - stacks[a]);
    rest.forEach((i, k) => { positions[i] = k + 1; });
  }
  const total = stacks.reduce((a, b) => a + b, 0);
  if (total !== totalChips) throw new Error(`chip conservation violated: ${total} != ${totalChips}`);
  return { positions, hands: round, errors, finalStacks: Array.from(stacks) };
}

module.exports = { playGame, makeBlindSchedule, DEFAULT_BLINDS, DEFAULT_BLIND_PERIOD };
