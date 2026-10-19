'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const NOW = 1_700_000_000_000;
const SAVE_KEY = 'ys_bugfree_final_v2';
const plain = value => JSON.parse(JSON.stringify(value));

function createHarness({ raw, failure = null, hidden = false, playing = true, dialogOpen = false } = {}) {
    let now = NOW;
    let storageFailure = failure;
    let docHidden = hidden;
    let appPlaying = playing;
    let modalOpen = dialogOpen;
    const storage = new Map(raw === undefined ? [] : [[SAVE_KEY, raw]]);
    const messages = [];
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const context = vm.createContext({
        console,
        Date: ClockDate,
        performance: { now: () => now - NOW },
        navigator: {},
        crypto: { randomUUID: () => 'prd-v5-test-tab' },
        document: {
            get hidden() { return docHidden; },
            getElementById: () => ({ classList: { toggle() {}, add() {}, remove() {} } }),
            querySelector: sel => (modalOpen && sel.includes('open') ? {} : null)
        },
        GameApp: {
            get playing() { return appPlaying; },
            isModalBlockingAutomation() { return modalOpen; }
        },
        localStorage: {
            getItem(key) {
                if (storageFailure === 'read') throw new Error('Storage read blocked');
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                if (storageFailure === 'write') throw new Error('QuotaExceededError');
                storage.set(key, String(value));
            },
            removeItem(key) {
                if (storageFailure === 'write') throw new Error('Storage write blocked');
                storage.delete(key);
            }
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        confirm: () => true,
        Sys: {
            toast: msg => messages.push(msg),
            shake() {},
            sfx: new Proxy({}, { get: () => () => {} })
        },
        UI: new Proxy({}, { get: () => () => {} }),
        VFX: { add() {}, cvs: { width: 480, height: 240 } },
        $: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } })
    });

    for (const file of ['save.js', 'catalog.js', 'adventure.js', 'game.js', 'progression.js', 'automation.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
    }
    vm.runInContext('globalThis.api = { Data, GameLimits, Catalog, Adventure, Ach, Logic, Combat, Simulation, Progression, AutomationEngine };', context);
    return {
        ...context.api,
        storage,
        messages,
        setNow(val) { now = val; },
        setFailure(val) { storageFailure = val; },
        setHidden(val) { docHidden = val; },
        setPlaying(val) { appPlaying = val; },
        setModalOpen(val) { modalOpen = val; }
    };
}

test('Stage 0 & FR05/FR06: v1-v4 migration preserves v4 backup, combat math, and derives only verifiable checkpoints', async () => {
    const base = createHarness();
    await base.Data.ready;
    const defaultClick = base.Simulation.getClickDamage(base.Data.state);
    const defaultAuto = base.Simulation.getAutoDamage(base.Data.state);

    const v4 = plain(base.Data.createDefault());
    v4.version = 4;
    v4.kills = 205; // passed 100 and 200 bosses in current run
    v4.bossKills = 15; // high cumulative boss kills must NOT unlock 300/400 locations
    v4.min = 50; // high min alone must NOT unlock 300/400 locations
    v4.hasStarted = true;
    v4.skill.rush = NOW - 20_000;
    for (const key of ['onboarding', 'preferences', 'automation', 'adventure', 'bossControl', 'extraCompanions', 'companionLoadout', 'companionPresets', 'cosmetics', 'trackedGoals', 'skillTimers', 'recentReports']) {
        delete v4[key];
    }
    const rawV4 = JSON.stringify(v4);
    const h = createHarness({ raw: rawV4 });
    await h.Data.ready;

    assert.equal(h.Data.state.version, 5);
    assert.equal(h.storage.get(`${SAVE_KEY}:v4-backup`), rawV4, 'pre-v5 raw backup must be stored before v5 save');
    assert.equal(h.Simulation.getClickDamage(h.Data.state), defaultClick, 'initial click damage must match v4');
    assert.equal(h.Simulation.getAutoDamage(h.Data.state), defaultAuto, 'initial auto damage must match v4');
    assert.deepEqual(plain(h.Data.state.companionLoadout), ['na', 'yu']);
    assert.deepEqual(plain(h.Data.state.adventure.clearedBossCheckpoints), [100, 200]);
    assert.deepEqual(plain(h.Data.state.adventure.unlockedLocations), ['classroom', 'library', 'science']);
    assert.equal(h.Data.state.extraCompanions.library.unlocked, true);
    assert.equal(h.Data.state.extraCompanions.science.unlocked, true);
    assert.equal(h.Data.state.extraCompanions.music.unlocked, false, 'cumulative bossKills must not unlock 300 checkpoint companion');
    assert.equal(h.Data.state.extraCompanions.tidy.unlocked, false);
    assert.equal(h.Data.state.skillTimers.rushReadyAt, NOW + 40_000, 'active cooldown must be preserved on migration');
    assert.equal(h.Data.state.onboarding.completed, true, 'existing started save skips initial onboarding automatically');
});

