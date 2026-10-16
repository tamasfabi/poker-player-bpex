#!/usr/bin/env python3
"""Poll the tournament every 30 s and print a line only when something worth acting on happens:
our bot erroring/unreachable, a bad streak, any team deploying a new version, and a digest every 10 games."""
import json, os, subprocess, sys, time

TOURNAMENT = "6ad1f731e9d3abe3c2580703"
BASE = f"https://live.leanpoker.org/api/tournament/{TOURNAMENT}"
TEAM = "bpex"
INTERVAL = int(sys.argv[1]) if len(sys.argv) > 1 else 30
DIGEST_EVERY = 10
# Shallow clones of the other teams' public repos (read only, never executed); pulled on every deploy
OPP_DIR = os.environ.get("OPP_DIR", "")


def repo_changes(team):
    d = os.path.join(OPP_DIR, f"poker-player-{team}")
    if not OPP_DIR or not os.path.isdir(d):
        return ""
    old = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    subprocess.run(["git", "-C", d, "pull", "-q", "--depth", "50"], capture_output=True)
    log = subprocess.run(["git", "-C", d, "log", "--format=%s", f"{old}..HEAD"], capture_output=True, text=True).stdout.split("\n")
    stat = subprocess.run(["git", "-C", d, "diff", "--shortstat", old, "HEAD"], capture_output=True, text=True).stdout.strip()
    return f" | commits: {'; '.join(l for l in log if l)[:300]} | {stat}" if stat else ""


def get(url):
    out = subprocess.run(["curl", "-sL", "--compressed", "-m", "20", "-H", "Accept: application/json", url],
                         capture_output=True).stdout
    return json.loads(out)


def say(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


seen, versions, ranks, streak, new_since_digest, alerted_error = None, {}, [], 0, 0, False
while True:
    try:
        t = get(BASE)
        games = get(BASE + "/game")
    except Exception as e:  # transient network/API errors must not kill the watch
        time.sleep(INTERVAL)
        continue

    for team in t["teams"]:
        v = team.get("last_version", "")
        if team["name"] in versions and versions[team["name"]] != v:
            extra = repo_changes(team["name"]) if team["name"] != TEAM else ""
            say(f"DEPLOY {team['name']}: {versions[team['name']]!r} -> {v!r}{extra}")
        versions[team["name"]] = v
        if team["name"] == TEAM:
            bad = "error" in v.lower() or "unreachable" in v.lower()
            if bad and not alerted_error:
                say(f"ALERT {TEAM} is failing: {v!r}")
            alerted_error = bad

    done = [g for g in games if g["status"] == "done"]
    if seen is None:
        seen = {g["id"] for g in done}
        pts = ", ".join(f"{x['name']} {x['points']}" for x in sorted(t["teams"], key=lambda x: -x["points"]))
        say(f"watching ({t.get('status')}, {len(done)} games): {pts}")
    for g in done:
        if g["id"] in seen:
            continue
        seen.add(g["id"])
        ours = next((x for x in g["teams"] if x["name"] == TEAM), None)
        if not ours:
            continue
        winner = next((x["name"] for x in g["teams"] if x["ranking"] == 1), "?")
        ranks.append((ours["ranking"], winner, ours["commit_id"][:7]))
        new_since_digest += 1
        streak = streak + 1 if ours["ranking"] >= 3 else 0
        if streak >= 3 and streak % 3 == 0:
            last = ", ".join(f"#{r}({w})" for r, w, _ in ranks[-streak:])
            say(f"ALERT bad streak: {streak} games without top-2 [{last}] commit {ours['commit_id'][:7]}")

    if new_since_digest >= DIGEST_EVERY:
        new_since_digest = 0
        pts = ", ".join(f"{x['name']} {x['points']}" for x in sorted(t["teams"], key=lambda x: -x["points"]))
        last = " ".join(f"#{r}" for r, _, _ in ranks[-DIGEST_EVERY:])
        avg = sum({1: 5, 2: 3}.get(r, 0) for r, _, _ in ranks[-DIGEST_EVERY:]) / DIGEST_EVERY
        say(f"DIGEST {pts} | our last {DIGEST_EVERY}: {last} (avg {avg:.1f} pts/game, commit {ranks[-1][2]})")

    if t.get("status") not in ("running", None):
        say(f"tournament status: {t.get('status')}") if t.get("status") != getattr(sys, "_last_status", None) else None
        sys._last_status = t.get("status")
    time.sleep(INTERVAL)
