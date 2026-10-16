// What we know about the other bots from the tournament logs (tools/analyze.py, 25 games).
// Live stats in opponents.ts refine the preflop raise frequency; the rest is fixed here.
export type Profile = {
  // Share of hands raised preflop
  preflopRaise: number;
  // How much wider than "normal" their postflop bets and shoves are (1 = honest, 3 = bets anything)
  postflopBetWidth: number;
  // How often they fold when we bet/raise postflop
  foldToBet: number;
};

const DEFAULT: Profile = { preflopRaise: 0.25, postflopBetWidth: 1, foldToBet: 0.45 };

const KNOWN: Record<string, Profile> = {
  // Min-raises ~45% of hands, auto c-bets ~0.2 pot every street, folds 72% to 3-bets, 64% to postflop raises
  nontechyk: { preflopRaise: 0.45, postflopBetWidth: 1.8, foldToBet: 0.64 },
  // ~20% raiser, half-pot c-bets 80%, folds 71% to postflop bets, rarely calls all-ins
  megistekik: { preflopRaise: 0.2, postflopBetWidth: 1.1, foldToBet: 0.71 },
  // Calling station (folds 12% to bets) that shoves postflop with any pair or air
  nontekik: { preflopRaise: 0.06, postflopBetWidth: 3, foldToBet: 0.12 },
};

export function profileOf(name: string | undefined): Profile {
  return (name && KNOWN[name]) || DEFAULT;
}
