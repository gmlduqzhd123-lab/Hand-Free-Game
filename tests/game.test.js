"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const NOW = 1_700_000_000_000;
const SAVE_KEY = "ys_bugfree_final_v2";
const plain = value => JSON.parse(JSON.stringify(value));

// Run the actual classic-script modules in an isolated browser-like realm.
// No source rewriting, game timers, browser dependencies, or real user saves.
function harness({ raw, storageFailure, sharedStorage } = {}) {
    let now = NOW;
    let failure = storageFailure;
    const storage = sharedStorage || new Map(raw === undefined ? [] : [[SAVE_KEY, raw]]);
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const messages = [];
    const context = vm.createContext({
        console,
        Date: ClockDate,
        performance: { now: () => now - NOW },
        navigator: {},
        crypto: { randomUUID: () => "isolated-test-tab" },
        localStorage: {
            getItem(key) {
                if (failure === "read") throw new Error("SecurityError: storage is blocked");
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                if (failure === "write") throw new Error("QuotaExceededError: storage is full");
                storage.set(key, String(value));
            },
            removeItem(key) {
                if (failure === "write") throw new Error("SecurityError: storage is blocked");
                storage.delete(key);
            }
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        confirm: () => true,
        location: { reload() {} },
        Sys: {
            toast: message => messages.push(message),
            shake() {},
            sfx: new Proxy({}, { get: () => () => {} })
        },
        UI: { renderAll() {}, renderRes() {}, renderHp() {}, renderAch() {} },
        VFX: { add() {}, cvs: { width: 480, height: 200 } },
        $: () => ({ style: {}, classList: { add() {}, remove() {} } })
    });
    for (const file of ["save.js", "game.js"]) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
    }
    vm.runInContext("globalThis.api = { Data, GameLimits, Ach, Logic, Combat, Simulation };", context);
    return {
        ...context.api, context, storage, messages,
        setFailure(value) { failure = value; },
        setNow(value) { now = value; }
    };
}

test("a fresh state and nested legacy defaults never share mutable objects", async () => {
    const h = harness();
    await h.Data.ready;
    const first = h.Data.createDefault();
    const second = h.Data.createDefault();
    first.comp.na.p = 50;
    first.relic[0] = true;
    assert.equal(second.comp.na.p, 0);
    assert.equal(second.relic[0], false);
    assert.equal(h.Data.def.comp.na.p, 0);

    const migrated = h.Data.normalize({ stat: { c: { p: 21 } }, gold: 777 });
    assert.equal(migrated.gold, 777);
    assert.equal(migrated.stat.c.p, 21);
    assert.equal(migrated.stat.c.l, second.stat.c.l);
    assert.equal(migrated.stat.a.p, second.stat.a.p);
    migrated.comp.na.p = 99;
    migrated.stat.a.p = 77;
    assert.equal(h.Data.def.comp.na.p, 0);
    assert.equal(h.Data.def.stat.a.p, 0);
    assert.notEqual(migrated.comp, second.comp);
});

test("legacy r/n skill timestamps migrate to the live rush/night contract", () => {
    const h = harness();
    const state = plain(h.Data.createDefault());
    delete state.version;
    state.skill = { r: NOW - 1000, n: NOW - 2000 };
    const migrated = h.Data.normalize(state);
    assert.equal(migrated.skill.rush, NOW - 1000);
    assert.equal(migrated.skill.night, NOW - 2000);
    assert.equal(h.Combat.sk.rush.cd, 60);
    assert.equal(h.Combat.sk.night.cd, 90);
    assert.equal(migrated.skill.r, undefined);
    assert.equal(migrated.skill.n, undefined);
});

test("malformed backups cannot replace a valid live state or persisted save", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 777;
    assert.equal(h.Data.save(), true);
    const originalState = h.Data.state;
    const originalBytes = h.storage.get(SAVE_KEY);
    const invalid = ["{broken json", { stat: {} }, null];
    for (const change of [
        state => { state.mob = null; },
        state => { state.gold = -1; },
        state => { state.gold = Infinity; },
        state => { state.stat.c.p = "10"; },
        state => { delete state.stat.c.p; },
        state => { delete state.comp.na.c; },
        state => { state.relic = [false]; },
        state => { state.ach[0] = "false"; },
        state => { state.skill.rush = -1; }
    ]) {
        const state = plain(h.Data.createDefault());
        change(state);
        invalid.push(state);
    }
    for (const input of invalid) {
        const result = h.Data.import(input);
        assert.equal(result.ok, false, `accepted invalid input: ${String(input)}`);
        assert.equal(h.Data.state, originalState);
        assert.equal(h.Data.state.gold, 777);
        assert.equal(h.storage.get(SAVE_KEY), originalBytes);
    }
});

