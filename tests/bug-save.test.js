"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "save.js"), "utf8");
const KEY = "ys_bugfree_final_v2";
const NOW = 1_700_000_000_000;
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ raw, sharedStorage, browser = false, lock = false, now = NOW, failOwnerWrite = false } = {}) {
    const storage = sharedStorage || new Map(raw === undefined ? [] : [[KEY, raw]]);
    const writes = [];
    const lockRequests = [];
    let readFailure = false;
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const callbacks = new Map();
    const context = vm.createContext({
        console, Date: ClockDate,
        crypto: { randomUUID: () => `audit-${Math.random()}` },
        localStorage: {
            getItem(key) {
                if (readFailure) throw new Error("SecurityError");
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                if (failOwnerWrite && key === `${KEY}:owner`) throw new Error("QuotaExceededError");
                storage.set(key, String(value));
                writes.push({ key, value: String(value) });
            },
            removeItem(key) { storage.delete(key); }
        },
        navigator: lock ? { locks: { request(name, options, callback) {
            return new Promise(resolve => lockRequests.push({ callback, resolve }));
        } } } : {},
        setTimeout, clearTimeout,
        setInterval: () => 1, clearInterval() {}
    });
    if (browser) context.window = {
        addEventListener(type, callback) {
            if (!callbacks.has(type)) callbacks.set(type, []);
            callbacks.get(type).push(callback);
        }
    };
    vm.runInContext(source, context, { filename: "save.js" });
    vm.runInContext("globalThis.api = { Data, GameLimits };", context);
    return {
        ...context.api, context, storage, writes, lockRequests,
        setReadFailure(value) { readFailure = value; },
        emit(type, event) { for (const callback of callbacks.get(type) || []) callback(event); }
    };
}

function fixture() {
    const state = plain(harness().Data.createDefault());
    state.gold = 777;
    return state;
}

test("lease-key failure keeps temporary transactions in memory without writing the shared game save", async () => {
    const old = fixture();
    old.revision = 3;
    const bytes = JSON.stringify(old);
    const h = harness({ raw: bytes, browser: true, failOwnerWrite: true });
    await h.Data.ready;
    try {
        assert.equal(h.Data._mode, "memory");
        assert.equal(h.Data.canWrite, true);
        const next = plain(h.Data.state);
        next.gold = 42;
        assert.equal(h.Data.save(next, { allowMemory: true }), true);
        assert.equal(h.Data.state.gold, 42);
        assert.equal(h.storage.get(KEY), bytes);
        assert.equal(h.writes.filter(write => write.key === KEY).length, 0);
        assert.equal(h.Data.save(), false);
    } finally { h.Data.close(); }
});

test("a Web Lock callback arriving after close cannot resurrect the writer or hold its lock", async () => {
    const h = harness({ browser: true, lock: true });
    assert.equal(h.lockRequests.length, 1);
    h.Data.close();
    const request = h.lockRequests[0];
    const callbackFinished = request.callback({ name: "writer" });
    await Promise.resolve();
    try {
        assert.equal(h.Data.canWrite, false);
        assert.equal(h.Data._releaseLock, null);
        assert.equal(await h.Data.ready, false);
    } finally {
        h.Data.close();
        await callbackFinished;
        request.resolve();
    }
});

test("new corruption discovered during an initial autosave is preserved instead of overwritten", async () => {
    for (const bytes of ["{corrupted later", JSON.stringify({ version: 4, gold: 77, revision: 0 })]) {
        const h = harness();
        await h.Data.ready;
        h.Data.state.gold = 42;
        h.storage.set(KEY, bytes);
        assert.equal(h.Data.save(), false);
        assert.equal(h.storage.get(KEY), bytes);
        assert.equal(h.Data.getRecovery(), bytes);
        assert.equal(h.storage.get(`${KEY}:recovery`), bytes);
        assert.equal(h.Data.state.gold, 42);
        const repaired = fixture();
        repaired.gold = 123;
        assert.equal(h.Data.import(repaired).ok, true);
        assert.equal(h.Data.getRecovery(), null);
        assert.equal(JSON.parse(h.storage.get(KEY)).gold, 123);
        assert.equal(h.storage.get(`${KEY}:recovery`), bytes);
    }
});