test('FR02: quotePurchase is side-effect free, matches applyPurchase for 1/10/max, and respects crit 50% cap', async () => {
    const h = createHarness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;

    // Exact boundary: gold = cost - 1, cost, cost + 1000
    h.Data.state.gold = 49;
    const beforeSnapshot = plain(h.Data.state);
    const unaffordable = h.Progression.quotePurchase(h.Data.state, 'click', '1');
    assert.equal(unaffordable.canBuy, false);
    assert.equal(unaffordable.actualCount, 0);
    assert.equal(unaffordable.nextCost, 50);
    assert.equal(unaffordable.shortfall, 1);
    assert.deepEqual(plain(h.Data.state), beforeSnapshot, 'quotePurchase must never mutate live state');

    h.Data.state.gold = 50;
    const exactOne = h.Progression.quotePurchase(h.Data.state, 'click', '1');
    assert.equal(exactOne.canBuy, true);
    assert.equal(exactOne.actualCount, 1);
    assert.equal(exactOne.totalCost, 50);
    assert.equal(h.Logic.upgrade('click', '1'), true);
    assert.equal(h.Data.state.gold, 0);
    assert.equal(h.Data.state.stat.c.l, exactOne.afterLevel);
    assert.equal(h.Simulation.getClickDamage(h.Data.state), exactOne.after.clickDamage);

    // Bulk buy 10 and max near item level 25 cap
    h.Data.state.gold = 1e12;
    h.Data.state.items['fairy-clock'] = 22; // 3 levels left to max 25
    const quote10NearCap = h.Progression.quotePurchase(h.Data.state, 'item:fairy-clock', '10');
    assert.equal(quote10NearCap.actualCount, 3, '10x purchase near cap must stop at maxLevel 25');
    const applied = h.Progression.applyPurchase('item:fairy-clock', '10');
    assert.equal(applied.count, 3);
    assert.equal(h.Data.state.items['fairy-clock'], 25);
    assert.equal(h.Simulation.getAutoDamage(h.Data.state), quote10NearCap.after.autoDamage);

    // Base crit cap 50% vs temporary night 100% buff
    h.Data.state.stat.crit.p = 45;
    h.Data.state.items['star-glasses'] = 20; // +3%p
    h.Data.state.items['praise-ribbon'] = 10; // +2%p -> total base crit = 50%
    h.Data.state.buff.nightUntil = NOW + 5000;
    const critQuote = h.Progression.quotePurchase(h.Data.state, 'crit', '1');
    assert.equal(critQuote.isMaxed, true);
    assert.equal(critQuote.isCritCapped, true);
    assert.equal(critQuote.canBuy, false);
    assert.ok(!critQuote.summary.includes('최적 전략'));
    assert.ok(critQuote.summary.includes('자동 공격'));

    const rec = h.Progression.recommendUpgrades(h.Data.state, 'idle');
    assert.ok(rec.primary);
    assert.ok(!rec.primary.reason.includes('최적 전략'), 'must never claim unverified 최적 전략');
});

