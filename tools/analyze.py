#!/usr/bin/env python3
"""Lean Poker log analyzer: download + cache game logs, profile every player.

Usage examples (python3 stdlib only):
  python3 tools/analyze.py                         # last 20 games, all players
  python3 tools/analyze.py --last 40               # last 40 games
  python3 tools/analyze.py --team bpex --commit d3d6204   # games where bpex ran that commit
  python3 tools/analyze.py --last 30 --version nontechyk=v8 --version megistekik=v0.4   # per-hand version filter
  python3 tools/analyze.py --since 12:50           # games finished at/after 12:50 UTC today
  python3 tools/analyze.py --hands bpex 15         # 15 biggest losing hands of bpex (with game id + round)
  python3 tools/analyze.py --dump <GAME_ID> <ROUND>        # print one hand action by action
  python3 tools/analyze.py --refresh               # re-download game list (logs of finished games are immutable)

Log format notes (discovered from raw data):
  * event without "type"      -> start of a round (hand); game_state has round, players, blinds, dealer
  * type card_deal            -> hole card dealt (hole cards of ALL players are visible in game_state)
  * type bet, on_turn=<idx>   -> "<name> made a bet of <added> (raise|call|fold|check|allin) and is left with ..."
                                 or "<name> was disqualified for making an error: ..."
    The first two bet events of a hand are the blind posts (logged as "raise").  <added> is the amount
    added on top of the player's previous bet in this hand.
  * type showdown             -> "<name> showed <5 cards> making a <category>"
  * type winner_announcement  -> "<name> won <N>"
  game_state attached to an event is the state AFTER the action.
"""
import argparse
import collections
import json
import os
import re
import statistics
import subprocess
import sys

TOURNAMENT = "6ad1f731e9d3abe3c2580703"
BASE = f"https://live.leanpoker.org/api/tournament/{TOURNAMENT}"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
US = "bpex"

RANKS = "23456789TJQKA"
RANK_MAP = {"10": "T", "J": "J", "Q": "Q", "K": "K", "A": "A"}


# ----------------------------------------------------------------------------- download / cache
def fetch_json(url, cache_name, refresh=False):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, cache_name)
    if not refresh and os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path) as f:
            return json.load(f)
    out = subprocess.run(["curl", "-sL", "--compressed", "-H", "Accept: application/json", url],
                         capture_output=True, check=True).stdout
    data = json.loads(out)
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def load_games(refresh):
    # game list changes while the tournament runs -> always refresh unless told otherwise
    return fetch_json(BASE + "/game", "games.json", refresh=True if refresh else not os.path.exists(os.path.join(CACHE, "games.json")) or refresh)


def load_log(game_id):
    return fetch_json(f"{BASE}/game/{game_id}/log", f"log_{game_id}.json")


# ----------------------------------------------------------------------------- cards
def card_str(c):
    r = c["rank"]
    r = RANK_MAP.get(r, r)
    return r + c["suit"][0]


def hole_class(cards):
    """'AKs', 'T9o', '77' style class for two hole cards."""
    if not cards or len(cards) < 2:
        return "??"
    r1, r2 = (RANK_MAP.get(c["rank"], c["rank"]) for c in cards)
    i1, i2 = RANKS.index(r1), RANKS.index(r2)
    if i1 < i2:
        r1, r2, i1, i2 = r2, r1, i2, i1
    if r1 == r2:
        return r1 + r2
    suited = cards[0]["suit"] == cards[1]["suit"]
    return r1 + r2 + ("s" if suited else "o")


def chen_score(cls):
    """Chen formula preflop strength (AA=20, 72o=-1). Used only to bucket ranges."""
    if cls == "??":
        return None
    hi, lo = cls[0], cls[1]
    pts = {"A": 10, "K": 8, "Q": 7, "J": 6, "T": 5}
    h = pts[hi] if hi in pts else int(hi) / 2.0
    if hi == lo:
        return max(5, h * 2)
    gap = RANKS.index(hi) - RANKS.index(lo) - 1
    s = h
    if cls.endswith("s"):
        s += 2
    s -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
    if gap <= 1 and RANKS.index(hi) < RANKS.index("Q"):
        s += 1
    return s


def bucket(cls):
    """Coarse hand buckets for range descriptions."""
    if cls == "??":
        return "unknown"
    hi, lo = cls[0], cls[1]
    if hi == lo:
        return "pair TT+" if RANKS.index(hi) >= RANKS.index("T") else ("pair 66-99" if RANKS.index(hi) >= 4 else "pair 22-55")
    if hi == "A":
        return "Ax broadway" if lo in "KQJT" else ("Ax suited" if cls.endswith("s") else "Ax offsuit")
    if hi in "KQJT" and lo in "KQJT":
        return "broadway"
    if hi == "K":
        return "Kx"
    gap = RANKS.index(hi) - RANKS.index(lo)
    if cls.endswith("s") and gap <= 2:
        return "suited connector"
    return "junk"


