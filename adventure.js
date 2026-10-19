'use strict';

const Adventure = {
    locations: Object.freeze([
        Object.freeze({
            id: 'classroom',
            name: '햇살 교실',
            shortName: '교실',
            checkpoint: 0,
            themeClass: 'loc-classroom',
            desc: '반짝이는 칠판과 책상이 놓인 첫 번째 모험 교실입니다.',
            enterStoryId: 'enter-classroom',
            enterStory: '수업이 끝난 교실에 귀여운 방해꾼들이 나타났어요! 분필 지팡이를 들고 첫 모험을 시작합니다.',
            clearStoryId: 'clear-100',
            clearStory: '100구간 보스를 물리치고 책 향기가 가득한 도서관으로 가는 복도가 열렸습니다!'
        }),
        Object.freeze({
            id: 'library',
            name: '별빛 도서관',
            shortName: '도서관',
            checkpoint: 100,
            themeClass: 'loc-library',
            desc: '책장 사이로 이야기 별빛이 반짝이는 조용한 도서관입니다.',
            enterStoryId: 'enter-library',
            enterStory: '도서관 요정이 책장 사이에서 반갑게 인사하며 경험치 성장을 도와주기 시작했어요.',
            clearStoryId: 'clear-200',
            clearStory: '200구간 보스를 정리하고 신기한 실험 기구가 가득한 과학실 문을 열었습니다!'
        }),
        Object.freeze({
            id: 'science',
            name: '무지개 과학실',
            shortName: '과학실',
            checkpoint: 200,
            themeClass: 'loc-science',
            desc: '모래시계와 프리즘 빛이 어우러진 호기심 가득한 과학실입니다.',
            enterStoryId: 'enter-science',
            enterStory: '과학 요정이 정밀한 모래시계를 맞추어 보스 도전 제한 시간을 늘려 주었습니다.',
            clearStoryId: 'clear-300',
            clearStory: '300구간 보스를 돌파하고 경쾌한 리듬이 울려 퍼지는 체육관으로 향합니다!'
        }),
        Object.freeze({
            id: 'gym',
            name: '활기찬 체육관',
            shortName: '체육관',
            checkpoint: 300,
            themeClass: 'loc-gym',
            desc: '넓은 코트와 응원 소리가 가득한 에너지 넘치는 체육관입니다.',
            enterStoryId: 'enter-gym',
            enterStory: '음악 요정의 경쾌한 행진곡이 울려 퍼져 마법 기술의 재사용 시간이 빨라집니다.',
            clearStoryId: 'clear-400',
            clearStory: '400구간 보스까지 모두 물리쳤어요! 드디어 4시 40분의 학교 정문이 열립니다!'
        }),
        Object.freeze({
            id: 'gate',
            name: '노을빛 학교 정문',
            shortName: '학교 정문',
            checkpoint: 400,
            themeClass: 'loc-gate',
            desc: '따뜻한 노을이 비추는 4시 40분의 학교 정문, 자유 모험이 이어지는 공간입니다.',
            enterStoryId: 'enter-gate',
            enterStory: '정리 요정과 함께 학교 정문에 도착했습니다! 이제 정문 너머로 자유 모험을 이어갈 수 있어요.',
            clearStoryId: null,
            clearStory: ''
        })
    ]),

    companions: Object.freeze([
        Object.freeze({
            id: 'na',
            name: '체육 요정',
            role: '자동 공격',
            legacy: true,
            unlockCheckpoint: 0,
            unlockLocation: 'classroom',
            unlockText: '기본 동행 동료',
            baseCost: 2000,
            costGrowth: 1.5,
            maxLevel: GameLimits.MAX_LEVEL,
            effectLabel: '자동 공격력',
            unit: '',
            getEffectValue(state) {
                return state && state.comp && state.comp.na ? state.comp.na.p : 0;
            },
            formatEffect(state) {
                const val = this.getEffectValue(state);
                return `자동 공격 +${Math.floor(val)}`;
            }
        }),
        Object.freeze({
            id: 'yu',
            name: '응원 요정',
            role: '추가 공격',
            legacy: true,
            unlockCheckpoint: 0,
            unlockLocation: 'classroom',
            unlockText: '기본 동행 동료',
            baseCost: 5000,
            costGrowth: 1.6,
            maxLevel: GameLimits.MAX_LEVEL,
            effectLabel: '추가 공격 보너스',
            unit: '%',
            getEffectValue(state) {
                return state && state.comp && state.comp.yu ? state.comp.yu.p : 0;
            },
            formatEffect(state) {
                const val = this.getEffectValue(state);
                return `추가 공격 +${Math.floor(val)}%`;
            }
        }),
        Object.freeze({
            id: 'library',
            name: '도서관 요정',
            role: '경험치 성장',
            legacy: false,
            unlockCheckpoint: 100,
            unlockLocation: 'library',
            unlockText: '100 구간 보스 격파',
            baseCost: 5000,
            costGrowth: 1.8,
            maxLevel: 25,
            perLevel: 0.01,
            bonusKey: 'xpPercent',
            effectLabel: '경험치 보너스',
            unit: '%',
            getEffectValue(state) {
                const entry = state && state.extraCompanions && state.extraCompanions.library;
                const level = entry ? Math.min(this.maxLevel, Math.max(0, Math.floor(entry.l || 0))) : 0;
                return level;
            },
            formatEffect(state) {
                const pct = this.getEffectValue(state);
                return `경험치 +${pct}%`;
            }
        }),
        Object.freeze({
            id: 'science',
            name: '과학 요정',
            role: '보스 시간',
            legacy: false,
            unlockCheckpoint: 200,
            unlockLocation: 'science',
            unlockText: '200 구간 보스 격파',
            baseCost: 8000,
            costGrowth: 1.8,
            maxLevel: 25,
            perLevel: 0.2,
            bonusKey: 'bossSeconds',
            effectLabel: '보스 제한 시간',
            unit: '초',
            getEffectValue(state) {
                const entry = state && state.extraCompanions && state.extraCompanions.science;
                const level = entry ? Math.min(this.maxLevel, Math.max(0, Math.floor(entry.l || 0))) : 0;
                return Math.round(level * 2) / 10;
            },
            formatEffect(state) {
                const sec = this.getEffectValue(state);
                return `보스 시간 +${sec.toFixed(1)}초`;
            }
        }),
        Object.freeze({
            id: 'music',
            name: '음악 요정',
            role: '재사용 단축',
            legacy: false,
            unlockCheckpoint: 300,
            unlockLocation: 'gym',
            unlockText: '300 구간 보스 격파',
            baseCost: 10000,
            costGrowth: 1.8,
            maxLevel: 20,
            perLevel: 0.01,
            bonusKey: 'cooldownReduction',
            effectLabel: '스킬 재사용 단축',
            unit: '%',
            getEffectValue(state) {
                const entry = state && state.extraCompanions && state.extraCompanions.music;
                const level = entry ? Math.min(this.maxLevel, Math.max(0, Math.floor(entry.l || 0))) : 0;
                return level;
            },
            formatEffect(state) {
                const pct = this.getEffectValue(state);
                return `재사용 시간 -${pct}%`;
            }
        }),
        Object.freeze({
            id: 'tidy',
            name: '정리 요정',
            role: '골드 수집',
            legacy: false,
            unlockCheckpoint: 400,
            unlockLocation: 'gate',
            unlockText: '400 구간 보스 격파',
            baseCost: 12000,
            costGrowth: 1.8,
            maxLevel: 25,
            perLevel: 0.01,
            bonusKey: 'goldPercent',
            effectLabel: '골드 보너스',
            unit: '%',
            getEffectValue(state) {
                const entry = state && state.extraCompanions && state.extraCompanions.tidy;
                const level = entry ? Math.min(this.maxLevel, Math.max(0, Math.floor(entry.l || 0))) : 0;
                return level;
            },
            formatEffect(state) {
                const pct = this.getEffectValue(state);
                return `골드 +${pct}%`;
            }
        })
    ]),

    synergies: Object.freeze([
        Object.freeze({
            id: 'library-tidy',
            name: '도서관 + 정리 요정 조합',
            members: Object.freeze(['library', 'tidy']),
            desc: '경험치 +5%p, 골드 +5%p 추가 보너스',
            xpBonus: 0.05,
            goldBonus: 0.05,
            bossSeconds: 0
        }),
        Object.freeze({
            id: 'music-science',
            name: '음악 + 과학 요정 조합',
            members: Object.freeze(['music', 'science']),
            desc: '보스 제한 시간 +2초 추가 보너스',
            xpBonus: 0,
            goldBonus: 0,
            bossSeconds: 2
        })
    ]),

    cosmetics: Object.freeze({
        outfit: Object.freeze([
            Object.freeze({ id: 'outfit-default', slot: 'outfit', name: '기본 교사 의상', unlockType: 'default', unlockText: '기본 제공', desc: '단정하고 활동하기 편한 기본 교사 복장입니다.' }),
            Object.freeze({ id: 'outfit-vest', slot: 'outfit', name: '산뜻한 조끼', unlockType: 'location', unlockTarget: 'library', unlockText: '100 구간 보스 격파', desc: '도서관 모험에 어울리는 따뜻한 니트 조끼입니다.' }),
            Object.freeze({ id: 'outfit-cape', slot: 'outfit', name: '모험 망토', unlockType: 'location', unlockTarget: 'gate', unlockText: '400 구간 보스 격파', desc: '4시 40분의 용사를 상징하는 황금빛 모험 망토입니다.' })
        ]),
        accessory: Object.freeze([
            Object.freeze({ id: 'accessory-none', slot: 'accessory', name: '없음', unlockType: 'default', unlockText: '기본 제공', desc: '소품을 착용하지 않은 기본 상태입니다.' }),
            Object.freeze({ id: 'accessory-mug', slot: 'accessory', name: '따뜻한 머그잔', unlockType: 'location', unlockTarget: 'library', unlockText: '100 구간 보스 격파', desc: '쉬는 시간의 여유를 담은 따뜻한 머그잔입니다.' }),
            Object.freeze({ id: 'accessory-notebook', slot: 'accessory', name: '수업 수첩', unlockType: 'location', unlockTarget: 'science', unlockText: '200 구간 보스 격파', desc: '모험 기록과 아이디어가 적힌 반짝이는 수업 수첩입니다.' })
        ]),
        wand: Object.freeze([
            Object.freeze({ id: 'wand-default', slot: 'wand', name: '기본 분필', unlockType: 'default', unlockText: '기본 제공', desc: '손에 익숙한 기본 분필 지팡이입니다.' }),
            Object.freeze({ id: 'wand-star', slot: 'wand', name: '별 분필', unlockType: 'anyAchievement', unlockText: '업적 1개 이상 달성', desc: '끝에서 노란 별빛이 반짝이는 마법 분필입니다.' }),
            Object.freeze({ id: 'wand-rainbow', slot: 'wand', name: '무지개 분필', unlockType: 'location', unlockTarget: 'gym', unlockText: '300 구간 보스 격파', desc: '일곱 빛깔 궤적을 그리는 무지개 분필 지팡이입니다.' })
        ]),
        background: Object.freeze([
            Object.freeze({ id: 'bg-default', slot: 'background', name: '기본 교실', unlockType: 'default', unlockText: '기본 제공', desc: '오후 햇살이 비치는 평화로운 기본 교실 배경입니다.' }),
            Object.freeze({ id: 'bg-sunset', slot: 'background', name: '노을 교실', unlockType: 'location', unlockTarget: 'science', unlockText: '200 구간 보스 격파', desc: '창밖으로 주홍빛 노을이 물드는 감성적인 교실입니다.' }),
            Object.freeze({ id: 'bg-festival', slot: 'background', name: '축제 교실', unlockType: 'location', unlockTarget: 'gate', unlockText: '400 구간 보스 격파', desc: '가랜드와 별 장식으로 꾸민 축제 분위기의 교실입니다.' })
        ]),
        decor: Object.freeze([
            Object.freeze({ id: 'decor-none', slot: 'decor', name: '없음', unlockType: 'default', unlockText: '기본 제공', desc: '추가 장식을 두지 않은 깔끔한 상태입니다.' }),
            Object.freeze({ id: 'decor-plant', slot: 'decor', name: '초록 화분', unlockType: 'anyAchievement', unlockText: '업적 1개 이상 달성', desc: '창가에서 싱그럽게 자라는 작은 초록 화분입니다.' }),
            Object.freeze({ id: 'decor-trophy', slot: 'decor', name: '황금 트로피', unlockType: 'location', unlockTarget: 'gate', unlockText: '400 구간 보스 격파', desc: '정문 돌파를 기념하는 반짝이는 황금 트로피입니다.' })
        ])
    }),

    locationById(id) {
        return this.locations.find(loc => loc.id === id) || this.locations[0];
    },

    companionById(id) {
        return this.companions.find(comp => comp.id === id) || null;
    },

    cosmeticById(slot, id) {
        const list = this.cosmetics[slot];
        if (!Array.isArray(list)) return null;
        return list.find(item => item.id === id) || list[0] || null;
    },

    getLoadout(state) {
        if (!state || !Array.isArray(state.companionLoadout)) return ['na', 'yu'];
        return state.companionLoadout.filter(id => GameLimits.COMPANION_IDS.includes(id)).slice(0, 2);
    },

    isCompanionUnlocked(state, id) {
        if (id === 'na' || id === 'yu') return true;
        return Boolean(state && state.extraCompanions && state.extraCompanions[id] && state.extraCompanions[id].unlocked);
    },

    isCompanionEquipped(state, id) {
        return this.getLoadout(state).includes(id);
    },

    getCompanionState(state, id) {
        if (!state) return { unlocked: false, l: 0, p: 0, c: 0 };
        if (id === 'na' || id === 'yu') {
            const c = state.comp && state.comp[id] ? state.comp[id] : { l: 0, p: 0, c: id === 'na' ? 2000 : 5000 };
            return { unlocked: true, l: c.l, p: c.p, c: c.c };
        }
        const extra = state.extraCompanions && state.extraCompanions[id];
        const baseCost = GameLimits.EXTRA_COMPANION_BASE_COSTS[id] || 5000;
        if (!extra) return { unlocked: false, l: 0, p: 0, c: baseCost };
        return { unlocked: Boolean(extra.unlocked), l: extra.l, p: extra.p, c: extra.c };
    },

    extraCompanionCostForLevel(id, level) {
        const baseCost = GameLimits.EXTRA_COMPANION_BASE_COSTS[id] || 5000;
        let cost = baseCost;
        const count = Math.max(0, Math.floor(level));
        for (let i = 0; i < count; i++) {
            cost = Math.max(1, Math.floor(GameLimits.multiply(cost, 1.8)));
        }
        return cost;
    },

    evaluateLoadoutSynergy(state, slots = null) {
        const loadout = Array.isArray(slots) ? slots : this.getLoadout(state);
        for (const syn of this.synergies) {
            const hasAll = syn.members.every(id => loadout.includes(id) && this.isCompanionUnlocked(state, id));
            if (!hasAll) continue;
            const levels = syn.members.map(id => this.getCompanionState(state, id).l);
            const active = levels.every(l => l >= 1);
            return {
                synergy: syn,
                active,
                pending: !active,
                reason: active
                    ? `${syn.name} 발동 중 (${syn.desc})`
                    : `${syn.name} 대기 중 · 두 동료를 Lv.1 이상으로 강화하면 효과가 발동합니다.`
            };
        }
        return { synergy: null, active: false, pending: false, reason: '발동 중인 지정 조합 효과가 없습니다.' };
    },

    bonuses(state, slotsOverride = null) {
        const loadout = Array.isArray(slotsOverride) ? slotsOverride : this.getLoadout(state);
        let xpBonus = 0;
        let goldBonus = 0;
        let bossSeconds = 0;
        let cooldownReduction = 0;

        for (const id of loadout) {
            if (!this.isCompanionUnlocked(state, id)) continue;
            const def = this.companionById(id);
            const compState = this.getCompanionState(state, id);
            if (!def || def.legacy || compState.l <= 0) continue;
            const level = Math.min(def.maxLevel, Math.max(0, Math.floor(compState.l)));
            if (def.bonusKey === 'xpPercent') xpBonus += level * def.perLevel;
            if (def.bonusKey === 'goldPercent') goldBonus += level * def.perLevel;
            if (def.bonusKey === 'bossSeconds') bossSeconds += level * def.perLevel;
            if (def.bonusKey === 'cooldownReduction') cooldownReduction += level * def.perLevel;
        }

        const synInfo = this.evaluateLoadoutSynergy(state, loadout);
        if (synInfo.active && synInfo.synergy) {
            xpBonus += synInfo.synergy.xpBonus;
            goldBonus += synInfo.synergy.goldBonus;
            bossSeconds += synInfo.synergy.bossSeconds;
        }

        return {
            xpBonus: Math.min(0.30, Math.round(xpBonus * 100) / 100),
            goldBonus: Math.min(0.30, Math.round(goldBonus * 100) / 100),
            bossSeconds: Math.min(7, Math.round(bossSeconds * 10) / 10),
            cooldownReduction: Math.min(0.20, Math.round(cooldownReduction * 100) / 100),
            synergy: synInfo
        };
    },

    getSkillCooldownMs(state, type) {
        const baseMs = type === 'rush' ? 60000 : 90000;
        const reduction = this.bonuses(state).cooldownReduction;
        return Math.round(baseMs * (1 - reduction));
    },

    getSkillReadyAt(state, type) {
        if (!state || !state.skill) return 0;
        const usedAt = Number(state.skill[type] || 0);
        if (usedAt <= 0) return 0;
        const baseMs = type === 'rush' ? 60000 : 90000;
        const minCooldownMs = Math.round(baseMs * 0.8);
        const timerKey = `${type}ReadyAt`;
        const storedReadyAt = state.skillTimers && typeof state.skillTimers[timerKey] === 'number'
            ? state.skillTimers[timerKey]
            : 0;
        if (storedReadyAt >= usedAt + minCooldownMs && storedReadyAt <= usedAt + baseMs) {
            return storedReadyAt;
        }
        return usedAt + baseMs;
    },

    isBossPending(state) {
        return Boolean(
            state && state.mob && state.mob.boss &&
            state.bossControl && state.bossControl.status === 'pending'
        );
    },

    isBossActive(state) {
        return Boolean(
            state && state.mob && state.mob.boss &&
            (!state.bossControl || state.bossControl.status !== 'pending')
        );
    },

    canSwapCompanions(state) {
        return !this.isBossActive(state);
    },

    getCurrentLocation(state) {
        if (!state || !state.adventure) return this.locations[0];
        const checkpoints = Array.isArray(state.adventure.clearedBossCheckpoints)
            ? state.adventure.clearedBossCheckpoints
            : [];
        let locId = 'classroom';
        if (checkpoints.includes(100)) locId = 'library';
        if (checkpoints.includes(200)) locId = 'science';
        if (checkpoints.includes(300)) locId = 'gym';
        if (checkpoints.includes(400)) locId = 'gate';
        state.adventure.currentLocation = locId;
        return this.locationById(locId);
    },

    recordBossClear(state, checkpoint, events = null) {
        if (!state || !state.adventure) return null;
        if (!GameLimits.BOSS_CHECKPOINTS.includes(checkpoint)) return null;
        const newlyCleared = !state.adventure.clearedBossCheckpoints.includes(checkpoint);
        if (newlyCleared) {
            state.adventure.clearedBossCheckpoints.push(checkpoint);
            state.adventure.clearedBossCheckpoints.sort((a, b) => a - b);
        }
        const mapLoc = { 100: 'library', 200: 'science', 300: 'gym', 400: 'gate' }[checkpoint];
        const mapComp = { 100: 'library', 200: 'science', 300: 'music', 400: 'tidy' }[checkpoint];
        let newlyUnlockedLocation = null;
        let newlyUnlockedCompanion = null;

        if (mapLoc && !state.adventure.unlockedLocations.includes(mapLoc)) {
            state.adventure.unlockedLocations.push(mapLoc);
            newlyUnlockedLocation = mapLoc;
        }
        if (mapComp && state.extraCompanions && state.extraCompanions[mapComp] && !state.extraCompanions[mapComp].unlocked) {
            state.extraCompanions[mapComp].unlocked = true;
            newlyUnlockedCompanion = mapComp;
        }
        const clearStoryId = `clear-${checkpoint}`;
        const enterStoryId = mapLoc ? `enter-${mapLoc}` : null;
        if (!state.adventure.seenStories.includes(clearStoryId)) {
            state.adventure.seenStories.push(clearStoryId);
        }
        if (enterStoryId && !state.adventure.seenStories.includes(enterStoryId)) {
            state.adventure.seenStories.push(enterStoryId);
        }
        this.syncUnlocks(state);
        if (events) {
            if (!Array.isArray(events.clearedCheckpoints)) events.clearedCheckpoints = [];
            if (newlyCleared) events.clearedCheckpoints.push(checkpoint);
            if (newlyUnlockedLocation) {
                if (!Array.isArray(events.unlockedLocations)) events.unlockedLocations = [];
                events.unlockedLocations.push(newlyUnlockedLocation);
            }
            if (newlyUnlockedCompanion) {
                if (!Array.isArray(events.unlockedCompanions)) events.unlockedCompanions = [];
                events.unlockedCompanions.push(newlyUnlockedCompanion);
            }
        }
        return { checkpoint, newlyCleared, locationId: mapLoc, companionId: mapComp };
    },

    syncUnlocks(state) {
        if (!state) return;
        if (typeof Data !== 'undefined' && typeof Data._syncDerivedUnlocks === 'function') {
            Data._syncDerivedUnlocks(state, false);
        }
    },

    isCosmeticUnlocked(state, slot, itemId) {
        if (!state || !state.cosmetics || !state.cosmetics.unlocked) {
            return GameLimits.COSMETIC_DEFAULTS[slot] === itemId;
        }
        this.syncUnlocks(state);
        const list = state.cosmetics.unlocked[slot];
        return Array.isArray(list) && list.includes(itemId);
    }
};

if (typeof window !== 'undefined') window.Adventure = Adventure;
if (typeof globalThis !== 'undefined') globalThis.Adventure = Adventure;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Adventure };
}
