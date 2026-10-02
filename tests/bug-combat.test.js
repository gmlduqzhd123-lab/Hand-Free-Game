'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const NOW = 1_700_000_000_000;
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
    let now = NOW;
    let confirmation = () => true;
    const storage = new Map();
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const context = vm.createContext({
        console, Date: ClockDate, navigator: {}, performance: { now: () => now - NOW },
        crypto: { randomUUID: () => 'combat-bug-audit' },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        confirm: () => confirmation(),
        Sys: { toast() {}, shake() {}, sfx: new Proxy({}, { get: () => () => {} }) },
        UI: new Proxy({}, { get: () => () => {} }),
        VFX: { add() {}, cvs: { width: 480, height: 320 } }
    });
    for (const file of ['save.js', 'catalog.js', 'game.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
    }
    vm.runInContext('globalThis.api = { Data, GameLimits, Catalog, Ach, Logic, Combat, Simulation };', context);
    return {
        ...context.api, context, storage,
        setNow(value) { now = value; },
        onConfirm(callback) { confirmation = callback; }
    };
}

test('a reached kill milestone remains claimable when a boss later expires in the same catch-up interval', () => {
    const h = harness();
    for (const [threshold, achievement] of [[100, 23], [300, 24]]) {
        for (const offline of [false, true]) {
            const state = h.Data.createDefault();
            state.kills = threshold - 1;
            state.min = threshold / 10 - 1;
            state.mob.hp = 1;
            const result = h.Simulation.simulate(state, NOW, NOW + 35_000, { offline });
            assert.equal(result.bossSpawned, 1);
            assert.equal(result.bossExpired, 1);
            assert.equal(state.kills, threshold - 1);
            assert.equal(h.Ach.isReady(achievement, state), true, `${threshold} kills reached before the expired boss`);
            assert.equal(h.Ach.canClaim(achievement, state), true);
        }
    }
});

test('the original time relic adds its promised ten seconds to an already active boss', async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.kills = 100;
    h.Data.state.min = 10;
    h.Data.state.gem = 10;
    h.Data.state.relic.fill(true);
    h.Data.state.relic[3] = false;
    h.Data.state.extraRelics.fill(true);
    h.Data.state.extraRelics[14] = h.Data.state.extraRelics[15] = false;
    h.Simulation.spawn(h.Data.state, true, NOW);
    const before = h.Data.state.mob.deadline;
    assert.equal(h.Logic.pullGacha(() => 0), true);
    assert.equal(h.Data.state.relic[3], true);
    assert.equal(h.Data.state.mob.deadline, before + 10_000);
    assert.equal(h.Logic.bossMax, 40);
    assert.equal(h.Logic.bossTime, 40);
});

test('approving prestige settles time spent in the confirmation before preserving teacher growth', async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.min = 1;
    const expected = plain(h.Data.state);
    h.Simulation.simulate(expected, NOW, NOW + 60_000);
    h.onConfirm(() => { h.setNow(NOW + 60_000); return true; });
    assert.equal(h.Logic.prestige(), true);
    assert.deepEqual(plain(h.Data.state.player), plain(expected.player));
    assert.equal(h.Data.state.xpRemainder, expected.xpRemainder);
    assert.equal(h.Data.state.token, expected.min);
    assert.equal(h.Data.state.lastActiveAt, NOW + 60_000);
});

test('an extended confirmation cannot reset a now-ineligible adventure for zero tokens', async () => {
    const h = harness();
    await h.Data.ready;
    h.Data.state.kills = 100;
    h.Data.state.min = 1;
    h.Data.state.gold = 321;
    h.Simulation.spawn(h.Data.state, true, NOW);
    h.onConfirm(() => { h.setNow(NOW + 31_000); return true; });
    assert.equal(h.Logic.prestige(), false);
    assert.equal(h.Data.state.min, 0);
    assert.equal(h.Data.state.token, 0);
    assert.ok(h.Data.state.gold >= 321);
    assert.equal(h.Data.state.kills, 99);
});