test("a valid backup restores only after persistence succeeds", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 777;
    assert.equal(h.Data.save(), true);
    const originalState = h.Data.state;
    const originalBytes = h.storage.get(SAVE_KEY);
    const incoming = plain(h.Data.createDefault());
    incoming.gold = 42;
    incoming.mob.hp = 40;
    h.setFailure("write");
    assert.equal(h.Data.import(incoming).ok, false);
    assert.equal(h.Data.state, originalState);
    assert.equal(h.Data.state.gold, 777);
    assert.equal(h.storage.get(SAVE_KEY), originalBytes);
    h.setFailure(undefined);
    assert.equal(h.Data.import(incoming).ok, true);
    assert.equal(h.Data.state.gold, 42);
    assert.equal(h.Data.state.mob.hp, 40);
    assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).gold, 42);
});

test("candidate saves and resets are atomic when storage is full", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 777;
    assert.equal(h.Data.save(), true);
    const originalState = h.Data.state;
    const originalBytes = h.storage.get(SAVE_KEY);
    const candidate = plain(originalState);
    candidate.gold = 42;
    h.setFailure("write");
    assert.equal(h.Data.save(candidate), false);
    assert.equal(h.Data.state, originalState);
    assert.equal(h.Data.reset().ok, false);
    assert.equal(h.Data.state, originalState);
    assert.equal(h.Data.state.gold, 777);
    assert.equal(h.storage.get(SAVE_KEY), originalBytes);
});

test("corrupt on-disk data remains recoverable and cannot be overwritten by autosave", async () => {
    const raw = "{this is the player's corrupt save";
    const h = harness({ raw });
    await h.Data.ready;
    assert.equal(h.Data.state.gold, 0);
    assert.equal(h.Data.recoveryRaw, raw);
    assert.equal(h.storage.get(SAVE_KEY), raw);
    assert.equal(h.Data.save(), false);
    assert.equal(h.storage.get(SAVE_KEY), raw);
    assert.ok([...h.storage.values()].includes(raw));
});

test("reloading a repaired save clears the active recovery guard and keeps its original copy", async () => {
    const raw = "{the original corrupt save";
    const h = harness({ raw });
    await h.Data.ready;
    h.storage.set(SAVE_KEY, JSON.stringify(h.Data.createDefault()));
    h.Data.load();
    assert.equal(h.Data.recoveryRaw, null);
    assert.equal(h.storage.get(`${SAVE_KEY}:recovery`), raw);
    assert.equal(h.Data.save(), true);
});

test("incomplete current-version nested upgrades are preserved for recovery on load", async () => {
    const baseline = plain(harness().Data.createDefault());
    for (const [group, item, field] of [["stat", "c", "p"], ["comp", "na", "c"]]) {
        const state = plain(baseline);
        state.gold = 777;
        delete state[group][item][field];
        const raw = JSON.stringify(state);
        const h = harness({ raw });
        await h.Data.ready;
        assert.equal(h.Data.recoveryRaw, raw);
        assert.equal(h.storage.get(SAVE_KEY), raw);
        assert.equal(h.storage.get(`${SAVE_KEY}:recovery`), raw);
        assert.equal(h.Data.save(), false);
        assert.equal(h.storage.get(SAVE_KEY), raw);
    }
});

test("blocked storage provides a playable default and reports the actual failure", async () => {
    const h = harness({ storageFailure: "read" });
    await h.Data.ready;
    assert.equal(h.Data.state.mob.hp, 100);
    assert.equal(h.Simulation.getClickDamage(h.Data.state), 10);
    let status;
    h.Data.onStatus(value => { status = value; });
    assert.equal(status.storageAvailable, false);
    assert.ok(status.message.length > 0);
    assert.equal(h.Data.save(), false);
});

test("a stale revision cannot overwrite a newer save even without tab-lock APIs", async () => {
    const first = harness();
    await first.Data.ready;
    assert.equal(first.Data.save(), true);
    const second = harness({ sharedStorage: first.storage });
    await second.Data.ready;
    first.Data.state.gold = 123;
    assert.equal(first.Data.save(), true);
    second.Data.state.gold = 0;
    assert.equal(second.Data.save(), false);
    assert.equal(JSON.parse(first.storage.get(SAVE_KEY)).gold, 123);
    assert.equal(second.Data.state.gold, 123);
    assert.equal(second.Data.canWrite, false);
});

