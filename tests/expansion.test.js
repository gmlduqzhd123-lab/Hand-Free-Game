"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const NOW = 1_700_000_000_000;
const SAVE_KEY = "ys_bugfree_final_v2";
const EXPANSION_FIELDS = ["items", "extraRelics", "extraAch", "extraAchReady", "xpBonusRemainder"];
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ raw, game = false, failure } = {}) {
    let storageFailure = failure;
    let now = NOW;
    const storage = new Map(raw === undefined ? [] : [[SAVE_KEY, raw]]);
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const messages = [];
    const context = vm.createContext({
        console, Date: ClockDate, performance: { now: () => now - NOW },
        navigator: {}, crypto: { randomUUID: () => "expansion-test-tab" },
        localStorage: {
            getItem(key) {
                if (storageFailure === "read") throw new Error("Storage blocked");
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                if (storageFailure === "write") throw new Error("QuotaExceededError");
                storage.set(key, String(value));
            },
            removeItem: key => storage.delete(key)
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        confirm: () => true,
        Sys: { toast: value => messages.push(value), shake() {}, sfx: new Proxy({}, { get: () => () => {} }) },
        UI: new Proxy({}, { get: () => () => {} }),
        VFX: { add() {}, cvs: { width: 480, height: 200 } },
        $: () => ({ style: {}, classList: { add() {}, remove() {} } })
    });
    for (const file of game ? ["save.js", "catalog.js", "game.js"] : ["save.js"]) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
    }
    vm.runInContext(game
        ? "globalThis.api = { Data, GameLimits, Catalog, Ach, Logic, Combat, Simulation };"
        : "globalThis.api = { Data, GameLimits };", context);
    return {
        ...context.api, context, storage, messages,
        setFailure(value) { storageFailure = value; },
        setNow(value) { now = value; }
    };
}

test("old v1-v4 saves retain original balances and collections while expansion fields default safely", async () => {
    const baseline = harness();
    for (const version of [1, 2, 3, 4]) {
        const legacy = plain(baseline.Data.createDefault());
        legacy.version = version;
        legacy.gold = 92751;
        legacy.gem = 123;
        legacy.token = 6;
        legacy.relic = [true, false, true, false];
        legacy.ach = [true, false, false, true, false];
        legacy.achReady = [true, true, false, true, false];
        legacy.stat.c = { l: 9, p: 88, c: 722 };
        legacy.comp.na = { l: 2, p: 98, c: 5000 };
        legacy.player = { level: 9, xp: 13 };
        for (const field of EXPANSION_FIELDS) delete legacy[field];
        if (version < 4) {
            delete legacy.player;
            delete legacy.xpRemainder;
        }
        const raw = JSON.stringify(legacy);
        const h = harness({ raw });
        await h.Data.ready;
        assert.equal(h.Data.getRecovery(), null);
        assert.equal(h.Data.key, SAVE_KEY);
        assert.equal(h.Data.version, 4);
        assert.equal(h.Data.state.gold, legacy.gold);
        assert.equal(h.Data.state.gem, legacy.gem);
        assert.equal(h.Data.state.token, legacy.token);
        assert.deepEqual(plain(h.Data.state.relic), legacy.relic);
        assert.deepEqual(plain(h.Data.state.ach), legacy.ach);
        assert.deepEqual(plain(h.Data.state.achReady), legacy.achReady);
        assert.deepEqual(plain(h.Data.state.stat.c), legacy.stat.c);
        assert.deepEqual(plain(h.Data.state.comp.na), legacy.comp.na);
        assert.deepEqual(plain(h.Data.state.player), version === 4 ? legacy.player : { level: 1, xp: 0 });
        assert.equal(Object.keys(h.Data.state.items).length, 24);
        assert.ok(Object.values(h.Data.state.items).every(level => level === 0));
        assert.deepEqual(plain(h.Data.state.extraRelics), Array(16).fill(false));
        assert.deepEqual(plain(h.Data.state.extraAch), Array(25).fill(false));
        assert.deepEqual(plain(h.Data.state.extraAchReady), Array(25).fill(false));
        assert.equal(h.Data.state.xpBonusRemainder, 0);
        assert.equal(h.storage.get(SAVE_KEY), raw, "migration must not overwrite before a successful save");
    }
});

