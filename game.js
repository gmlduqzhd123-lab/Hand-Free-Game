'use strict';

/* The same discrete battle rules drive visible play and away progress. */
const Simulation = {
    OFFLINE_LIMIT_MS: 86400000,
    names: ['졸음 슬라임', '낙서 유령', '먼지 뭉치', '종이 박쥐', '장난 도깨비'],
    bosses: ['왕관 슬라임', '칠판 낙서왕', '먼지 대장', '종이 비행용', '장난감 대마왕'],

    xpForLevel(level) { return GameLimits.xpForLevel(level); },
    getPlayerMultiplier(state) { return 1 + (state.player.level - 1) * 0.05; },
    getMultiplier(state) { return GameLimits.add(1, GameLimits.multiply(state.token, 0.1)); },
    getMilestoneMultiplier(level) { return level >= 100 ? 16 : level >= 50 ? 8 : level >= 25 ? 4 : level >= 10 ? 2 : 1; },
    getClickDamage(state) {
        let damage = GameLimits.multiply(state.stat.c.p, this.getMilestoneMultiplier(state.stat.c.l));
        damage = GameLimits.multiply(damage, state.relic[2] ? 1.5 : 1);
        damage = GameLimits.multiply(damage, GameLimits.add(1, state.comp.yu.p / 100));
        damage = GameLimits.multiply(damage, this.getMultiplier(state));
        damage = GameLimits.multiply(damage, 1 + Catalog.bonuses(state).clickPct);
        return Math.floor(GameLimits.multiply(damage, this.getPlayerMultiplier(state)));
    },
    getAutoDamage(state) {
        const base = GameLimits.add(GameLimits.multiply(state.stat.a.p, this.getMilestoneMultiplier(state.stat.a.l)), state.comp.na.p);
        let damage = GameLimits.multiply(GameLimits.multiply(base, state.relic[0] ? 1.5 : 1), this.getMultiplier(state));
        damage = GameLimits.multiply(damage, 1 + Catalog.bonuses(state).autoPct);
        return Math.floor(GameLimits.multiply(damage, this.getPlayerMultiplier(state)));
    },
    calcMobStats(state) {
        const boss = state.mob.boss;
        return {
            hp: Math.floor(GameLimits.multiply(GameLimits.multiply(100, GameLimits.pow(1.15, state.kills)), boss ? 6 : 1)),
            reward: Math.floor(GameLimits.multiply(Math.floor(GameLimits.multiply(GameLimits.multiply(15, GameLimits.pow(1.12, state.kills)), boss ? 5 : 1)), 1 + Catalog.bonuses(state).goldPct))
        };
    },
    bossDuration(state) { return (state.relic[3] ? 40000 : 30000) + Catalog.bonuses(state).bossSeconds * 1000; },
    getCriticalChance(state, now = Date.now()) { return state.buff.nightUntil > now ? 100 : Math.min(50, state.stat.crit.p + Catalog.bonuses(state).critPoints); },
    reconcile(state, now = Date.now()) {
        const maximum = this.calcMobStats(state).hp;
        // Saved partial damage is kept; only a new enemy receives full HP.
        state.mob.hp = Number.isFinite(state.mob.hp) && state.mob.hp > 0 ? Math.min(state.mob.hp, maximum) : maximum;
        if (state.mob.boss && !(state.mob.deadline > 0)) {
            state.mob.deadline = Math.ceil((state.lastActiveAt || now) + this.bossDuration(state));
        }
        if (!state.mob.boss) state.mob.deadline = 0;
        state.autoRemainder = Number.isFinite(state.autoRemainder) && state.autoRemainder >= 0 && state.autoRemainder < 1 ? state.autoRemainder : 0;
        state.xpRemainder = Number.isFinite(state.xpRemainder) && state.xpRemainder >= 0 && state.xpRemainder < 1 ? state.xpRemainder : 0;
        state.xpBonusRemainder = Number.isFinite(state.xpBonusRemainder) && state.xpBonusRemainder >= 0 && state.xpBonusRemainder < 1 ? state.xpBonusRemainder : 0;
        return state;
    },
    spawn(state, forceBoss = null, now = Date.now()) {
        // The supported counter limit continues as ordinary work, without repeated boss rewards.
        state.mob.boss = forceBoss === null ? state.kills > 0 && state.kills < GameLimits.MAX_COUNTER && state.kills % 100 === 0 : Boolean(forceBoss);
        state.mob.hp = this.calcMobStats(state).hp;
        state.mob.deadline = state.mob.boss ? Math.ceil(now + this.bossDuration(state)) : 0;
    },
    events() {
        return { gold: 0, goldGross: 0, gems: 0, kills: 0, bossKills: 0, bossExpired: 0, bossSpawned: 0, autoHits: 0, rushHits: 0, damage: 0, lastDamage: 0, lastReward: 0, critical: false, reachedFinish: false, elapsedMs: 0, capped: false, xpGained: 0, levelsGained: 0 };
    },
    gainXP(state, amount, events) {
        let remaining = Math.max(0, Math.floor(GameLimits.finite(amount)));
        while (remaining > 0 && state.player.level < GameLimits.MAX_LEVEL) {
            const needed = this.xpForLevel(state.player.level) - state.player.xp;
            const gained = Math.min(remaining, needed);
            state.player.xp += gained;
            remaining -= gained;
            events.xpGained = GameLimits.add(events.xpGained, gained);
            if (state.player.xp === this.xpForLevel(state.player.level)) {
                state.player.level += 1;
                state.player.xp = 0;
                events.levelsGained += 1;
            }
        }
        if (state.player.level === GameLimits.MAX_LEVEL) state.player.xp = 0;
    },
    clockRemainder(previous, elapsedMs) {
        // Keep fractional frames at full precision and only snap the second
        // boundary. Rounding every frame would accumulate at odd frame rates.
        const remainder = (previous * 1000 + elapsedMs) % 1000;
        return remainder < 0.000001 || 1000 - remainder < 0.000001 ? 0 : remainder / 1000;
    },
    expireBoss(state, events, now) {
        if (!state.mob.boss || state.mob.deadline > now) return false;
        // A milestone reached earlier in this frame or away interval must not
        // disappear when failure rolls the adventure back by one enemy.
        Ach.evaluate(state);
        state.min = Math.max(0, state.min - 1);
        state.kills = Math.max(0, state.kills - 1);
        this.spawn(state, false, now);
        events.bossExpired = Math.min(GameLimits.MAX_COUNTER, events.bossExpired + 1);
        return true;
    },
    damage(state, rawDamage, now, events, options = {}) {
        let damage = GameLimits.finite(rawDamage);
        if (!(damage > 0)) return false;
        // Automatic hits never crit. Avoid scanning equipment bonuses for every
        // automatic second of a long away interval.
        const chance = options.auto ? 0 : this.getCriticalChance(state, now);
        const critical = chance > 0 && (options.random || Math.random)() * 100 < chance;
        if (critical) damage = GameLimits.multiply(damage, state.relic[1] ? 5 : 3);
        events.lastDamage = damage;
        events.damage = GameLimits.add(events.damage, damage);
        events.critical = critical;
        if (damage < state.mob.hp) {
            state.mob.hp = GameLimits.finite(state.mob.hp - damage);
            return false;
        }

        const reward = this.calcMobStats(state).reward;
        const wasBoss = state.mob.boss;
        const oldKills = state.kills;
        state.kills = Math.min(GameLimits.MAX_COUNTER, state.kills + 1);
        events.kills = Math.min(GameLimits.MAX_COUNTER, events.kills + 1);
        events.lastReward = reward;
        events.goldGross = GameLimits.add(events.goldGross, reward);
        if (!options.offline) state.gold = GameLimits.add(state.gold, reward);
        if (wasBoss) {
            state.bossKills = Math.min(GameLimits.MAX_COUNTER, state.bossKills + 1);
            events.bossKills = Math.min(GameLimits.MAX_COUNTER, events.bossKills + 1);
            const gems = Math.min(GameLimits.MAX_NUMBER, 2 + Math.floor(state.kills / 100));
            state.gem = GameLimits.add(state.gem, gems);
            events.gems = GameLimits.add(events.gems, gems);
        }
        if (state.kills > oldKills && state.kills % 10 === 0) {
            const oldMinute = state.min;
            state.min = Math.min(GameLimits.MAX_COUNTER, state.min + 1);
            if (oldMinute < 40 && state.min >= 40) events.reachedFinish = true;
        }
        this.spawn(state, null, now);
        if (state.mob.boss) events.bossSpawned = Math.min(GameLimits.MAX_COUNTER, events.bossSpawned + 1);
        return true;
    },
    simulate(state, from, to, options = {}) {
        const start = Number.isFinite(from) ? Math.max(0, from) : Date.now();
        const finish = Number.isFinite(to) ? Math.max(start, to) : start;
        const offline = Boolean(options.offline);
        const end = offline ? Math.min(finish, start + this.OFFLINE_LIMIT_MS) : finish;
        const events = this.events();
        const initialGold = state.gold;
        events.elapsedMs = end - start;
        events.capped = end < finish;
        this.reconcile(state, start);
        this.expireBoss(state, events, start);

        let autoDamage = this.getAutoDamage(state);
        let clickDamage = this.getClickDamage(state);
        const remainderMs = state.autoRemainder * 1000;
        const xpRemainderMs = state.xpRemainder * 1000;
        const xpPerSecond = GameLimits.XP_PER_SECOND * (1 + Catalog.bonuses(state).xpPct);
        let nextAuto = autoDamage > 0 ? start + 1000 - remainderMs : Infinity;
        let nextXP = state.player.level < GameLimits.MAX_LEVEL ? start + 1000 - xpRemainderMs : Infinity;
        const rushStarted = state.skill.rush;
        let nextRush = !offline && state.buff.rushUntil > start
            ? rushStarted + (Math.floor((start - rushStarted) / 80) + 1) * 80 : Infinity;
        if (nextRush < start) nextRush = start + 80;
        if (nextRush > state.buff.rushUntil) nextRush = Infinity;

        while (true) {
            const deadline = state.mob.boss ? state.mob.deadline : Infinity;
            const next = Math.min(nextAuto, nextRush, nextXP, deadline);
            if (next > end + 0.000001 || !Number.isFinite(next)) break;
            // A wall-clock deadline wins ties with an attack, in visible and away play.
            if (deadline === next) {
                this.expireBoss(state, events, next);
                continue;
            }
            // A level earned at this second boosts attacks at the same timestamp.
            if (nextXP === next) {
                const previousLevel = state.player.level;
                // Equipment can grant a fraction of one XP. Carry that fraction
                // across seconds, saves, and offline chunks rather than losing it.
                const xpTotal = xpPerSecond + state.xpBonusRemainder;
                const xpWhole = Math.floor(xpTotal + 0.000000001);
                state.xpBonusRemainder = Math.max(0, Math.round((xpTotal - xpWhole) * 1000000000) / 1000000000);
                this.gainXP(state, xpWhole, events);
                nextXP = state.player.level < GameLimits.MAX_LEVEL ? nextXP + 1000 : Infinity;
                if (state.player.level !== previousLevel) {
                    autoDamage = this.getAutoDamage(state);
                    clickDamage = this.getClickDamage(state);
                }
                continue;
            }
            if (nextAuto === next) {
                // Skip consecutive nonlethal automatic hits in one operation. This bounds
                // catch-up work even when a large enemy takes thousands of seconds.
                const boundary = Math.min(end, nextRush, nextXP, deadline);
                const exclusive = boundary === nextRush || boundary === nextXP || boundary === deadline;
                const available = Math.max(0, Math.floor((boundary - nextAuto - (exclusive ? 0.000001 : 0)) / 1000) + 1);
                const needed = Math.ceil(state.mob.hp / autoDamage);
                const skipped = Math.min(available, Math.max(0, needed - 1));
                if (skipped > 1) {
                    const damage = GameLimits.multiply(autoDamage, skipped);
                    state.mob.hp = GameLimits.finite(state.mob.hp - damage);
                    events.lastDamage = autoDamage;
                    events.damage = GameLimits.add(events.damage, damage);
                    events.autoHits = Math.min(GameLimits.MAX_COUNTER, events.autoHits + skipped);
                    nextAuto += skipped * 1000;
                    continue;
                }
                this.damage(state, autoDamage, next, events, { auto: true, offline });
                events.autoHits = Math.min(GameLimits.MAX_COUNTER, events.autoHits + 1);
                nextAuto += 1000;
            } else {
                this.damage(state, clickDamage, next, events, { offline: false, random: options.random });
                events.rushHits = Math.min(GameLimits.MAX_COUNTER, events.rushHits + 1);
                nextRush += 80;
                if (nextRush > state.buff.rushUntil) nextRush = Infinity;
            }
        }

        if (offline) state.gold = GameLimits.add(initialGold, Math.floor(GameLimits.multiply(events.goldGross, 0.7)));
        events.gold = Math.max(0, state.gold - initialGold);
        state.autoRemainder = this.clockRemainder(state.autoRemainder, end - start);
        state.xpRemainder = this.clockRemainder(state.xpRemainder, end - start);
        // A capped away interval is consumed once. Timers still expire at the real time.
        this.expireBoss(state, events, finish);
        if (state.buff.rushUntil <= finish) state.buff.rushUntil = 0;
        if (state.buff.nightUntil <= finish) state.buff.nightUntil = 0;
        state.lastActiveAt = finish;
        Ach.evaluate(state);
        return events;
    }
};