test("autosave timestamps do not consume an away interval", async () => {
    const h = harness();
    await h.Data.ready;
    const awayStarted = h.Data.state.lastActiveAt;
    for (let seconds = 5; seconds <= 180; seconds += 5) {
        h.setNow(NOW + seconds * 1000);
        assert.equal(h.Data.save(), true);
    }
    assert.equal(h.Data.state.lastActiveAt, awayStarted);
    assert.equal(h.Data.state.savedAt, NOW + 180_000);
    const saved = JSON.parse(h.storage.get(SAVE_KEY));
    assert.equal(saved.lastActiveAt, awayStarted);
    assert.equal(saved.savedAt, NOW + 180_000);
});

test("prestige resets legacy fallback upgrades while preserving earned progress", async () => {
    const h = harness({ raw: JSON.stringify({ stat: { c: { l: 8, p: 50, c: 500 } }, min: 1, gold: 900 }) });
    await h.Data.ready;
    h.Data.state.comp.na = { l: 1, p: 50, c: 3600 };
    h.Data.state.gem = 12;
    h.Data.state.token = 7;
    h.Data.state.relic[0] = true;
    h.Data.state.totalClicks = 500;
    h.Ach.evaluate(h.Data.state);
    assert.equal(h.Logic.prestige(), true);
    assert.equal(h.Data.state.comp.na.p, 0);
    assert.equal(h.Data.state.stat.c.l, 1);
    assert.equal(h.Data.state.stat.c.p, 10);
    assert.equal(h.Data.state.gold, 0);
    assert.equal(h.Data.state.token, 8);
    assert.equal(h.Data.state.gem, 12);
    assert.equal(h.Data.state.relic[0], true);
    assert.equal(h.Data.state.totalClicks, 500);
    assert.equal(h.Data.state.achReady[2], true);
    assert.equal(h.Data.def.comp.na.p, 0);
    h.Data.state.min = 1;
    h.Data.state.token = 1e12;
    assert.equal(h.Logic.prestige(), true);
    assert.equal(h.Data.state.token, 1e12 + 1);
    assert.equal(h.Data.state.mob.hp, 100);
});

test("restoring a partially damaged normal enemy keeps its saved HP", () => {
    const initial = harness();
    const state = plain(initial.Data.createDefault());
    state.mob.hp = 40;
    const h = harness({ raw: JSON.stringify(state) });
    h.Simulation.reconcile(h.Data.state, NOW);
    assert.equal(h.Data.state.mob.boss, false);
    assert.equal(h.Data.state.mob.hp, 40);
    assert.equal(h.Simulation.calcMobStats(h.Data.state).hp, 100);
});

function autoState(h) {
    const state = h.Data.createDefault();
    state.kills = 50;
    state.stat.a.l = 1;
    state.stat.a.p = 100;
    state.mob.hp = h.Simulation.calcMobStats(state).hp;
    h.Simulation.reconcile(state, NOW);
    return state;
}

test("5 fps and a ten-second pause preserve the same automatic combat time", () => {
    const h = harness();
    const lowFps = autoState(h);
    const oncePerSecond = plain(lowFps);
    const paused = plain(lowFps);
    const startingHp = lowFps.mob.hp;
    for (let i = 0; i < 50; i++) h.Simulation.simulate(lowFps, NOW + i * 200, NOW + (i + 1) * 200);
    for (let i = 0; i < 10; i++) h.Simulation.simulate(oncePerSecond, NOW + i * 1000, NOW + (i + 1) * 1000);
    h.Simulation.simulate(paused, NOW, NOW + 10_000);
    assert.equal(startingHp - lowFps.mob.hp, 1000);
    assert.equal(lowFps.mob.hp, oncePerSecond.mob.hp);
    assert.equal(lowFps.mob.hp, paused.mob.hp);
    assert.equal(lowFps.kills, 50);
});

