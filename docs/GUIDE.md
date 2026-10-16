# bpex – stratégia és munkamenet guide

## Hogyan pontozunk

- Egy meccs: 4 bot, mindenki 1000 zsetonnal kezd, a vak folyamatosan nő.
- Az 1. hely 5 pontot ér, a 2. hely 3 pontot, a 3–4. hely nullát.
- **A cél nem a zsetonmaximalizálás, hanem az, hogy a végén mi maradjunk talpon.** Ha a meccs elején nagyot kockáztatunk marginális kézzel, az többet ront, mint amennyit egy átlagos pot hoz.
- Az emelkedő vakok miatt a meccs vége push/fold játék: aki ezt jól csinálja, az nyer.

## Stratégiai alapelvek botok ellen

1. **Kihasználni, nem GTO-t játszani.** A botok determinisztikusak és egyszerűek, ezért ki kell mérni, mire hogyan reagálnak (lásd `docs/opponents.md`), és arra játszani.
2. **Maniac / mindig shove-oló bot ellen:** szűkebb, de *biztosan* callolós range (pl. TT+, AQ+, rövid stacknél szélesebb). Ellene ne blöffölj és ne steal-elj.
3. **Calling station ellen:** soha ne blöffölj, értékből bettelj vékonyabban és nagyobbat.
4. **Szűk, sokat dobó bot ellen:** lopd a vakokat, és posztflopon c-betelj gyakran.
5. **Equity bot ellen (pl. nontechyk):** a pot oddsra reagál, ezért a méretezéssel lehet manipulálni. Nagy kezzel kisebb bet, hogy callolja; gyengével inkább check/fold. Ha profilozza az ellenfeleit, akkor a viselkedésünk állandósága kihasználható – érdemes vegyes méretezést használni.
6. **Rövid stack (< ~12 BB):** csak push/fold, Nash-szerű shove range-ekkel. Az ilyen range-ek botok ellen nagyon erősek.
7. **Stabilitás mindenekelőtt:** egy exception vagy timeout = fold. A `betRequest` mindig try/catch-ben fut, és pontosan egyszer hívja a callbacket.

## Munkamenet egy stratégiaváltáshoz

1. **Adat:** `python3 tools/analyze.py` → friss ellenfélprofil (`docs/opponents.md`).
2. **Hipotézis:** egy konkrét, mérhető változtatás, pl. „rövid stacknél szélesebb shove range”.
3. **Szimuláció:** `sim/` – A/B teszt a régi és az új verzió között ugyanazokon a seedeken, legalább 2000 meccsel. Csak akkor menjen ki, ha az átlagpont nő a releváns ellenfél-archetípusok ellen.
4. **Deploy:**
   - Emeld a `VERSION`-t az `src/index.ts`-ben, majd `npm run build`.
   - Commit és push a `main`-re.
   - Ellenőrizd a curl version hívással (lásd `CLAUDE.md`).
5. **Monitor:** `python3 tools/standings.py 10`. Az új commit meccseit nézd, ne az összesített pontot – az a régi verziók eredményeit is tartalmazza.

## Hasznos linkek

- Dashboard: https://live.leanpoker.org/tournament/6ad1f731e9d3abe3c2580703
- Player API: https://www.leanpoker.org/docs/api/player
- Lean Poker csapatoldal (logok, deploy státusz): leanpoker.org → bejelentkezés GitHubbal
