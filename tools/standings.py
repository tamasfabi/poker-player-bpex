#!/usr/bin/env python3
"""Print current Lean Poker tournament standings and our recent game results."""
import json, subprocess, sys

TOURNAMENT = "6ad1f731e9d3abe3c2580703"
BASE = f"https://live.leanpoker.org/api/tournament/{TOURNAMENT}"
TEAM = "bpex"


def get(url):
    out = subprocess.run(["curl", "-sL", "--compressed", "-H", "Accept: application/json", url],
                         capture_output=True, check=True).stdout
    return json.loads(out)


t = get(BASE)
games = get(BASE + "/game")
print(f"tournament: {t.get('status')}  games: {len(games)}")
for team in sorted(t["teams"], key=lambda x: -x["points"]):
    mark = "  <==" if team["name"] == TEAM else ""
    print(f"  {team['points']:>5}  {team['name']:<12} {team.get('last_version', '')}{mark}")

n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
print(f"last {n} games (our rank, gained, commit):")
for g in games[-n:]:
    ours = next((x for x in g["teams"] if x["name"] == TEAM), None)
    winner = next((x["name"] for x in g["teams"] if x["ranking"] == 1), "?")
    if ours:
        print(f"  {g.get('finished') or g['status']}  #{ours['ranking']} +{ours['gained']}  {ours['commit_id'][:7]}  winner={winner}")
