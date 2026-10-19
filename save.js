'use strict';

/* Save version 5 keeps the existing storage key and migrates older backups (v1-v4). */
const GameLimits = Object.freeze({
    MAX_NUMBER: 1e100,
    MAX_LEVEL: 1000,
    MAX_COUNTER: 1e9,
    MAX_REVISION: Number.MAX_SAFE_INTEGER,
    MAX_ITEM_LEVEL: 25,
    ITEM_IDS: Object.freeze([
        'chalk-spark', 'star-pointer', 'storybook', 'rainbow-stamp', 'pencil-wand', 'lesson-bell',
        'fairy-clock', 'tidy-broom', 'cloud-robot', 'paper-bird', 'music-box', 'classroom-garden',
        'reading-lamp', 'wisdom-book', 'note-bag', 'learning-badge',
        'coin-pouch', 'honey-lunchbox', 'treasure-map', 'lucky-plant',
        'star-glasses', 'praise-ribbon', 'sand-timer', 'calm-tea'
    ]),
    LOCATION_IDS: Object.freeze(['classroom', 'library', 'science', 'gym', 'gate']),
    BOSS_CHECKPOINTS: Object.freeze([100, 200, 300, 400]),
    LEGACY_COMPANION_IDS: Object.freeze(['na', 'yu']),
    EXTRA_COMPANION_IDS: Object.freeze(['library', 'science', 'music', 'tidy']),
    COMPANION_IDS: Object.freeze(['na', 'yu', 'library', 'science', 'music', 'tidy']),
    EXTRA_COMPANION_MAX_LEVELS: Object.freeze({ library: 25, science: 25, music: 20, tidy: 25 }),
    EXTRA_COMPANION_BASE_COSTS: Object.freeze({ library: 5000, science: 8000, music: 10000, tidy: 12000 }),
    COSMETIC_SLOTS: Object.freeze(['outfit', 'accessory', 'wand', 'background', 'decor']),
    COSMETIC_DEFAULTS: Object.freeze({
        outfit: 'outfit-default',
        accessory: 'accessory-none',
        wand: 'wand-default',
        background: 'bg-default',
        decor: 'decor-none'
    }),
    COSMETIC_IDS: Object.freeze({
        outfit: Object.freeze(['outfit-default', 'outfit-vest', 'outfit-cape']),
        accessory: Object.freeze(['accessory-none', 'accessory-mug', 'accessory-notebook']),
        wand: Object.freeze(['wand-default', 'wand-star', 'wand-rainbow']),
        background: Object.freeze(['bg-default', 'bg-sunset', 'bg-festival']),
        decor: Object.freeze(['decor-none', 'decor-plant', 'decor-trophy'])
    }),
    AUTOMATION_STRATEGIES: Object.freeze(['hold', 'auto-priority', 'balanced']),
    SKILL_MODES: Object.freeze(['manual', 'ready', 'boss']),
    PURCHASE_QUANTITIES: Object.freeze(['1', '10', 'max']),
    PLAY_STYLES: Object.freeze(['idle', 'active']),
    BOSS_ENTRY_MODES: Object.freeze(['auto', 'prepare']),
    BOSS_STATES: Object.freeze(['none', 'pending', 'active']),
    MAX_TRACKED_GOALS: 3,
    MAX_RECENT_REPORTS: 10,
    MAX_ACHIEVEMENT_ID: 29,
    STORY_IDS: Object.freeze([
        'enter-classroom', 'clear-100', 'enter-library', 'clear-200', 'enter-science',
        'clear-300', 'enter-gym', 'clear-400', 'enter-gate'
    ]),
    XP_PER_SECOND: 5,
    xpForLevel(level) { return 20 + (Math.max(1, Math.min(this.MAX_LEVEL, Math.floor(level))) - 1) * 10; },
    finite(value, fallback = 0, maximum = 1e100) {
        if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
        return Math.min(maximum, Math.max(0, value));
    },
    saturate(value, maximum = 1e100) { return this.finite(value, 0, maximum); },
    add(left, right) { return this.finite(this.finite(left) + this.finite(right)); },
    multiply(left, right) { return this.finite(this.finite(left) * this.finite(right)); },
    pow(base, exponent) {
        const result = Math.pow(this.finite(base), this.finite(exponent));
        return this.finite(result);
    }
});

const AUTOMATION_TARGET_SET = new Set([
    'click', 'auto', 'crit', 'comp1', 'comp2',
    ...GameLimits.EXTRA_COMPANION_IDS.map(id => `comp:${id}`),
    ...GameLimits.ITEM_IDS.map(id => `item:${id}`)
]);

const V3_REQUIRED_FIELDS = Object.freeze([
    'version', 'min', 'gold', 'gem', 'token', 'kills', 'totalClicks', 'bossKills',
    'mob', 'stat', 'comp', 'relic', 'ach', 'achReady', 'skill', 'buff',
    'autoRemainder', 'lastActiveAt', 'savedAt', 'revision', 'sound'
]);

const V4_REQUIRED_FIELDS = Object.freeze([
    ...V3_REQUIRED_FIELDS, 'player', 'xpRemainder'
]);

class SaveValidationError extends Error {
    constructor(message) { super(message); this.name = 'SaveValidationError'; }
}