test("a transient read failure during ownership acquisition preserves progress already read successfully", async () => {
    const bytes = JSON.stringify(fixture());
    const h = harness({ raw: bytes, browser: true, lock: true });
    assert.equal(h.Data.state.gold, 777);
    h.setReadFailure(true);
    const request = h.lockRequests[0];
    const callbackFinished = request.callback({ name: "writer" });
    await Promise.resolve();
    try {
        assert.equal(h.Data.state.gold, 777);
        const next = plain(h.Data.state);
        next.gold = 800;
        assert.equal(h.Data.save(next, { allowMemory: true }), true);
        assert.equal(h.Data.state.gold, 800);
        assert.equal(h.storage.get(KEY), bytes);
    } finally {
        h.Data.close();
        await callbackFinished;
        request.resolve();
    }
});

test("revision advancement beyond the gameplay counter cap still blocks stale writers", async () => {
    const old = fixture();
    old.revision = 1e9;
    const first = harness({ raw: JSON.stringify(old) });
    const second = harness({ sharedStorage: first.storage });
    await Promise.all([first.Data.ready, second.Data.ready]);
    first.Data.state.gold = 900;
    assert.equal(first.Data.save(), true);
    assert.ok(JSON.parse(first.storage.get(KEY)).revision > old.revision);
    second.Data.state.gold = 0;
    assert.equal(second.Data.save(), false);
    assert.equal(JSON.parse(first.storage.get(KEY)).gold, 900);
    assert.equal(second.Data.state.gold, 900);
});

test("clock rollback preserves remaining buff and boss time and elapsed skill cooldown time", () => {
    const old = fixture();
    const previousClock = NOW + 3600000;
    old.savedAt = old.lastActiveAt = previousClock;
    old.skill = { rush: previousClock - 3000, night: previousClock - 7000 };
    old.buff = { rushUntil: previousClock + 2000, nightUntil: previousClock + 3000 };
    old.mob = { hp: 40, boss: true, deadline: previousClock + 20000 };
    const h = harness({ raw: JSON.stringify(old) });
    assert.equal(h.Data.state.lastActiveAt, NOW);
    assert.equal(h.Data.state.skill.rush, NOW - 3000);
    assert.equal(h.Data.state.skill.night, NOW - 7000);
    assert.equal(h.Data.state.buff.rushUntil, NOW + 2000);
    assert.equal(h.Data.state.buff.nightUntil, NOW + 3000);
    assert.equal(h.Data.state.mob.deadline, NOW + 20000);
    assert.equal(h.Data.state.mob.hp, 40);
});

test("clock rollback keeps an unprocessed hidden interval and does not revive zero timers", () => {
    const old = fixture();
    const previousClock = NOW + 3600000;
    old.savedAt = previousClock;
    old.lastActiveAt = previousClock - 120000;
    old.skill = { rush: 0, night: 0 };
    old.buff = { rushUntil: 0, nightUntil: 0 };
    old.mob.deadline = 0;
    const h = harness({ raw: JSON.stringify(old) });
    assert.equal(h.Data.state.lastActiveAt, NOW - 120000);
    assert.deepEqual(plain(h.Data.state.skill), { rush: 0, night: 0 });
    assert.deepEqual(plain(h.Data.state.buff), { rushUntil: 0, nightUntil: 0 });
    assert.equal(h.Data.state.mob.deadline, 0);
});

test("normal clock and a forward clock retain absolute deadlines and their away anchor", () => {
    const old = fixture();
    old.savedAt = old.lastActiveAt = NOW - 120000;
    old.skill.rush = NOW - 121000;
    old.buff.rushUntil = NOW - 116000;
    old.mob = { hp: 40, boss: true, deadline: NOW - 90000 };
    const h = harness({ raw: JSON.stringify(old) });
    assert.equal(h.Data.state.lastActiveAt, old.lastActiveAt);
    assert.equal(h.Data.state.skill.rush, old.skill.rush);
    assert.equal(h.Data.state.buff.rushUntil, old.buff.rushUntil);
    assert.equal(h.Data.state.mob.deadline, old.mob.deadline);
});

