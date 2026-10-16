"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chenScore = exports.hasStraightDraw = exports.hasFlushDraw = exports.evaluate = exports.rankValue = exports.Category = void 0;
var Category;
(function (Category) {
    Category[Category["HighCard"] = 0] = "HighCard";
    Category[Category["Pair"] = 1] = "Pair";
    Category[Category["TwoPair"] = 2] = "TwoPair";
    Category[Category["Trips"] = 3] = "Trips";
    Category[Category["Straight"] = 4] = "Straight";
    Category[Category["Flush"] = 5] = "Flush";
    Category[Category["FullHouse"] = 6] = "FullHouse";
    Category[Category["Quads"] = 7] = "Quads";
    Category[Category["StraightFlush"] = 8] = "StraightFlush";
})(Category || (exports.Category = Category = {}));
const RANK_VALUES = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, J: 11, Q: 12, K: 13, A: 14,
};
function rankValue(card) {
    return RANK_VALUES[card.rank];
}
exports.rankValue = rankValue;
function straightHigh(uniqueDesc) {
    const ranks = new Set(uniqueDesc);
    if (ranks.has(14))
        ranks.add(1);
    for (let high = 14; high >= 5; high--) {
        let ok = true;
        for (let r = high; r > high - 5; r--) {
            if (!ranks.has(r)) {
                ok = false;
                break;
            }
        }
        if (ok)
            return high;
    }
    return 0;
}
function makeValue(category, ranks) {
    let score = category;
    for (let i = 0; i < 5; i++)
        score = score * 15 + (ranks[i] ?? 0);
    return { category, ranks, score };
}
// Evaluates up to 5 cards (fewer is fine, e.g. a 3-card flop on its own).
function evaluate5(cards) {
    const values = cards.map(rankValue).sort((a, b) => b - a);
    const counts = new Map();
    for (const v of values)
        counts.set(v, (counts.get(v) ?? 0) + 1);
    // Groups sorted by count desc, then rank desc
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const byGroup = groups.map(([rank]) => rank);
    const isFlush = cards.length === 5 && cards.every(c => c.suit === cards[0].suit);
    const sHigh = cards.length === 5 && counts.size === 5 ? straightHigh(byGroup) : 0;
    if (isFlush && sHigh)
        return makeValue(Category.StraightFlush, [sHigh]);
    if (groups[0][1] === 4)
        return makeValue(Category.Quads, byGroup);
    if (groups[0][1] === 3 && groups[1]?.[1] === 2)
        return makeValue(Category.FullHouse, byGroup);
    if (isFlush)
        return makeValue(Category.Flush, values);
    if (sHigh)
        return makeValue(Category.Straight, [sHigh]);
    if (groups[0][1] === 3)
        return makeValue(Category.Trips, byGroup);
    if (groups[0][1] === 2 && groups[1]?.[1] === 2)
        return makeValue(Category.TwoPair, byGroup);
    if (groups[0][1] === 2)
        return makeValue(Category.Pair, byGroup);
    return makeValue(Category.HighCard, values);
}
function combinations(items, k) {
    const result = [];
    const pick = (start, acc) => {
        if (acc.length === k) {
            result.push(acc.slice());
            return;
        }
        for (let i = start; i < items.length; i++) {
            acc.push(items[i]);
            pick(i + 1, acc);
            acc.pop();
        }
    };
    pick(0, []);
    return result;
}
// Best 5-card hand out of any number of cards.
function evaluate(cards) {
    if (cards.length <= 5)
        return evaluate5(cards);
    let best = null;
    for (const combo of combinations(cards, 5)) {
        const value = evaluate5(combo);
        if (!best || value.score > best.score)
            best = value;
    }
    return best;
}
exports.evaluate = evaluate;
function hasFlushDraw(hole, board) {
    const all = [...hole, ...board];
    return hole.some(h => all.filter(c => c.suit === h.suit).length === 4);
}
exports.hasFlushDraw = hasFlushDraw;
function hasStraightDraw(hole, board) {
    const all = new Set([...hole, ...board].map(rankValue));
    if (all.has(14))
        all.add(1);
    const holeValues = new Set(hole.map(rankValue));
    if (holeValues.has(14))
        holeValues.add(1);
    // Open-ended: 4 consecutive ranks that include one of our hole cards
    for (let low = 1; low <= 11; low++) {
        const run = [low, low + 1, low + 2, low + 3];
        if (run.every(r => all.has(r)) && run.some(r => holeValues.has(r)) && low > 1 && low + 3 < 14) {
            return true;
        }
    }
    return false;
}
exports.hasStraightDraw = hasStraightDraw;
// Chen formula for preflop hand strength (roughly -1..20).
function chenScore(hole) {
    const [a, b] = hole.map(rankValue).sort((x, y) => y - x);
    const points = (v) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
    let score = points(a);
    if (a === b) {
        score = Math.max(5, score * 2);
    }
    else {
        const gap = a - b - 1;
        if (hole[0].suit === hole[1].suit)
            score += 2;
        score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
        if (gap <= 1 && a < 12)
            score += 1;
    }
    return Math.ceil(score);
}
exports.chenScore = chenScore;