test('FR03: AutomationEngine enforces budgetLimit, reserveGold, foreground/dialog/ownership guards, and atomic persistence', async () => {
    const h = createHarness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;
    h.Data.state.gold = 1000;
    h.Data.state.automation = {
        enabled: true,
        strategy: 'auto-priority',
        targets: ['auto', 'item:fairy-clock', 'item:tidy-broom'],
        cursor: 0,
        budgetLimit: 1000,
        budgetSpent: 900,
        reserveGold: 200,
        allowDuringBossPending: false,
        skills: { rush: 'ready', night: 'ready' },
        lastDecisionAt: 0
    };

    // tidy-broom costs 150, auto costs 100, fairy-clock costs 50.
    // Remaining budget is 1000 - 900 = 100, so 150 cost is blocked, and spending 100 (50 + 100 no, 50 + 67 = 117 > 100)
    // means only fairy-clock (50g) or auto (100g) fits within remaining budget 100!
    const tick1 = h.AutomationEngine.tick(NOW);
    assert.equal(tick1.executed, true);
    assert.ok(h.Data.state.automation.budgetSpent <= 1000, 'budgetSpent must never exceed budgetLimit');
    assert.ok(h.Data.state.gold >= 200, 'gold after auto purchase must stay >= reserveGold');
    assert.deepEqual(plain(tick1.skills), ['rush', 'night'], 'night auto-cast allowed when rush starts in the same decision');

    const spentAfterTick1 = h.Data.state.automation.budgetSpent;
    const goldAfterTick1 = h.Data.state.gold;

    // Rate limit: within 1000ms no new decision
    h.setNow(NOW + 500);
    assert.equal(h.AutomationEngine.tick(NOW + 500).executed, false);

    // Hidden tab guard: no auto actions
    h.setHidden(true);
    h.setNow(NOW + 2000);
    assert.equal(h.AutomationEngine.tick(NOW + 2000).executed, false);
    assert.equal(h.Data.state.automation.budgetSpent, spentAfterTick1);
    h.setHidden(false);

    // Open dialog guard: no auto actions
    h.setModalOpen(true);
    h.setNow(NOW + 3000);
    assert.equal(h.AutomationEngine.tick(NOW + 3000).executed, false);
    h.setModalOpen(false);

    // Storage failure rolls back candidate and stops automation without partial application
    h.Data.state.automation.budgetLimit = 5000;
    h.Data.state.gold = 5000;
    const snapBeforeFail = plain(h.Data.state);
    h.setFailure('write');
    h.setNow(NOW + 5000);
    const failedTick = h.AutomationEngine.tick(NOW + 5000);
    assert.equal(failedTick.executed, false);
    assert.equal(failedTick.error, 'save_failed');
    assert.equal(h.Data.state.gold, snapBeforeFail.gold);
    assert.equal(h.Data.state.automation.budgetSpent, snapBeforeFail.automation.budgetSpent);
    h.setFailure(null);
    h.Data.storageAvailable = true;

    // Prestige preserves budgetSpent; only restartBudget resets budgetSpent to 0
    h.Data.state.min = 10;
    assert.equal(h.Logic.prestige({ skipConfirm: true }), true);
    assert.equal(h.Data.state.automation.budgetSpent, snapBeforeFail.automation.budgetSpent);
    assert.equal(h.AutomationEngine.restartBudget(2500), true);
    assert.equal(h.Data.state.automation.budgetSpent, 0);
    assert.equal(h.Data.state.automation.budgetLimit, 2500);

    // Group targets 'extraComp' and 'items' expand to individual comp:* and item:* entries
    assert.equal(h.AutomationEngine.updateSettings({ targets: ['extraComp', 'items'] }), true);
    assert.ok(h.Data.state.automation.targets.includes('comp:library'), 'extraComp expands to comp:library');
    assert.ok(h.Data.state.automation.targets.includes('item:chalk-spark'), 'items expands to item:chalk-spark');

    // Balanced strategy skips crit-capped items
    h.Data.state.stat.crit = { l: 50, p: 50, c: 300 };
    h.Data.state.gold = 50000;
    h.Data.state.automation.strategy = 'balanced';
    h.Data.state.automation.targets = ['crit', 'click'];
    h.Data.state.automation.budgetLimit = 50000;
    const clickBeforeBalanced = h.Data.state.stat.c.l;
    h.setNow(NOW + 8000);
    const balancedTick = h.AutomationEngine.tick(NOW + 8000);
    assert.equal(balancedTick.executed, true);
    assert.ok(balancedTick.purchases > 0, 'balanced strategy should purchase available uncapped targets');
    assert.equal(h.Data.state.stat.crit.l, 50, 'balanced strategy must skip crit when crit is already capped');
    assert.ok(h.Data.state.stat.c.l > clickBeforeBalanced, 'balanced strategy should level up click instead');
});