test("offline gold is 70% of the same changing-stage automatic combat rewards", () => {
    const h = harness();
    const online = h.Data.createDefault();
    online.stat.a = { l: 1, p: 1_000_000, c: 160 };
    const offline = plain(online);
    h.Simulation.reconcile(online, NOW);
    h.Simulation.reconcile(offline, NOW);
    const onlineResult = h.Simulation.simulate(online, NOW, NOW + 120_000);
    const offlineResult = h.Simulation.simulate(offline, NOW, NOW + 120_000, { offline: true });
    assert.ok(online.gold > 0);
    assert.ok(online.kills > 10);
    assert.equal(offline.gold, Math.floor(online.gold * 0.7));
    assert.equal(offline.kills, online.kills);
    assert.equal(offline.min, online.min);
    assert.equal(offline.mob.hp, online.mob.hp);
    assert.equal(offline.gem, online.gem);
    assert.equal(offlineResult.kills, onlineResult.kills);
});

test("a boss appearing does not satisfy the boss-kill achievement", () => {
    const h = harness();
    const state = h.Data.createDefault();
    state.kills = 99;
    state.min = 9;
    state.stat.a = { l: 1, p: 10_000_000_000, c: 160 };
    state.mob.hp = 1;
    h.Simulation.reconcile(state, NOW);
    h.Simulation.simulate(state, NOW, NOW + 1000);
    h.Ach.evaluate(state);
    assert.equal(state.kills, 100);
    assert.equal(state.mob.boss, true);
    assert.equal(state.bossKills, 0);
    assert.equal(state.achReady[1], false);
    h.Simulation.simulate(state, NOW + 1000, NOW + 2000);
    h.Ach.evaluate(state);
    assert.equal(state.bossKills, 1);
    assert.equal(state.achReady[1], true);
});

test("boss deadlines advance through slow frames and expire once", () => {
    const h = harness();
    const state = h.Data.createDefault();
    state.kills = 100;
    state.min = 10;
    h.Simulation.spawn(state, true, NOW);
    h.Simulation.simulate(state, NOW, NOW + 5000);
    assert.equal(state.mob.boss, true);
    assert.equal(state.mob.deadline - (NOW + 5000), 25_000);
    const result = h.Simulation.simulate(state, NOW + 5000, NOW + 31_000);
    assert.equal(result.bossExpired, 1);
    assert.equal(state.mob.boss, false);
    assert.equal(state.kills, 99);
    assert.equal(state.min, 9);
    const later = h.Simulation.simulate(state, NOW + 31_000, NOW + 40_000);
    assert.equal(later.bossExpired, 0);
    assert.equal(state.kills, 99);
});

test("a boss spawned on a fractional automatic tick remains a valid persistent save", async () => {
    const h = harness();
    await h.Data.ready;
    const state = h.Data.createDefault();
    state.kills = 99;
    state.min = 9;
    state.mob.hp = 1;
    state.stat.a = { l: 1, p: 1e20, c: 160 };
    state.autoRemainder = 1 / 3;
    h.Simulation.simulate(state, NOW, NOW + 1000);
    assert.equal(state.kills, 100);
    assert.equal(state.mob.boss, true);
    assert.ok(Number.isInteger(state.mob.deadline));
    assert.equal(h.Data.save(state), true);
    assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).mob.deadline, state.mob.deadline);
});

test("the 499-to-500 click boundary makes the achievement ready immediately", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.totalClicks = 499;
    h.Ach.evaluate(h.Data.state);
    assert.equal(h.Data.state.achReady[2], false);
    h.Data.state.totalClicks++;
    h.Ach.check();
    assert.equal(h.Data.state.achReady[2], true);
    assert.equal(h.Data.state.ach[2], false);
    const gems = h.Data.state.gem;
    h.Ach.claim(2);
    assert.equal(h.Data.state.ach[2], true);
    assert.equal(h.Data.state.gem - gems, 15);
    h.Ach.claim(2);
    assert.equal(h.Data.state.gem - gems, 15);
});

test("rush runs every 80 ms during live play and never produces away attacks", () => {
    const h = harness();
    const live = autoState(h);
    live.stat.a.p = 0;
    live.skill.rush = NOW;
    live.buff.rushUntil = NOW + 5000;
    const away = plain(live);
    const initialHp = live.mob.hp;
    const liveResult = h.Simulation.simulate(live, NOW, NOW + 5000);
    assert.equal(liveResult.rushHits, 62);
    assert.equal(initialHp - live.mob.hp, 620);
    const awayResult = h.Simulation.simulate(away, NOW, NOW + 1000, { offline: true });
    assert.equal(awayResult.rushHits, 0);
    assert.equal(away.mob.hp, initialHp);
    assert.equal(away.buff.rushUntil, NOW + 5000);
    const resumed = h.Simulation.simulate(away, NOW + 1000, NOW + 1500);
    assert.equal(resumed.rushHits, 6);
    assert.equal(initialHp - away.mob.hp, 60);
});