# ----------------------------------------------------------------------------- parsing
BET_RE = re.compile(r"^(\S+) made a bet of (\d+) \((raise|call|fold|check|allin)\)")
DQ_RE = re.compile(r"^(\S+) was disqualified")
SHOW_RE = re.compile(r"^(\S+) showed (.*) making an? (.+)$")
WON_RE = re.compile(r"^(\S+) won (\d+)$")


def street_of(n_cc):
    return {0: "preflop", 3: "flop", 4: "turn", 5: "river"}.get(n_cc, "?")


def parse_game(game_id, log):
    """Return list of hands. Each hand: dict with game, round, sb, bb, dealer, players{name->info}, actions[], showdown{}, winners{}."""
    hands = []
    cur = None
    prev_state = None
    for ev in log:
        gs = ev.get("game_state")
        if gs is None:
            continue
        t = ev.get("type")
        if t is None:  # new round
            if cur is not None:
                finish_hand(cur, prev_state)
            cur = {
                "game": game_id, "round": gs["round"], "sb": gs["small_blind"], "bb": gs["big_blind"],
                "dealer": gs["dealer"], "orbits": gs.get("orbits"),
                "players": {p["name"]: {"id": p["id"], "stack_start": p["stack"], "status_start": p["status"],
                                        "version": str(p.get("version")), "hole": [], "cls": "??"} for p in gs["players"]},
                "order": [p["name"] for p in gs["players"]],
                "actions": [], "showdown": {}, "winners": collections.Counter(), "n_blinds_seen": 0,
                "board": [], "last_aggressor": None, "pot_end": 0,
            }
            hands.append(cur)
            prev_state = gs
            continue
        if cur is None:
            prev_state = gs
            continue
        # hole cards / board
        for p in gs["players"]:
            if len(p.get("hole_cards") or []) == 2 and not cur["players"][p["name"]]["hole"]:
                cur["players"][p["name"]]["hole"] = p["hole_cards"]
                cur["players"][p["name"]]["cls"] = hole_class(p["hole_cards"])
        if len(gs.get("community_cards") or []) > len(cur["board"]):
            cur["board"] = gs["community_cards"]
        if t == "bet":
            msg = ev["message"]
            idx = ev.get("on_turn")
            pre = prev_state
            pre_p = pre["players"][idx]
            post_p = gs["players"][idx]
            name = pre_p["name"]
            m = BET_RE.match(msg)
            street = street_of(len(gs.get("community_cards") or []))
            buy_in_before = pre["current_buy_in"]
            bet_before = pre_p["bet"]
            stack_before = pre_p["stack"]
            pot_before = pre["pot"]
            to_call = max(0, buy_in_before - bet_before)
            # who is all-in among opponents with the max bet (facing a shove?)
            facing_allin = any(q["stack"] == 0 and q["bet"] >= buy_in_before and q["bet"] > 0 and q["id"] != idx
                               and q["status"] == "active" for q in pre["players"])
            act = {
                "player": name, "street": street, "idx": idx,
                "buy_in_before": buy_in_before, "bet_before": bet_before, "stack_before": stack_before,
                "pot_before": pot_before, "to_call": to_call, "facing_allin": facing_allin,
                "aggressor_before": cur["last_aggressor"],
                "n_active_before": sum(1 for q in pre["players"] if q["status"] == "active"),
            }
            if m:
                _, amount, kind = m.groups()
                amount = int(amount)
                total = bet_before + amount
                act.update({"raw_kind": kind, "amount": amount, "total": total, "stack_after": post_p["stack"]})
                is_blind = False
                if street == "preflop" and cur["n_blinds_seen"] < 2 and kind in ("raise", "allin"):
                    is_blind = True
                    cur["n_blinds_seen"] += 1
                    cur["players"][name]["blind"] = "SB" if cur["n_blinds_seen"] == 1 else "BB"
                    cur["last_aggressor"] = name
                act["blind"] = is_blind
                if is_blind:
                    kind2 = "blind"
                elif kind == "fold":
                    kind2 = "fold"
                elif kind == "check":
                    kind2 = "check"
                elif kind == "call":
                    kind2 = "call"
                elif kind in ("raise", "allin"):
                    if total > buy_in_before:
                        kind2 = "raise"
                    elif amount == 0:
                        kind2 = "check"
                    else:
                        kind2 = "call"
                else:
                    kind2 = kind
                act["kind"] = kind2
                act["allin"] = post_p["stack"] == 0 and kind2 in ("raise", "call")
                if kind2 == "raise" and not is_blind:
                    cur["last_aggressor"] = name
                    act["raise_to_bb"] = total / cur["bb"]
                    act["raise_vs_pot"] = amount / pot_before if pot_before else None
                    act["is_open"] = street == "preflop" and buy_in_before <= cur["bb"]
                    act["is_3bet"] = street == "preflop" and buy_in_before > cur["bb"]
                    act["is_bet"] = street != "preflop" and to_call == 0
            elif DQ_RE.match(msg):
                act.update({"raw_kind": "dq", "kind": "fold", "amount": 0, "total": bet_before, "blind": False,
                            "stack_after": post_p["stack"], "allin": False, "dq": True})
            else:
                act.update({"raw_kind": "?", "kind": "?", "amount": 0, "total": bet_before, "blind": False,
                            "stack_after": post_p["stack"], "allin": False})
            cur["actions"].append(act)
        elif t == "showdown":
            m = SHOW_RE.match(ev["message"])
            if m:
                cur["showdown"][m.group(1)] = m.group(3)
        elif t == "winner_announcement":
            m = WON_RE.match(ev["message"])
            if m:
                cur["winners"][m.group(1)] += int(m.group(2))
        prev_state = gs
    if cur is not None:
        finish_hand(cur, prev_state)
    return hands