test("new collection defaults are independent and a partial item map fills only omitted known IDs", () => {
    const h = harness();
    const first = h.Data.createDefault();
    const second = h.Data.createDefault();
    first.items["chalk-spark"] = 25;
    first.extraRelics[0] = true;
    first.extraAch[0] = true;
    first.extraAchReady[0] = true;
    assert.equal(second.items["chalk-spark"], 0);
    assert.equal(second.extraRelics[0], false);
    assert.equal(second.extraAch[0], false);
    assert.equal(second.extraAchReady[0], false);
    const incoming = plain(second);
    incoming.items = { "chalk-spark": 4, "calm-tea": 25 };
    const normalized = h.Data.normalize(incoming, { strict: true });
    assert.equal(normalized.items["chalk-spark"], 4);
    assert.equal(normalized.items["calm-tea"], 25);
    assert.equal(Object.keys(normalized.items).length, 24);
    assert.ok(Object.entries(normalized.items).filter(([id]) => !["chalk-spark", "calm-tea"].includes(id)).every(([, level]) => level === 0));
});

test("malformed expansion fields reject import atomically instead of dropping collection progress", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 54321;
    h.Data.state.items["chalk-spark"] = 3;
    assert.equal(h.Data.save(), true);
    const original = h.Data.state;
    const bytes = h.storage.get(SAVE_KEY);
    const changes = [
        value => { value.items = null; },
        value => { value.items = []; },
        value => { value.items = { "unknown-item": 1 }; },
        ...[-1, 26, 1.5, "1", false, null, NaN, Infinity].map(level => value => { value.items["chalk-spark"] = level; }),
        ...["extraRelics", "extraAch", "extraAchReady"].flatMap(field => [
            value => { value[field] = null; },
            value => { value[field] = []; },
            value => { value[field].pop(); },
            value => { value[field].push(false); },
            value => { delete value[field][0]; },
            value => { value[field][0] = "false"; },
            value => { value[field][0] = 0; }
        ]),
        ...[-1, 1, 2, "0.5", null, NaN, Infinity].map(remainder => value => { value.xpBonusRemainder = remainder; })
    ];
    for (const change of changes) {
        const incoming = plain(h.Data.createDefault());
        change(incoming);
        assert.equal(h.Data.import(incoming).ok, false);
        assert.equal(h.Data.state, original);
        assert.equal(h.storage.get(SAVE_KEY), bytes);
        assert.throws(() => h.Data.normalize(incoming), { name: "SaveValidationError" });
    }
});

test("invalid expansion data loaded from storage retains its exact original for recovery", async () => {
    const baseline = harness();
    const invalid = plain(baseline.Data.createDefault());
    invalid.gold = 9988;
    invalid.items["future-unknown-item"] = 2;
    const bytes = JSON.stringify(invalid);
    const h = harness({ raw: bytes });
    await h.Data.ready;
    assert.equal(h.Data.getRecovery(), bytes);
    assert.equal(h.Data.save(), false);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
    assert.equal(h.storage.get(`${SAVE_KEY}:recovery`), bytes);
});

test("all expansion progress round trips through save, reload, backup import, and failed storage", async () => {
    const h = harness();
    await h.Data.ready;
    for (const [index, id] of h.GameLimits.ITEM_IDS.entries()) h.Data.state.items[id] = index + 1;
    h.Data.state.extraRelics = Array.from({ length: 16 }, (_, index) => index % 2 === 0);
    h.Data.state.extraAch = Array.from({ length: 25 }, (_, index) => index % 3 === 0);
    h.Data.state.extraAchReady = Array(25).fill(true);
    h.Data.state.xpBonusRemainder = 0.375;
    assert.equal(h.Data.save(), true);
    const bytes = h.storage.get(SAVE_KEY);
    const reloaded = harness({ raw: bytes });
    await reloaded.Data.ready;
    for (const field of EXPANSION_FIELDS) assert.deepEqual(plain(reloaded.Data.state[field]), plain(h.Data.state[field]));
    const imported = harness();
    await imported.Data.ready;
    assert.equal(imported.Data.import(bytes).ok, true);
    for (const field of EXPANSION_FIELDS) assert.deepEqual(plain(imported.Data.state[field]), plain(h.Data.state[field]));
    const incoming = plain(h.Data.state);
    incoming.items["chalk-spark"] = 25;
    h.setFailure("write");
    const original = h.Data.state;
    assert.equal(h.Data.save(incoming), false);
    assert.equal(h.Data.import(incoming).ok, false);
    assert.equal(h.Data.reset().ok, false);
    assert.equal(h.Data.state, original);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
});