const Ach = {
    list: [
        { id: 0, title: '첫 모험', desc: '몬스터 10마리 처치', condition: s => s.kills >= 10, rwd: 5 },
        { id: 1, title: '퇴근 예행 연습', desc: '16:10 보스 처치', condition: s => s.bossKills >= 1, rwd: 20 },
        { id: 2, title: '광란의 손가락', desc: '화면 500회 터치', condition: s => s.totalClicks >= 500, rwd: 15 },
        { id: 3, title: '교실의 보물', desc: '골드 100만 달성', condition: s => s.gold >= 1000000, rwd: 30 },
        { id: 4, title: '분필 마법사', desc: '분필 마법 Lv 50 달성', condition: s => s.stat.c.l >= 50, rwd: 50 },
        { id: 5, title: '첫 번째 준비물', desc: '상점 아이템 1종 구매', condition: s => Catalog.itemCount(s) >= 1, rwd: 3 },
        { id: 6, title: '설레는 책가방', desc: '상점 아이템 6종 보유', condition: s => Catalog.itemCount(s) >= 6, rwd: 8 },
        { id: 7, title: '준비물 전문가', desc: '상점 아이템 12종 보유', condition: s => Catalog.itemCount(s) >= 12, rwd: 15 },
        { id: 8, title: '완벽한 교실', desc: '상점 아이템 24종 모두 보유', condition: s => Catalog.itemCount(s) >= 24, rwd: 30 },
        { id: 9, title: '차곡차곡 성장', desc: '아이템 레벨 합계 25 달성', condition: s => Catalog.totalItemLevels(s) >= 25, rwd: 5 },
        { id: 10, title: '마법의 준비물함', desc: '아이템 레벨 합계 100 달성', condition: s => Catalog.totalItemLevels(s) >= 100, rwd: 15 },
        { id: 11, title: '교실의 장인', desc: '아이템 레벨 합계 300 달성', condition: s => Catalog.totalItemLevels(s) >= 300, rwd: 30 },
        { id: 12, title: '반짝이는 완성', desc: '모든 아이템 Lv 25 달성', condition: s => Catalog.totalItemLevels(s) >= 600, rwd: 80 },
        { id: 13, title: '분필에 담긴 힘', desc: '추가 공격 아이템 레벨 합계 10 달성', condition: s => Catalog.categoryLevels('click', s) >= 10, rwd: 8 },
        { id: 14, title: '든든한 교실 친구', desc: '자동 공격 아이템 레벨 합계 10 달성', condition: s => Catalog.categoryLevels('auto', s) >= 10, rwd: 8 },
        { id: 15, title: '배움의 즐거움', desc: '경험치 아이템 레벨 합계 10 달성', condition: s => Catalog.categoryLevels('xp', s) >= 10, rwd: 8 },
        { id: 16, title: '알뜰한 선생님', desc: '골드 아이템 레벨 합계 10 달성', condition: s => Catalog.categoryLevels('gold', s) >= 10, rwd: 8 },
        { id: 17, title: '반짝이는 눈', desc: '치명타 아이템 2종 보유', condition: s => Catalog.items.filter(item => item.category === 'crit' && Catalog.itemLevel(item, s) > 0).length >= 2, rwd: 8 },
        { id: 18, title: '마음의 여유', desc: '보스 시간 아이템 레벨 합계 20 달성', condition: s => Catalog.categoryLevels('boss', s) >= 20, rwd: 12 },
        { id: 19, title: '신나는 첫 수업', desc: '선생님 Lv 5 달성', condition: s => s.player.level >= 5, rwd: 5 },
        { id: 20, title: '교실의 길잡이', desc: '선생님 Lv 10 달성', condition: s => s.player.level >= 10, rwd: 10 },
        { id: 21, title: '성장하는 선생님', desc: '선생님 Lv 25 달성', condition: s => s.player.level >= 25, rwd: 25 },
        { id: 22, title: '별빛 선생님', desc: '선생님 Lv 50 달성', condition: s => s.player.level >= 50, rwd: 50 },
        { id: 23, title: '백 번의 작은 승리', desc: '현재 모험에서 몬스터 100마리 처치', condition: s => s.kills >= 100, rwd: 10 },
        { id: 24, title: '교실 수호대장', desc: '현재 모험에서 몬스터 300마리 처치', condition: s => s.kills >= 300, rwd: 20 },
        { id: 25, title: '겁 없는 선생님', desc: '보스 누적 10마리 처치', condition: s => s.bossKills >= 10, rwd: 30 },
        { id: 26, title: '반짝 마법 연습', desc: '추가 공격 누적 2,000회', condition: s => s.totalClicks >= 2000, rwd: 20 },
        { id: 27, title: '마법의 달인', desc: '추가 공격 누적 10,000회', condition: s => s.totalClicks >= 10000, rwd: 50 },
        { id: 28, title: '교실 보물 도감', desc: '유물 20종 모두 수집', condition: s => Catalog.relicCount(s) >= 20, rwd: 60 },
        { id: 29, title: '꾸준한 배움', desc: '연수학점 100 달성', condition: s => s.token >= 100, rwd: 30 }
    ],
    isClaimed(id, state = Data.state) { return Boolean(id < 5 ? state.ach[id] : state.extraAch && state.extraAch[id - 5]); },
    isReady(id, state = Data.state) { return Boolean(id < 5 ? state.achReady[id] : state.extraAchReady && state.extraAchReady[id - 5]); },
    setReady(id, state) {
        if (id < 5) state.achReady[id] = true;
        else { if (!state.extraAchReady) state.extraAchReady = Array(25).fill(false); state.extraAchReady[id - 5] = true; }
    },
    setClaimed(id, state) {
        if (id < 5) state.ach[id] = true;
        else { if (!state.extraAch) state.extraAch = Array(25).fill(false); state.extraAch[id - 5] = true; }
    },
    evaluate(state) {
        let changed = false;
        this.list.forEach(a => {
            if (!this.isReady(a.id, state) && (this.isClaimed(a.id, state) || a.condition(state))) {
                this.setReady(a.id, state);
                changed = true;
            }
        });
        return changed;
    },
    canClaim(id, state = Data.state) {
        const achievement = this.list[id];
        return Boolean(achievement && !this.isClaimed(id, state) && (this.isReady(id, state) || achievement.condition(state)));
    },
    check() {
        const changed = this.evaluate(Data.state);
        if (typeof document !== 'undefined') {
            const notification = document.getElementById('noti-ach');
            if (notification) notification.classList.toggle('show', this.list.some(a => this.canClaim(a.id)));
        }
        if (changed && typeof UI !== 'undefined') UI.renderAch();
        return changed;
    },
    claim(id) {
        if (!Logic.canAct()) return false;
        Logic.catchUp();
        if (!this.canClaim(id)) return false;
        const candidate = Logic.cloneState();
        this.evaluate(candidate);
        this.setClaimed(id, candidate);
        candidate.gem = GameLimits.add(candidate.gem, this.list[id].rwd);
        if (!Logic.commit(candidate)) return false;
        Logic.sound('ach');
        Logic.toast(`🏆 업적 달성! 💎 ${this.list[id].rwd} 획득`);
        this.check();
        Logic.render();
        return true;
    }
};
Ach.list.forEach(achievement => {
    achievement.goal = (state = Data.state) => Boolean(Ach.isReady(achievement.id, state) || achievement.condition(state));
});