test('FR04: Boss prepare mode holds pending state across 60s and 24h, blocks combat/clicks/skills, and records failure snapshot', async () => {
    const h = createHarness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;
    h.Data.state.bossControl.entryMode = 'prepare';
    h.Data.state.kills = 99;
    h.Data.state.min = 9;
    h.Data.state.mob.hp = 1;

    // Normal mob -> pending boss transition in the same simulate call
    const evTransition = h.Simulation.simulate(h.Data.state, NOW, NOW + 5000);
    assert.equal(h.Data.state.kills, 100);
    assert.equal(h.Data.state.mob.boss, true);
    assert.equal(h.Data.state.bossControl.status, 'pending');
    assert.equal(h.Data.state.mob.deadline, 0);
    const bossFullHp = h.Data.state.mob.hp;
    const goldAtPending = h.Data.state.gold;

    // 60s and 24h simulation while pending: XP advances, boss HP and deadline untouched, no kills/gold
    h.Simulation.simulate(h.Data.state, NOW + 5000, NOW + 65_000);
    assert.equal(h.Data.state.bossControl.status, 'pending');
    assert.equal(h.Data.state.mob.hp, bossFullHp);
    assert.equal(h.Data.state.gold, goldAtPending);

    const levelBefore24h = h.Data.state.player.level;
    h.Simulation.simulate(h.Data.state, NOW + 65_000, NOW + 65_000 + 86_400_000, { offline: true });
    assert.equal(h.Data.state.bossControl.status, 'pending');
    assert.equal(h.Data.state.mob.hp, bossFullHp);
    assert.ok(h.Data.state.player.level > levelBefore24h, 'XP continues advancing while boss is pending');

    // Manual attack and new skills are blocked while pending; totalClicks does not increase
    const clicksBefore = h.Data.state.totalClicks;
    const nowPending = NOW + 65_000 + 86_400_000;
    h.setNow(nowPending);
    assert.equal(h.Combat.attack(100, 100, nowPending), false);
    assert.equal(h.Data.state.totalClicks, clicksBefore, 'totalClicks must not increment while boss is pending');
    assert.equal(h.Combat.useSkill('rush', nowPending), false);

    // Start boss challenge atomically; repeated startBoss does not reset deadline or challengeId
    assert.equal(h.Logic.startBoss(nowPending), true);
    assert.equal(h.Data.state.bossControl.status, 'active');
    const challengeId = h.Data.state.bossControl.challengeId;
    const deadline = h.Data.state.mob.deadline;
    assert.ok(deadline > nowPending);
    assert.equal(h.Logic.startBoss(nowPending + 5000), false);
    assert.equal(h.Data.state.bossControl.challengeId, challengeId);
    assert.equal(h.Data.state.mob.deadline, deadline);

    // Predict boss does not mutate state or challengeId
    const stateBeforePredict = plain(h.Data.state);
    const pred = h.Progression.predictBoss(h.Data.state, nowPending);
    assert.ok(pred);
    assert.deepEqual(plain(h.Data.state), stateBeforePredict);

    // Let boss expire and verify failure analysis snapshot
    h.setNow(deadline + 1000);
    h.Logic.catchUp(deadline + 1000);
    assert.equal(h.Data.state.kills, 99, 'boss failure rolls back kills by 1');
    assert.equal(h.Data.state.min, 9, 'boss failure rolls back min by 1');
    const analysis = h.Progression.analyzeBossFailure(h.Data.state);
    assert.ok(analysis);
    assert.equal(analysis.maxHp, bossFullHp);
    assert.ok(analysis.remainingHp > 0 && analysis.remainingHp <= bossFullHp);
});