test("legacy clock rollback without savedAt shifts lastDt, skill aliases, buffs, and boss timers together", () => {
    for (const savedAt of [undefined, 0]) {
        const old = fixture();
        old.version = 2;
        const previousClock = NOW + 3600000;
        delete old.lastActiveAt;
        if (savedAt === undefined) delete old.savedAt;
        else old.savedAt = savedAt;
        old.lastDt = previousClock;
        old.skill = { r: previousClock - 3000, n: previousClock - 7000 };
        old.buff = { rushUntil: previousClock + 2000, nightUntil: previousClock + 3000 };
        old.mob = { hp: 40, boss: true, deadline: previousClock + 20000 };
        const h = harness({ raw: JSON.stringify(old) });
        assert.equal(h.Data.state.lastActiveAt, NOW);
        assert.equal(h.Data.state.skill.rush, NOW - 3000);
        assert.equal(h.Data.state.buff.rushUntil, NOW + 2000);
        assert.equal(h.Data.state.mob.deadline, NOW + 20000);
        assert.equal(h.Data.state.gold, 777);
    }
});

test("a played v4 memory-only backup with savedAt zero imports correct skill and boss durations on an earlier clock", async () => {
    const backup = fixture();
    const exportedClock = NOW + 3600000;
    backup.hasStarted = true;
    backup.lastActiveAt = exportedClock;
    backup.savedAt = 0;
    backup.skill = { rush: exportedClock - 3000, night: exportedClock - 7000 };
    backup.buff = { rushUntil: exportedClock + 2000, nightUntil: exportedClock + 3000 };
    backup.mob = { hp: 40, boss: true, deadline: exportedClock + 20000 };
    const h = harness();
    await h.Data.ready;
    assert.equal(h.Data.import(backup).ok, true);
    assert.equal(h.Data.state.lastActiveAt, NOW);
    assert.equal(h.Data.state.skill.rush, NOW - 3000);
    assert.equal(h.Data.state.skill.night, NOW - 7000);
    assert.equal(h.Data.state.mob.deadline, NOW + 20000);
    assert.deepEqual(plain(h.Data.state.buff), { rushUntil: 0, nightUntil: 0 });
    assert.equal(h.Data.state.gold, 777);
    assert.equal(h.Data.state.hasStarted, true);
});

test("the maximum safe revision fails without recycling a revision or changing stored progress", async () => {
    const old = fixture();
    old.revision = Number.MAX_SAFE_INTEGER;
    const bytes = JSON.stringify(old);
    const h = harness({ raw: bytes });
    await h.Data.ready;
    const next = plain(h.Data.state);
    next.gold = 0;
    assert.equal(h.Data.save(next), false);
    assert.equal(h.storage.get(KEY), bytes);
    assert.equal(h.Data.state.gold, 777);
});

test("malformed or far-future leases cannot permanently block fallback ownership", async () => {
    for (const lease of [
        { owner: "other", expiresAt: NOW + 3600000 },
        { owner: "other", expiresAt: "9999999999999999" },
        { owner: "other", expiresAt: null },
        { owner: 7, expiresAt: NOW + 6000 }
    ]) {
        const storage = new Map([[`${KEY}:owner`, JSON.stringify(lease)]]);
        const h = harness({ sharedStorage: storage, browser: true });
        await h.Data.ready;
        try { assert.equal(h.Data.canWrite, true); }
        finally { h.Data.close(); }
    }
});

test("a legitimate unexpired fallback lease still protects its current owner", async () => {
    const storage = new Map([[`${KEY}:owner`, JSON.stringify({ owner: "other", expiresAt: NOW + 6000 })]]);
    const h = harness({ sharedStorage: storage, browser: true });
    await h.Data.ready;
    assert.equal(h.Data.canWrite, false);
    h.Data.close();
    assert.equal(JSON.parse(storage.get(`${KEY}:owner`)).owner, "other");
});

test("malformed or future handoff requests never release a live writer, while a valid request works", async () => {
    const h = harness({ browser: true, lock: true });
    const request = h.lockRequests[0];
    const callbackFinished = request.callback({ name: "writer" });
    await h.Data.ready;
    try {
        for (const invalid of [
            { requestedAt: NOW },
            { owner: null, requestedAt: NOW },
            { owner: "other", requestedAt: NOW + 60000 },
            { owner: "other", requestedAt: "not-a-time" },
            { owner: "other", requestedAt: NOW - 60000 }
        ]) {
            h.emit("storage", { key: `${KEY}:request`, newValue: JSON.stringify(invalid) });
            assert.equal(h.Data.canWrite, true);
        }
        h.emit("storage", { key: `${KEY}:request`, newValue: JSON.stringify({ owner: "other", requestedAt: NOW }) });
        assert.equal(h.Data.canWrite, false);
    } finally {
        h.Data.close();
        await callbackFinished;
        request.resolve();
    }
});