def finish_hand(hand, end_state):
    for p in end_state["players"]:
        info = hand["players"][p["name"]]
        info["stack_end"] = p["stack"]
        info["status_end"] = p["status"]
        info["delta"] = p["stack"] - info["stack_start"]
        info["chen"] = chen_score(info["cls"])
    hand["went_to_showdown"] = bool(hand["showdown"])
    hand["n_dealt"] = sum(1 for n, i in hand["players"].items() if i["status_start"] == "active" and i["stack_start"] > 0)


# ----------------------------------------------------------------------------- stats
def pct(a, b):
    return f"{100.0 * a / b:5.1f}%" if b else "   n/a"


def frac(a, b):
    return f"{a}/{b} ({100.0 * a / b:.0f}%)" if b else f"{a}/{b}"


class PlayerStats:
    def __init__(self, name):
        self.name = name
        self.versions = collections.Counter()
        self.hands_dealt = 0
        self.hands_with_decision_pf = 0
        self.vpip = 0
        self.pfr = 0
        self.limp = 0
        self.pf_open = []           # raise_to_bb of open raises
        self.pf_3bet = 0
        self.pf_faced_open = 0       # faced a raise (unraised by them) preflop
        self.pf_faced_open_resp = collections.Counter()
        self.pf_faced_3bet = 0       # they had raised, got re-raised
        self.pf_faced_3bet_resp = collections.Counter()
        self.pf_shove_hands = []     # (cls, stack_bb, result)
        self.pf_allin_hands = 0
        self.pf_call_allin = collections.Counter()   # call/fold when facing all-in preflop
        self.pf_call_allin_hands = []               # (cls, won?)
        self.post_bets = 0
        self.post_raises = 0
        self.post_calls = 0
        self.post_checks = 0
        self.post_folds = 0
        self.post_faced_bet = collections.Counter()  # fold/call/raise
        self.post_bet_vs_pot = []
        self.post_call_allin = collections.Counter()
        self.post_call_allin_hands = []
        self.post_shove_hands = []
        self.cbet_opp = 0
        self.cbet = 0
        self.showdowns = 0
        self.showdown_won = 0
        self.showdown_cats = collections.Counter()
        self.sd_hole = []            # hole classes at showdown
        self.vpip_hole = []
        self.pfr_hole = []
        self.chips = 0
        self.chips_by_situation = collections.Counter()
        self.count_by_situation = collections.Counter()
        self.vs = collections.defaultdict(collections.Counter)  # reaction to a specific aggressor
        self.vs_shove = collections.defaultdict(collections.Counter)
        self.vs_shove_hands = collections.defaultdict(list)
        self.busted_round = []
        self.bb_at_bust = []
        self.wins = collections.Counter()  # ranking counter
        self.timeouts = 0
        self.multi_raise_streets = 0
        self.hand_examples = []      # (delta, game, round, summary)
        self.pf_open_inc = []        # raise increment (added chips) in bb for open raises
        self.pf_tiny_raises = 0      # raises where total < 2 bb (sub-min "raise by small blind")
        self.pf_raises_total = 0
        self.steal_att = 0           # open raise when everyone else still to act
        self.steal_ok = 0            # ...and everybody folded
        self.bb_def = collections.defaultdict(collections.Counter)  # BB facing raise, by size bucket -> fold/call/raise
        self.raise_wars = []         # (cls, n_raises, street, delta, game, round) when >=3 raises by them in a street
        self.first20 = []            # chip delta over rounds 0-19 per game
        self.dq = 0


def hand_summary(hand, focus=None):
    parts = []
    for a in hand["actions"]:
        if a.get("blind"):
            continue
        tag = a["kind"]
        if a["kind"] == "raise":
            tag = f"raise->{a['total']}"
        elif a["kind"] == "call":
            tag = f"call {a['to_call']}"
        if a.get("allin"):
            tag += "(allin)"
        parts.append(f"{a['street'][:2]}:{a['player'][:4]} {tag}")
    board = " ".join(card_str(c) for c in hand["board"])
    cards = " ".join(f"{n[:4]}={i['cls']}" for n, i in hand["players"].items() if i["hole"])
    sd = " ".join(f"{n[:4]}:{c}" for n, c in hand["showdown"].items())
    return f"[{cards}] board[{board}] {' | '.join(parts)} => {dict(hand['winners'])} {sd}"