test('FR05, FR06, FR07: Checkpoints unlock locations, companions, synergies, timers, and cosmetics without affecting combat math on cosmetic swap', async () => {
    const h = createHarness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;
    h.Data.state.stat.a = { l: 50, p: 1e12, c: 1000 };

    // Defeat 100, 200, 300, 400 bosses sequentially
    for (const cp of [100, 200, 300, 400]) {
        h.Data.state.kills = cp;
        h.Data.state.min = cp / 10;
        h.Simulation.spawn(h.Data.state, true, NOW);
        const ev = h.Simulation.events();
        h.Simulation.damage(h.Data.state, 1e30, NOW, ev);
        assert.ok(h.Data.state.adventure.clearedBossCheckpoints.includes(cp));
    }

    assert.deepEqual(plain(h.Data.state.adventure.unlockedLocations), ['classroom', 'library', 'science', 'gym', 'gate']);
    assert.equal(h.Data.state.adventure.currentLocation, 'gate');
    for (const compId of ['library', 'science', 'music', 'tidy']) {
        assert.equal(h.Data.state.extraCompanions[compId].unlocked, true);
    }

    // Upgrade library + tidy to Lv.1 and equip them -> +6%p XP and +6%p gold (1% personal + 5% synergy)
    h.Data.state.gold = 1e9;
    assert.equal(h.Logic.upgradeExtraCompanion('library', '1'), true);
    assert.equal(h.Logic.upgradeExtraCompanion('tidy', '1'), true);
    assert.equal(h.Logic.setCompanionLoadout(['library', 'tidy'], NOW), true);
    const bonuses = h.Adventure.bonuses(h.Data.state);
    assert.equal(bonuses.xpBonus, 0.06);
    assert.equal(bonuses.goldBonus, 0.06);
    assert.equal(bonuses.synergy.active, true);

    // Music cooldown snapshot: upgrade music to Lv.10 (-10% cooldown) and equip music + science
    assert.equal(h.Logic.upgradeExtraCompanion('music', '10'), true);
    assert.equal(h.Logic.setCompanionLoadout(['music', 'science'], NOW), true);
    assert.equal(h.Combat.useSkill('rush', NOW), true);
    assert.equal(h.Data.state.skillTimers.rushReadyAt, NOW + 54_000, '10% reduction snapshots readyAt at NOW + 54s');

    // Swapping music out does NOT change the already-started rushReadyAt timer
    assert.equal(h.Logic.setCompanionLoadout(['na', 'yu'], NOW), true);
    assert.equal(h.Adventure.getSkillReadyAt(h.Data.state, 'rush'), NOW + 54_000);

    // Upgrading science from Lv.0 -> Lv.1 while music+science are equipped during an active boss adds only delta (+2.2s = 2200ms)
    assert.equal(h.Logic.setCompanionLoadout(['music', 'science'], NOW), true);
    h.Data.state.kills = 100;
    h.Simulation.spawn(h.Data.state, true, NOW);
    const deadlineBefore = h.Data.state.mob.deadline;
    assert.equal(h.Logic.setCompanionLoadout(['na', 'yu'], NOW), false, 'cannot swap companions during active boss');
    assert.equal(h.Logic.upgradeExtraCompanion('science', '1'), true);
    assert.equal(h.Data.state.mob.deadline, deadlineBefore + 2200, 'Lv.0->1 science with musicLv.10 adds +0.2s personal + 2.0s synergy once');

    // Cosmetics: equipping unlocked cosmetics preserves all combat stats
    const clickBeforeCos = h.Simulation.getClickDamage(h.Data.state);
    const autoBeforeCos = h.Simulation.getAutoDamage(h.Data.state);
    assert.equal(h.Logic.equipCosmetics({
        outfit: 'outfit-cape',
        accessory: 'accessory-notebook',
        wand: 'wand-rainbow',
        background: 'bg-festival',
        decor: 'decor-trophy'
    }), true);
    assert.equal(h.Simulation.getClickDamage(h.Data.state), clickBeforeCos);
    assert.equal(h.Simulation.getAutoDamage(h.Data.state), autoBeforeCos);
});