test('rush, guaranteed criticals, XP equipment, and boss deadlines agree across normal frame sizes', () => {
    const h = harness();
    const initial = h.Data.createDefault();
    initial.kills = 99;
    initial.min = 9;
    initial.mob.hp = 1;
    initial.stat.c.p = 1000;
    initial.stat.a.p = 200;
    initial.skill.rush = NOW;
    initial.buff.rushUntil = NOW + 5000;
    initial.buff.nightUntil = NOW + 10_000;
    initial.items['reading-lamp'] = 1;
    const reference = plain(initial);
    const result = h.Simulation.simulate(reference, NOW, NOW + 35_000, { random: () => 0.99 });
    for (const frameMs of [16, 33, 80, 200, 1000, 5000]) {
        const state = plain(initial);
        let rushHits = 0;
        for (let at = NOW; at < NOW + 35_000; at += frameMs) {
            rushHits += h.Simulation.simulate(state, at, Math.min(NOW + 35_000, at + frameMs), { random: () => 0.99 }).rushHits;
        }
        assert.equal(rushHits, result.rushHits, `${frameMs}ms rush frequency`);
        for (const field of ['kills', 'min', 'gold', 'gem', 'bossKills', 'mob', 'player', 'extraAchReady', 'xpBonusRemainder']) {
            assert.deepEqual(plain(state[field]), plain(reference[field]), `${frameMs}ms ${field}`);
        }
        assert.ok(Math.abs(state.xpRemainder - reference.xpRemainder) < 0.000001);
        assert.ok(Math.abs(state.autoRemainder - reference.autoRemainder) < 0.000001);
    }
});

test('changing the running clock backwards preserves remaining skills and boss time without paying extra XP', async () => {
    for (const entry of ['advance', 'manual']) {
        const h = harness();
        await h.Data.ready;
        h.Data.state.kills = 100;
        h.Data.state.min = 10;
        h.Data.state.skill.rush = h.Data.state.skill.night = NOW;
        h.Data.state.buff.rushUntil = NOW + 5000;
        h.Data.state.buff.nightUntil = NOW + 10_000;
        h.Simulation.spawn(h.Data.state, true, NOW);
        h.setNow(NOW + 2000);
        h.Logic.advance(NOW, NOW + 2000, { silent: true, render: false });
        assert.equal(h.Data.save(), true);
        const growth = plain(h.Data.state.player);
        const clock = NOW + 2000 - 3_600_000;
        h.setNow(clock);
        if (entry === 'advance') {
            assert.equal(h.Logic.rebaseClock(clock), true);
            h.Logic.advance(h.Data.state.lastActiveAt, clock, { silent: true, render: false });
        }
        else h.Combat.attack();
        assert.equal(h.Data.state.lastActiveAt, clock, entry);
        assert.deepEqual(plain(h.Data.state.player), growth, entry);
        assert.equal(h.Data.state.mob.deadline, clock + 28_000, entry);
        assert.equal(h.Data.state.buff.rushUntil, clock + 3000, entry);
        assert.equal(h.Data.state.buff.nightUntil, clock + 8000, entry);
        assert.equal(h.Data.state.skill.rush, clock - 2000, entry);
        assert.equal(h.Data.state.savedAt, clock, entry);
        assert.equal(h.Data.save(), true);
        assert.equal(h.Data.state.mob.deadline, clock + 28_000, 'saving must not apply a second offset');
        assert.equal(h.Simulation.getCriticalChance(h.Data.state, clock + 7999), 100);
        assert.equal(h.Simulation.getCriticalChance(h.Data.state, clock + 8000), 0);
        h.setNow(clock + 57_999);
        assert.equal(h.Combat.useSkill('rush'), false);
        h.setNow(clock + 58_000);
        assert.equal(h.Combat.useSkill('rush'), true);
    }
});