test("reset clears expanded purchases and rewards while retaining teacher selection and started status", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.character = "male";
    h.Data.state.hasStarted = true;
    h.Data.state.items["rainbow-stamp"] = 25;
    h.Data.state.extraRelics.fill(true);
    h.Data.state.extraAch.fill(true);
    h.Data.state.extraAchReady.fill(true);
    h.Data.state.xpBonusRemainder = 0.75;
    assert.equal(h.Data.save(), true);
    assert.equal(h.Data.reset().ok, true);
    for (const field of EXPANSION_FIELDS) assert.deepEqual(plain(h.Data.state[field]), plain(h.Data.createDefault()[field]));
    assert.equal(h.Data.state.character, "male");
    assert.equal(h.Data.state.hasStarted, true);
});

test("claimed expanded achievements normalize to ready without increasing any currency", () => {
    const h = harness();
    const state = plain(h.Data.createDefault());
    state.extraAch[0] = state.extraAch[24] = true;
    state.gold = 19;
    state.gem = 7;
    const normalized = h.Data.normalize(state, { strict: true });
    assert.equal(normalized.extraAchReady[0], true);
    assert.equal(normalized.extraAchReady[24], true);
    assert.equal(normalized.gold, 19);
    assert.equal(normalized.gem, 7);
});

test("catalog IDs match persisted item IDs and every item can be bought at its displayed price", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    assert.equal(h.Catalog.items.length, 24);
    assert.deepEqual(h.Catalog.items.map(item => item.id), h.GameLimits.ITEM_IDS);
    assert.equal(new Set(h.Catalog.items.map(item => item.id)).size, 24);
    assert.equal(h.Catalog.relics.length, 20);
    assert.equal(new Set(h.Catalog.relics.map(relic => relic.id)).size, 20);
    h.Data.state.gold = 1_000_000;
    assert.equal(h.Data.save(), true);
    for (const item of h.Catalog.items) {
        const gold = h.Data.state.gold;
        const price = h.Catalog.itemCost(item.id);
        assert.equal(h.Catalog.canBuyItem(item.id), true);
        assert.equal(h.Logic.buyItem(item.id), true);
        assert.equal(h.Data.state.items[item.id], 1);
        assert.equal(h.Data.state.gold, gold - price);
        assert.ok(h.Catalog.itemCost(item.id) > price);
        assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).items[item.id], 1);
    }
    assert.equal(h.Catalog.itemCount(), 24);
    assert.equal(h.Catalog.totalItemLevels(), 24);
    assert.equal(h.Catalog.categoryLevels("click"), 6);
    assert.equal(h.Catalog.categoryLevels("auto"), 6);
});

test("item purchases stop without charges when unaffordable, unknown, or already at level 25", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    const initial = plain(h.Data.state);
    assert.equal(h.Logic.buyItem("chalk-spark"), false);
    assert.equal(h.Logic.buyItem("unknown"), false);
    assert.deepEqual(plain(h.Data.state), initial);
    h.Data.state.gold = 1e9;
    for (const item of h.Catalog.items) h.Data.state.items[item.id] = 25;
    assert.equal(h.Data.save(), true);
    const maximum = plain(h.Data.state);
    const bytes = h.storage.get(SAVE_KEY);
    for (const item of h.Catalog.items) {
        assert.equal(h.Catalog.canBuyItem(item.id), false);
        assert.equal(h.Logic.buyItem(item.id), false);
    }
    assert.deepEqual(plain(h.Data.state), maximum);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
});