test('FR08, FR09, FR10: Ach.claimAll atomic payout, settleAway 24h cap & no double payout, and buildPrestigePlan freshness', async () => {
    const h = createHarness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;
    h.Data.state.kills = 15;
    h.Data.state.player.level = 6;
    h.Ach.evaluate(h.Data.state);

    const gemsBefore = h.Data.state.gem;
    const claimedCount = h.Ach.claimAll();
    assert.equal(claimedCount, 2, 'kills>=10 (5 gems) and level>=5 (5 gems) claimed at once');
    assert.equal(h.Data.state.gem, gemsBefore + 10);
    assert.equal(h.Ach.claimAll(), false, 'second claimAll pays nothing');

    // Pin goals
    assert.equal(h.Progression.toggleTrackedGoal(0), true);
    assert.equal(h.Progression.toggleTrackedGoal(1), true);
    assert.equal(h.Progression.toggleTrackedGoal(2), true);
    assert.equal(h.Progression.toggleTrackedGoal(3), false, 'max 3 tracked goals');

    // FR09: 30-hour away interval caps at 24h and does not pay the remaining 6h on next reconnect
    const startAt = NOW;
    h.Data.state.lastActiveAt = startAt;
    h.Data.save();
    const returnAt = startAt + 30 * 3600 * 1000;
    h.setNow(returnAt);
    const settled1 = h.Progression.settleAway(returnAt, { notify: false, render: false });
    assert.equal(settled1.settled, true);
    assert.equal(settled1.report.rawElapsedMs, 30 * 3600 * 1000);
    assert.equal(settled1.report.appliedElapsedMs, 24 * 3600 * 1000);
    assert.equal(settled1.report.capped, true);
    const goldAfterSettle = h.Data.state.gold;

    // Re-running settleAway at the same timestamp pays 0 and keeps the prepared report
    const settled2 = h.Progression.settleAway(returnAt, { notify: false, render: false });
    assert.equal(settled2.settled, false);
    assert.equal(h.Data.state.gold, goldAfterSettle);
    assert.equal(settled2.report.id, settled1.report.id);

    // FR10: Prestige preview plan detects state changes (e.g., boss expiration) before final confirmation
    h.Data.state.kills = 100;
    h.Data.state.min = 10;
    h.Simulation.spawn(h.Data.state, true, returnAt);
    const previewPlan = h.Progression.buildPrestigePlan(h.Data.state);
    assert.equal(previewPlan.gainTokens, 10);

    // Time passes and boss expires while user is looking at preview dialog
    const afterExpire = h.Data.state.mob.deadline + 1000;
    h.setNow(afterExpire);
    const prestigeAttempt = h.Logic.prestige({
        skipConfirm: true,
        expectedSignature: previewPlan.signature,
        expectedGainTokens: previewPlan.gainTokens
    });
    assert.equal(typeof prestigeAttempt, 'object');
    assert.equal(prestigeAttempt.needsReconfirm, true);
    assert.equal(prestigeAttempt.plan.gainTokens, 9, 'updated plan reflects boss rollback to 9 tokens');

    // Confirming with updated signature succeeds and assigns new runId
    const confirmed = h.Logic.prestige({
        skipConfirm: true,
        expectedSignature: prestigeAttempt.plan.signature,
        expectedGainTokens: prestigeAttempt.plan.gainTokens
    });
    assert.equal(confirmed, true);
    assert.equal(h.Data.state.adventure.runId, 'run-2');
    assert.deepEqual(plain(h.Data.state.trackedGoals), [0, 1, 2], 'tracked goals persist across prestige');
});