def version_ok(info, vfilter):
    """vfilter: {player: substring}. A hand counts for a player only if its version string contains the substring."""
    if not vfilter:
        return True
    sub = vfilter.get(info.get("name") or "", None)
    return sub is None or sub in str(info.get("version"))


def raise_bucket(total_bb):
    if total_bb < 2:
        return "<2bb"
    if total_bb <= 3:
        return "2-3bb"
    if total_bb <= 5:
        return "3-5bb"
    if total_bb <= 10:
        return "5-10bb"
    return ">10bb"


def analyze(hands_by_game, games_meta, vfilter=None):
    stats = {}
    game_info = []
    for game_id, hands in hands_by_game.items():
        meta = games_meta.get(game_id, {})
        if not hands:
            continue
        n_rounds = hands[-1]["round"] + 1
        final = {n: i["stack_end"] for n, i in hands[-1]["players"].items()}
        schedule = {}
        for h in hands:
            schedule.setdefault(h["sb"], h["round"])
        game_info.append({"game": game_id, "rounds": n_rounds, "final": final, "schedule": schedule,
                          "rank": {t["name"]: t["ranking"] for t in meta.get("teams", [])},
                          "finished": meta.get("finished")})
        first20 = collections.Counter()
        for h in hands:
            for name, info in h["players"].items():
                info["name"] = name
                st = stats.setdefault(name, PlayerStats(name))
                if not version_ok(info, vfilter):
                    continue
                if info["status_start"] != "active" or info["stack_start"] <= 0:
                    continue
                st.versions[info.get("version")] += 1
                st.hands_dealt += 1
                st.chips += info["delta"]
                if h["round"] < 20:
                    first20[name] += info["delta"]
                if info["status_end"] == "out" and info["stack_end"] == 0:
                    st.busted_round.append(h["round"])
                    st.bb_at_bust.append(h["bb"])
            per_hand(h, stats, vfilter)
        for name, d in first20.items():
            stats[name].first20.append(d)
        for t in meta.get("teams", []):
            if t["name"] in stats:
                stats[t["name"]].wins[t["ranking"]] += 1
    return stats, game_info