test("a shop purchase rolls back both level and price on the first storage failure", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    h.Data.state.gold = 1000;
    assert.equal(h.Data.save(), true);
    const before = plain(h.Data.state);
    const bytes = h.storage.get(SAVE_KEY);
    h.setFailure("write");
    assert.equal(h.Logic.buyItem("chalk-spark"), false);
    assert.deepEqual(plain(h.Data.state), before);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
});

test("the 20-relic draw pool awards each relic once and stops without charging when complete", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    h.Data.state.gem = 200;
    assert.equal(h.Data.save(), true);
    for (let draw = 0; draw < 20; draw++) {
        const gems = h.Data.state.gem;
        assert.equal(h.Logic.pullGacha(() => 0), true);
        assert.equal(h.Catalog.relicCount(), draw + 1);
        assert.equal(h.Data.state.gem, gems - 10);
        assert.equal(h.Data.state.relic.length, 4);
        assert.equal(h.Data.state.extraRelics.length, 16);
    }
    assert.ok(h.Data.state.relic.every(Boolean));
    assert.ok(h.Data.state.extraRelics.every(Boolean));
    h.Data.state.gem = 50;
    assert.equal(h.Data.save(), true);
    const bytes = h.storage.get(SAVE_KEY);
    assert.equal(h.Logic.pullGacha(() => 0.999999), false);
    assert.equal(h.Data.state.gem, 50);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
    const reloaded = harness({ raw: bytes, game: true });
    await reloaded.Data.ready;
    assert.equal(reloaded.Catalog.relicCount(), 20);
    assert.equal(reloaded.Logic.pullGacha(), false);
});

test("new relic draws and expanded achievement rewards both roll back on storage failure", async () => {
    for (const action of ["relic", "achievement"]) {
        const h = harness({ game: true });
        await h.Data.ready;
        h.Data.state.gem = 50;
        h.Data.state.extraAchReady[0] = true;
        assert.equal(h.Data.save(), true);
        const before = plain(h.Data.state);
        const bytes = h.storage.get(SAVE_KEY);
        h.setFailure("write");
        assert.equal(action === "relic" ? h.Logic.pullGacha(() => 0) : h.Ach.claim(5), false);
        assert.deepEqual(plain(h.Data.state), before);
        assert.equal(h.storage.get(SAVE_KEY), bytes);
    }
});

test("all 30 achievements pay exactly once across repeated claims, reload, and backup import", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    assert.equal(h.Ach.list.length, 30);
    assert.deepEqual(plain(h.Ach.list.map(achievement => achievement.id)), Array.from({ length: 30 }, (_, id) => id));
    h.Data.state.achReady.fill(true);
    h.Data.state.extraAchReady.fill(true);
    assert.equal(h.Data.save(), true);
    let expectedGems = 0;
    for (const achievement of h.Ach.list) {
        assert.equal(h.Ach.canClaim(achievement.id), true);
        assert.equal(h.Ach.claim(achievement.id), true);
        expectedGems += achievement.rwd;
        assert.equal(h.Data.state.gem, expectedGems);
        assert.equal(h.Ach.isClaimed(achievement.id), true);
        assert.equal(h.Ach.isReady(achievement.id), true);
        assert.equal(h.Ach.claim(achievement.id), false);
        assert.equal(h.Data.state.gem, expectedGems);
    }
    assert.equal(h.Data.state.ach.length, 5);
    assert.equal(h.Data.state.extraAch.length, 25);
    const bytes = h.storage.get(SAVE_KEY);
    const reloaded = harness({ raw: bytes, game: true });
    await reloaded.Data.ready;
    const imported = harness({ game: true });
    await imported.Data.ready;
    assert.equal(imported.Data.import(bytes).ok, true);
    for (const other of [reloaded, imported]) {
        for (let id = 0; id < 30; id++) assert.equal(other.Ach.claim(id), false);
        assert.equal(other.Ach.claim(-1), false);
        assert.equal(other.Ach.claim(30), false);
        assert.equal(other.Data.state.gem, expectedGems);
    }
});

