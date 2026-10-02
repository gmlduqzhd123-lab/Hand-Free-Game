"""Real Chromium regression checks. Run a static server, then pass its URL.

Uses the system Chromium and the environment's HTTPS proxy with TLS validation
enabled. Requires the already-installed Playwright Python package.
"""

import argparse
import json
import os
import sys
from contextlib import contextmanager
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default=os.environ.get("BASE_URL", "http://127.0.0.1:8000/"))
    parser.add_argument("--output", help="Optional JSON result file")
    args = parser.parse_args()
    results = []

    with sync_playwright() as playwright:
        launch = {"executable_path": os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), "headless": True}
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        if proxy:
            launch["proxy"] = {"server": proxy, "bypass": "127.0.0.1,localhost"}
        browser = playwright.chromium.launch(**launch)

        @contextmanager
        def fresh(viewport=None, raw=None):
            context = browser.new_context(viewport=viewport or {"width": 390, "height": 844})
            errors = []
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
                labels = page.evaluate(r"""() => [document.title, document.body.textContent,
                    ...[...document.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label'))].join('\n')""")
                for personal_name in ["나명심", "유미혜", "엽쌤", "엽아"]:
                    assert personal_name not in labels, f"personal name is still rendered: {personal_name}"
                assert "체력 코치" in labels
                assert "응원 동료" in labels
                return {"title": page.title(), "companions": "generic role labels", "personalNamesRemoved": True}

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

        def layouts():
            sizes = [(320, 568), (390, 844), (844, 320), (844, 360), (1440, 900)]
            checked = []
            for width, height in sizes:
                with fresh({"width": width, "height": height}) as (_, page, _):
                    header = page.locator("#header").bounding_box()
                    xp = page.locator("#player-progress").bounding_box()
                    assert header and xp and xp["height"] > 0
                    assert xp["y"] >= header["y"] and xp["y"] + xp["height"] <= header["y"] + header["height"], f"XP display escapes its header at {width}x{height}"
                    for skill in ["#btn-s1", "#btn-s2"]:
                        box = page.locator(skill).bounding_box()
                        assert box and box["y"] >= -1 and box["y"] + box["height"] <= height + 1, f"skill control is clipped at {width}x{height}: {box}"
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
                    checked.append(f"{width}x{height}")
            return {"reachableControls": checked}

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
            ("legacy save migrates and XP survives reload without bonuses, then resets", migrated_xp_reload_reset),
            ("portrait, short landscape, and desktop controls", layouts),
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