def per_hand(h, stats, vfilter):
    acts = h["actions"]
    bb = h["bb"]
    flags = collections.defaultdict(lambda: {"vpip": False, "pfr": False, "pf_decision": False, "raised_pf": False,
                                             "seen": set(), "n_raises": collections.Counter()})
    aggressor_pf = None
    n_raises_pf_before = 0
    for i, a in enumerate(acts):
        name = a["player"]
        info = h["players"][name]
        if not version_ok(info, vfilter):
            if a["kind"] == "raise" and a["street"] == "preflop" and not a.get("blind"):
                n_raises_pf_before += 1
                aggressor_pf = name
            continue
        st = stats.setdefault(name, PlayerStats(name))
        f = flags[name]
        if a.get("dq"):
            st.timeouts += 1
        if a.get("blind"):
            continue
        key = a["street"]
        first_on_street = key not in f["seen"]        # first decision of this player on this street
        f["seen"].add(key)
        prior_raises = f["n_raises"][a["street"]]
        if a["kind"] == "raise":
            f["n_raises"][a["street"]] += 1
        if a["street"] == "preflop":
            f["pf_decision"] = True
            facing_raise = a["buy_in_before"] > bb
            if a["kind"] in ("call", "raise"):
                f["vpip"] = True
            if a["kind"] == "raise":
                f["pfr"] = True
                st.pf_raises_total += 1
                if a["raise_to_bb"] < 2:
                    st.pf_tiny_raises += 1
                if a.get("is_open"):
                    st.pf_open.append(a["raise_to_bb"])
                    st.pf_open_inc.append(a["amount"] / bb)
                    # steal attempt: nobody has voluntarily entered yet
                    if n_raises_pf_before == 0 and not any(x["kind"] == "call" for x in acts[:i] if not x.get("blind")):
                        st.steal_att += 1
                        others = [x for x in acts[i + 1:] if x["player"] != name and x["street"] == "preflop"]
                        if others and all(x["kind"] == "fold" for x in others) and not any(x["street"] != "preflop" for x in acts[i + 1:]):
                            st.steal_ok += 1
                else:
                    st.pf_3bet += 1
                if a["allin"]:
                    st.pf_allin_hands += 1
                    st.pf_shove_hands.append((info["cls"], round(a["stack_before"] / bb, 1), info["delta"], h["game"], h["round"]))
            if a["kind"] == "call" and not facing_raise:
                st.limp += 1
            if facing_raise and first_on_street:
                st.pf_faced_open += 1
                st.pf_faced_open_resp[a["kind"]] += 1
                agg = a["aggressor_before"]
                if agg and agg != name:
                    st.vs[agg]["pf_" + a["kind"]] += 1
                if info.get("blind") == "BB":
                    st.bb_def[raise_bucket(a["buy_in_before"] / bb)][a["kind"]] += 1
            elif facing_raise and f["raised_pf"] and prior_raises == 1 and not f.get("faced_3bet"):
                f["faced_3bet"] = True
                st.pf_faced_3bet += 1
                st.pf_faced_3bet_resp[a["kind"]] += 1
            if a["facing_allin"] and a["to_call"] > 0 and not f.get("faced_allin_pf"):
                f["faced_allin_pf"] = True
                st.pf_call_allin[a["kind"]] += 1
                if a["kind"] in ("call", "raise"):
                    st.pf_call_allin_hands.append((info["cls"], round(a["to_call"] / bb, 1), info["delta"], h["game"], h["round"]))
                agg = a["aggressor_before"]
                if agg and agg != name:
                    st.vs_shove[agg][a["kind"]] += 1
                    st.vs_shove[agg]["pf"] += 1
                    if a["kind"] in ("call", "raise"):
                        st.vs_shove_hands[agg].append((info["cls"], info["delta"], h["game"], h["round"]))
            if a["kind"] == "raise":
                f["raised_pf"] = True
                aggressor_pf = name
                n_raises_pf_before += 1
        else:
            if a["kind"] == "raise":
                if a["to_call"] == 0:
                    st.post_bets += 1
                    if a["pot_before"]:
                        st.post_bet_vs_pot.append(a["amount"] / a["pot_before"])
                else:
                    st.post_raises += 1
                if a["allin"]:
                    st.post_shove_hands.append((info["cls"], a["street"], info["delta"], h["game"], h["round"]))
            elif a["kind"] == "call":
                st.post_calls += 1
            elif a["kind"] == "check":
                st.post_checks += 1
            elif a["kind"] == "fold":
                st.post_folds += 1
            if a["to_call"] > 0 and first_on_street:
                st.post_faced_bet[a["kind"]] += 1
                agg = a["aggressor_before"]
                if agg and agg != name:
                    st.vs[agg]["post_" + a["kind"]] += 1
            if a["to_call"] > 0 and a["facing_allin"] and not f.get("faced_allin_post"):
                f["faced_allin_post"] = True
                st.post_call_allin[a["kind"]] += 1
                if a["kind"] in ("call", "raise"):
                    st.post_call_allin_hands.append((info["cls"], a["street"], round(a["to_call"] / bb, 1), info["delta"], h["game"], h["round"]))
                agg = a["aggressor_before"]
                if agg and agg != name:
                    st.vs_shove[agg][a["kind"]] += 1
                    st.vs_shove[agg]["post"] += 1
                    if a["kind"] in ("call", "raise"):
                        st.vs_shove_hands[agg].append((info["cls"], info["delta"], h["game"], h["round"]))
            if a["street"] == "flop" and name == aggressor_pf and a["to_call"] == 0 and not f.get("cbet_counted"):
                f["cbet_counted"] = True
                st.cbet_opp += 1
                if a["kind"] == "raise":
                    st.cbet += 1
    for name, f in flags.items():
        info = h["players"][name]
        st = stats[name]
        if f["pf_decision"]:
            st.hands_with_decision_pf += 1
        if f["vpip"]:
            st.vpip += 1
            st.vpip_hole.append(info["cls"])
        if f["pfr"]:
            st.pfr += 1
            st.pfr_hole.append(info["cls"])
        for street, n in f["n_raises"].items():
            if n >= 3:
                st.raise_wars.append((info["cls"], n, street, info["delta"], h["game"], h["round"]))
    # showdown + situation accounting
    for name, info in h["players"].items():
        if not version_ok(info, vfilter):
            continue
        if info["status_start"] != "active" or info["stack_start"] <= 0:
            continue
        st = stats[name]
        d = info["delta"]
        my_acts = [a for a in acts if a["player"] == name and not a.get("blind")]
        folded_street = next((a["street"] for a in my_acts if a["kind"] == "fold"), None)
        if any(a.get("dq") for a in my_acts):
            sit = "disqualified (stack removed)"
            st.dq += 1
        elif name in h["showdown"]:
            st.showdowns += 1
            st.showdown_cats[h["showdown"][name]] += 1
            st.sd_hole.append(info["cls"])
            if d > 0:
                st.showdown_won += 1
                sit = "showdown won"
            elif d == 0:
                sit = "showdown split/even"
            else:
                sit = "showdown lost (all-in)" if info["stack_end"] == 0 or any(a["allin"] for a in my_acts) else "showdown lost"
        elif folded_street == "preflop":
            sit = "preflop fold from blind" if info.get("blind") else "preflop fold (free)"
        elif folded_street:
            sit = f"fold on {folded_street}"
        elif d > 0:
            sit = "won uncontested"
        elif d < 0:
            # reached showdown but mucked (the log only shows hands that beat the previously shown one)
            st.showdowns += 1
            st.sd_hole.append(info["cls"])
            sit = "showdown lost (all-in, mucked)" if info["stack_end"] == 0 or any(a["allin"] for a in my_acts) else "showdown lost (mucked)"
        else:
            sit = "even (no action)"
        st.chips_by_situation[sit] += d
        st.count_by_situation[sit] += 1
        if my_acts or info.get("blind"):
            st.hand_examples.append((d, h["game"], h["round"], hand_summary(h), sit))