test("prestige preserves expanded investments, collections, achievements, and fractional XP bonuses", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    h.Data.state.min = 7;
    h.Data.state.gold = 1000;
    h.Data.state.token = 2;
    h.Data.state.items["chalk-spark"] = 3;
    h.Data.state.items["reading-lamp"] = 9;
    h.Data.state.extraRelics[12] = true;
    h.Data.state.extraAch[0] = h.Data.state.extraAchReady[0] = true;
    h.Data.state.xpBonusRemainder = 0.375;
    assert.equal(h.Data.save(), true);
    const expansion = Object.fromEntries(EXPANSION_FIELDS.map(field => [field, plain(h.Data.state[field])]));
    assert.equal(h.Logic.prestige(), true);
    assert.equal(h.Data.state.min, 0);
    assert.equal(h.Data.state.gold, 0);
    assert.equal(h.Data.state.token, 9);
    for (const field of EXPANSION_FIELDS) assert.deepEqual(plain(h.Data.state[field]), expansion[field]);
    const persisted = JSON.parse(h.storage.get(SAVE_KEY));
    for (const field of EXPANSION_FIELDS) assert.deepEqual(persisted[field], plain(h.Data.state[field]));
});

test("equipment and new relics affect all six advertised combat and growth categories", () => {
    const h = harness({ game: true });
    const state = h.Data.createDefault();
    state.stat.c.p = 100;
    state.stat.a.p = 100;
    state.stat.crit.p = 1;
    for (const id of ["chalk-spark", "fairy-clock", "reading-lamp", "coin-pouch", "star-glasses", "sand-timer"]) state.items[id] = 25;
    for (const index of [0, 4, 8, 10, 12, 14]) state.extraRelics[index] = true;
    state.relic[0] = state.relic[2] = state.relic[3] = true;
    assert.equal(h.Simulation.getClickDamage(state), 210);
    assert.equal(h.Simulation.getAutoDamage(state), 210);
    assert.equal(h.Simulation.calcMobStats(state).reward, 18);
    assert.equal(h.Simulation.getCriticalChance(state, NOW), 6.75);
    assert.equal(h.Simulation.bossDuration(state), 48000);
    const critical = h.Simulation.events();
    h.Simulation.damage(state, 10, NOW, critical, { random: () => 0.06749 });
    assert.equal(critical.critical, true);
    const ordinary = h.Simulation.events();
    h.Simulation.damage(state, 10, NOW, ordinary, { random: () => 0.0675 });
    assert.equal(ordinary.critical, false);
    const growth = h.Simulation.simulate(state, NOW, NOW + 8000);
    assert.equal(growth.xpGained, 49);
    assert.equal(state.xpBonusRemainder, 0);
});

test("fractional item XP bonuses survive frame chunks, offline progress, save, and reload", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    const start = h.Data.createDefault();
    start.items["reading-lamp"] = 1;
    start.stat.a.p = 0;
    const single = plain(start);
    const chunks = plain(start);
    const frames = plain(start);
    const away = plain(start);
    assert.equal(h.Simulation.simulate(single, NOW, NOW + 40000).xpGained, 201);
    let chunkXP = 0;
    for (let elapsed = 0; elapsed < 40000; elapsed += 137) {
        chunkXP += h.Simulation.simulate(chunks, NOW + elapsed, NOW + Math.min(40000, elapsed + 137)).xpGained;
    }
    let frameXP = 0;
    for (let frame = 0; frame < 2400; frame++) {
        frameXP += h.Simulation.simulate(frames, NOW + frame * (1000 / 60), NOW + (frame + 1) * (1000 / 60)).xpGained;
    }
    assert.equal(h.Simulation.simulate(away, NOW, NOW + 40000, { offline: true }).xpGained, 201);
    assert.equal(chunkXP, 201);
    assert.equal(frameXP, 201);
    for (const state of [chunks, frames, away]) {
        assert.deepEqual(plain(state.player), plain(single.player));
        assert.equal(state.xpBonusRemainder, single.xpBonusRemainder);
    }
    const beforeSave = plain(start);
    assert.equal(h.Simulation.simulate(beforeSave, NOW, NOW + 17000).xpGained, 85);
    assert.equal(beforeSave.xpBonusRemainder, 0.425);
    h.setNow(NOW + 17000);
    assert.equal(h.Data.save(beforeSave), true);
    const reloaded = harness({ raw: h.storage.get(SAVE_KEY), game: true });
    await reloaded.Data.ready;
    assert.equal(reloaded.Data.state.xpBonusRemainder, 0.425);
    assert.equal(reloaded.Simulation.simulate(reloaded.Data.state, NOW + 17000, NOW + 40000).xpGained, 116);
    assert.deepEqual(plain(reloaded.Data.state.player), plain(single.player));
    assert.equal(reloaded.Data.state.xpBonusRemainder, 0);
});

