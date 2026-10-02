'use strict';

/* Save version 4 keeps the existing storage key and migrates older backups. */
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

class SaveValidationError extends Error {
    constructor(message) { super(message); this.name = 'SaveValidationError'; }
}

const Data = {
    key: 'ys_bugfree_final_v2',
    version: 4,
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
            version: 4,
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
            character: 'female', hasStarted: false
        };
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
        object(raw, '저장 데이터');
        if (!['gold', 'kills', 'stat', 'comp', 'mob', 'totalClicks', 'min', 'gem', 'token']
            .some(field => own(raw, field))) {
            throw new SaveValidationError('게임 저장 데이터가 아닙니다.');
        }
        if (own(raw, 'version') && ![1, 2, 3, 4].includes(raw.version)) {
            throw new SaveValidationError('지원하지 않는 저장 버전입니다.');
        }
        const state = this.createDefault();
        if (raw.version === 3 || raw.version === 4) {
            for (const field of Object.keys(state)) {
                // Optional presentation and collection fields keep existing v3/v4 saves valid.
                if (['character', 'hasStarted', 'items', 'extraRelics', 'extraAch', 'extraAchReady', 'xpBonusRemainder'].includes(field)) continue;
                if (raw.version === 3 && ['player', 'xpRemainder'].includes(field)) continue;
                if (!own(raw, field)) throw new SaveValidationError(`${field}의 저장 정보가 누락되었습니다.`);
            }
            if (raw.version === 4) {
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
                    ((strict || raw.version === 3 || raw.version === 4) && !['l', 'p', 'c'].every(part => own(item, part)))) {
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
        // Existing players who never bought automatic work receive the same free
        // starter as a new game. Their gold and original upgrade cost are retained.
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
                // Collection levels never silently clamp, including when loading a saved file.
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
        // Older saves already represent a played game and retain away rewards.
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
        // A clock rollback moves every absolute timer together. The latest known
        // clock anchors the offset; a played memory-only backup may have no savedAt.
        const now = Date.now();
        const legacyClock = !own(raw, 'version') || raw.version < 3;
        const clockAnchor = Math.max(state.savedAt, legacyClock || state.hasStarted ? state.lastActiveAt : 0);
        const rollback = Math.max(0, clockAnchor - now);
        if (rollback > 0) {
            const shift = value => value > 0 ? Math.max(0, value - rollback) : 0;
            state.lastActiveAt = shift(state.lastActiveAt);
            state.savedAt = shift(state.savedAt);
            for (const field of ['rush', 'night']) state.skill[field] = shift(state.skill[field]);
            for (const field of ['rushUntil', 'nightUntil']) state.buff[field] = shift(state.buff[field]);
            state.mob.deadline = shift(state.mob.deadline);
        }
        state.lastActiveAt = Math.min(now, state.lastActiveAt);
        // Legacy saves did not count defeated bosses. The first boss is alive at 100 kills.
        if (!own(raw, 'bossKills')) state.bossKills = Math.floor(Math.max(0, state.kills - 1) / 100);
        state.achReady = state.achReady.map((value, index) => value || state.ach[index]);
        state.extraAchReady = state.extraAchReady.map((value, index) => value || state.extraAch[index]);
        if (state.kills >= 10) state.achReady[0] = true;
        if (state.bossKills > 0) state.achReady[1] = true;
        if (state.totalClicks >= 500) state.achReady[2] = true;
        if (state.gold >= 1000000) state.achReady[3] = true;
        if (state.stat.c.l >= 50) state.achReady[4] = true;
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
        // Preserve in memory even if quota or browser policy prevents a recovery copy.
        try {
            if (localStorage.getItem(`${this.key}:recovery`) === null) {
                localStorage.setItem(`${this.key}:recovery`, raw);
            }
        } catch (error) { /* The settings screen can still download recoveryRaw. */ }
    },

    getRecovery() { return this.recoveryRaw; },

    load() {
        const result = this._read(this.key);
        if (!result.ok) {
            // Permission can disappear between the initial read and ownership
            // acquisition. Keep any progress we have already read successfully.
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
            this.state = this.normalize(JSON.parse(result.raw));
            this._revision = this.state.revision;
            // A repaired live save ends recovery mode; the historical recovery key remains.
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
            // Without a lock or a lease no tab may touch the shared save, even
            // when the main key is writable but the lease key is not.
            if (!options.allowMemory) return false;
            if (candidate !== undefined) this.state = next;
            this.storageAvailable = false;
            this._announce('storage-write', '이 탭에서 임시로 진행 중입니다. 진행을 보관하려면 백업을 내려받으세요.');
            return true;
        }
        const storedRevision = this._storedRevision(Boolean(options.replaceRecovery));
        if (this.recoveryRaw !== null && !options.replaceRecovery) return false;
        if (storedRevision === null) {
            // Never overwrite an unknown existing save when its revision cannot be read.
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
                // With storage blocked there is no shared progress to overwrite.
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
            // The confirmation window resolves simultaneous startup contenders before gameplay.
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
                        // Explicit tab handoff saves before releasing the exclusive writer.
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
            // Let the application flush the final combat interval before releasing ownership.
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