test("night guarantees manual critical hits while leaving automatic damage unchanged", () => {
    const h = harness();
    const state = h.Data.createDefault();
    state.buff.nightUntil = NOW + 10_000;
    state.stat.crit.p = 0;
    const manual = h.Simulation.events();
    h.Simulation.damage(state, 10, NOW, manual, { random: () => 0.99 });
    assert.equal(manual.critical, true);
    assert.equal(manual.damage, 30);
    const automatic = h.Simulation.events();
    h.Simulation.damage(state, 10, NOW, automatic, { auto: true, random: () => 0.99 });
    assert.equal(automatic.critical, false);
    assert.equal(automatic.damage, 10);
    const expired = h.Simulation.events();
    h.Simulation.damage(state, 10, NOW + 10_000, expired, { random: () => 0 });
    assert.equal(expired.critical, false);
    assert.equal(expired.damage, 10);
});

test("canonical skill cooldowns cannot be retriggered before their deadline", async () => {
    const h = harness();
    await h.Data.ready;
    assert.equal(h.Combat.useSkill("rush", NOW), true);
    assert.equal(h.Data.state.skill.rush, NOW);
    assert.equal(h.Data.state.buff.rushUntil, NOW + 5000);
    assert.equal(h.Combat.useSkill("rush", NOW + 59_999), false);
    assert.equal(h.Combat.useSkill("r", NOW + 60_000), false);
    h.setNow(NOW + 60_000);
    assert.equal(h.Combat.useSkill("rush", NOW + 60_000), true);
    assert.equal(h.Data.state.skill.rush, NOW + 60_000);
});

test("an upgrade rolls back its charge and level if its first persistence attempt fails", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 1000;
    assert.equal(h.Data.save(), true);
    const before = plain(h.Data.state);
    const saved = h.storage.get(SAVE_KEY);
    h.setFailure("write");
    assert.equal(h.Logic.upgrade("click"), false);
    assert.deepEqual(plain(h.Data.state), before);
    assert.equal(h.storage.get(SAVE_KEY), saved);
    assert.equal(h.Data.storageAvailable, false);
});

test("growth boundaries keep enemy stats, damage, and upgrade costs finite", async () => {
    const h = harness();
    await h.Data.ready;
    const state = h.Data.state;
    state.kills = 1_000_000_000;
    state.token = 1_000_000_000;
    state.stat.c = { l: 1000, p: 1e100, c: 1e100 };
    state.stat.a = { l: 1000, p: 1e100, c: 1e100 };
    state.comp.na = { l: 1000, p: 1e100, c: 1e100 };
    state.comp.yu = { l: 1000, p: 1e100, c: 1e100 };
    state.relic = [true, true, true, true];
    const stats = h.Simulation.calcMobStats(state);
    for (const value of [stats.hp, stats.reward, h.Simulation.getClickDamage(state), h.Simulation.getAutoDamage(state)]) {
        assert.ok(Number.isFinite(value));
        assert.ok(value > 0 && value <= 1e100);
    }
    state.gold = 1e100;
    const before = plain(state.stat.c);
    h.Logic.up("up-click", state.stat.c, state.stat.c.c, 1.5, item => { item.p = item.p * 1.4 + 5; });
    assert.deepEqual(plain(state.stat.c), before);
    assert.equal(state.gold, 1e100);
    assert.doesNotThrow(() => h.Data.normalize(plain(state), { strict: true }));
});

test("successful late upgrades clamp growing costs and stop charging at maximum", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 1e100;
    h.Data.state.stat.c = { l: 999, p: 1e99, c: 9e99 };
    assert.equal(h.Logic.upgrade("click"), true);
    assert.equal(h.Data.state.stat.c.l, 1000);
    assert.equal(h.Data.state.stat.c.c, 1e100);
    assert.ok(Number.isFinite(h.Data.state.stat.c.p));
    assert.ok(h.Data.state.gold >= 0);
    h.Data.state.gold = 1e100;
    const maximum = plain(h.Data.state.stat.c);
    assert.equal(h.Logic.upgrade("click"), false);
    assert.equal(h.Data.state.gold, 1e100);
    assert.deepEqual(plain(h.Data.state.stat.c), maximum);
});