test("bonus gold applies to live and offline enemy rewards with the original offline reduction", () => {
    const h = harness({ game: true });
    const live = h.Data.createDefault();
    live.stat.a.p = 1e10;
    live.items["coin-pouch"] = 25;
    live.items["honey-lunchbox"] = 25;
    live.extraRelics[10] = true;
    const away = plain(live);
    const liveEvents = h.Simulation.simulate(live, NOW, NOW + 60000);
    const awayEvents = h.Simulation.simulate(away, NOW, NOW + 60000, { offline: true });
    assert.ok(liveEvents.gold > 0);
    assert.equal(away.gold, Math.floor(live.gold * 0.7));
    assert.equal(awayEvents.goldGross, liveEvents.goldGross);
    assert.equal(away.kills, live.kills);
    assert.deepEqual(plain(away.player), plain(live.player));
});

test("expanded readiness is earned at its boundary and retained after a reset of adventure progress", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    assert.equal(h.Ach.canClaim(5), false);
    h.Data.state.gold = 5000;
    assert.equal(h.Logic.buyItem("chalk-spark"), true);
    assert.equal(h.Ach.canClaim(5), true);
    assert.equal(h.Ach.isReady(5), true);
    assert.equal(h.Ach.isClaimed(5), false);
    h.Data.state.totalClicks = 1999;
    h.Ach.evaluate(h.Data.state);
    assert.equal(h.Ach.isReady(26), false);
    h.Combat.attack();
    assert.equal(h.Data.state.totalClicks, 2000);
    assert.equal(h.Ach.isReady(26), true);
    h.Data.state.kills = 300;
    h.Data.state.min = 30;
    h.Ach.evaluate(h.Data.state);
    assert.equal(h.Ach.isReady(24), true);
    assert.equal(h.Logic.prestige(), true);
    assert.equal(h.Data.state.kills, 0);
    assert.equal(h.Ach.canClaim(24), true);
    assert.equal(h.Ach.claim(24), true);
    assert.equal(h.Ach.claim(24), false);
});

test("fully expanded late-game states keep rewards and damage finite within supported limits", () => {
    const h = harness({ game: true });
    const state = h.Data.createDefault();
    state.kills = 1e9;
    state.token = 1e9;
    state.player.level = 1000;
    state.stat.c = { l: 1000, p: 1e100, c: 1e100 };
    state.stat.a = { l: 1000, p: 1e100, c: 1e100 };
    state.stat.crit.p = 50;
    state.relic.fill(true);
    state.extraRelics.fill(true);
    for (const id of h.GameLimits.ITEM_IDS) state.items[id] = 25;
    for (const value of [
        h.Simulation.getClickDamage(state), h.Simulation.getAutoDamage(state),
        h.Simulation.calcMobStats(state).hp, h.Simulation.calcMobStats(state).reward
    ]) assert.ok(Number.isFinite(value) && value > 0 && value <= 1e100);
    assert.equal(h.Simulation.getCriticalChance(state, NOW), 50);
    assert.ok(h.Simulation.bossDuration(state) <= 60000);
    assert.doesNotThrow(() => h.Data.normalize(plain(state), { strict: true }));
});