const Logic = {
    names: Simulation.names,
    bosses: Simulation.bosses,
    curMaxHp: 100,
    curRwd: 15,
    bossTime: 0,
    bossMax: 30,
    bossActive: false,
    isNight: false,
    canAct() { return Data.canWrite !== false && (typeof GameApp === 'undefined' || GameApp.playing) && !(typeof document !== 'undefined' && document.hidden); },
    rebaseClock(now = Date.now()) {
        if (Data.canWrite === false || !Number.isFinite(now) || now < 0) return false;
        const state = Data.state;
        const anchor = Math.max(state.lastActiveAt, state.savedAt);
        if (!(anchor > now)) return false;
        const offset = anchor - now;
        const shift = timestamp => timestamp > 0 ? Math.max(0, Math.ceil(timestamp - offset)) : 0;
        // This accepts the actual present time only. Simulation's historical
        // start/end timestamps must never be mistaken for a changed device clock.
        state.lastActiveAt = shift(state.lastActiveAt);
        state.savedAt = shift(state.savedAt);
        for (const name of ['rush', 'night']) state.skill[name] = shift(state.skill[name]);
        for (const name of ['rushUntil', 'nightUntil']) state.buff[name] = shift(state.buff[name]);
        state.mob.deadline = shift(state.mob.deadline);
        return true;
    },
    catchUp(now = Date.now()) {
        if (!this.canAct()) return Simulation.events();
        this.rebaseClock(now);
        if (Data.state.lastActiveAt < now) return this.advance(Data.state.lastActiveAt, now);
        return Simulation.events();
    },
    cloneState() { return JSON.parse(JSON.stringify(Data.state)); },
    commit(candidate) {
        if (Data.save(candidate, { allowMemory: Data.storageAvailable === false })) return true;
        this.toast('저장하지 못해 변경을 취소했습니다. 저장 공간과 브라우저 설정을 확인하세요.');
        return false;
    },
    sound(name) { if (typeof Sys !== 'undefined' && Sys.sfx && Sys.sfx[name]) Sys.sfx[name](); },
    toast(message) { if (typeof Sys !== 'undefined' && Sys.toast) Sys.toast(message); },
    render() { if (typeof UI !== 'undefined') UI.renderAll(); },
    sync(now = Date.now()) {
        const stats = Simulation.calcMobStats(Data.state);
        this.curMaxHp = stats.hp;
        this.curRwd = stats.reward;
        this.bossActive = Data.state.mob.boss;
        this.bossMax = Simulation.bossDuration(Data.state) / 1000;
        this.bossTime = this.bossActive ? Math.max(0, (Data.state.mob.deadline - now) / 1000) : 0;
        this.isNight = Data.state.buff.nightUntil > now;
    },
    reconcile(now = Date.now()) { Simulation.reconcile(Data.state, now); this.sync(now); Ach.check(); },
    calcMobStats() { this.sync(); return { hp: this.curMaxHp, reward: this.curRwd }; },
    getMul(state = Data.state) { return Simulation.getMultiplier(state); },
    getMileMul(level) { return Simulation.getMilestoneMultiplier(level); },
    getC_Dmg(state = Data.state) { return Simulation.getClickDamage(state); },
    getA_Dmg(state = Data.state) { return Simulation.getAutoDamage(state); },
    spawn(forceBoss = null, now = Date.now()) {
        Simulation.spawn(Data.state, forceBoss, now);
        this.sync(now);
        Ach.check();
        this.render();
    },
    effects(events, x, y, auto = false) {
        if (!(events.lastDamage > 0)) return;
        if (typeof Sys !== 'undefined') {
            if (Sys.hitEffect) Sys.hitEffect();
            if (events.critical && Sys.shake) Sys.shake('light');
        }
        if (events.critical) this.sound('crit'); else if (!auto) this.sound('hit');
        if (typeof VFX !== 'undefined') {
            if (VFX.hit) VFX.hit();
            const center = VFX.center ? VFX.center() : { x: VFX.cvs.width / 2, y: VFX.cvs.height / 2 };
            if (!Number.isFinite(x) || !Number.isFinite(y)) { x = center.x; y = center.y; }
            VFX.add((events.critical ? '치명타 ' : '-') + (typeof fNum === 'function' ? fNum(events.lastDamage) : events.lastDamage), x, y, auto ? 'auto' : events.critical ? 'crit' : 'normal');
            if (events.kills > 0) VFX.add('골드 +' + (typeof fNum === 'function' ? fNum(events.gold) : events.gold), center.x, center.y - 20, 'gold');
        }
        if (events.kills > 0) {
            this.sound('coin');
            if (typeof VFX !== 'undefined' && VFX.celebrate) VFX.celebrate();
        }
    },
    notify(events, offline = false) {
        const messages = [];
        if (offline) {
            if (events.gold > 0 || events.kills > 0 || events.xpGained > 0) messages.push(`⏰ 자리 비움 성장 완료!<br>EXP +${typeof fNum === 'function' ? fNum(events.xpGained) : events.xpGained} · 💰${typeof fNum === 'function' ? fNum(events.gold) : events.gold} · ${events.kills}마리 처치${events.capped ? ' (최대 24시간)' : ''}`);
            if (events.bossExpired > 0) messages.push('⏳ 자리 비움 중 보스가 달아났어요. 다시 도전해 보세요.');
        } else {
            if (events.bossExpired > 0) { this.sound('err'); messages.push('⏳ 보스가 달아났어요. 성장하고 다시 도전!'); }
            if (events.bossKills > 0) messages.push(`🎉 보스 격파! 💎${typeof fNum === 'function' ? fNum(events.gems) : events.gems} 획득`);
            if (events.bossSpawned > 0 && typeof Sys !== 'undefined' && Sys.shake) Sys.shake('hard');
        }
        if (events.levelsGained > 0) {
            messages.push(`✨ Lv ${Data.state.player.level} 달성!${events.levelsGained > 1 ? ` (+${events.levelsGained} 레벨)` : ''} 공격력 +${Math.round((Data.state.player.level - 1) * 5)}%`);
            if (!offline && typeof VFX !== 'undefined' && VFX.levelUp) VFX.levelUp();
        }
        if (events.reachedFinish) messages.push('🎉 16:40 달성! 오늘의 교실을 지켰어요. 모험을 계속하거나 내일의 모험을 시작하세요.');
        if (messages.length) this.toast(messages.join('<br>'));
    },
    advance(from, to, options = {}) {
        if (Data.canWrite === false) { this.sync(to); return Simulation.events(); }
        const events = Simulation.simulate(Data.state, from, to, options);
        this.sync(to);
        Ach.check();
        if (!options.offline && !options.silent) this.effects(events, undefined, undefined, events.rushHits === 0);
        if (!options.silent) this.notify(events, Boolean(options.offline));
        if (options.render !== false) {
            if (events.kills || events.bossExpired) this.render();
            else if (typeof UI !== 'undefined') { UI.renderHp(); UI.renderRes(); }
        }
        return events;
    },
    hit(damage, x, y, isAuto = false, now = Date.now()) {
        if (!this.canAct()) return false;
        this.catchUp(now);
        const events = Simulation.events();
        const oldGold = Data.state.gold;
        Simulation.expireBoss(Data.state, events, now);
        Simulation.damage(Data.state, damage, now, events, { auto: isAuto });
        events.gold = Math.max(0, Data.state.gold - oldGold);
        this.sync(now);
        this.effects(events, x, y, isAuto);
        this.notify(events);
        Ach.check();
        if (events.kills || events.bossExpired) { this.render(); Data.save(); }
        else if (typeof UI !== 'undefined') { UI.renderHp(); UI.renderRes(); }
        return events;
    },
    getUpgrade(type, state = Data.state) {
        const key = ({ 'up-click': 'click', c: 'click', 'up-auto': 'auto', a: 'auto', 'up-crit': 'crit', 'up-comp1': 'comp1', na: 'comp1', 'up-comp2': 'comp2', yu: 'comp2' })[type] || type;
        const definitions = {
            click: { current: state.stat.c, growth: 1.5, apply: s => { s.p = Math.floor(GameLimits.add(GameLimits.multiply(s.p, 1.4), 5)); } },
            auto: { current: state.stat.a, growth: 1.6, apply: s => { s.p = s.l === 1 ? 5 : Math.floor(GameLimits.add(GameLimits.multiply(s.p, 1.4), 2)); } },
            crit: { current: state.stat.crit, growth: 2, apply: s => { s.p = Math.min(50, s.p + 1); } },
            comp1: { current: state.comp.na, growth: 1.8, apply: s => { s.p = Math.floor(GameLimits.add(GameLimits.multiply(s.p, 1.5), 50)); } },
            comp2: { current: state.comp.yu, growth: 2.2, apply: s => { s.p = GameLimits.add(s.p, 10); } }
        };
        return definitions[key] ? { ...definitions[key], key } : null;
    },
    isUpgradeMaxed(type, state = Data.state) {
        const upgrade = this.getUpgrade(type, state);
        return !upgrade || upgrade.current.l >= GameLimits.MAX_LEVEL || upgrade.current.p >= GameLimits.MAX_NUMBER ||
            (upgrade.key === 'crit' && upgrade.current.p + Catalog.bonuses(state).critPoints >= 50);
    },
    canUpgrade(type, state = Data.state) {
        const upgrade = this.getUpgrade(type, state);
        return Boolean(upgrade && !this.isUpgradeMaxed(type, state) && state.gold >= upgrade.current.c);
    },
    upgrade(type) {
        if (!this.canAct()) return false;
        this.catchUp();
        if (!this.canUpgrade(type)) return false;
        const candidate = this.cloneState();
        const upgrade = this.getUpgrade(type, candidate);
        candidate.gold = Math.max(0, candidate.gold - upgrade.current.c);
        upgrade.current.l += 1;
        upgrade.current.c = Math.floor(GameLimits.multiply(upgrade.current.c, upgrade.growth));
        upgrade.apply(upgrade.current);
        Ach.evaluate(candidate);
        if (!this.commit(candidate)) return false;
        this.sound('btn');
        this.sync();
        Ach.check();
        this.render();
        return true;
    },
    // Legacy callers use the button id; state objects are resolved afresh after a transaction.
    up(type) { return this.upgrade(type); },
    buyItem(id) {
        if (!this.canAct()) return false;
        const item = Catalog.getItem(id);
        if (!item) return false;
        this.catchUp();
        if (!Catalog.canBuyItem(item)) return false;
        const candidate = this.cloneState();
        candidate.gold = Math.max(0, candidate.gold - Catalog.itemCost(item, candidate));
        if (!candidate.items) candidate.items = {};
        candidate.items[item.id] = Catalog.itemLevel(item, candidate) + 1;
        if (candidate.mob.boss && item.category === 'boss') {
            const seconds = Catalog.bonuses(candidate).bossSeconds - Catalog.bonuses(Data.state).bossSeconds;
            candidate.mob.deadline = Math.min(8640000000000000, Math.ceil(candidate.mob.deadline + seconds * 1000));
        }
        Ach.evaluate(candidate);
        if (!this.commit(candidate)) return false;
        this.sound('btn');
        this.sync();
        Ach.check();
        this.render();
        return true;
    },
    pullGacha(random = Math.random) {
        if (!this.canAct()) return false;
        this.catchUp();
        if (Data.state.gem < 10) return false;
        const available = Catalog.relics.flatMap((_, index) => Catalog.ownedRelic(index) ? [] : [index]);
        if (!available.length) { this.toast('모든 유물을 모았습니다!'); return false; }
        const candidate = this.cloneState();
        candidate.gem -= 10;
        const sample = random();
        if (!Number.isFinite(sample)) return false;
        const chosen = available[Math.min(available.length - 1, Math.max(0, Math.floor(sample * available.length)))];
        if (chosen < 4) candidate.relic[chosen] = true;
        else {
            if (!candidate.extraRelics) candidate.extraRelics = Array(16).fill(false);
            candidate.extraRelics[chosen - 4] = true;
        }
        if (candidate.mob.boss) {
            const duration = Simulation.bossDuration(candidate) - Simulation.bossDuration(Data.state);
            candidate.mob.deadline = Math.min(8640000000000000, Math.ceil(candidate.mob.deadline + duration));
        }
        Ach.evaluate(candidate);
        if (!this.commit(candidate)) return false;
        this.sound('gacha');
        this.toast(`🎁 ${Catalog.relics[chosen].name} 발견! (${Catalog.relicCount(candidate)}/${Catalog.relics.length})`);
        this.sync();
        Ach.check();
        this.render();
        return true;
    },
    prestige() {
        if (!this.canAct()) return false;
        this.catchUp();
        if (Data.state.min <= 0) { this.toast('모험을 더 진행하면 연수학점을 받을 수 있어요.'); return false; }
        const approved = typeof confirm !== 'function' || confirm(`현재 모험을 정산하고 다음 모험을 시작할까요?\n연수학점 🏅${typeof fNum === 'function' ? fNum(Data.state.min) : Data.state.min} 획득!`);
        // Native confirmation stops JavaScript, while wall-clock battle and XP
        // time still pass. Settle it before preserving growth or resetting timers.
        if (!this.canAct()) return false;
        this.catchUp();
        if (!approved) return false;
        if (Data.state.min <= 0) { this.toast('보스 도전 결과를 반영했어요. 모험을 더 진행한 뒤 다시 정산하세요.'); return false; }
        const previous = this.cloneState();
        Ach.evaluate(previous);
        const candidate = Data.createDefault();
        candidate.token = GameLimits.add(previous.token, previous.min);
        candidate.gem = previous.gem;
        candidate.relic = previous.relic.slice();
        candidate.ach = previous.ach.slice();
        candidate.achReady = previous.achReady.slice();
        candidate.items = { ...previous.items };
        candidate.extraRelics = (previous.extraRelics || Array(16).fill(false)).slice();
        candidate.extraAch = (previous.extraAch || Array(25).fill(false)).slice();
        candidate.extraAchReady = (previous.extraAchReady || Array(25).fill(false)).slice();
        candidate.totalClicks = previous.totalClicks;
        candidate.bossKills = previous.bossKills;
        candidate.player = { ...previous.player };
        candidate.xpRemainder = previous.xpRemainder;
        candidate.xpBonusRemainder = previous.xpBonusRemainder || 0;
        candidate.skill = { ...previous.skill };
        candidate.sound = previous.sound;
        candidate.character = previous.character;
        candidate.hasStarted = previous.hasStarted;
        candidate.revision = previous.revision;
        if (!this.commit(candidate)) return false;
        this.sync();
        Ach.check();
        this.render();
        this.toast('🏅 연수학점을 받고 다음 모험을 시작했어요.');
        return true;
    }
};

const Combat = {
    sk: { rush: { cd: 60, d: 5 }, night: { cd: 90, d: 10 } },
    attack(x, y, now = Date.now()) {
        if (!Logic.canAct()) return false;
        // Settle passive levels before measuring this manual attack's damage.
        Logic.catchUp(now);
        Data.state.totalClicks = Math.min(GameLimits.MAX_COUNTER, Data.state.totalClicks + 1);
        return Logic.hit(Logic.getC_Dmg(), x, y, false, now);
    },
    useSkill(type, now = Date.now()) {
        const skill = this.sk[type];
        if (!skill || !Logic.canAct()) return false;
        Logic.catchUp(now);
        if (Data.state.skill[type] > 0 && now - Data.state.skill[type] < skill.cd * 1000) return false;
        const candidate = Logic.cloneState();
        candidate.skill[type] = now;
        candidate.buff[`${type}Until`] = now + skill.d * 1000;
        if (!Logic.commit(candidate)) return false;
        Logic.sound('gacha');
        Logic.toast(type === 'rush' ? '반짝 분필 · 5초간 빠른 마법 공격' : '칭찬의 마법 · 10초간 추가 공격 치명타 100%');
        Logic.sync(now);
        Logic.render();
        return true;
    }
};
