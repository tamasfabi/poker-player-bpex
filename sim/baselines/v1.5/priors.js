"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileOf = void 0;
const DEFAULT = { preflopRaise: 0.25, postflopBetWidth: 1, foldToBet: 0.45 };
const KNOWN = {
    // Min-raises ~45% of hands, auto c-bets ~0.2 pot every street, folds 72% to 3-bets, 64% to postflop raises
    nontechyk: { preflopRaise: 0.45, postflopBetWidth: 1.8, foldToBet: 0.64 },
    // ~20% raiser, half-pot c-bets 80%, folds 71% to postflop bets, rarely calls all-ins
    megistekik: { preflopRaise: 0.2, postflopBetWidth: 1.1, foldToBet: 0.71 },
    // Calling station (folds 12% to bets) that shoves postflop with any pair or air
    nontekik: { preflopRaise: 0.06, postflopBetWidth: 3, foldToBet: 0.12 },
};
function profileOf(name) {
    return (name && KNOWN[name]) || DEFAULT;
}
exports.profileOf = profileOf;