test("boss time items and new time relics immediately extend an active boss by their stated bonus", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    h.Data.state.kills = 100;
    h.Data.state.min = 10;
    h.Data.state.gold = 10000;
    h.Data.state.gem = 50;
    h.Data.state.relic.fill(true);
    h.Data.state.extraRelics.fill(true);
    h.Data.state.extraRelics[14] = false;
    h.Simulation.spawn(h.Data.state, true, NOW);
    assert.equal(h.Data.save(), true);
    const deadline = h.Data.state.mob.deadline;
    assert.equal(h.Logic.buyItem("sand-timer"), true);
    assert.equal(h.Data.state.mob.deadline, deadline + 200);
    assert.equal(h.Logic.pullGacha(() => 0), true);
    assert.equal(h.Data.state.extraRelics[14], true);
    assert.equal(h.Data.state.mob.deadline, deadline + 3200);
    assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).mob.deadline, deadline + 3200);
    h.Data.state.items["sand-timer"] = 25;
    assert.equal(h.Data.save(), true);
    const completedDeadline = h.Data.state.mob.deadline;
    assert.equal(h.Logic.buyItem("sand-timer"), false);
    assert.equal(h.Data.state.mob.deadline, completedDeadline);
});

test("failed time-item and time-relic purchases cannot extend a boss or consume resources", async () => {
    for (const action of ["item", "relic"]) {
        const h = harness({ game: true });
        await h.Data.ready;
        h.Data.state.kills = 100;
        h.Data.state.gold = 10000;
        h.Data.state.gem = 50;
        h.Data.state.relic.fill(true);
        h.Data.state.extraRelics.fill(true);
        h.Data.state.extraRelics[14] = false;
        h.Simulation.spawn(h.Data.state, true, NOW);
        assert.equal(h.Data.save(), true);
        const before = plain(h.Data.state);
        const bytes = h.storage.get(SAVE_KEY);
        h.setFailure("write");
        assert.equal(action === "item" ? h.Logic.buyItem("sand-timer") : h.Logic.pullGacha(() => 0), false);
        assert.deepEqual(plain(h.Data.state), before);
        assert.equal(h.storage.get(SAVE_KEY), bytes);
    }
});

test("invalid relic random samples never consume gems or collection progress", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    h.Data.state.gem = 50;
    assert.equal(h.Data.save(), true);
    const before = plain(h.Data.state);
    const bytes = h.storage.get(SAVE_KEY);
    for (const sample of [NaN, Infinity, -Infinity]) {
        assert.equal(h.Logic.pullGacha(() => sample), false);
        assert.deepEqual(plain(h.Data.state), before);
        assert.equal(h.storage.get(SAVE_KEY), bytes);
    }
});

test("permanent equipment critical bonuses stop base upgrades at the actual 50 percent cap", async () => {
    const h = harness({ game: true });
    await h.Data.ready;
    h.Data.state.gold = 50000;
    h.Data.state.stat.crit = { l: 46, p: 46, c: 300 };
    h.Data.state.extraRelics[12] = h.Data.state.extraRelics[13] = true;
    assert.equal(h.Data.save(), true);
    assert.equal(h.Simulation.getCriticalChance(h.Data.state, NOW), 50);
    assert.equal(h.Logic.isUpgradeMaxed("crit"), true);
    assert.equal(h.Logic.canUpgrade("crit"), false);
    const before = plain(h.Data.state);
    const bytes = h.storage.get(SAVE_KEY);
    assert.equal(h.Logic.upgrade("crit"), false);
    assert.deepEqual(plain(h.Data.state), before);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
    h.Data.state.extraRelics[12] = h.Data.state.extraRelics[13] = false;
    h.Data.state.buff.nightUntil = NOW + 10000;
    assert.equal(h.Simulation.getCriticalChance(h.Data.state, NOW), 100);
    assert.equal(h.Logic.isUpgradeMaxed("crit"), false, "a temporary guaranteed-critical skill must not block permanent growth");
    assert.equal(h.Logic.upgrade("crit"), true);
    assert.equal(h.Data.state.stat.crit.p, 47);
});