const Data = {
    key: 'ys_bugfree_final_v2',
    version: 5,
    state: null,
    def: null,
    canWrite: false,
    storageAvailable: true,
    recoveryRaw: null,
    _revision: 0,
    _listeners: new Set(),
    _code: 'loading',
    _message: '저장 데이터를 확인하고 있습니다.',
    _mode: 'single',
    _leaseDuration: 6000,
    _lease: null,
    _channel: null,
    _closed: false,
    _trying: false,
    _releaseLock: null,
    _timer: null,
    _tabId: typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,

    createDefault() {
        return {
            version: 5,
            min: 0, gold: 0, gem: 0, token: 0, kills: 0, totalClicks: 0, bossKills: 0,
            mob: { hp: 100, boss: false, deadline: 0 },
            stat: {
                c: { l: 1, p: 10, c: 50 },
                a: { l: 1, p: 10, c: 100 },
                crit: { l: 0, p: 0, c: 300 }
            },
            comp: { na: { l: 0, p: 0, c: 2000 }, yu: { l: 0, p: 0, c: 5000 } },
            relic: [false, false, false, false],
            ach: [false, false, false, false, false],
            achReady: [false, false, false, false, false],
            items: Object.fromEntries(GameLimits.ITEM_IDS.map(id => [id, 0])),
            extraRelics: Array(16).fill(false),
            extraAch: Array(25).fill(false),
            extraAchReady: Array(25).fill(false),
            skill: { rush: 0, night: 0 },
            buff: { rushUntil: 0, nightUntil: 0 },
            autoRemainder: 0,
            player: { level: 1, xp: 0 },
            xpRemainder: 0,
            xpBonusRemainder: 0,
            lastActiveAt: Date.now(), savedAt: 0, revision: 0, sound: true,
            character: 'female', hasStarted: false,
            onboarding: {
                version: 1,
                step: 0,
                steps: { observeAuto: false, firstUpgrade: false, useRush: false, viewAch: false },
                completed: false,
                skipped: false
            },
            preferences: {
                playStyle: 'idle',
                purchaseQty: '1',
                showGoals: true
            },
            automation: {
                enabled: false,
                strategy: 'auto-priority',
                targets: ['auto', 'comp1', 'item:fairy-clock'],
                cursor: 0,
                budgetLimit: 0,
                budgetSpent: 0,
                reserveGold: 0,
                allowDuringBossPending: false,
                skills: { rush: 'manual', night: 'manual' },
                lastDecisionAt: 0
            },
            adventure: {
                runId: 'run-1',
                currentLocation: 'classroom',
                clearedBossCheckpoints: [],
                unlockedLocations: ['classroom'],
                seenStories: ['enter-classroom']
            },
            bossControl: {
                entryMode: 'auto',
                status: 'none',
                challengeId: 0,
                startedAt: 0,
                startAutoDamage: 0,
                skillsUsed: { rush: false, night: false },
                lastResult: null
            },
            extraCompanions: {
                library: { unlocked: false, l: 0, p: 0, c: 5000 },
                science: { unlocked: false, l: 0, p: 0, c: 8000 },
                music: { unlocked: false, l: 0, p: 0, c: 10000 },
                tidy: { unlocked: false, l: 0, p: 0, c: 12000 }
            },
            companionLoadout: ['na', 'yu'],
            companionPresets: [
                { name: '성장 조합', slots: ['na', 'yu'] },
                { name: '수집 조합', slots: ['na', 'yu'] },
                { name: '보스 조합', slots: ['na', 'yu'] }
            ],
            cosmetics: {
                unlocked: {
                    outfit: ['outfit-default'],
                    accessory: ['accessory-none'],
                    wand: ['wand-default'],
                    background: ['bg-default'],
                    decor: ['decor-none']
                },
                equipped: {
                    outfit: 'outfit-default',
                    accessory: 'accessory-none',
                    wand: 'wand-default',
                    background: 'bg-default',
                    decor: 'decor-none'
                }
            },
            trackedGoals: [],
            skillTimers: { rushReadyAt: 0, nightReadyAt: 0 },
            recentReports: []
        };
    },

    _syncDerivedUnlocks(state, isLegacyMigration = false) {
        if (isLegacyMigration) {
            for (const checkpoint of GameLimits.BOSS_CHECKPOINTS) {
                if (state.kills >= checkpoint + 1 && !state.adventure.clearedBossCheckpoints.includes(checkpoint)) {
                    state.adventure.clearedBossCheckpoints.push(checkpoint);
                }
            }
        }
        state.adventure.clearedBossCheckpoints.sort((a, b) => a - b);
        const checkpointToLocation = { 100: 'library', 200: 'science', 300: 'gym', 400: 'gate' };
        const checkpointToCompanion = { 100: 'library', 200: 'science', 300: 'music', 400: 'tidy' };
        if (!state.adventure.unlockedLocations.includes('classroom')) {
            state.adventure.unlockedLocations.unshift('classroom');
        }
        for (const checkpoint of state.adventure.clearedBossCheckpoints) {
            const loc = checkpointToLocation[checkpoint];
            if (loc && !state.adventure.unlockedLocations.includes(loc)) {
                state.adventure.unlockedLocations.push(loc);
            }
            const clearStory = `clear-${checkpoint}`;
            const enterStory = `enter-${loc}`;
            if (!state.adventure.seenStories.includes(clearStory)) state.adventure.seenStories.push(clearStory);
            if (loc && !state.adventure.seenStories.includes(enterStory)) state.adventure.seenStories.push(enterStory);
        }
        let highestLoc = 'classroom';
        for (const checkpoint of GameLimits.BOSS_CHECKPOINTS) {
            if (state.adventure.clearedBossCheckpoints.includes(checkpoint)) {
                highestLoc = checkpointToLocation[checkpoint];
            }
        }
        state.adventure.currentLocation = highestLoc;

        for (const [checkpoint, loc] of Object.entries(checkpointToLocation)) {
            if (state.adventure.unlockedLocations.includes(loc)) {
                const compId = checkpointToCompanion[checkpoint];
                if (compId && state.extraCompanions[compId]) {
                    state.extraCompanions[compId].unlocked = true;
                }
            }
        }

        const unlockCosmetic = (slot, id) => {
            if (!state.cosmetics.unlocked[slot].includes(id)) {
                state.cosmetics.unlocked[slot].push(id);
            }
        };
        const anyAchReady = state.achReady.some(Boolean) || state.extraAchReady.some(Boolean);
        if (anyAchReady) {
            unlockCosmetic('wand', 'wand-star');
            unlockCosmetic('decor', 'decor-plant');
        }
        if (state.adventure.unlockedLocations.includes('library')) {
            unlockCosmetic('outfit', 'outfit-vest');
            unlockCosmetic('accessory', 'accessory-mug');
        }
        if (state.adventure.unlockedLocations.includes('science')) {
            unlockCosmetic('accessory', 'accessory-notebook');
            unlockCosmetic('background', 'bg-sunset');
        }
        if (state.adventure.unlockedLocations.includes('gym')) {
            unlockCosmetic('wand', 'wand-rainbow');
        }
        if (state.adventure.unlockedLocations.includes('gate')) {
            unlockCosmetic('outfit', 'outfit-cape');
            unlockCosmetic('background', 'bg-festival');
            unlockCosmetic('decor', 'decor-trophy');
        }
    },

    normalize(raw, options = {}) {
        const strict = Boolean(options.strict);
        const object = (value, field) => {
            if (!value || typeof value !== 'object' || Array.isArray(value) ||
                Object.prototype.toString.call(value) !== '[object Object]') {
                throw new SaveValidationError(`${field}의 형식이 올바르지 않습니다.`);
            }
            return value;
        };
        const own = (value, field) => Object.prototype.hasOwnProperty.call(value, field);
        const number = (value, field, maximum = GameLimits.MAX_NUMBER, integer = false) => {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
                (integer && !Number.isInteger(value)) || (strict && value > maximum)) {
                throw new SaveValidationError(`${field}의 숫자 범위가 올바르지 않습니다.`);
            }
            return Math.min(maximum, value);
        };
        const boolean = (value, field) => {
            if (typeof value !== 'boolean') throw new SaveValidationError(`${field}는 참/거짓 값이어야 합니다.`);
            return value;
        };
        const string = (value, field, maxLength = 64, allowEmpty = false) => {
            if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > maxLength) {
                throw new SaveValidationError(`${field}의 문자열 형식이 올바르지 않습니다.`);
            }
            return value;
        };
        object(raw, '저장 데이터');
        if (!['gold', 'kills', 'stat', 'comp', 'mob', 'totalClicks', 'min', 'gem', 'token']
            .some(field => own(raw, field))) {
            throw new SaveValidationError('게임 저장 데이터가 아닙니다.');
        }
        if (own(raw, 'version') && ![1, 2, 3, 4, 5].includes(raw.version)) {
            throw new SaveValidationError('지원하지 않는 저장 버전입니다.');
        }
        const state = this.createDefault();
        if (raw.version === 3 || raw.version === 4 || raw.version === 5) {
            const required = raw.version === 3 ? V3_REQUIRED_FIELDS : V4_REQUIRED_FIELDS;
            for (const field of required) {
                if (!own(raw, field)) throw new SaveValidationError(`${field}의 저장 정보가 누락되었습니다.`);
            }
            if (raw.version >= 4) {
                const player = object(raw.player, 'player');
                for (const name of ['level', 'xp']) {
                    if (!own(player, name)) throw new SaveValidationError(`player.${name}의 저장 정보가 누락되었습니다.`);
                }
            }
            for (const [field, names] of Object.entries({
                stat: ['c', 'a', 'crit'], comp: ['na', 'yu'],
                mob: ['hp', 'boss', 'deadline'], skill: ['rush', 'night'],
                buff: ['rushUntil', 'nightUntil']
            })) {
                const group = object(raw[field], field);
                for (const name of names) {
                    if (!own(group, name)) throw new SaveValidationError(`${field}.${name}의 저장 정보가 누락되었습니다.`);
                }
            }
        }
        for (const field of ['gold', 'gem', 'token']) {
            if (own(raw, field)) state[field] = number(raw[field], field);
        }
        for (const field of ['min', 'kills', 'totalClicks', 'bossKills']) {
            if (own(raw, field)) state[field] = number(raw[field], field, GameLimits.MAX_COUNTER, true);
        }
        if (own(raw, 'revision')) state.revision = number(raw.revision, 'revision', GameLimits.MAX_REVISION, true);
        const groups = { stat: ['c', 'a', 'crit'], comp: ['na', 'yu'] };
        for (const [field, names] of Object.entries(groups)) {
            if (!own(raw, field)) continue;
            const group = object(raw[field], field);
            if (!names.some(name => own(group, name))) {
                throw new SaveValidationError(`${field}에 필요한 강화 정보가 없습니다.`);
            }
            for (const name of names) {
                if (!own(group, name)) continue;
                const item = object(group[name], `${field}.${name}`);
                if (!['l', 'p', 'c'].some(part => own(item, part)) ||
                    ((strict || raw.version >= 3) && !['l', 'p', 'c'].every(part => own(item, part)))) {
                    throw new SaveValidationError(`${field}.${name}의 강화 정보가 불완전합니다.`);
                }
                for (const part of ['l', 'p', 'c']) {
                    if (!own(item, part)) continue;
                    let maximum = part === 'l' ? GameLimits.MAX_LEVEL : GameLimits.MAX_NUMBER;
                    if (field === 'stat' && name === 'crit' && part === 'p') maximum = 50;
                    state[field][name][part] = number(item[part], `${field}.${name}.${part}`, maximum, part === 'l');
                }
            }
        }
        if (state.stat.a.l === 0 && state.stat.a.p === 0) {
            state.stat.a.l = 1;
            state.stat.a.p = 10;
        }
        if (own(raw, 'player')) {
            const player = object(raw.player, 'player');
            if (!own(player, 'level') || !own(player, 'xp')) {
                throw new SaveValidationError('플레이어 성장 정보가 불완전합니다.');
            }
            state.player.level = number(player.level, 'player.level', GameLimits.MAX_LEVEL, true);
            if (state.player.level < 1) throw new SaveValidationError('플레이어 레벨은 1 이상이어야 합니다.');
            const maximumXp = state.player.level === GameLimits.MAX_LEVEL ? 0 : GameLimits.xpForLevel(state.player.level) - 1;
            state.player.xp = number(player.xp, 'player.xp', maximumXp, true);
        }
        if (own(raw, 'items')) {
            const items = object(raw.items, 'items');
            for (const id of Object.keys(items)) {
                if (!GameLimits.ITEM_IDS.includes(id)) {
                    throw new SaveValidationError(`알 수 없는 아이템 ID입니다: ${id}`);
                }
                const level = number(items[id], `items.${id}`, GameLimits.MAX_ITEM_LEVEL, true);
                if (items[id] > GameLimits.MAX_ITEM_LEVEL) {
                    throw new SaveValidationError(`items.${id}의 레벨은 25 이하여야 합니다.`);
                }
                state.items[id] = level;
            }
        }
        for (const [field, length] of [
            ['relic', 4], ['ach', 5], ['achReady', 5],
            ['extraRelics', 16], ['extraAch', 25], ['extraAchReady', 25]
        ]) {
            if (!own(raw, field)) continue;
            if (!Array.isArray(raw[field]) || raw[field].length !== length) {
                throw new SaveValidationError(`${field}의 배열 길이가 올바르지 않습니다.`);
            }
            state[field] = Array.from(raw[field], (value, index) => boolean(value, `${field}[${index}]`));
        }
        const maxTimestamp = 8640000000000000;
        for (const field of ['lastActiveAt', 'savedAt']) {
            if (own(raw, field)) state[field] = number(raw[field], field, maxTimestamp, true);
        }
        if (!own(raw, 'lastActiveAt') && own(raw, 'lastDt')) {
            state.lastActiveAt = number(raw.lastDt, 'lastDt', maxTimestamp, true);
        }
        if (own(raw, 'sound')) state.sound = boolean(raw.sound, 'sound');
        state.hasStarted = own(raw, 'hasStarted') ? boolean(raw.hasStarted, 'hasStarted') : true;
        if (own(raw, 'character')) {
            if (!['female', 'male'].includes(raw.character)) {
                throw new SaveValidationError('선생님 캐릭터의 선택이 올바르지 않습니다.');
            }
            state.character = raw.character;
        }
        if (own(raw, 'autoRemainder')) {
            state.autoRemainder = number(raw.autoRemainder, 'autoRemainder', 1);
            if (state.autoRemainder >= 1) throw new SaveValidationError('자동 공격 시간은 1초 미만이어야 합니다.');
        }
        if (own(raw, 'xpRemainder')) {
            state.xpRemainder = number(raw.xpRemainder, 'xpRemainder', 1);
            if (state.xpRemainder >= 1) throw new SaveValidationError('경험치 획득 시간은 1초 미만이어야 합니다.');
        }
        if (own(raw, 'xpBonusRemainder')) {
            state.xpBonusRemainder = number(raw.xpBonusRemainder, 'xpBonusRemainder', 1);
            if (state.xpBonusRemainder >= 1) throw new SaveValidationError('보너스 경험치 잔여량은 1 미만이어야 합니다.');
        }
        if (own(raw, 'skill')) {
            const skills = object(raw.skill, 'skill');
            for (const [name, legacy] of [['rush', 'r'], ['night', 'n']]) {
                const field = own(skills, name) ? name : legacy;
                if (own(skills, field)) state.skill[name] = number(skills[field], `skill.${field}`, maxTimestamp, true);
            }
        }
        if (own(raw, 'buff')) {
            const buffs = object(raw.buff, 'buff');
            for (const field of ['rushUntil', 'nightUntil']) {
                if (own(buffs, field)) state.buff[field] = number(buffs[field], `buff.${field}`, maxTimestamp, true);
            }
        }
        if (own(raw, 'mob')) {
            const mob = object(raw.mob, 'mob');
            if (strict && (!own(mob, 'hp') || !own(mob, 'boss'))) {
                throw new SaveValidationError('적의 저장 정보가 불완전합니다.');
            }
            if (own(mob, 'hp')) state.mob.hp = number(mob.hp, 'mob.hp');
            if (own(mob, 'boss')) state.mob.boss = boolean(mob.boss, 'mob.boss');
            if (own(mob, 'deadline')) state.mob.deadline = number(mob.deadline, 'mob.deadline', maxTimestamp, true);
            else if (state.mob.boss) state.mob.deadline = state.lastActiveAt + (state.relic[3] ? 40000 : 30000);
        }

        // Validate v5 fields if present
        if (own(raw, 'onboarding')) {
            const ob = object(raw.onboarding, 'onboarding');
            if (own(ob, 'version')) state.onboarding.version = number(ob.version, 'onboarding.version', 100, true);
            if (own(ob, 'step')) state.onboarding.step = number(ob.step, 'onboarding.step', 10, true);
            if (own(ob, 'completed')) state.onboarding.completed = boolean(ob.completed, 'onboarding.completed');
            if (own(ob, 'skipped')) state.onboarding.skipped = boolean(ob.skipped, 'onboarding.skipped');
            if (own(ob, 'steps')) {
                const steps = object(ob.steps, 'onboarding.steps');
                for (const key of ['observeAuto', 'firstUpgrade', 'useRush', 'viewAch']) {
                    if (own(steps, key)) state.onboarding.steps[key] = boolean(steps[key], `onboarding.steps.${key}`);
                }
            }
        } else if (state.hasStarted) {
            // Existing started saves from v1-v4 do not force onboarding on load.
            state.onboarding.completed = true;
        }

        if (own(raw, 'preferences')) {
            const pref = object(raw.preferences, 'preferences');
            if (own(pref, 'playStyle')) {
                if (!GameLimits.PLAY_STYLES.includes(pref.playStyle)) {
                    throw new SaveValidationError('선호 플레이 스타일이 올바르지 않습니다.');
                }
                state.preferences.playStyle = pref.playStyle;
            }
            if (own(pref, 'purchaseQty')) {
                if (!GameLimits.PURCHASE_QUANTITIES.includes(pref.purchaseQty)) {
                    throw new SaveValidationError('구매 수량 설정이 올바르지 않습니다.');
                }
                state.preferences.purchaseQty = pref.purchaseQty;
            }
            if (own(pref, 'showGoals')) state.preferences.showGoals = boolean(pref.showGoals, 'preferences.showGoals');
        }

        if (own(raw, 'automation')) {
            const auto = object(raw.automation, 'automation');
            if (own(auto, 'enabled')) state.automation.enabled = boolean(auto.enabled, 'automation.enabled');
            if (own(auto, 'strategy')) {
                if (!GameLimits.AUTOMATION_STRATEGIES.includes(auto.strategy)) {
                    throw new SaveValidationError('자동 강화 전략이 올바르지 않습니다.');
                }
                state.automation.strategy = auto.strategy;
            }
            if (own(auto, 'targets')) {
                if (!Array.isArray(auto.targets) || auto.targets.length > 40) {
                    throw new SaveValidationError('자동 구매 대상 목록이 올바르지 않습니다.');
                }
                const seen = new Set();
                for (const target of auto.targets) {
                    if (typeof target !== 'string' || !AUTOMATION_TARGET_SET.has(target) || seen.has(target)) {
                        throw new SaveValidationError(`유효하지 않거나 중복된 자동 구매 대상입니다: ${target}`);
                    }
                    seen.add(target);
                }
                state.automation.targets = Array.from(seen);
            }
            if (own(auto, 'cursor')) state.automation.cursor = number(auto.cursor, 'automation.cursor', GameLimits.MAX_COUNTER, true);
            if (own(auto, 'budgetLimit')) state.automation.budgetLimit = number(auto.budgetLimit, 'automation.budgetLimit');
            if (own(auto, 'budgetSpent')) state.automation.budgetSpent = number(auto.budgetSpent, 'automation.budgetSpent');
            if (own(auto, 'reserveGold')) state.automation.reserveGold = number(auto.reserveGold, 'automation.reserveGold');
            if (own(auto, 'allowDuringBossPending')) {
                state.automation.allowDuringBossPending = boolean(auto.allowDuringBossPending, 'automation.allowDuringBossPending');
            }
            if (own(auto, 'skills')) {
                const sk = object(auto.skills, 'automation.skills');
                for (const name of ['rush', 'night']) {
                    if (own(sk, name)) {
                        if (!GameLimits.SKILL_MODES.includes(sk[name])) {
                            throw new SaveValidationError(`자동 스킬 설정이 올바르지 않습니다: ${name}`);
                        }
                        state.automation.skills[name] = sk[name];
                    }
                }
            }
            if (own(auto, 'lastDecisionAt')) {
                state.automation.lastDecisionAt = number(auto.lastDecisionAt, 'automation.lastDecisionAt', maxTimestamp, true);
            }
        }

        if (own(raw, 'adventure')) {
            const adv = object(raw.adventure, 'adventure');
            if (own(adv, 'runId')) state.adventure.runId = string(adv.runId, 'adventure.runId', 64);
            if (own(adv, 'currentLocation')) {
                if (!GameLimits.LOCATION_IDS.includes(adv.currentLocation)) {
                    throw new SaveValidationError('현재 장소 ID가 올바르지 않습니다.');
                }
                state.adventure.currentLocation = adv.currentLocation;
            }
            if (own(adv, 'clearedBossCheckpoints')) {
                if (!Array.isArray(adv.clearedBossCheckpoints) || adv.clearedBossCheckpoints.length > 4) {
                    throw new SaveValidationError('보스 격파 구간 배열이 올바르지 않습니다.');
                }
                const seen = new Set();
                for (const cp of adv.clearedBossCheckpoints) {
                    if (!GameLimits.BOSS_CHECKPOINTS.includes(cp) || seen.has(cp)) {
                        throw new SaveValidationError('보스 격파 구간 값이 올바르지 않습니다.');
                    }
                    seen.add(cp);
                }
                state.adventure.clearedBossCheckpoints = Array.from(seen).sort((a, b) => a - b);
            }
            if (own(adv, 'unlockedLocations')) {
                if (!Array.isArray(adv.unlockedLocations) || adv.unlockedLocations.length === 0 || adv.unlockedLocations.length > 5) {
                    throw new SaveValidationError('해금 장소 목록이 올바르지 않습니다.');
                }
                const seen = new Set();
                for (const loc of adv.unlockedLocations) {
                    if (!GameLimits.LOCATION_IDS.includes(loc) || seen.has(loc)) {
                        throw new SaveValidationError(`알 수 없거나 중복된 장소 ID입니다: ${loc}`);
                    }
                    seen.add(loc);
                }
                if (!seen.has('classroom')) throw new SaveValidationError('기본 교실 장소는 항상 해금되어 있어야 합니다.');
                state.adventure.unlockedLocations = Array.from(seen);
            }
            if (own(adv, 'seenStories')) {
                if (!Array.isArray(adv.seenStories) || adv.seenStories.length > 20) {
                    throw new SaveValidationError('이야기 기록 배열이 올바르지 않습니다.');
                }
                const seen = new Set();
                for (const storyId of adv.seenStories) {
                    if (typeof storyId !== 'string' || !GameLimits.STORY_IDS.includes(storyId) || seen.has(storyId)) {
                        throw new SaveValidationError(`알 수 없거나 중복된 이야기 ID입니다: ${storyId}`);
                    }
                    seen.add(storyId);
                }
                state.adventure.seenStories = Array.from(seen);
            }
        }

        if (own(raw, 'bossControl')) {
            const bc = object(raw.bossControl, 'bossControl');
            if (own(bc, 'entryMode')) {
                if (!GameLimits.BOSS_ENTRY_MODES.includes(bc.entryMode)) {
                    throw new SaveValidationError('보스 진입 방식이 올바르지 않습니다.');
                }
                state.bossControl.entryMode = bc.entryMode;
            }
            if (own(bc, 'status')) {
                if (!GameLimits.BOSS_STATES.includes(bc.status)) {
                    throw new SaveValidationError('보스 도전 상태가 올바르지 않습니다.');
                }
                state.bossControl.status = bc.status;
            }
            if (own(bc, 'challengeId')) state.bossControl.challengeId = number(bc.challengeId, 'bossControl.challengeId', GameLimits.MAX_COUNTER, true);
            if (own(bc, 'startedAt')) state.bossControl.startedAt = number(bc.startedAt, 'bossControl.startedAt', maxTimestamp, true);
            if (own(bc, 'startAutoDamage')) state.bossControl.startAutoDamage = number(bc.startAutoDamage, 'bossControl.startAutoDamage');
            if (own(bc, 'skillsUsed')) {
                const su = object(bc.skillsUsed, 'bossControl.skillsUsed');
                for (const name of ['rush', 'night']) {
                    if (own(su, name)) state.bossControl.skillsUsed[name] = boolean(su[name], `bossControl.skillsUsed.${name}`);
                }
            }
            if (own(bc, 'lastResult') && bc.lastResult !== null) {
                const lr = object(bc.lastResult, 'bossControl.lastResult');
                if (!['failed', 'victory', 'expired', 'cleared'].includes(lr.outcome)) {
                    throw new SaveValidationError('보스 직전 결과 상태가 올바르지 않습니다.');
                }
                const normalizedOutcome = lr.outcome === 'expired' ? 'failed' : lr.outcome === 'cleared' ? 'victory' : lr.outcome;
                const lrSkills = own(lr, 'skillsUsed') ? object(lr.skillsUsed, 'bossControl.lastResult.skillsUsed') : { rush: false, night: false };
                const cpVal = own(lr, 'checkpoint')
                    ? number(lr.checkpoint, 'bossControl.lastResult.checkpoint', GameLimits.MAX_COUNTER, true)
                    : (own(lr, 'stage') ? number(lr.stage, 'bossControl.lastResult.stage', GameLimits.MAX_COUNTER, true) : 100);
                state.bossControl.lastResult = {
                    outcome: normalizedOutcome,
                    checkpoint: cpVal,
                    maxHp: number(lr.maxHp, 'bossControl.lastResult.maxHp'),
                    remainingHp: number(lr.remainingHp, 'bossControl.lastResult.remainingHp'),
                    durationSec: number(lr.durationSec, 'bossControl.lastResult.durationSec', 10000),
                    autoDamage: number(lr.autoDamage, 'bossControl.lastResult.autoDamage'),
                    skillsUsed: {
                        rush: own(lrSkills, 'rush') ? boolean(lrSkills.rush, 'bossControl.lastResult.skillsUsed.rush') : false,
                        night: own(lrSkills, 'night') ? boolean(lrSkills.night, 'bossControl.lastResult.skillsUsed.night') : false
                    },
                    at: own(lr, 'at') ? number(Math.ceil(lr.at), 'bossControl.lastResult.at', maxTimestamp, true) : 0
                };
            }
        }

        if (own(raw, 'extraCompanions')) {
            const ec = object(raw.extraCompanions, 'extraCompanions');
            for (const id of Object.keys(ec)) {
                if (!GameLimits.EXTRA_COMPANION_IDS.includes(id)) {
                    throw new SaveValidationError(`알 수 없는 동료 ID입니다: ${id}`);
                }
                const entry = object(ec[id], `extraCompanions.${id}`);
                const maxLevel = GameLimits.EXTRA_COMPANION_MAX_LEVELS[id];
                const unlocked = own(entry, 'unlocked') ? boolean(entry.unlocked, `extraCompanions.${id}.unlocked`) : false;
                const l = own(entry, 'l') ? number(entry.l, `extraCompanions.${id}.l`, maxLevel, true) : 0;
                if (own(entry, 'l') && entry.l > maxLevel) {
                    throw new SaveValidationError(`extraCompanions.${id}의 레벨 상한을 초과했습니다.`);
                }
                if (!unlocked && l > 0) {
                    throw new SaveValidationError(`해금되지 않은 동료(${id})는 강화할 수 없습니다.`);
                }
                const p = own(entry, 'p') ? number(entry.p, `extraCompanions.${id}.p`) : 0;
                const c = own(entry, 'c') ? number(entry.c, `extraCompanions.${id}.c`) : GameLimits.EXTRA_COMPANION_BASE_COSTS[id];
                state.extraCompanions[id] = { unlocked, l, p, c };
            }
        }

        if (own(raw, 'cosmetics')) {
            const cos = object(raw.cosmetics, 'cosmetics');
            if (own(cos, 'unlocked')) {
                const un = object(cos.unlocked, 'cosmetics.unlocked');
                for (const slot of Object.keys(un)) {
                    if (!GameLimits.COSMETIC_SLOTS.includes(slot)) {
                        throw new SaveValidationError(`알 수 없는 외형 슬롯입니다: ${slot}`);
                    }
                    const list = un[slot];
                    if (!Array.isArray(list) || list.length === 0 || list.length > 10) {
                        throw new SaveValidationError(`cosmetics.unlocked.${slot} 배열이 올바르지 않습니다.`);
                    }
                    const seen = new Set();
                    for (const itemId of list) {
                        if (!GameLimits.COSMETIC_IDS[slot].includes(itemId) || seen.has(itemId)) {
                            throw new SaveValidationError(`유효하지 않거나 중복된 외형 ID입니다: ${itemId}`);
                        }
                        seen.add(itemId);
                    }
                    const defId = GameLimits.COSMETIC_DEFAULTS[slot];
                    if (!seen.has(defId)) seen.add(defId);
                    state.cosmetics.unlocked[slot] = Array.from(seen);
                }
            }
            if (own(cos, 'equipped')) {
                const eq = object(cos.equipped, 'cosmetics.equipped');
                for (const slot of Object.keys(eq)) {
                    if (!GameLimits.COSMETIC_SLOTS.includes(slot)) {
                        throw new SaveValidationError(`알 수 없는 외형 슬롯입니다: ${slot}`);
                    }
                    const itemId = eq[slot];
                    if (!GameLimits.COSMETIC_IDS[slot].includes(itemId)) {
                        throw new SaveValidationError(`알 수 없는 외형 ID입니다: ${itemId}`);
                    }
                    state.cosmetics.equipped[slot] = itemId;
                }
            }
        }

        if (own(raw, 'trackedGoals')) {
            if (!Array.isArray(raw.trackedGoals) || raw.trackedGoals.length > GameLimits.MAX_TRACKED_GOALS) {
                throw new SaveValidationError('고정 목표 배열 길이가 올바르지 않습니다.');
            }
            const seen = new Set();
            for (const id of raw.trackedGoals) {
                const goalId = number(id, 'trackedGoals', GameLimits.MAX_ACHIEVEMENT_ID, true);
                if (seen.has(goalId)) throw new SaveValidationError('중복된 고정 목표 ID입니다.');
                seen.add(goalId);
            }
            state.trackedGoals = Array.from(seen);
        }

        if (own(raw, 'skillTimers')) {
            const st = object(raw.skillTimers, 'skillTimers');
            for (const field of ['rushReadyAt', 'nightReadyAt']) {
                if (own(st, field)) state.skillTimers[field] = number(st[field], `skillTimers.${field}`, maxTimestamp, true);
            }
        }

        if (own(raw, 'recentReports')) {
            if (!Array.isArray(raw.recentReports) || raw.recentReports.length > GameLimits.MAX_RECENT_REPORTS) {
                throw new SaveValidationError('최근 보고서 배열 길이가 올바르지 않습니다.');
            }
            state.recentReports = raw.recentReports.map((item, idx) => {
                const rep = object(item, `recentReports[${idx}]`);
                const createdAtVal = own(rep, 'createdAt') ? rep.createdAt : rep.at;
                const rawElapsedVal = own(rep, 'rawElapsedMs') ? rep.rawElapsedMs : rep.awayMs;
                const appliedElapsedVal = own(rep, 'appliedElapsedMs') ? rep.appliedElapsedMs : rep.settledMs;
                const beforeLvVal = own(rep, 'beforeLevel') ? rep.beforeLevel : rep.levelBefore;
                const afterLvVal = own(rep, 'afterLevel') ? rep.afterLevel : rep.levelAfter;
                const locVal = own(rep, 'locationId') ? rep.locationId : rep.location;
                const locationId = typeof locVal === 'string' && GameLimits.LOCATION_IDS.includes(locVal) ? locVal : 'classroom';
                const charVal = own(rep, 'character') && ['female', 'male'].includes(rep.character) ? rep.character : state.character;
                const headlineVal = own(rep, 'headline') && typeof rep.headline === 'string' ? rep.headline.slice(0, 120) : '';
                return {
                    id: string(rep.id, `recentReports[${idx}].id`, 64),
                    createdAt: number(createdAtVal, `recentReports[${idx}].createdAt`, maxTimestamp, true),
                    rawElapsedMs: number(rawElapsedVal, `recentReports[${idx}].rawElapsedMs`, maxTimestamp, true),
                    appliedElapsedMs: number(appliedElapsedVal, `recentReports[${idx}].appliedElapsedMs`, 86400000, true),
                    capped: boolean(rep.capped, `recentReports[${idx}].capped`),
                    beforeLevel: number(beforeLvVal, `recentReports[${idx}].beforeLevel`, GameLimits.MAX_LEVEL, true),
                    afterLevel: number(afterLvVal, `recentReports[${idx}].afterLevel`, GameLimits.MAX_LEVEL, true),
                    xpGained: number(rep.xpGained, `recentReports[${idx}].xpGained`),
                    goldGained: number(rep.goldGained, `recentReports[${idx}].goldGained`),
                    gemsGained: number(rep.gemsGained, `recentReports[${idx}].gemsGained`),
                    kills: number(rep.kills, `recentReports[${idx}].kills`, GameLimits.MAX_COUNTER, true),
                    bossKills: number(rep.bossKills, `recentReports[${idx}].bossKills`, GameLimits.MAX_COUNTER, true),
                    bossExpired: number(rep.bossExpired, `recentReports[${idx}].bossExpired`, GameLimits.MAX_COUNTER, true),
                    character: charVal,
                    locationId,
                    headline: headlineVal
                };
            });
        }

        // Legacy saves did not count defeated bosses. The first boss is alive at 100 kills.
        if (!own(raw, 'bossKills')) state.bossKills = Math.floor(Math.max(0, state.kills - 1) / 100);
        state.achReady = state.achReady.map((value, index) => value || state.ach[index]);
        state.extraAchReady = state.extraAchReady.map((value, index) => value || state.extraAch[index]);
        if (state.kills >= 10) state.achReady[0] = true;
        if (state.bossKills > 0) state.achReady[1] = true;
        if (state.totalClicks >= 500) state.achReady[2] = true;
        if (state.gold >= 1000000) state.achReady[3] = true;
        if (state.stat.c.l >= 50) state.achReady[4] = true;

        const isLegacyMigration = !own(raw, 'version') || raw.version < 5 || !own(raw, 'adventure');
        this._syncDerivedUnlocks(state, isLegacyMigration);

        if (own(raw, 'companionLoadout')) {
            if (!Array.isArray(raw.companionLoadout) || raw.companionLoadout.length === 0 || raw.companionLoadout.length > 2) {
                throw new SaveValidationError('동행 동료 슬롯 구성이 올바르지 않습니다.');
            }
            const seen = new Set();
            for (const id of raw.companionLoadout) {
                if (!GameLimits.COMPANION_IDS.includes(id) || seen.has(id)) {
                    throw new SaveValidationError(`유효하지 않거나 중복된 동료 ID입니다: ${id}`);
                }
                if (GameLimits.EXTRA_COMPANION_IDS.includes(id) && !state.extraCompanions[id].unlocked) {
                    throw new SaveValidationError(`미보유 동료는 동행할 수 없습니다: ${id}`);
                }
                seen.add(id);
            }
            state.companionLoadout = Array.from(seen);
        }

        if (own(raw, 'companionPresets')) {
            if (!Array.isArray(raw.companionPresets) || raw.companionPresets.length === 0 || raw.companionPresets.length > 3) {
                throw new SaveValidationError('동료 프리셋 배열이 올바르지 않습니다.');
            }
            state.companionPresets = raw.companionPresets.map((preset, idx) => {
                const p = object(preset, `companionPresets[${idx}]`);
                const name = string(p.name, `companionPresets[${idx}].name`, 30);
                if (!Array.isArray(p.slots) || p.slots.length === 0 || p.slots.length > 2) {
                    throw new SaveValidationError(`companionPresets[${idx}].slots 배열이 올바르지 않습니다.`);
                }
                const seen = new Set();
                for (const id of p.slots) {
                    if (!GameLimits.COMPANION_IDS.includes(id) || seen.has(id)) {
                        throw new SaveValidationError(`프리셋에 유효하지 않거나 중복된 동료가 있습니다: ${id}`);
                    }
                    seen.add(id);
                }
                return { name, slots: Array.from(seen) };
            });
        }

        for (const slot of GameLimits.COSMETIC_SLOTS) {
            const equippedId = state.cosmetics.equipped[slot];
            if (!state.cosmetics.unlocked[slot].includes(equippedId)) {
                throw new SaveValidationError(`보유하지 않은 외형은 장착할 수 없습니다: ${equippedId}`);
            }
        }

        // Reconcile bossControl status with mob.boss
        if (!state.mob.boss) {
            if (strict && own(raw, 'bossControl') && raw.bossControl && raw.bossControl.status === 'pending') {
                throw new SaveValidationError('일반 몬스터 상태에서 보스 대기 상태를 설정할 수 없습니다.');
            }
            state.bossControl.status = 'none';
            state.mob.deadline = 0;
        } else if (state.bossControl.status === 'pending') {
            state.mob.deadline = 0;
        } else {
            state.bossControl.status = 'active';
            if (!(state.mob.deadline > 0)) {
                state.mob.deadline = state.lastActiveAt + (state.relic[3] ? 40000 : 30000);
            }
        }

        // Populate skillTimers from skill timestamps when migrating or when skill was set directly
        if (state.skill.rush === 0) state.skillTimers.rushReadyAt = 0;
        else if (!(state.skillTimers.rushReadyAt >= state.skill.rush)) {
            state.skillTimers.rushReadyAt = state.skill.rush + 60000;
        }
        if (state.skill.night === 0) state.skillTimers.nightReadyAt = 0;
        else if (!(state.skillTimers.nightReadyAt >= state.skill.night)) {
            state.skillTimers.nightReadyAt = state.skill.night + 90000;
        }

        // A clock rollback moves every absolute timer together.
        const now = Date.now();
        const legacyClock = !own(raw, 'version') || raw.version < 3;
        const clockAnchor = Math.max(state.savedAt, legacyClock || state.hasStarted ? state.lastActiveAt : 0);
        const rollback = Math.max(0, clockAnchor - now);
        if (rollback > 0) {
            const shift = value => value > 0 ? Math.max(0, value - rollback) : 0;
            state.lastActiveAt = shift(state.lastActiveAt);
            state.savedAt = shift(state.savedAt);
            for (const field of ['rush', 'night']) state.skill[field] = shift(state.skill[field]);
            for (const field of ['rushReadyAt', 'nightReadyAt']) state.skillTimers[field] = shift(state.skillTimers[field]);
            for (const field of ['rushUntil', 'nightUntil']) state.buff[field] = shift(state.buff[field]);
            state.mob.deadline = shift(state.mob.deadline);
            state.bossControl.startedAt = shift(state.bossControl.startedAt);
            if (state.bossControl.lastResult && state.bossControl.lastResult.at > 0) {
                state.bossControl.lastResult.at = shift(state.bossControl.lastResult.at);
            }
            state.automation.lastDecisionAt = shift(state.automation.lastDecisionAt);
            if (Array.isArray(state.recentReports)) {
                for (const rep of state.recentReports) {
                    rep.createdAt = shift(rep.createdAt);
                }
            }
        }
        state.lastActiveAt = Math.min(now, state.lastActiveAt);
        return state;
    },

    _read(key) {
        try { return { ok: true, raw: localStorage.getItem(key) }; }
        catch (error) {
            this.storageAvailable = false;
            this._announce('storage-read', '저장소에 접근할 수 없습니다. 이 탭의 진행은 백업으로 보관하세요.');
            return { ok: false, raw: null };
        }
    },

    _preserve(raw) {
        this.recoveryRaw = raw;
        try {
            if (localStorage.getItem(`${this.key}:recovery`) === null) {
                localStorage.setItem(`${this.key}:recovery`, raw);
            }
        } catch (error) { /* The settings screen can still download recoveryRaw. */ }
    },

    _preservePreV5Backup(raw, parsed) {
        if (!parsed || typeof parsed !== 'object') return;
        if (parsed.version === 5) return;
        try {
            if (localStorage.getItem(`${this.key}:v4-backup`) === null) {
                localStorage.setItem(`${this.key}:v4-backup`, raw);
            }
        } catch (error) { /* Optional migration snapshot never blocks gameplay. */ }
    },

    getRecovery() { return this.recoveryRaw; },

    load() {
        const result = this._read(this.key);
        if (!result.ok) {
            if (!this.state) { this.state = this.createDefault(); this._revision = 0; }
            return this.state;
        }
        if (result.raw === null) {
            this.state = this.createDefault();
            this._revision = 0;
            this.recoveryRaw = null;
            return this.state;
        }
        try {
            const parsed = JSON.parse(result.raw);
            this.state = this.normalize(parsed);
            this._preservePreV5Backup(result.raw, parsed);
            this._revision = this.state.revision;
            this.recoveryRaw = null;
        } catch (error) {
            this._preserve(result.raw);
            this.state = this.createDefault();
            this._revision = 0;
            this._announce('corrupt-save', '기존 저장이 손상되었습니다. 원본을 보존했고 자동 덮어쓰기를 중지했습니다. 설정에서 복구하거나 새로 시작하세요.');
        }
        return this.state;
    },

    _storedRevision(allowCorrupt = false) {
        const result = this._read(this.key);
        if (!result.ok) return null;
        if (result.raw === null) return 0;
        try {
            const parsed = JSON.parse(result.raw);
            return this.normalize(parsed).revision;
        } catch (error) {
            this._preserve(result.raw);
            if (allowCorrupt) return 0;
            this._announce('corrupt-save', '저장 원본에 문제가 발견되어 자동 덮어쓰기를 중지했습니다. 원본을 백업하고 복구하세요.');
            return null;
        }
    },

    _validLease(lease, now = Date.now()) {
        return Boolean(lease && typeof lease.owner === 'string' && lease.owner.length > 0 &&
            Number.isSafeInteger(lease.expiresAt) && lease.expiresAt > now &&
            lease.expiresAt <= now + this._leaseDuration);
    },

    _ownsLease() {
        if (this._mode !== 'lease') return true;
        const result = this._read(`${this.key}:owner`);
        if (!result.ok) return false;
        try {
            const lease = JSON.parse(result.raw);
            return this._validLease(lease) && lease.owner === this._tabId;
        } catch (error) { return false; }
    },

    save(candidate, options = {}) {
        if (!this.canWrite || !this._ownsLease()) {
            this._loseOwnership('다른 탭이 저장을 담당하고 있습니다. 이 탭에서는 진행을 덮어쓰지 않습니다.');
            return false;
        }
        if (this.recoveryRaw !== null && !options.replaceRecovery) {
            this._announce('corrupt-save', '손상된 원본을 보호하기 위해 자동 저장을 중지했습니다. 설정에서 원본을 백업하고 복구하세요.');
            return false;
        }
        let next;
        try { next = this.normalize(candidate === undefined ? this.state : candidate, { strict: true }); }
        catch (error) { this._announce('validation', error.message); return false; }
        if (this._mode === 'memory') {
            if (!options.allowMemory) return false;
            if (candidate !== undefined) this.state = next;
            this.storageAvailable = false;
            this._announce('storage-write', '이 탭에서 임시로 진행 중입니다. 진행을 보관하려면 백업을 내려받으세요.');
            return true;
        }
        const storedRevision = this._storedRevision(Boolean(options.replaceRecovery));
        if (this.recoveryRaw !== null && !options.replaceRecovery) return false;
        if (storedRevision === null) {
            if (options.allowMemory && candidate !== undefined) this.state = next;
            return Boolean(options.allowMemory);
        }
        if (storedRevision !== null && storedRevision !== this._revision && !options.replaceRecovery) {
            this._loseOwnership('더 최신의 저장이 발견되어 오래된 진행의 덮어쓰기를 차단했습니다.', 'stale-save');
            this._sync();
            return false;
        }
        next.savedAt = Date.now();
        const previousRevision = Math.max(this._revision, storedRevision || 0);
        if (previousRevision >= GameLimits.MAX_REVISION) {
            this._announce('validation', '저장 번호가 한계에 도달했습니다. 현재 진행의 백업을 보관해 주세요.');
            return false;
        }
        next.revision = previousRevision + 1;
        if (!this._ownsLease()) {
            this._loseOwnership('저장 중 소유권이 이동하여 이전 탭의 쓰기를 차단했습니다.');
            this._sync();
            return false;
        }
        try { localStorage.setItem(this.key, JSON.stringify(next)); }
        catch (error) {
            this.storageAvailable = false;
            this._announce('storage-write', '저장하지 못했습니다. 저장 공간과 브라우저 권한을 확인하고 백업 파일을 내려받으세요.');
            if (options.allowMemory && candidate !== undefined) this.state = next;
            return Boolean(options.allowMemory);
        }
        this.storageAvailable = true;
        this._revision = next.revision;
        if (candidate === undefined) {
            this.state.savedAt = next.savedAt;
            this.state.revision = next.revision;
        } else this.state = next;
        if (options.replaceRecovery) this.recoveryRaw = null;
        this._announce(options.statusCode || 'saved', '진행이 저장되었습니다.');
        this._broadcast({ type: 'saved', revision: next.revision });
        return true;
    },

    import(raw) {
        let candidate;
        try { candidate = this.normalize(typeof raw === 'string' ? JSON.parse(raw) : raw, { strict: true }); }
        catch (error) {
            const message = error instanceof SyntaxError ? '백업 JSON 형식이 올바르지 않습니다.' : error.message;
            this._announce('validation', message);
            return { ok: false, code: 'validation', error: message };
        }
        // Imported progress begins now; importing the same backup cannot replay offline time.
        candidate.lastActiveAt = Date.now();
        candidate.buff = { rushUntil: 0, nightUntil: 0 };
        if (!this.save(candidate, { replaceRecovery: this.recoveryRaw !== null, statusCode: 'imported' })) {
            return { ok: false, code: this._code, error: this._message };
        }
        return { ok: true };
    },

    reset() {
        const candidate = this.createDefault();
        // Reset game progress while retaining the chosen cosmetic appearance.
        candidate.character = this.state && this.state.character === 'male' ? 'male' : 'female';
        candidate.hasStarted = Boolean(this.state && this.state.hasStarted === true);
        if (!this.save(candidate, { replaceRecovery: this.recoveryRaw !== null, statusCode: 'reset' })) {
            return { ok: false, code: this._code, error: this._message };
        }
        return { ok: true };
    },

    onStatus(callback) {
        this._listeners.add(callback);
        callback(this.status());
        return () => this._listeners.delete(callback);
    },

    status() {
        return {
            canWrite: this.canWrite, storageAvailable: this.storageAvailable,
            code: this._code, message: this._message, revision: this._revision,
            recoveryAvailable: this.recoveryRaw !== null, mode: this._mode
        };
    },

    _announce(code, message) {
        this._code = code;
        this._message = message;
        const status = this.status();
        for (const callback of this._listeners) {
            try { callback(status); } catch (error) { console.error('저장 상태 표시 실패:', error); }
        }
    },

    _broadcast(message) {
        try { if (this._channel) this._channel.postMessage({ ...message, owner: this._tabId }); }
        catch (error) { /* storage events provide synchronization without BroadcastChannel. */ }
    },

    _sync() {
        if (this.canWrite) return;
        const result = this._read(this.key);
        if (!result.ok || result.raw === null) return;
        try {
            const next = this.normalize(JSON.parse(result.raw));
            this.state = next;
            this._revision = next.revision;
            this.recoveryRaw = null;
            this._announce('synced', '다른 탭에서 저장한 최신 진행을 표시하고 있습니다.');
        } catch (error) {
            this._preserve(result.raw);
            this._announce('corrupt-save', '다른 탭의 저장을 읽을 수 없습니다. 손상된 원본을 보존했습니다.');
        }
    },

    _acquired() {
        if (this._closed) return false;
        this.load();
        this.canWrite = true;
        this._announce('ownership-acquired', this.storageAvailable
            ? '이 탭에서 게임을 진행하고 저장합니다.'
            : '저장소를 사용할 수 없어 이 탭에서 임시로 진행합니다. 백업 파일을 내려받으세요.');
        this._broadcast({ type: 'acquired' });
        if (this._resolveReady) { this._resolveReady(true); this._resolveReady = null; }
        return true;
    },

    _loseOwnership(message, code = 'ownership-lost') {
        this.canWrite = false;
        this._announce(code, message);
        if (this._releaseLock) { this._releaseLock(); this._releaseLock = null; }
    },

    async _tryLock() {
        if (this._trying || this._closed || this.canWrite || Date.now() < (this._holdUntil || 0)) return;
        this._trying = true;
        try {
            await navigator.locks.request(`${this.key}:writer`, { mode: 'exclusive', ifAvailable: true }, async lock => {
                if (this._closed) return;
                if (!lock) {
                    this._announce('ownership-lost', '다른 탭에서 게임이 실행 중입니다. 이 탭은 최신 저장을 표시합니다.');
                    this._sync();
                    if (this._resolveReady) { this._resolveReady(false); this._resolveReady = null; }
                    return;
                }
                if (!this._acquired()) return;
                await new Promise(resolve => { this._releaseLock = resolve; });
                this._releaseLock = null;
            });
        } catch (error) {
            this._mode = 'lease';
            await this._tryLease();
        } finally { this._trying = false; }
    },

    async _tryLease() {
        if (this._closed || this.canWrite || this._leaseClaiming || Date.now() < (this._holdUntil || 0)) return;
        this._leaseClaiming = true;
        try {
            const result = this._read(`${this.key}:owner`);
            if (!result.ok) {
                this._mode = 'memory';
                this._acquired();
                return;
            }
            let lease = null;
            try { lease = JSON.parse(result.raw); } catch (error) { /* Invalid leases expire. */ }
            if (this._validLease(lease) && lease.owner !== this._tabId) {
                this._announce('ownership-lost', '다른 탭에서 게임이 실행 중입니다. 이 탭은 최신 저장을 표시합니다.');
                this._sync();
                return;
            }
            const next = { owner: this._tabId, expiresAt: Date.now() + this._leaseDuration };
            try { localStorage.setItem(`${this.key}:owner`, JSON.stringify(next)); }
            catch (error) {
                this.storageAvailable = false;
                this._mode = 'memory';
                this._acquired();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 150));
            if (this._closed) return;
            if (this._ownsLease()) this._acquired();
            else this._loseOwnership('다른 탭이 저장을 담당하고 있습니다.');
        } finally {
            this._leaseClaiming = false;
            if (this._resolveReady) { this._resolveReady(this.canWrite); this._resolveReady = null; }
        }
    },

    _renewLease() {
        if (!this.canWrite || this._mode !== 'lease') return;
        if (!this._ownsLease()) {
            this._loseOwnership('저장 소유권이 다른 탭으로 이동했습니다. 최신 저장을 표시합니다.');
            this._sync();
            return;
        }
        try {
            localStorage.setItem(`${this.key}:owner`, JSON.stringify({ owner: this._tabId, expiresAt: Date.now() + this._leaseDuration }));
        } catch (error) {
            this.storageAvailable = false;
            this._loseOwnership('저장소를 확인할 수 없어 다른 탭의 진행 보호를 위해 잠시 중지했습니다.');
        }
    },

    _releaseOwnership(nextOwner) {
        if (this._mode === 'lease' && this._ownsLease()) {
            try { localStorage.removeItem(`${this.key}:owner`); } catch (error) { /* Lease expires naturally. */ }
        }
        this._loseOwnership('다른 탭으로 게임 진행을 넘겼습니다.');
        this._broadcast({ type: 'released', target: nextOwner });
    },

    async requestOwnership() {
        if (this.canWrite) return true;
        this._broadcast({ type: 'request-ownership' });
        try {
            localStorage.setItem(`${this.key}:request`, JSON.stringify({ owner: this._tabId, requestedAt: Date.now() }));
        } catch (error) { /* BroadcastChannel remains available with blocked storage. */ }
        await new Promise(resolve => setTimeout(resolve, 200));
        if (this._mode === 'lock') this._tryLock();
        else await this._tryLease();
        await new Promise(resolve => setTimeout(resolve, 200));
        return this.canWrite;
    },

    takeOver() { return this.requestOwnership(); },

    close() {
        if (this.canWrite) this.save();
        this._closed = true;
        if (this._resolveReady) { this._resolveReady(false); this._resolveReady = null; }
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        this._releaseOwnership();
        if (this._channel) this._channel.close();
    },

    resume() {
        if (!this._closed) return this.ready;
        this._closed = false;
        this._startOwnership();
        return this.ready;
    },

    _handleOwnershipRequest(owner) {
        if (!this.canWrite || typeof owner !== 'string' || !owner || owner === this._tabId) return;
        if (!this.save()) {
            this._announce(this.recoveryRaw !== null ? 'corrupt-save' : 'storage-write',
                '진행을 안전하게 저장할 수 없어 탭 전환을 중지했습니다. 현재 탭에서 백업하거나 저장 문제를 해결하세요.');
            return;
        }
        this._holdUntil = Date.now() + 2500;
        this._releaseOwnership(owner);
    },

    _startOwnership() {
        if (typeof window === 'undefined') {
            this.canWrite = true;
            this.ready = Promise.resolve(true);
            return;
        }
        this.ready = new Promise(resolve => { this._resolveReady = resolve; });
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this._channel = new BroadcastChannel(`${this.key}:tabs`);
                this._channel.onmessage = event => {
                    const message = event.data || {};
                    if (message.owner === this._tabId) return;
                    if (message.type === 'saved' && !this.canWrite) this._sync();
                    if (message.type === 'released' && !this.canWrite && (!message.target || message.target === this._tabId)) {
                        if (this._mode === 'lock') this._tryLock();
                        else this._tryLease();
                    }
                    if (message.type === 'request-ownership' && this.canWrite) {
                        this._handleOwnershipRequest(message.owner);
                    }
                };
            } catch (error) { /* Exclusive locks/leases still protect the save. */ }
        }
        if (!this._boundEvents) window.addEventListener('storage', event => {
            if (event.key === this.key && !this.canWrite) this._sync();
            if (event.key === `${this.key}:owner` && this._mode === 'lease') {
                if (this.canWrite && !this._ownsLease()) {
                    this._loseOwnership('다른 탭으로 저장 소유권이 이동했습니다.');
                    this._sync();
                }
            }
            if (event.key === `${this.key}:request` && this.canWrite) {
                try {
                    const request = JSON.parse(event.newValue);
                    const age = request && Number.isSafeInteger(request.requestedAt) ? Date.now() - request.requestedAt : -1;
                    if (age >= 0 && age < 3000) this._handleOwnershipRequest(request.owner);
                } catch (error) { /* Invalid requests cannot alter ownership. */ }
            }
        });
        if (!this._boundEvents) {
            window.addEventListener('pagehide', () => Promise.resolve().then(() => this.close()));
            window.addEventListener('pageshow', event => { if (event.persisted) this.resume(); });
            this._boundEvents = true;
        }
        this._mode = typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request ? 'lock' : 'lease';
        if (this._mode === 'lock') this._tryLock();
        else this._tryLease();
        this._timer = setInterval(() => {
            if (this.canWrite) this._renewLease();
            else if (!this._closed) {
                if (this._mode === 'lock') this._tryLock();
                else this._tryLease();
            }
        }, 1500);
    }
};

function freezeSaveDefaults(value) {
    for (const child of Object.values(value)) {
        if (child && typeof child === 'object') freezeSaveDefaults(child);
    }
    return Object.freeze(value);
}

Data.def = freezeSaveDefaults(Data.createDefault());
Data.load();
Data._startOwnership();