# ----------------------------------------------------------------------------- report
def top_classes(lst, n=12):
    c = collections.Counter(lst)
    return ", ".join(f"{k}x{v}" if v > 1 else k for k, v in c.most_common(n))


def report_player(st, n_games):
    print(f"\n==================== {st.name} ====================")
    print(f"versions: {dict(st.versions)}")
    print(f"games: {n_games}  rank counts: {dict(sorted(st.wins.items()))}  chips net (sum of per-hand deltas): {st.chips:+d}")
    print(f"hands dealt: {st.hands_dealt}  preflop decisions: {st.hands_with_decision_pf}  disqualified (unreachable/invalid response -> stack removed): {st.dq}")
    if st.busted_round:
        print(f"busted in {len(st.busted_round)} games, avg round {statistics.mean(st.busted_round):.0f}, avg BB at bust {statistics.mean(st.bb_at_bust):.0f}")
    hd = st.hands_with_decision_pf
    print(f"VPIP {pct(st.vpip, hd)}  PFR {pct(st.pfr, hd)}  limps {st.limp}  opens {len(st.pf_open)}  3-bets {st.pf_3bet}")
    if st.first20:
        print(f"chip delta over rounds 0-19 (time-cap relevance): avg {statistics.mean(st.first20):+.0f} per game, games positive {sum(1 for x in st.first20 if x > 0)}/{len(st.first20)}")
    if st.pf_open:
        print(f"open-raise size (total bet): avg {statistics.mean(st.pf_open):.1f} bb, median {statistics.median(st.pf_open):.1f} bb, "
              f"distribution: {dict(sorted(collections.Counter(min(int(x), 20) for x in st.pf_open).items()))} (int bb, 20=20+)")
        print(f"open-raise increment (chips added / bb): median {statistics.median(st.pf_open_inc):.2f}; tiny raises (total < 2bb): {frac(st.pf_tiny_raises, st.pf_raises_total)} of all pf raises")
        print(f"steal attempts (first raise, no limper): {st.steal_att}, everyone folded: {pct(st.steal_ok, st.steal_att)}")
    if st.bb_def:
        print("BB defence when facing a raise, by raise-to size: " + "; ".join(
            f"{b}: n={sum(c.values())} fold {pct(c['fold'], sum(c.values()))} call {pct(c['call'], sum(c.values()))} raise {pct(c['raise'], sum(c.values()))}"
            for b, c in sorted(st.bb_def.items(), key=lambda kv: ["<2bb", "2-3bb", "3-5bb", "5-10bb", ">10bb"].index(kv[0]))))
    if st.raise_wars:
        won = sum(1 for x in st.raise_wars if x[3] > 0)
        print(f"raise wars (>=3 raises by them on one street): {len(st.raise_wars)}, won {won}: "
              f"{', '.join(f'{c}x{n}/{s[:2]}{d:+d}' for c, n, s, d, g, r in st.raise_wars[:25])}")
    print(f"preflop all-in shoves: {st.pf_allin_hands} ({pct(st.pf_allin_hands, hd)} of pf decisions)")
    if st.pf_shove_hands:
        won = sum(1 for x in st.pf_shove_hands if x[2] > 0)
        print(f"   shove hands (cls, stack bb, delta): won {won}/{len(st.pf_shove_hands)}")
        print(f"   {', '.join(f'{c}@{s}bb{d:+d}' for c, s, d, g, r in st.pf_shove_hands[:40])}")
        print(f"   buckets: {dict(collections.Counter(bucket(c) for c, *_ in st.pf_shove_hands))}")
    print(f"first decision facing a preflop raise: {st.pf_faced_open} -> {dict(st.pf_faced_open_resp)}  fold {pct(st.pf_faced_open_resp['fold'], st.pf_faced_open)}")
    print(f"facing a 3-bet after own raise (once per hand): {st.pf_faced_3bet} -> {dict(st.pf_faced_3bet_resp)}  fold {pct(st.pf_faced_3bet_resp['fold'], st.pf_faced_3bet)}")
    tot = sum(st.pf_call_allin.values())
    print(f"facing an all-in preflop: {tot} -> {dict(st.pf_call_allin)}  call/raise {pct(st.pf_call_allin['call'] + st.pf_call_allin['raise'], tot)}")
    if st.pf_call_allin_hands:
        won = sum(1 for x in st.pf_call_allin_hands if x[2] > 0)
        print(f"   called all-in with (cls, to_call bb, delta): won {won}/{len(st.pf_call_allin_hands)}: "
              f"{', '.join(f'{c}@{s}bb{d:+d}' for c, s, d, g, r in st.pf_call_allin_hands[:40])}")
        print(f"   buckets: {dict(collections.Counter(bucket(c) for c, *_ in st.pf_call_allin_hands))}")
    print(f"VPIP hands: {top_classes(st.vpip_hole, 25)}")
    print(f"   VPIP buckets: {dict(collections.Counter(bucket(c) for c in st.vpip_hole).most_common())}")
    print(f"PFR hands:  {top_classes(st.pfr_hole, 25)}")
    agg = st.post_bets + st.post_raises
    print(f"postflop: bets {st.post_bets} raises {st.post_raises} calls {st.post_calls} checks {st.post_checks} folds {st.post_folds}  "
          f"AF={agg / st.post_calls if st.post_calls else float('inf'):.2f}  agg% {pct(agg, agg + st.post_calls + st.post_checks + st.post_folds)}")
    if st.post_bet_vs_pot:
        print(f"postflop bet size vs pot: median {statistics.median(st.post_bet_vs_pot):.2f}, mean {statistics.mean(st.post_bet_vs_pot):.2f}  "
              f"<=0.34: {sum(1 for x in st.post_bet_vs_pot if x <= 0.34)}, 0.34-0.75: {sum(1 for x in st.post_bet_vs_pot if 0.34 < x <= 0.75)}, >0.75: {sum(1 for x in st.post_bet_vs_pot if x > 0.75)}")
    tot = sum(st.post_faced_bet.values())
    print(f"facing a postflop bet/raise: {tot} -> {dict(st.post_faced_bet)}  fold {pct(st.post_faced_bet['fold'], tot)}")
    print(f"c-bet (pf aggressor, flop, unopened): {frac(st.cbet, st.cbet_opp)}")
    tot = sum(st.post_call_allin.values())
    print(f"facing an all-in postflop: {tot} -> {dict(st.post_call_allin)}")
    if st.post_call_allin_hands:
        won = sum(1 for x in st.post_call_allin_hands if x[3] > 0)
        print(f"   called with: won {won}/{len(st.post_call_allin_hands)}: {', '.join(f'{c}/{s[:1]}@{t}bb{d:+d}' for c, s, t, d, g, r in st.post_call_allin_hands[:30])}")
    if st.post_shove_hands:
        won = sum(1 for x in st.post_shove_hands if x[2] > 0)
        print(f"postflop shoves: {len(st.post_shove_hands)} won {won}: {', '.join(f'{c}/{s[:1]}{d:+d}' for c, s, d, g, r in st.post_shove_hands[:30])}")
    print(f"showdowns: {st.showdowns} won {st.showdown_won} ({pct(st.showdown_won, st.showdowns)})  categories: {dict(st.showdown_cats.most_common())}")
    print(f"   showdown hole classes: {top_classes(st.sd_hole, 25)}")
    print("chips by situation (count, sum):")
    for sit, d in sorted(st.chips_by_situation.items(), key=lambda kv: kv[1]):
        print(f"   {sit:<28} n={st.count_by_situation[sit]:<5} {d:+d}")
    if st.vs:
        print("reaction when the last aggressor was X (preflop pf_*, postflop post_*):")
        for opp, c in sorted(st.vs.items()):
            pf_tot = c["pf_fold"] + c["pf_call"] + c["pf_raise"]
            po_tot = c["post_fold"] + c["post_call"] + c["post_raise"]
            print(f"   vs {opp:<11} preflop n={pf_tot:<4} fold {pct(c['pf_fold'], pf_tot)} call {pct(c['pf_call'], pf_tot)} raise {pct(c['pf_raise'], pf_tot)} | "
                  f"postflop n={po_tot:<4} fold {pct(c['post_fold'], po_tot)} call {pct(c['post_call'], po_tot)} raise {pct(c['post_raise'], po_tot)}")
    if st.vs_shove:
        print("facing an all-in by X:")
        for opp, c in sorted(st.vs_shove.items()):
            tot = c["fold"] + c["call"] + c["raise"]
            hands = st.vs_shove_hands.get(opp, [])
            won = sum(1 for x in hands if x[1] > 0)
            print(f"   vs {opp:<11} n={tot:<4} fold {pct(c['fold'], tot)} call/raise {pct(c['call'] + c['raise'], tot)} (pf {c['pf']}, post {c['post']})  "
                  f"called with (won {won}/{len(hands)}): {', '.join(f'{x[0]}{x[1]:+d}' for x in hands[:20])}")