test('Stage 3 Final Verification: 24h away settlement performance benchmark, 256KiB export bound, and PWA subpath assets', async () => {
    const h = createHarness();
    await h.Data.ready;
    h.Data.state.hasStarted = true;
    h.Data.state.stat.a.l = 12;
    h.Data.state.stat.a.p = 95;
    h.Data.state.comp.na.l = 5;
    h.Data.state.comp.na.p = 75;
    h.Data.state.lastActiveAt = NOW;
    h.Data.save();

    const baseState = JSON.parse(JSON.stringify(h.Data.state));
    const endAt = NOW + 24 * 3600 * 1000;

    // Warm up JIT once before timing
    h.Simulation.simulate(JSON.parse(JSON.stringify(baseState)), NOW, endAt, { offline: true });

    const t0 = performance.now();
    const baseExpected = JSON.parse(JSON.stringify(baseState));
    h.Simulation.simulate(baseExpected, NOW, endAt, { offline: true });
    const baselineMs = Math.max(1, performance.now() - t0);

    h.Data.state = JSON.parse(JSON.stringify(baseState));
    h.Data.save();
    h.setNow(endAt);
    const t1 = performance.now();
    const settled = h.Progression.settleAway(endAt, { notify: false, render: false });
    const v5Ms = Math.max(1, performance.now() - t1);

    assert.equal(settled.settled, true);
    assert.equal(h.Data.state.gold, baseExpected.gold, '24h settleAway matches baseline gold');
    assert.equal(h.Data.state.kills, baseExpected.kills, '24h settleAway matches baseline kills');
    assert.deepEqual(plain(h.Data.state.player), plain(baseExpected.player), '24h settleAway matches baseline player level/xp');
    assert.ok(v5Ms <= Math.max(baselineMs * 2, baselineMs + 80) && v5Ms < 1500,
        `24h settleAway (${v5Ms.toFixed(1)}ms) must remain within 2x of baseline (${baselineMs.toFixed(1)}ms)`);

    // Populate maximum 10 away reports and check exported payload size <= 256KiB
    for (let i = 0; i < 12; i++) {
        const stepStart = endAt + i * 120_000;
        const stepEnd = stepStart + 90_000;
        h.Data.state.lastActiveAt = stepStart;
        h.setNow(stepEnd);
        h.Progression.settleAway(stepEnd, { notify: false, render: false });
    }
    assert.equal(h.Data.state.recentReports.length, 10, 'recentReports capped at 10 entries');
    const serializedJson = JSON.stringify(h.Data.state);
    const encodedBackup = Buffer.from(encodeURIComponent(serializedJson), 'utf8').toString('base64');
    assert.ok(Buffer.byteLength(serializedJson, 'utf8') <= 256 * 1024, 'JSON save stays well under 256KiB');
    assert.ok(Buffer.byteLength(encodedBackup, 'utf8') <= 256 * 1024, 'Base64 export stays well under 256KiB');

    // Verify manifest.webmanifest and sw.js APP_SHELL for /Hand-Free-Game/ subpath & offline readiness
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.id, '/Hand-Free-Game/');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');

    const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const match = swSource.match(/const APP_SHELL\s*=\s*(\[[\s\S]*?\]);/);
    assert.ok(match, 'sw.js must define APP_SHELL');
    const appShell = vm.runInNewContext(match[1]);
    for (const reqScript of ['./adventure.js', './progression.js', './automation.js', './experience-ui.js', './save.js', './game.js', './app.js']) {
        assert.ok(appShell.includes(reqScript), `sw.js APP_SHELL must include ${reqScript}`);
    }
    for (const relPath of appShell) {
        assert.ok(relPath.startsWith('./'), `APP_SHELL entry must be relative for subpath deployment: ${relPath}`);
        if (relPath !== './') {
            const diskPath = path.join(ROOT, relPath.slice(2));
            assert.ok(fs.existsSync(diskPath), `APP_SHELL asset must exist on disk: ${relPath}`);
        }
    }
});

