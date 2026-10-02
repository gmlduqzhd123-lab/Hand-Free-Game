"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SAVE_KEY = "ys_bugfree_final_v2";
const NOW = 1_700_000_000_000;
const plain = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(path.join(__dirname, "..", "save.js"), "utf8");

function harness(raw) {
    const storage = new Map(raw === undefined ? [] : [[SAVE_KEY, raw]]);
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [NOW])); }
        static now() { return NOW; }
    }
    const context = vm.createContext({
        console,
        Date: ClockDate,
        crypto: { randomUUID: () => "character-test-tab" },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        setTimeout, clearTimeout, setInterval, clearInterval
    });
    vm.runInContext(source, context, { filename: "save.js" });
    vm.runInContext("globalThis.api = { Data };", context);
    return { Data: context.api.Data, storage, context };
}

function gameplay(state) {
    const result = plain(state);
    delete result.character;
    delete result.hasStarted;
    delete result.savedAt;
    delete result.revision;
    return result;
}

test("legacy v1-v4 saves without character keep their progress and default to female", () => {
    const h = harness();
    for (const version of [1, 2, 3, 4]) {
        const old = plain(h.Data.createDefault());
        old.version = version;
        old.gold = 777;
        old.kills = 8;
        old.mob.hp = 31;
        delete old.character;
        delete old.hasStarted;
        if (version < 4) {
            delete old.player;
            delete old.xpRemainder;
        }
        const restored = h.Data.normalize(old, { strict: true });
        assert.equal(restored.version, 4);
        assert.equal(restored.character, "female");
        assert.equal(restored.hasStarted, true);
        assert.equal(restored.gold, 777);
        assert.equal(restored.kills, 8);
        assert.equal(restored.mob.hp, 31);
    }
});

test("both appearance choices survive save, reload, export JSON, and import", async () => {
    for (const character of ["female", "male"]) {
        const h = harness();
        await h.Data.ready;
        h.Data.state.character = character;
        h.Data.state.hasStarted = true;
        h.Data.state.gold = 321;
        h.Data.state.player = { level: 7, xp: 12 };
        assert.equal(h.Data.save(), true);
        const backup = h.storage.get(SAVE_KEY);
        const reloaded = harness(backup);
        await reloaded.Data.ready;
        assert.equal(reloaded.Data.key, SAVE_KEY);
        assert.equal(reloaded.Data.version, 4);
        assert.equal(reloaded.Data.state.character, character);
        assert.equal(reloaded.Data.state.hasStarted, true);
        assert.deepEqual(gameplay(reloaded.Data.state), gameplay(h.Data.state));
        const imported = harness();
        await imported.Data.ready;
        assert.equal(imported.Data.import(backup).ok, true);
        assert.equal(imported.Data.state.character, character);
        assert.equal(imported.Data.state.hasStarted, true);
        assert.equal(imported.Data.state.gold, 321);
        assert.deepEqual(plain(imported.Data.state.player), { level: 7, xp: 12 });
        assert.equal(JSON.parse(imported.storage.get(SAVE_KEY)).character, character);
    }
});

test("choosing an appearance changes no gameplay fields", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.gold = 901;
    h.Data.state.kills = 17;
    h.Data.state.mob.hp = 42;
    h.Data.state.player = { level: 4, xp: 9 };
    h.Data.state.stat.c = { l: 6, p: 80, c: 900 };
    assert.equal(h.Data.save(plain(h.Data.state)), true);
    const original = gameplay(h.Data.state);
    const choice = plain(h.Data.state);
    choice.character = "male";
    assert.equal(h.Data.save(choice), true);
    assert.equal(h.Data.state.character, "male");
    assert.deepEqual(gameplay(h.Data.state), original);
});

test("invalid characters reject import atomically and cannot replace live progress", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.character = "male";
    h.Data.state.gold = 777;
    assert.equal(h.Data.save(), true);
    const original = h.Data.state;
    const persisted = h.storage.get(SAVE_KEY);
    for (const character of ["other", "Male", "", null, false, 1, {}, []]) {
        const invalid = plain(h.Data.createDefault());
        invalid.character = character;
        assert.equal(h.Data.import(invalid).ok, false);
        assert.equal(h.Data.state, original);
        assert.equal(h.Data.state.character, "male");
        assert.equal(h.Data.state.gold, 777);
        assert.equal(h.storage.get(SAVE_KEY), persisted);
    }
});

test("invalid character saves fail without replacing state or stored bytes", async () => {
    const h = harness();
    await h.Data.ready;
    assert.equal(h.Data.save(), true);
    const original = h.Data.state;
    const persisted = h.storage.get(SAVE_KEY);
    const invalid = plain(original);
    invalid.character = "unknown";
    assert.equal(h.Data.save(invalid), false);
    assert.equal(h.Data.state, original);
    assert.equal(h.storage.get(SAVE_KEY), persisted);
});

