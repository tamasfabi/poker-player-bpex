# bpex maniac

Shove-first aggro bot for Lean Poker (TypeScript).

## Strategy

Built on one observation: the other bots fold too much, so pressure wins.

- **Push/fold from 20 big blinds down**: any two cards go all-in when nobody has raised. Folding is a leak.
- **Opens**: deeper than 20 big blinds we open 6.5 big blinds with pairs, any ace and broadway cards, so a call is
  always expensive.
- **Calling all-ins**: only QQ+ and AK. Their shoves are never bluffs, so we don't pay them off.
- **Postflop**: big bets (pot-sized and above) only with two pair or better; we never bluff big. Small bets are a
  mix of value and semi-bluffs.
- **Heads-up**: shove every hand under 25 big blinds.

## Run

```bash
npm install
npm start
```