def report_games(game_info):
    print("\n==================== games ====================")
    rounds = [g["rounds"] for g in game_info]
    print(f"games: {len(game_info)}  rounds per game: min {min(rounds)} median {statistics.median(rounds):.0f} max {max(rounds)}")
    sched = collections.defaultdict(list)
    for g in game_info:
        for sb, r in g["schedule"].items():
            sched[sb].append(r)
    print("blind schedule (small blind -> first round seen): " + ", ".join(f"sb{sb}@r{min(rs)}" for sb, rs in sorted(sched.items())))
    cut = [g for g in game_info if sum(1 for v in g["final"].values() if v > 0) > 1]
    print(f"games ending with >1 player still holding chips (time cap, ranked by stack): {len(cut)}")
    for g in game_info:
        fin = " ".join(f"{n[:5]}={v}" for n, v in g["final"].items())
        rk = " ".join(f"{n[:5]}:{r}" for n, r in sorted(g["rank"].items(), key=lambda kv: kv[1]))
        print(f"   {g['game']} {g['finished']} rounds={g['rounds']:<4} final[{fin}] rank[{rk}]")


def report_hands(stats, player, n, worst=True):
    st = stats[player]
    ex = sorted(st.hand_examples, key=lambda x: x[0], reverse=not worst)
    print(f"\n==================== {'biggest losses' if worst else 'biggest wins'} of {player} ====================")
    for d, g, r, s, sit in ex[:n]:
        print(f"{d:+6d}  game {g} round {r:<3} [{sit}] {s}")


