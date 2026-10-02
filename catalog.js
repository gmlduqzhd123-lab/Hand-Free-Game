'use strict';

// Stable IDs keep equipment investments intact when the shop grows.
const Catalog = {
    items: [
        { id: 'chalk-spark', name: '반짝 분필', category: 'click', icon: '✨', baseCost: 40, growth: 1.35, bonusPerLevel: 0.01 },
        { id: 'star-pointer', name: '별빛 지시봉', category: 'click', icon: '⭐', baseCost: 120, growth: 1.38, bonusPerLevel: 0.015 },
        { id: 'storybook', name: '꿈꾸는 동화책', category: 'click', icon: '📖', baseCost: 300, growth: 1.4, bonusPerLevel: 0.02 },
        { id: 'rainbow-stamp', name: '무지개 도장', category: 'click', icon: '🌈', baseCost: 650, growth: 1.42, bonusPerLevel: 0.025 },
        { id: 'pencil-wand', name: '요술 연필', category: 'click', icon: '✏️', baseCost: 1400, growth: 1.44, bonusPerLevel: 0.03 },
        { id: 'lesson-bell', name: '햇살 수업종', category: 'click', icon: '🔔', baseCost: 3000, growth: 1.46, bonusPerLevel: 0.04 },
        { id: 'fairy-clock', name: '요정 탁상시계', category: 'auto', icon: '🕰️', baseCost: 50, growth: 1.35, bonusPerLevel: 0.01 },
        { id: 'tidy-broom', name: '부지런한 빗자루', category: 'auto', icon: '🧹', baseCost: 150, growth: 1.38, bonusPerLevel: 0.015 },
        { id: 'cloud-robot', name: '구름 도우미', category: 'auto', icon: '☁️', baseCost: 400, growth: 1.4, bonusPerLevel: 0.02 },
        { id: 'paper-bird', name: '종이새 친구', category: 'auto', icon: '🕊️', baseCost: 850, growth: 1.42, bonusPerLevel: 0.025 },
        { id: 'music-box', name: '자장가 오르골', category: 'auto', icon: '🎵', baseCost: 1800, growth: 1.44, bonusPerLevel: 0.03 },
        { id: 'classroom-garden', name: '교실의 작은 정원', category: 'auto', icon: '🌻', baseCost: 3600, growth: 1.46, bonusPerLevel: 0.04 },
        { id: 'reading-lamp', name: '독서 반딧불', category: 'xp', icon: '💡', baseCost: 180, growth: 1.4, bonusPerLevel: 0.005 },
        { id: 'wisdom-book', name: '지혜의 그림책', category: 'xp', icon: '📚', baseCost: 700, growth: 1.42, bonusPerLevel: 0.01 },
        { id: 'note-bag', name: '배움 가득 책가방', category: 'xp', icon: '🎒', baseCost: 1600, growth: 1.44, bonusPerLevel: 0.015 },
        { id: 'learning-badge', name: '성장 배지', category: 'xp', icon: '🌱', baseCost: 3200, growth: 1.46, bonusPerLevel: 0.02 },
        { id: 'coin-pouch', name: '도토리 주머니', category: 'gold', icon: '👛', baseCost: 220, growth: 1.4, bonusPerLevel: 0.005 },
        { id: 'honey-lunchbox', name: '달콤한 도시락', category: 'gold', icon: '🍯', baseCost: 800, growth: 1.42, bonusPerLevel: 0.01 },
        { id: 'treasure-map', name: '보물찾기 지도', category: 'gold', icon: '🗺️', baseCost: 1800, growth: 1.44, bonusPerLevel: 0.015 },
        { id: 'lucky-plant', name: '행운의 화분', category: 'gold', icon: '🍀', baseCost: 3800, growth: 1.46, bonusPerLevel: 0.02 },
        { id: 'star-glasses', name: '별을 보는 안경', category: 'crit', icon: '👓', baseCost: 1100, growth: 1.44, bonusPerLevel: 0.15 },
        { id: 'praise-ribbon', name: '칭찬 리본', category: 'crit', icon: '🎀', baseCost: 2600, growth: 1.46, bonusPerLevel: 0.2 },
        { id: 'sand-timer', name: '느긋한 모래시계', category: 'boss', icon: '⏳', baseCost: 1500, growth: 1.44, bonusPerLevel: 0.2 },
        { id: 'calm-tea', name: '포근한 꽃차', category: 'boss', icon: '🍵', baseCost: 3000, growth: 1.46, bonusPerLevel: 0.2 }
    ],
    relics: [
        { id: 'legacy-clock', name: '반짝 초시계', description: '자동 공격 ×1.5', icon: '🕰️', effect: 'legacy-auto', bonus: 0.5 },
        { id: 'legacy-badge', name: '칭찬 스티커', description: '치명타 공격 ×5', icon: '🌟', effect: 'legacy-crit', bonus: 5 },
        { id: 'legacy-chalk', name: '마법 연필', description: '추가 공격 ×1.5', icon: '✨', effect: 'legacy-click', bonus: 0.5 },
        { id: 'legacy-timer', name: '노래 교본', description: '보스 제한 시간 +10초', icon: '⏳', effect: 'legacy-boss', bonus: 10 },
        { id: 'moon-pencil', name: '달빛 연필', description: '추가 공격력 +15%', icon: '🌙', effect: 'clickPct', bonus: 0.15 },
        { id: 'sun-chalk', name: '햇살 분필통', description: '추가 공격력 +20%', icon: '☀️', effect: 'clickPct', bonus: 0.2 },
        { id: 'rainbow-quill', name: '무지개 깃펜', description: '추가 공격력 +25%', icon: '🪶', effect: 'clickPct', bonus: 0.25 },
        { id: 'wish-wand', name: '소원을 담은 지시봉', description: '추가 공격력 +30%', icon: '🪄', effect: 'clickPct', bonus: 0.3 },
        { id: 'fairy-bell', name: '요정의 종', description: '자동 공격력 +15%', icon: '🔔', effect: 'autoPct', bonus: 0.15 },
        { id: 'cloud-cushion', name: '구름 방석', description: '자동 공격력 +20%', icon: '☁️', effect: 'autoPct', bonus: 0.2 },
        { id: 'forest-box', name: '숲속 오르골', description: '자동 공격력 +25%', icon: '🎶', effect: 'autoPct', bonus: 0.25 },
        { id: 'starlight-garden', name: '별빛 화분', description: '자동 공격력 +30%', icon: '🌷', effect: 'autoPct', bonus: 0.3 },
        { id: 'wisdom-key', name: '지혜의 열쇠', description: '경험치 획득 +10%', icon: '🗝️', effect: 'xpPct', bonus: 0.1 },
        { id: 'dream-notebook', name: '꿈의 공책', description: '경험치 획득 +15%', icon: '📓', effect: 'xpPct', bonus: 0.15 },
        { id: 'acorn-vault', name: '도토리 저금통', description: '처치 골드 +10%', icon: '🐿️', effect: 'goldPct', bonus: 0.1 },
        { id: 'clover-crown', name: '네잎클로버 왕관', description: '처치 골드 +15%', icon: '🍀', effect: 'goldPct', bonus: 0.15 },
        { id: 'star-mirror', name: '반짝 거울', description: '치명타 확률 +2%p', icon: '🪞', effect: 'critPoints', bonus: 2 },
        { id: 'praise-medal', name: '칭찬 메달', description: '치명타 확률 +2%p', icon: '🏅', effect: 'critPoints', bonus: 2 },
        { id: 'slow-snowglobe', name: '느린 눈꽃 구슬', description: '보스 제한 시간 +3초', icon: '🔮', effect: 'bossSeconds', bonus: 3 },
        { id: 'peace-teapot', name: '평온한 찻주전자', description: '보스 제한 시간 +3초', icon: '🫖', effect: 'bossSeconds', bonus: 3 }
    ],
    categoryNames: { click: '추가 공격', auto: '자동 공격', xp: '경험치', gold: '골드', crit: '치명타', boss: '보스 시간' },
    getItem(itemOrId) { return typeof itemOrId === 'string' ? this.items.find(item => item.id === itemOrId) : itemOrId; },
    itemLevel(itemOrId, state = Data.state) {
        const item = this.getItem(itemOrId);
        const level = item && state.items ? state.items[item.id] : 0;
        return Number.isInteger(level) && level >= 0 ? Math.min(25, level) : 0;
    },
    itemCost(itemOrId, state = Data.state) {
        const item = this.getItem(itemOrId);
        if (!item) return Infinity;
        return Math.floor(GameLimits.multiply(item.baseCost, GameLimits.pow(item.growth, this.itemLevel(item, state))));
    },
    canBuyItem(itemOrId, state = Data.state) {
        const item = this.getItem(itemOrId);
        return Boolean(item && this.itemLevel(item, state) < item.maxLevel && state.gold >= this.itemCost(item, state));
    },
    ownedRelic(index, state = Data.state) {
        return Boolean(index < 4 ? state.relic[index] : state.extraRelics && state.extraRelics[index - 4]);
    },
    itemCount(state = Data.state) { return this.items.filter(item => this.itemLevel(item, state) > 0).length; },
    totalItemLevels(state = Data.state) { return this.items.reduce((sum, item) => sum + this.itemLevel(item, state), 0); },
    categoryLevels(category, state = Data.state) { return this.items.filter(item => item.category === category).reduce((sum, item) => sum + this.itemLevel(item, state), 0); },
    relicCount(state = Data.state) { return this.relics.filter((_, index) => this.ownedRelic(index, state)).length; },
    bonuses(state = Data.state) {
        const bonuses = { clickPct: 0, autoPct: 0, xpPct: 0, goldPct: 0, critPoints: 0, bossSeconds: 0 };
        const keys = { click: 'clickPct', auto: 'autoPct', xp: 'xpPct', gold: 'goldPct', crit: 'critPoints', boss: 'bossSeconds' };
        this.items.forEach(item => { bonuses[keys[item.category]] += this.itemLevel(item, state) * item.bonusPerLevel; });
        this.relics.forEach((relic, index) => {
            // The first four effects are already applied by the original battle rules.
            if (index >= 4 && this.ownedRelic(index, state)) bonuses[relic.effect] += relic.bonus;
        });
        const caps = { clickPct: 5, autoPct: 5, xpPct: 1.5, goldPct: 1.5, critPoints: 15, bossSeconds: 20 };
        Object.keys(bonuses).forEach(key => { bonuses[key] = Math.min(caps[key], Math.max(0, Math.round(bonuses[key] * 1000000) / 1000000)); });
        return bonuses;
    }
};

Catalog.items.forEach(item => {
    item.maxLevel = 25;
    const amount = item.category === 'crit' ? `${item.bonusPerLevel}%p` : item.category === 'boss' ? `${item.bonusPerLevel}초` : `${Math.round(item.bonusPerLevel * 1000) / 10}%`;
    item.description = `레벨마다 ${Catalog.categoryNames[item.category]} +${amount}`;
});