test("a missing character is optional while every original v4 field stays required", async () => {
    const h = harness();
    await h.Data.ready;
    const old = plain(h.Data.createDefault());
    delete old.character;
    delete old.hasStarted;
    assert.equal(h.Data.import(old).ok, true);
    assert.equal(h.Data.state.character, "female");
    assert.equal(h.Data.state.hasStarted, true);
    const missingGold = plain(old);
    delete missingGold.gold;
    assert.equal(h.Data.import(missingGold).ok, false);
});

test("reset clears the same gameplay progress and preserves chosen appearance", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.character = "male";
    h.Data.state.hasStarted = true;
    h.Data.state.gold = 12345;
    h.Data.state.player = { level: 12, xp: 20 };
    h.Data.state.kills = 42;
    h.Data.state.gem = 50;
    h.Data.state.token = 10;
    h.Data.state.relic[0] = true;
    assert.equal(h.Data.save(), true);
    assert.equal(h.Data.reset().ok, true);
    assert.equal(h.Data.state.character, "male");
    assert.equal(h.Data.state.hasStarted, true);
    assert.deepEqual(gameplay(h.Data.state), gameplay(h.Data.createDefault()));
    assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).character, "male");
    assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).hasStarted, true);
});

test("fresh intro state is unstarted and explicit lifecycle flags survive save and import", async () => {
    for (const hasStarted of [false, true]) {
        const h = harness();
        await h.Data.ready;
        assert.equal(h.Data.state.hasStarted, false);
        h.Data.state.hasStarted = hasStarted;
        assert.equal(h.Data.save(), true);
        const bytes = h.storage.get(SAVE_KEY);
        const reloaded = harness(bytes);
        await reloaded.Data.ready;
        assert.equal(reloaded.Data.state.hasStarted, hasStarted);
        const imported = harness();
        await imported.Data.ready;
        assert.equal(imported.Data.import(bytes).ok, true);
        assert.equal(imported.Data.state.hasStarted, hasStarted);
    }
});

test("invalid lifecycle flags cannot change progress or stored bytes", async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;
    h.Data.state.gold = 678;
    assert.equal(h.Data.save(), true);
    const original = h.Data.state;
    const persisted = h.storage.get(SAVE_KEY);
    for (const hasStarted of ["true", "false", 0, 1, null, {}, []]) {
        const invalid = plain(h.Data.createDefault());
        invalid.hasStarted = hasStarted;
        assert.equal(h.Data.import(invalid).ok, false);
        assert.equal(h.Data.state, original);
        assert.equal(h.storage.get(SAVE_KEY), persisted);
    }
});

test("reset never marks a fresh intro as already started", async () => {
    const h = harness();
    await h.Data.ready;
    assert.equal(h.Data.state.hasStarted, false);
    assert.equal(h.Data.reset().ok, true);
    assert.equal(h.Data.state.hasStarted, false);
    assert.equal(JSON.parse(h.storage.get(SAVE_KEY)).hasStarted, false);
});

test("prestige retains the chosen teacher and started lifecycle while resetting the adventure", async () => {
    const h = harness();
    await h.Data.ready;
    const catalog = fs.readFileSync(path.join(__dirname, "..", "catalog.js"), "utf8");
    vm.runInContext(catalog, h.context, { filename: "catalog.js" });
    const game = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
    vm.runInContext(game, h.context, { filename: "game.js" });
    vm.runInContext("globalThis.prestige = () => Logic.prestige();", h.context);
    h.Data.state.character = "male";
    h.Data.state.hasStarted = true;
    h.Data.state.min = 7;
    h.Data.state.gold = 1200;
    h.Data.state.kills = 70;
    h.Data.state.token = 2;
    h.Data.state.player = { level: 6, xp: 3 };
    assert.equal(h.Data.save(), true);
    assert.equal(h.context.prestige(), true);
    assert.equal(h.Data.state.character, "male");
    assert.equal(h.Data.state.hasStarted, true);
    assert.equal(h.Data.state.min, 0);
    assert.equal(h.Data.state.gold, 0);
    assert.equal(h.Data.state.kills, 0);
    assert.equal(h.Data.state.token, 9);
    assert.deepEqual(plain(h.Data.state.player), { level: 6, xp: 3 });
    const persisted = JSON.parse(h.storage.get(SAVE_KEY));
    assert.equal(persisted.character, "male");
    assert.equal(persisted.hasStarted, true);
});

test("invalid appearance in an existing save preserves its original bytes for recovery", async () => {
    const fixture = harness();
    const invalid = plain(fixture.Data.createDefault());
    invalid.character = "unrecognized";
    invalid.gold = 555;
    const bytes = JSON.stringify(invalid);
    const h = harness(bytes);
    await h.Data.ready;
    assert.equal(h.Data.getRecovery(), bytes);
    assert.equal(h.Data.save(), false);
    assert.equal(h.storage.get(SAVE_KEY), bytes);
    assert.equal(h.storage.get(SAVE_KEY + ":recovery"), bytes);
});
