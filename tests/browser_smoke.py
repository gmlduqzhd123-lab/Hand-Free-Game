"""Real Chromium regression checks. Run a static server, then pass its URL.

Uses a discovered system or Playwright Chromium, or CHROMIUM_PATH, and the
environment's HTTPS proxy with TLS validation enabled. Requires Playwright.
"""

import argparse
import json
import os
import shutil
import sys
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


def chromium_path(playwright):
    """Prefer an explicit override, then installed browsers on any host OS."""
    configured = os.environ.get("CHROMIUM_PATH")
    if configured:
        if not Path(configured).is_file():
            raise FileNotFoundError(f"CHROMIUM_PATH does not exist: {configured}")
        return configured
    candidates = [shutil.which(name) for name in ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge"]]
    for variable in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"]:
        if os.environ.get(variable):
            base = Path(os.environ[variable])
            candidates.extend(str(base / relative) for relative in ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"])
    candidates.append("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    candidates.append(playwright.chromium.executable_path)
    cache = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".cache")) / "ms-playwright"
    if cache.is_dir():
        candidates.extend(str(path) for path in sorted(cache.glob("chromium-*/chrome-win*/chrome.exe"), reverse=True))
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default=os.environ.get("BASE_URL", "http://127.0.0.1:8000/"))
    parser.add_argument("--output", help="Optional JSON result file")
    parser.add_argument("--screenshots", help="Optional directory for initial and progressed layout screenshots")
    parser.add_argument("--check", action="append", help="Run only checks containing this text (repeatable)")
    args = parser.parse_args()
    results = []

    with sync_playwright() as playwright:
        launch = {"headless": True}
        executable = chromium_path(playwright)
        if executable:
            launch["executable_path"] = executable
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        if proxy:
            launch["proxy"] = {"server": proxy, "bypass": "127.0.0.1,localhost"}
        browser = playwright.chromium.launch(**launch)

        @contextmanager
        def fresh(viewport=None, raw=None, clock=None, reduced_motion=False):
            context = browser.new_context(viewport=viewport or {"width": 390, "height": 844},
                reduced_motion="reduce" if reduced_motion else "no-preference")
            errors = []
            if clock is not None:
                context.add_init_script("Date.now = () => " + str(clock))
            if raw is not None:
                context.add_init_script("""(() => {
                    if (!['http:', 'https:'].includes(location.protocol)) return;
                    const key = 'ys_bugfree_final_v2';
                    if (localStorage.getItem(key) === null) localStorage.setItem(key, RAW);
                })();""".replace("RAW", json.dumps(raw)))

            def console_message(message):
                if message.type != "error":
                    return
                location = message.location
                url = location.get("url", "")
                # Font-network failures are external to the local game logic. Keep
                # every other error, including swallowed Data status callbacks.
                if urlparse(url).hostname == "cdn.jsdelivr.net" and message.text.startswith("Failed to load resource:"):
                    return
                errors.append(f"console.error: {message.text} ({url}:{location.get('lineNumber', 0)})")

            def attach_errors(page):
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", console_message)

            context.on("page", attach_errors)
            page = context.new_page()
            try:
                response = page.goto(args.url, wait_until="domcontentloaded")
                assert response and response.ok, "game document did not load successfully"
                page.wait_for_function("typeof GameApp !== 'undefined' && GameApp.booted && Data.canWrite", timeout=15000)
                page.evaluate("() => GameApp.ready")
                yield context, page, errors
                assert not errors, "unhandled browser errors: " + "; ".join(errors)
            finally:
                context.close()

        def check(name, function):
            if args.check and not any(fragment.lower() in name.lower() for fragment in args.check):
                return
            try:
                detail = function()
                results.append({"name": name, "passed": True, "detail": detail})
            except Exception as error:
                results.append({"name": name, "passed": False, "error": str(error)})

        def initialization():
            with fresh() as (_, page, _):
                page.wait_for_timeout(250)
                assert page.locator(".achieve-item").count() == 5
                assert page.locator("#lv-comp1").inner_text() == "0"
                assert page.locator("#lv-comp2").inner_text() == "0"
                assert page.evaluate("Number.isFinite(Data.state.mob.hp) && Data.state.mob.hp > 0")
                assert page.evaluate("Boolean(Combat.sk.rush && Combat.sk.night)")
                page.locator("#btn-s1").click()
                page.locator("#btn-s2").click()
                page.wait_for_timeout(200)
                return {"achievements": 5, "skills": "rush/night activated"}

        def keyboard_and_achievement():
            with fresh() as (_, page, _):
                page.evaluate("Data.state.totalClicks = 499; Data.state.mob.hp = 100; UI.renderAll()")
                page.locator("#battle-view").focus()
                page.keyboard.press("Enter")
                assert page.evaluate("Data.state.totalClicks") == 500
                page.locator('[data-target="tab-ach"]').click()
                claim = page.locator(".achieve-item").nth(2).locator("button")
                assert claim.is_enabled(), "500-click achievement button remained disabled"
                gems = page.evaluate("Data.state.gem")
                claim.click()
                assert page.evaluate("Data.state.gem") == gems + 15
                page.locator("#battle-view").focus()
                page.keyboard.press("Space")
                assert page.evaluate("Data.state.totalClicks") == 501
                assert page.locator("#battle-view").get_attribute("aria-keyshortcuts")
                assert "maximum-scale=1" not in page.locator('meta[name="viewport"]').get_attribute("content")
                return {"keyboardClicks": 2, "achievementGemReward": 15}

        def clipboard_fallback():
            with fresh() as (_, page, _):
                page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined})")
                page.locator('[data-target="tab-sys"]').click()
                page.evaluate("() => Sys.export()")
                page.locator("#backup-dialog").wait_for(state="visible")
                code = page.locator("#backup-code").input_value()
                assert len(code) > 100
                decoded = page.evaluate("code => JSON.parse(decodeURIComponent(atob(code)))", code)
                assert decoded["stat"]["c"]["p"] == 10
                with page.expect_download() as download_info:
                    page.locator("#backup-download").click()
                assert download_info.value.suggested_filename
                page.locator("#backup-close").click()
                page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => Promise.reject(new Error('permission denied'))}})")
                page.evaluate("() => Sys.export()")
                page.locator("#backup-dialog").wait_for(state="visible")
                assert page.locator("#backup-code").input_value()
                return {"unavailable": "manual code and download", "denied": "manual code"}

        def malformed_import():
            with fresh() as (_, page, _):
                page.evaluate("Data.state.gold = 777; Data.save(); UI.renderAll()")
                before = page.evaluate("localStorage.getItem(Data.key)")
                page.locator('[data-target="tab-sys"]').click()
                page.evaluate("Sys.import()")
                page.locator("#import-code").fill(page.evaluate("btoa(encodeURIComponent(JSON.stringify({stat:{}})))"))
                page.locator("#import-submit").click()
                assert page.locator("#import-error").inner_text().strip()
                assert page.evaluate("Data.state.gold") == 777
                assert page.evaluate("localStorage.getItem(Data.key)") == before
                return {"goldPreserved": 777, "inlineError": True}

        def audio_resume():
            with fresh() as (_, page, _):
                page.locator("#battle-view").click(position={"x": 30, "y": 30})
                page.wait_for_function("Sys.ctx && Sys.ctx.state === 'running'")
                page.evaluate("() => Sys.ctx.suspend()")
                assert page.evaluate("Sys.ctx.state") == "suspended"
                page.locator("#btn-sound").click()
                page.locator("#btn-sound").click()
                page.wait_for_function("Sys.ctx.state === 'running'")
                assert page.evaluate("Sys.sound") is True
                return {"resumed": True}

        def effects():
            with fresh({"width": 1440, "height": 900}) as (_, page, _):
                page.evaluate("""() => {
                    window.effectCalls = [];
                    const add = VFX.add.bind(VFX);
                    VFX.add = (...args) => { effectCalls.push(args); return add(...args); };
                    Data.state.mob.hp = 1;
                }""")
                page.locator("#battle-view").click(position={"x": 30, "y": 40})
                calls = page.evaluate("effectCalls.map(args => ({x: args[1], y: args[2], type: args[3]}))")
                size = page.evaluate("({width: VFX.width, height: VFX.height})")
                assert any(call["type"] == "gold" for call in calls)
                for call in calls:
                    assert 0 <= call["x"] <= size["width"], f"effect x is outside its canvas: {call}"
                    assert 0 <= call["y"] <= size["height"], f"effect y is outside its canvas: {call}"
                page.evaluate("Sys.shake('hard')")
                page.wait_for_timeout(650)
                cleanup = page.evaluate("""({hit: $('monster').classList.contains('hit'),
                    transform: $('monster').style.transform,
                    hard: $('game-app').classList.contains('shake-hard'),
                    filter: getComputedStyle($('game-app')).filter})""")
                assert cleanup["hit"] is False
                assert cleanup["transform"] == ""
                assert cleanup["hard"] is False
                assert cleanup["filter"] in ("none", "")
                motion = page.evaluate("""() => {
                    VFX.ptc = []; VFX.add('test', 100, 100, 'normal');
                    const initial = JSON.stringify(VFX.ptc);
                    const run = fps => {
                        VFX.ptc = JSON.parse(initial);
                        for (let i=0; i<fps; i++) VFX.update(1000/fps);
                        return VFX.ptc[0];
                    };
                    const frames = [5, 30, 120].map(fps => ({fps, particle: run(fps)}));
                    VFX.ptc = JSON.parse(initial);
                    VFX.update(1200);
                    return {frames, particlesAfterPause: VFX.ptc.length};
                }""")
                reference = motion["frames"][-1]["particle"]
                for frame in motion["frames"]:
                    particle = frame["particle"]
                    assert particle, f"particle expired too early at {frame['fps']} fps"
                    assert abs(particle["x"] - reference["x"]) < 0.01, f"horizontal motion changes at {frame['fps']} fps"
                    assert abs(particle["y"] - reference["y"]) < 0.01, f"vertical motion changes at {frame['fps']} fps"
                    assert abs(particle["life"] - reference["life"]) < 0.000001, f"particle lifetime changes at {frame['fps']} fps"
                assert motion["particlesAfterPause"] == 0, "a 1200-ms pause failed to expire a one-second effect"
                return {"localCoordinates": calls, "effectsCleared": cleanup, "refreshRateIndependent": [5, 30, 120], "longPauseExpiresEffects": True}

        def critical_cap():
            with fresh() as (_, page, _):
                page.evaluate("Data.state.gold = 1e20; Data.state.stat.crit.p = 50; Data.state.stat.crit.l = 50; UI.renderRes()")
                button = page.locator("#up-crit")
                assert button.is_disabled(), "maximum critical upgrade is still enabled"
                assert "최대" in (button.get_attribute("aria-label") or "") or "MAX" in button.inner_text(), "maximum critical upgrade lacks a maximum-state label"
                return {"disabledAtPercent": 50}

        def resume_hp():
            with fresh() as (_, page, _):
                # This case isolates restoration of partial HP. The dedicated
                # no-input case verifies that new games start auto-attacking.
                page.evaluate("Data.state.stat.a = {l:0,p:0,c:100}; Data.state.mob.hp = 40; Data.save()")
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("GameApp.booted && Data.canWrite", timeout=15000)
                assert page.evaluate("Data.state.mob.hp") == 40
                return {"savedHp": 40, "restoredHp": 40}

        def multiple_tabs():
            with fresh() as (context, first, _):
                first.evaluate("Data.state.gold = 123; Data.save(); UI.renderAll()")
                second = context.new_page()
                second.goto(args.url, wait_until="domcontentloaded")
                second.wait_for_function("typeof GameApp !== 'undefined' && GameApp.booted", timeout=15000)
                second.wait_for_timeout(250)
                assert second.evaluate("Data.canWrite") is False
                second.evaluate("Data.state.gold = 0")
                assert second.evaluate("Data.save()") is False
                assert first.evaluate("JSON.parse(localStorage.getItem(Data.key)).gold") == 123
                assert second.locator("#session-overlay").is_visible()
                return {"staleSaveBlocked": True, "persistedGold": 123}

        def hidden_progress_once():
            with fresh() as (_, page, _):
                detail = page.evaluate("""() => {
                    window.testClock = Date.now();
                    window.testHidden = false;
                    Date.now = () => testClock;
                    Object.defineProperty(document, 'hidden', {configurable: true, get: () => testHidden});
                    Data.state.stat.a = {l: 1, p: 10, c: 160};
                    Data.state.lastActiveAt = testClock;
                    Data.state.autoRemainder = 0;
                    Data.state.xpRemainder = 0;
                    UI.renderAll();
                    testHidden = true;
                    document.dispatchEvent(new Event('visibilitychange'));
                    const from = Data.state.lastActiveAt;
                    const expected = JSON.parse(JSON.stringify(Data.state));
                    Simulation.simulate(expected, from, from + 180000, {offline: true});
                    for (let seconds = 5; seconds <= 180; seconds += 5) {
                        testClock = from + seconds * 1000;
                        Data.save();
                    }
                    const hidden = {gold: Data.state.gold, lastActiveAt: Data.state.lastActiveAt};
                    testHidden = false;
                    document.dispatchEvent(new Event('visibilitychange'));
                    const resumed = {gold: Data.state.gold, kills: Data.state.kills, hp: Data.state.mob.hp,
                        player: {...Data.state.player}, xpRemainder: Data.state.xpRemainder};
                    document.dispatchEvent(new Event('visibilitychange'));
                    return {from, hidden, resumed, secondGold: Data.state.gold, secondPlayer: {...Data.state.player},
                        expected: {gold: expected.gold, kills: expected.kills, hp: expected.mob.hp,
                            player: {...expected.player}, xpRemainder: expected.xpRemainder}};
                }""")
                assert detail["hidden"]["lastActiveAt"] == detail["from"], "hidden autosaves erased the away interval"
                assert detail["hidden"]["gold"] == 0, "hidden tab generated live rewards"
                assert detail["expected"]["gold"] > 0
                assert detail["resumed"] == detail["expected"], "visibility resume diverged from the shared offline rules"
                assert detail["secondGold"] == detail["resumed"]["gold"], "repeated visibility resume paid the same away rewards twice"
                assert detail["secondPlayer"] == detail["resumed"]["player"], "repeated visibility resume paid the same away XP twice"
                assert detail["resumed"]["player"]["level"] > 1
                return {"controlledHiddenSeconds": 180, "resumedGold": detail["resumed"]["gold"],
                    "resumedPlayer": detail["resumed"]["player"], "paidOnce": True}

        def closing_hidden_preserves_away():
            with fresh() as (_, page, _):
                detail = page.evaluate("""() => {
                    window.testClock = Date.now();
                    window.testHidden = false;
                    Date.now = () => testClock;
                    Object.defineProperty(document, 'hidden', {configurable: true, get: () => testHidden});
                    Data.state.stat.a = {l: 1, p: 10, c: 160};
                    Data.state.lastActiveAt = testClock;
                    Data.state.autoRemainder = 0;
                    testHidden = true;
                    document.dispatchEvent(new Event('visibilitychange'));
                    const from = Data.state.lastActiveAt;
                    for (let seconds = 5; seconds <= 180; seconds += 5) {
                        testClock = from + seconds * 1000;
                        Data.save();
                    }
                    window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: false}));
                    const saved = JSON.parse(localStorage.getItem(Data.key));
                    return {from, persistedLastActiveAt: saved.lastActiveAt,
                        gold: Data.state.gold, persistedGold: saved.gold};
                }""")
                assert detail["persistedLastActiveAt"] == detail["from"], "closing a hidden tab consumed its pending away interval"
                assert detail["gold"] == 0, "closing a hidden tab paid full-rate online combat rewards"
                assert detail["persistedGold"] == 0, "pagehide persisted full-rate rewards for a hidden interval"
                return {"controlledHiddenSeconds": 180, "awayAnchorPreserved": True, "onlineGold": 0}

        def repaired_corrupt_tabs():
            with fresh(raw="{an intentionally corrupt save") as (context, first, _):
                assert first.evaluate("GameApp.recoveryPending") is True
                second = context.new_page()
                second.goto(args.url, wait_until="domcontentloaded")
                second.wait_for_function("typeof GameApp !== 'undefined' && GameApp.booted", timeout=15000)
                assert second.evaluate("GameApp.recoveryPending") is True
                assert first.evaluate("Data.reset().ok") is True
                first.wait_for_function("!GameApp.recoveryPending && !$('recovery-dialog').open")
                second.wait_for_function("Data.getRecovery() === null && !GameApp.recoveryPending", timeout=15000)
                assert second.evaluate("localStorage.getItem(Data.key + ':recovery')") == "{an intentionally corrupt save"
                first.close()
                second.wait_for_function("Data.canWrite && Logic.canAct() && !GameApp.recoveryPending", timeout=15000)
                assert second.locator("#session-overlay").is_hidden()
                assert second.locator("#recovery-dialog").is_hidden()
                second.locator("#battle-view").click(position={"x": 30, "y": 30})
                assert second.evaluate("Data.state.totalClicks") == 1
                return {"repairedByFirstTab": True, "secondTabCanPlay": True, "originalRecoveryCopyPreserved": True}

        def idle_without_input():
            with fresh() as (_, page, _):
                initial = page.evaluate("({player:{...Data.state.player}, hp:Data.state.mob.hp, clicks:Data.state.totalClicks})")
                assert initial == {"player": {"level": 1, "xp": 0}, "hp": 100, "clicks": 0}, "a new game received progress before its first elapsed tick"
                assert page.locator("#player-level").inner_text() == "Lv.1"
                assert page.locator("#player-xp-track").get_attribute("role") == "progressbar"
                page.wait_for_function("Data.state.player.xp >= 5 && Data.state.mob.hp < 100", timeout=3000)
                first_tick = page.evaluate("({player:{...Data.state.player}, hp:Data.state.mob.hp, clicks:Data.state.totalClicks})")
                assert first_tick["player"] == {"level": 1, "xp": 5}
                assert first_tick["hp"] == 90
                assert first_tick["clicks"] == 0
                page.wait_for_function("$('player-xp-track').getAttribute('aria-valuenow') === '5'")
                assert "5 / 20" in page.locator("#player-xp").inner_text()
                page.wait_for_function("Data.state.player.level === 2", timeout=5000)
                page.wait_for_function("$('player-level').textContent === 'Lv.2'")
                assert page.evaluate("Data.state.totalClicks") == 0
                assert page.locator("#player-xp-track").get_attribute("aria-valuemax") == "30"
                return {"untouchedFirstTick": first_tick, "automaticFirstLevel": 2, "accessibleXPBar": True}

        def anonymous_game_labels():
            with fresh() as (_, page, _):
                for tab in ["tab-stat", "tab-comp", "tab-relic", "tab-ach", "tab-sys"]:
                    page.locator(f'[data-target="{tab}"]').click()
                labels = page.evaluate(r"""() => [document.title, document.querySelector('meta[name="description"]').content, document.body.textContent,
                    ...[...document.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label'))].join('\n')""")
                for personal_name in ["나명심", "유미혜", "엽쌤", "엽아"]:
                    assert personal_name not in labels, f"personal name is still rendered: {personal_name}"
                assert "체육 요정" in labels, "the automatic companion's generic role label is missing"
                assert "응원 요정" in labels, "the click companion's generic role label is missing"
                assert "선생님" in labels and "초등" in labels, "the teacher premise is absent from game copy"
                assert "선생님" in page.title(), "the title does not identify the teacher RPG"
                return {"title": page.title(), "companions": "generic role labels", "personalNamesRemoved": True}

        def upgrades_relics_prestige_backup():
            with fresh() as (_, page, _):
                page.evaluate("window.flowClock = Date.now(); Date.now = () => flowClock; Data.state.gold = 100000; Data.state.gem = 40; UI.renderAll()")
                starting_gold = page.evaluate("Data.state.gold")
                for button, state, level in [("up-click", "stat.c", 2), ("up-auto", "stat.a", 2), ("up-crit", "stat.crit", 1)]:
                    before = page.evaluate(f"Data.state.{state}.c")
                    page.locator(f"#{button}").click()
                    assert page.evaluate(f"Data.state.{state}.l") == level
                    starting_gold -= before
                    assert page.evaluate("Data.state.gold") == starting_gold, f"{button} charged an unexpected amount"
                page.locator('[data-target="tab-comp"]').click()
                for button, state in [("up-comp1", "comp.na"), ("up-comp2", "comp.yu")]:
                    page.locator(f"#{button}").click()
                    assert page.evaluate(f"Data.state.{state}.l") == 1
                    assert page.evaluate(f"Data.state.{state}.p") > 0
                page.locator('[data-target="tab-relic"]').click()
                for owned in range(1, 5):
                    page.locator("#btn-gacha").click()
                    assert page.evaluate("Data.state.relic.filter(Boolean).length") == owned, "relic draw awarded a duplicate"
                    assert page.evaluate("Data.state.gem") == 40 - 10 * owned
                assert page.locator("#btn-gacha").is_disabled(), "completed relic collection remains purchasable"
                page.evaluate("Data.state.min = 2; Data.state.player = {level:7,xp:13}; Data.state.xpRemainder = 0.25; Data.state.ach[0] = true; Data.state.achReady[0] = true; Data.state.totalClicks = 501; Data.state.lastActiveAt = flowClock; UI.renderAll()")
                page.locator('[data-target="tab-sys"]').click()
                page.once("dialog", lambda dialog: dialog.accept())
                page.locator('button[onclick="Logic.prestige()"]').click()
                preserved = page.evaluate("({player:{...Data.state.player}, xpRemainder:Data.state.xpRemainder, token:Data.state.token, relic:[...Data.state.relic], ach:[...Data.state.ach], totalClicks:Data.state.totalClicks})")
                assert preserved == {"player": {"level": 7, "xp": 13}, "xpRemainder": 0.25, "token": 2, "relic": [True] * 4, "ach": [True, False, False, False, False], "totalClicks": 501}
                assert page.evaluate("Data.state.gold === 0 && Data.state.min === 0 && Data.state.stat.a.p === 10 && Data.state.comp.na.l === 0 && Data.state.comp.yu.l === 0")
                page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined}); Sys.export()")
                page.locator("#backup-dialog").wait_for(state="visible")
                code = page.locator("#backup-code").input_value()
                page.locator("#backup-close").click()
                page.once("dialog", lambda dialog: dialog.accept())
                page.locator('button[onclick="Sys.hardReset()"]').click()
                assert page.evaluate("Data.state.token") == 0
                page.locator('button[onclick="Sys.import()"]').click()
                page.locator("#import-code").fill(code)
                page.locator("#import-submit").click()
                assert page.locator("#import-dialog").is_hidden()
                restored = page.evaluate("({player:{...Data.state.player}, xpRemainder:Data.state.xpRemainder, token:Data.state.token, relic:[...Data.state.relic], ach:[...Data.state.ach], totalClicks:Data.state.totalClicks})")
                assert restored == preserved, "valid UI backup round trip lost earned progress"
                assert page.evaluate("JSON.parse(localStorage.getItem(Data.key)).token") == 2
                return {"upgrades": 5, "distinctRelics": 4, "prestigeTokens": 2, "backupRestoredEarnedProgress": True}

        def migrated_xp_reload_reset():
            with fresh() as (_, source, _):
                legacy = source.evaluate("""() => {
                    const state = Data.createDefault();
                    state.version = 3; delete state.player; delete state.xpRemainder;
                    state.gold = 777; state.mob.hp = 40;
                    state.stat.a = {l:0,p:0,c:321};
                    return JSON.stringify(state);
                }""")
            with fresh(raw=legacy) as (context, page, _):
                assert page.evaluate("Data.state.version") == 4
                assert page.evaluate("Data.state.gold") == 777
                assert page.evaluate("Data.state.stat.a") == {"l": 1, "p": 10, "c": 321}
                assert page.evaluate("Data.state.mob.hp") == 40
                clock = page.evaluate("""() => {
                    const clock = Date.now(); Date.now = () => clock;
                    Data.state.player = {level:7,xp:13}; Data.state.xpRemainder = 0.25;
                    Data.state.lastActiveAt = clock;
                    if (!Data.save()) throw new Error('failed to save XP reload fixture');
                    return clock;
                }""")
                context.add_init_script("Date.now = () => " + str(clock))
                for _ in range(2):
                    page.reload(wait_until="domcontentloaded")
                    page.wait_for_function("GameApp.booted && Data.canWrite", timeout=15000)
                    page.evaluate("() => GameApp.ready")
                    assert page.evaluate("Data.state.player") == {"level": 7, "xp": 13}
                    assert page.evaluate("Data.state.xpRemainder") == 0.25
                    assert page.locator("#player-level").inner_text() == "Lv.7"
                page.once("dialog", lambda dialog: dialog.accept())
                page.evaluate("() => Sys.hardReset()")
                assert page.evaluate("Data.state.player") == {"level": 1, "xp": 0}
                assert page.evaluate("Data.state.xpRemainder") == 0
                assert page.evaluate("Data.state.stat.a.p") == 10
                assert page.locator("#player-level").inner_text() == "Lv.1"
                assert page.evaluate("JSON.parse(localStorage.getItem(Data.key)).player") == {"level": 1, "xp": 0}
                return {"legacyGold": 777, "freeStarter": True, "reloadedPlayer": {"level": 7, "xp": 13},
                    "reloadBonus": 0, "resetRestoresIdleStart": True}

        def old_saved_progress():
            with fresh() as (_, source, _):
                fixture = source.evaluate("""() => {
                    const now = Date.now(); const state = Data.createDefault();
                    state.version = 2; delete state.player; delete state.xpRemainder;
                    state.gold = 12345; state.gem = 36; state.token = 12;
                    state.kills = 104; state.min = 1; state.totalClicks = 654; state.bossKills = 1;
                    state.stat.c = {l:22,p:1234,c:789}; state.stat.a = {l:9,p:321,c:999};
                    state.stat.crit = {l:7,p:7,c:888};
                    state.comp.na = {l:3,p:225,c:10000}; state.comp.yu = {l:4,p:40,c:20000};
                    state.relic = [true,false,true,false]; state.ach = [true,true,false,false,false];
                    state.achReady = [true,true,true,false,false]; state.mob.hp = 40;
                    state.skill = {r:now-10000,n:now-5000}; state.lastActiveAt = now; state.sound = false;
                    return {raw:JSON.stringify(state), now};
                }""")
            with fresh(raw=fixture["raw"], clock=fixture["now"]) as (_, page, _):
                old = json.loads(fixture["raw"])
                current = page.evaluate("JSON.parse(JSON.stringify(Data.state))")
                for field in ["gold", "gem", "token", "kills", "min", "totalClicks", "bossKills", "stat", "comp", "relic", "ach", "achReady", "mob", "sound"]:
                    assert current[field] == old[field], f"version 2 migration lost {field}: {current[field]}"
                assert current["player"] == {"level": 1, "xp": 0}
                assert current["skill"] == {"rush": old["skill"]["r"], "night": old["skill"]["n"]}
                assert page.locator("#lv-click").inner_text() == "22"
                page.locator('[data-target="tab-comp"]').click()
                assert page.locator("#lv-comp1").inner_text() == "3"
                assert page.locator("#lv-comp2").inner_text() == "4"
                assert page.evaluate("Data.save()") is True
                persisted = page.evaluate("JSON.parse(localStorage.getItem('ys_bugfree_final_v2'))")
                assert persisted["version"] == 4 and persisted["gold"] == 12345
                return {"legacyVersion": 2, "sameStorageKey": "ys_bugfree_final_v2", "preserved": "all currencies, upgrades, companions, relics, achievements, enemy HP, skill cooldowns, sound", "automaticUpgradePreserved": {"level": 9, "power": 321}}

        def layouts():
            sizes = [(320, 568), (320, 601), (375, 667), (390, 600), (390, 601), (390, 650), (390, 651),
                (390, 741), (390, 780), (390, 820), (320, 821), (390, 821), (390, 840), (390, 841),
                (390, 844), (412, 915), (430, 932), (768, 1024),
                (568, 320), (844, 320), (844, 360), (1024, 768), (1280, 720), (1440, 900)]
            checked = []
            for width, height in sizes:
                with fresh({"width": width, "height": height}) as (_, page, _):
                    page.evaluate("() => document.fonts.ready")
                    def visible_box(selector):
                        element = page.locator(selector)
                        assert element.is_visible(), f"{selector} is hidden at {width}x{height}"
                        box = element.bounding_box()
                        assert box and box["width"] > 0 and box["height"] > 0
                        assert box["x"] >= -1 and box["x"] + box["width"] <= width + 1, f"{selector} is horizontally clipped at {width}x{height}: {box}"
                        assert box["y"] >= -1 and box["y"] + box["height"] <= height + 1, f"{selector} is vertically clipped at {width}x{height}: {box}"
                        return box

                    header = page.locator("#header").bounding_box()
                    xp = visible_box("#player-progress")
                    assert header and xp and xp["height"] > 0
                    assert xp["y"] >= header["y"] and xp["y"] + xp["height"] <= header["y"] + header["height"], f"XP display escapes its header at {width}x{height}"
                    glance = {selector: visible_box(selector) for selector in ["#hud-gold", "#hud-gem", "#hud-token",
                        "#hud-auto", "#hud-click", "#mob-name", "#mob-hp-track", "#hp-text", "#work-stage",
                        "#btn-s1", "#btn-s2", "#tab-nav", "#up-click", "#up-auto", "#up-crit"]}
                    for card in page.locator("#tab-stat .up-card").all():
                        box = card.bounding_box()
                        assert box and box["y"] >= -1 and box["y"] + box["height"] <= height + 1, f"initial upgrade card requires scrolling at {width}x{height}: {box}"
                    for tab_button in page.locator(".tab-btn").all():
                        box = tab_button.bounding_box()
                        assert box and box["width"] >= 44 and box["height"] >= 40, f"tab touch target is too small at {width}x{height}: {box}"
                    battle = page.locator("#battle-view").bounding_box()
                    panel = page.locator("#panel-area").bounding_box()
                    workspace = page.locator("#game-app").bounding_box()
                    assert battle and panel and workspace
                    if width >= 1000:
                        assert workspace["width"] > 800, f"desktop wastes its available width at {width}x{height}: {workspace}"
                        assert battle["x"] + battle["width"] <= panel["x"] + 1, f"desktop battle and upgrades are not separate columns at {width}x{height}: {battle}, {panel}"
                    else:
                        overlap_x = min(battle["x"] + battle["width"], panel["x"] + panel["width"]) - max(battle["x"], panel["x"])
                        overlap_y = min(battle["y"] + battle["height"], panel["y"] + panel["height"]) - max(battle["y"], panel["y"])
                        assert overlap_x <= 1 or overlap_y <= 1, f"battle and upgrades overlap at {width}x{height}"
                    page.evaluate("""() => {
                        window.layoutClock = Date.now(); Date.now = () => layoutClock;
                        Data.state.kills = 500; Data.state.min = 50;
                        Data.state.player = {level:36,xp:220};
                        Data.state.gold = 1806; Data.state.lastActiveAt = layoutClock;
                        Simulation.spawn(Data.state, true, layoutClock);
                        Logic.sync(layoutClock); UI.renderAll();
                    }""")
                    boss_view = {selector: visible_box(selector) for selector in ["#mob-name", "#mob-hp-track",
                        "#hp-text", "#boss-timer-wrap", "#boss-seconds", "#btn-s1", "#btn-s2", "#tab-nav",
                        "#up-click", "#up-auto", "#up-crit"]}
                    for card in page.locator("#tab-stat .up-card").all():
                        box = card.bounding_box()
                        assert box and box["y"] >= -1 and box["y"] + box["height"] <= height + 1, f"boss display pushes an upgrade card out of view at {width}x{height}: {box}"
                    boss_battle = page.locator("#battle-view").bounding_box()
                    boss_timer = boss_view["#boss-timer-wrap"]
                    assert boss_battle and boss_timer["y"] >= boss_battle["y"] and boss_timer["y"] + boss_timer["height"] <= boss_battle["y"] + boss_battle["height"], f"boss deadline is outside its battle card at {width}x{height}"
                    for tab, button in [("tab-stat", "up-click"), ("tab-comp", "up-comp2"), ("tab-sys", None)]:
                        selector = f'[data-target="{tab}"]'
                        page.locator(selector).click()
                        target = page.locator(f"#{button}") if button else page.locator(f"#{tab} button").last
                        target.scroll_into_view_if_needed()
                        box = target.bounding_box()
                        assert box and box["height"] > 0
                        assert box["y"] >= -1 and box["y"] + box["height"] <= height + 1, f"{tab} control is clipped at {width}x{height}: {box}"
                    dimensions = page.evaluate("({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})")
                    assert dimensions["scroll"] <= dimensions["client"] + 1, "unintended horizontal overflow"
                    checked.append({"viewport": f"{width}x{height}", "initialControls": glance,
                        "bossControls": boss_view, "battle": battle, "panel": panel, "workspace": workspace})
            return {"visibleWithoutScrolling": checked, "tabTouchTargets": "at least 44 × 40 CSS pixels"}

        def dialogs_on_compact_screens():
            checked = []
            for width, height in [(320, 568), (844, 320)]:
                with fresh({"width": width, "height": height}) as (_, page, _):
                    for show, dialog_id, action_id, close_id in [
                        ("Sys.export()", "backup-dialog", "backup-download", "backup-close"),
                        ("Sys.import()", "import-dialog", "import-submit", "import-cancel"),
                    ]:
                        page.evaluate(show)
                        dialog = page.locator(f"#{dialog_id}")
                        dialog.wait_for(state="visible")
                        box = dialog.bounding_box()
                        assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1
                        assert box["y"] >= -1 and box["y"] + box["height"] <= height + 1, f"{dialog_id} escapes compact viewport"
                        action = page.locator(f"#{action_id}")
                        action.scroll_into_view_if_needed()
                        action_box = action.bounding_box()
                        assert action_box and action_box["height"] >= 40
                        assert action_box["y"] >= -1 and action_box["y"] + action_box["height"] <= height + 1, f"{dialog_id} action cannot be reached"
                        dimensions = dialog.evaluate("element => ({scroll:element.scrollWidth, client:element.clientWidth})")
                        assert dimensions["scroll"] <= dimensions["client"] + 1, f"{dialog_id} overflows horizontally"
                        page.locator(f"#{close_id}").click()
                        assert dialog.is_hidden()
                        checked.append(f"{dialog_id} {width}x{height}")
            return {"reachableDialogs": checked}

        def teacher_animation_behavior():
            with fresh() as (_, page, _):
                hero = page.locator("#teacher-hero")
                assert hero.is_visible(), "the protagonist is not visible"
                page.wait_for_function("$('teacher-hero').classList.contains('attacking')", timeout=2500)
                assert page.evaluate("Data.state.totalClicks") == 0, "automatic teacher attacks required input"
                page.evaluate("window.heroClock = Date.now(); Date.now = () => heroClock; Data.state.mob.hp = 1")
                page.locator("#battle-view").click(position={"x": 20, "y": 20})
                assert page.evaluate("$('teacher-hero').classList.contains('attacking')"), "a manual attack did not animate the teacher"
                assert page.evaluate("$('teacher-hero').classList.contains('celebrate')"), "defeating an enemy did not animate the teacher"
                assert page.evaluate("$('attack-projectile').classList.contains('flying')"), "a teacher attack did not launch its effect"
                page.evaluate("Data.state.player = {level:1,xp:15}; Data.state.xpRemainder = 0; Data.state.lastActiveAt = heroClock; heroClock += 1000; Logic.catchUp(heroClock)")
                assert page.evaluate("Data.state.player.level") == 2
                assert page.evaluate("$('teacher-hero').classList.contains('level-up')"), "a passive level-up did not animate the teacher"
                assert page.locator("#hero-level").inner_text() == "Lv.2"
                page.wait_for_timeout(1000)
                assert page.evaluate("!['attacking','celebrate','level-up'].some(name => $('teacher-hero').classList.contains(name))"), "teacher animation did not clean up"
                assert page.evaluate("!$('attack-projectile').classList.contains('flying')"), "projectile animation did not clean up"
                return {"noInputAttack": True, "manualAttack": True, "enemyDefeatCelebration": True, "passiveLevelUp": True, "animationCleanup": True}

        def teacher_enemy_layouts():
            checked = []
            for width, height in [(320, 601), (375, 667), (390, 844), (430, 932), (568, 320), (844, 320), (1024, 768), (1280, 720), (1440, 900)]:
                with fresh({"width": width, "height": height}) as (_, page, _):
                    page.evaluate("window.artClock = Date.now(); Date.now = () => artClock")
                    page.evaluate("() => document.fonts.ready")
                    assert page.locator("#teacher-sprite").is_visible()
                    page.wait_for_function("$('teacher-sprite').complete && $('teacher-sprite').naturalWidth > 0")

                    def contained_art():
                        violations = page.evaluate("""() => {
                            const problems = [];
                            const battle = $('battle-view').getBoundingClientRect();
                            for (const selector of ['#teacher-sprite', '#monster']) {
                                const element = document.querySelector(selector);
                                if (!element) { problems.push(`${selector} is missing`); continue; }
                                const box = element.getBoundingClientRect();
                                if (!(box.width > 0 && box.height > 0)) problems.push(`${selector} has no area`);
                                const within = (outer, x = true, y = true) =>
                                    (!x || (box.left >= outer.left - 2 && box.right <= outer.right + 2)) &&
                                    (!y || (box.top >= outer.top - 2 && box.bottom <= outer.bottom + 2));
                                if (!within(battle)) problems.push(`${selector} escapes battle: ${JSON.stringify({left:box.left,top:box.top,right:box.right,bottom:box.bottom})}`);
                                if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) problems.push(`${selector} escapes viewport`);
                                for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
                                    const style = getComputedStyle(ancestor);
                                    const clipsX = ['hidden','clip','auto','scroll'].includes(style.overflowX);
                                    const clipsY = ['hidden','clip','auto','scroll'].includes(style.overflowY);
                                    if ((clipsX || clipsY) && !within(ancestor.getBoundingClientRect(), clipsX, clipsY)) problems.push(`${selector} clipped by ${ancestor.id || ancestor.className}`);
                                }
                            }
                            return problems;
                        }""")
                        assert not violations, f"art clipping at {width}x{height}: {'; '.join(violations)}"

                    for boss in [False, True]:
                        for variant in range(5):
                            page.evaluate("""({boss, variant}) => {
                                Data.state.kills = boss ? (variant + 1) * 100 : variant;
                                Simulation.spawn(Data.state, boss, artClock);
                                Logic.sync(artClock); UI.renderAll();
                            }""", {"boss": boss, "variant": variant})
                            page.wait_for_function("[...document.querySelectorAll('#monster img')].every(img => img.complete && img.naturalWidth > 0)")
                            assert page.locator("#monster").get_attribute("data-variant") == str(variant)
                            assert page.evaluate("$('monster').classList.contains('boss')") is boss
                            expected_asset = f"enemy-{variant}{'-boss' if boss else ''}.svg"
                            enemy_loaded = page.evaluate(r"""async expected => {
                                const background = getComputedStyle($('monster')).backgroundImage;
                                if (!background.includes(expected)) return false;
                                const url = background.match(/url\([\"']?([^\"')]+)[\"']?\)/)?.[1];
                                if (!url) return false;
                                const image = new Image(); image.src = url;
                                try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
                            }""", expected_asset)
                            assert enemy_loaded, f"enemy artwork did not load: {expected_asset} at {width}x{height}"
                            contained_art()
                        for animation in ["heroAttack", "celebrate", "levelUp"]:
                            page.evaluate(f"VFX.{animation}()")
                            for _ in range(5):
                                contained_art()
                                page.wait_for_timeout(60)
                            page.evaluate("VFX.reset()")
                    checked.append(f"{width}x{height}")
            return {"viewports": checked, "enemyVariantsPerViewport": 10, "animationSamplesPerViewport": 30, "teacherAndEnemyInsideClippingAncestors": True}

        def reduced_motion_preference():
            with fresh(reduced_motion=True) as (_, page, _):
                page.evaluate("window.motionClock = Date.now(); Date.now = () => motionClock; VFX.reset()")
                before = page.evaluate("getComputedStyle($('monster')).transform")
                result = page.evaluate("""() => {
                    Combat.attack(20,20,motionClock);
                    VFX.celebrate(); VFX.levelUp();
                    return {enemyTransform:getComputedStyle($('monster')).transform,
                        animated:[...document.querySelectorAll('#teacher-hero, #teacher-sprite, #monster, #attack-projectile')]
                            .filter(element => getComputedStyle(element).animationName !== 'none').map(element => element.id)};
                }""")
                assert result["enemyTransform"] == before, "reduced-motion attacks still transform the enemy"
                assert not result["animated"], "reduced-motion elements still animate: " + ", ".join(result["animated"])
                assert page.evaluate("Data.state.totalClicks") == 1, "reduced-motion preference disabled gameplay"
                return {"animationsDisabled": True, "enemyHitTransformDisabled": True, "attackStillWorks": True}

        def glance_summaries_follow_progress():
            with fresh() as (_, page, _):
                page.evaluate("window.summaryClock = Date.now(); Date.now = () => summaryClock")
                assert page.locator("#hud-auto").inner_text() == "10"
                assert page.locator("#hud-click").inner_text() == "10"
                assert page.locator("#work-stage").inner_text() == "1"
                assert "자동" in page.locator("#work-status").inner_text()
                page.evaluate("""() => {
                    Data.state.player = {level:36,xp:220};
                    Data.state.min = 2; Data.state.gold = 1806;
                    Data.state.gem = 5; Data.state.kills = 26;
                    Data.state.mob.hp = Simulation.calcMobStats(Data.state).hp * 0.18;
                    Data.state.skill.rush = summaryClock - 14000;
                    Data.state.skill.night = summaryClock - 8000;
                    Data.state.buff.nightUntil = summaryClock + 9000;
                    Data.state.lastActiveAt = summaryClock;
                    Logic.sync(summaryClock);
                    UI.renderAll();
                }""")
                assert page.locator("#hud-auto").inner_text() == "27", "automatic damage summary did not reflect the player level"
                assert page.locator("#hud-click").inner_text() == "27", "manual damage summary did not reflect the player level"
                assert page.locator("#work-stage").inner_text() == "27"
                assert "74" in page.locator("#next-boss").inner_text()
                assert page.locator("#clock").inner_text() == "16:02"
                assert "220 / 370" in page.locator("#player-xp").inner_text()
                hp = page.locator("#hp-text").inner_text()
                assert "/" in hp and page.locator("#mob-hp-track").get_attribute("aria-valuenow") == "18"
                assert "46초" in page.locator("#skill-status-rush").inner_text()
                assert "작동 중" in page.locator("#skill-status-night").inner_text()
                assert page.locator("#btn-s1").get_attribute("data-state") == "cooldown"
                assert page.locator("#btn-s2").get_attribute("data-state") == "active"
                assert page.locator("#btn-s1").get_attribute("data-active") == "false"
                assert page.locator("#btn-s2").get_attribute("data-active") == "true", "an active skill lacks its visual-state marker"
                page.locator("#up-auto").click()
                assert page.locator("#hud-auto").inner_text() != "27", "an upgrade did not refresh the automatic damage summary"
                page.evaluate("Simulation.spawn(Data.state, true, summaryClock); Logic.sync(summaryClock); UI.renderAll()")
                assert "보스" in page.locator("#work-status").inner_text()
                assert "보스" in page.locator("#next-boss").inner_text()
                assert page.locator("#boss-seconds").inner_text() == "30초"
                assert page.locator("#boss-timer-wrap").is_visible()
                return {"level": 36, "levelAdjustedDamage": 27, "stage": 27, "remainingToBoss": 74,
                    "hpLabel": hp, "cooldownsReadable": True, "upgradeRefresh": True, "bossDeadlineVisible": True}

        def screenshots():
            if not args.screenshots:
                return {"skipped": "pass --screenshots to save visual review images"}
            directory = Path(args.screenshots)
            directory.mkdir(parents=True, exist_ok=True)
            images = []
            for width, height in [(390, 844), (390, 780), (1440, 900), (320, 568), (320, 601), (375, 667), (430, 932), (568, 320), (844, 320)]:
                with fresh({"width": width, "height": height}) as (_, page, _):
                    # Stop time at the current frame so an image is a stable
                    # layout artifact rather than a capture of random combat.
                    page.evaluate("window.visualClock = Date.now(); Date.now = () => visualClock")
                    page.evaluate("() => document.fonts.ready")
                    page.wait_for_timeout(180)
                    initial = directory / f"initial-{width}x{height}.png"
                    page.screenshot(path=str(initial), animations="disabled")
                    page.evaluate("""() => {
                        Data.state.player = {level:36,xp:220};
                        Data.state.min = 2; Data.state.gold = 1806;
                        Data.state.gem = 5; Data.state.token = 0;
                        Data.state.kills = 26; Data.state.mob.boss = false;
                        Data.state.mob.deadline = 0;
                        Data.state.mob.hp = Simulation.calcMobStats(Data.state).hp * 0.18;
                        Data.state.skill.rush = visualClock - 14000;
                        Data.state.skill.night = visualClock - 8000;
                        Data.state.buff.nightUntil = visualClock + 9000;
                        Data.state.lastActiveAt = visualClock;
                        Logic.sync(visualClock);
                        UI.renderAll();
                    }""")
                    page.wait_for_timeout(180)
                    progressed = directory / f"progressed-{width}x{height}.png"
                    page.screenshot(path=str(progressed), animations="disabled")
                    images.extend([str(initial), str(progressed)])
            return {"images": images, "progressedFixture": {"level": 36, "minute": 2, "gold": 1806, "activeNightBuff": True}}

        for name, function in [
            ("initialization and both skills", initialization),
            ("keyboard attack and immediately claimable achievement", keyboard_and_achievement),
            ("clipboard fallback and downloadable backup", clipboard_fallback),
            ("malformed import preserves progress", malformed_import),
            ("interrupted audio resumes on user toggle", audio_resume),
            ("canvas coordinates, effect cleanup, and refresh-rate motion", effects),
            ("critical cap disables upgrade", critical_cap),
            ("normal enemy HP resumes after reload", resume_hp),
            ("second tab cannot overwrite active progress", multiple_tabs),
            ("hidden autosaves preserve away progress and resume pays once", hidden_progress_once),
            ("closing a hidden tab preserves the away interval", closing_hidden_preserves_away),
            ("two corrupt tabs recover and hand off ownership after repair", repaired_corrupt_tabs),
            ("untouched game starts automatic combat, XP, and leveling", idle_without_input),
            ("title, companions, relics, and achievements omit personal names", anonymous_game_labels),
            ("upgrades, companions, distinct relics, prestige, and valid backup round trip", upgrades_relics_prestige_backup),
            ("legacy save migrates and XP survives reload without bonuses, then resets", migrated_xp_reload_reset),
            ("version 2 earned save migrates without changing currencies or game features", old_saved_progress),
            ("portrait, short landscape, and desktop controls", layouts),
            ("backup and import dialogs remain usable on compact screens", dialogs_on_compact_screens),
            ("teacher animates automatic and manual attacks, defeat, level-up, and cleans up", teacher_animation_behavior),
            ("teacher and all enemy variants remain visible throughout mobile animations", teacher_enemy_layouts),
            ("reduced-motion preference stops visual motion while attacks work", reduced_motion_preference),
            ("damage, HP, stage, and skill summaries follow game progress", glance_summaries_follow_progress),
            ("initial and progressed screenshots for visual review", screenshots),
        ]:
            check(name, function)
        browser.close()

    report = {"url": args.url, "passed": sum(item["passed"] for item in results), "total": len(results), "results": results}
    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as output:
            output.write(serialized + "\n")
    print(serialized)
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