def dump_hand(hands_by_game, game_id, rnd):
    for h in hands_by_game[game_id]:
        if h["round"] == rnd:
            print(json.dumps({k: v for k, v in h.items() if k != "actions"}, indent=1, default=str))
            for a in h["actions"]:
                print(a)
            return
    print("round not found")


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--last", type=int, default=20, help="only the last N finished games (default 20)")
    ap.add_argument("--all", action="store_true", help="all finished games")
    ap.add_argument("--team", help="with --commit: only games where TEAM ran commit COMMIT (prefix)")
    ap.add_argument("--commit", help="commit prefix for --team")
    ap.add_argument("--games", nargs="*", help="explicit game ids")
    ap.add_argument("--version", action="append", default=[], metavar="PLAYER=SUBSTR",
                    help="count PLAYER's hands only when its version string contains SUBSTR (repeatable; versions switch mid-game)")
    ap.add_argument("--since", help="only games finished at/after this 'HH:MM' (UTC) or full timestamp prefix")
    ap.add_argument("--players", nargs="*", help="only report these players")
    ap.add_argument("--hands", nargs=2, metavar=("PLAYER", "N"), help="print N biggest losing hands of PLAYER")
    ap.add_argument("--wins", nargs=2, metavar=("PLAYER", "N"), help="print N biggest winning hands of PLAYER")
    ap.add_argument("--dump", nargs=2, metavar=("GAME_ID", "ROUND"), help="dump one hand")
    ap.add_argument("--no-games", action="store_true", help="skip the per-game table")
    ap.add_argument("--refresh", action="store_true", help="re-download the game list")
    ap.add_argument("--json", help="write raw stats to this json file")
    args = ap.parse_args()

    games = load_games(args.refresh)
    games = [g for g in games if g.get("status") in ("done", "finished")]
    games.sort(key=lambda g: g.get("finished") or "")
    if args.games:
        games = [g for g in games if g["id"] in set(args.games)]
    elif args.team and args.commit:
        games = [g for g in games if any(t["name"] == args.team and t["commit_id"].startswith(args.commit) for t in g["teams"])]
    if args.since:
        key = args.since if len(args.since) > 5 else f"2026-10-16 {args.since}"
        games = [g for g in games if (g.get("finished") or "") >= key]
    elif not (args.games or (args.team and args.commit) or args.all):
        games = games[-args.last:]
    games_meta = {g["id"]: g for g in games}
    print(f"selected {len(games)} games: {games[0]['finished'] if games else ''} .. {games[-1]['finished'] if games else ''}")

    hands_by_game = {}
    for g in games:
        try:
            log = load_log(g["id"])
        except Exception as e:  # noqa
            print(f"failed to load {g['id']}: {e}", file=sys.stderr)
            continue
        hands_by_game[g["id"]] = parse_game(g["id"], log)

    if args.dump:
        dump_hand(hands_by_game, args.dump[0], int(args.dump[1]))
        return

    vfilter = dict(v.split("=", 1) for v in args.version) if args.version else None
    if vfilter:
        print(f"version filter: {vfilter}")
    stats, game_info = analyze(hands_by_game, games_meta, vfilter)
    if not args.no_games:
        report_games(game_info)
    for name in sorted(stats):
        if args.players and name not in args.players:
            continue
        report_player(stats[name], len(games))
    if args.hands:
        report_hands(stats, args.hands[0], int(args.hands[1]), worst=True)
    if args.wins:
        report_hands(stats, args.wins[0], int(args.wins[1]), worst=False)
    if args.json:
        with open(args.json, "w") as f:
            json.dump({n: {k: v for k, v in vars(s).items() if k != "hand_examples"} for n, s in stats.items()}, f, default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o), indent=1)


if __name__ == "__main__":
    main()
