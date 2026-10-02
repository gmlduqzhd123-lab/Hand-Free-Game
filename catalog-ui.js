'use strict';

// Build each purchase button once so a held pointer keeps its original target.
const CatalogUI = {
    initialized: false,
    itemRows: new Map(),
    relicRows: new Map(),
    filterCategory: 'all',

    element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    },

    init() {
        if (this.initialized) return;
        const shop = document.getElementById('item-shop-list');
        const relicList = document.getElementById('relic-list');
        if (!shop || !relicList) return;
        const categories = {click:'분필 마법',auto:'자동 공격',xp:'경험치',gold:'골드',crit:'치명타',boss:'보스 도전'};
        for (const item of Catalog.items) {
            const card = this.element('article', 'item-shop-card');
            card.id = 'item-card-' + item.id;
            card.dataset.itemCategory = item.category;
            const icon = this.element('span', 'item-shop-icon', item.icon || '✦');
            icon.setAttribute('aria-hidden', 'true');
            const information = this.element('div', 'item-shop-info');
            const category = this.element('span', 'item-shop-category', categories[item.category] || '교실 아이템');
            const title = this.element('h3', 'item-shop-title', item.name);
            const description = this.element('p', 'item-shop-description', item.description);
            description.id = 'item-description-' + item.id;
            const level = this.element('span', 'item-shop-level');
            level.id = 'item-level-' + item.id;
            information.append(category, title, description, level);
            const button = this.element('button', 'up-btn item-buy-button');
            button.id = 'shop-' + item.id;
            button.type = 'button';
            button.dataset.repeatAction = 'item';
            button.dataset.itemId = item.id;
            button.setAttribute('aria-describedby', description.id);
            const cost = this.element('span', 'item-cost');
            cost.id = 'item-cost-' + item.id;
            button.append(this.element('span', 'item-buy-label', '강화'), cost);
            card.append(icon, information, button);
            shop.append(card);
            this.itemRows.set(item.id, {card, button, level, cost});
        }
        Catalog.relics.forEach((relic, index) => {
            let row = document.getElementById('relic-' + index);
            if (!row) {
                row = this.element('div', 'relic-item');
                row.id = 'relic-' + index;
                const icon = this.element('div', 'relic-icon', relic.icon || '✦');
                icon.setAttribute('aria-hidden', 'true');
                row.append(icon, this.element('div', 'relic-name', relic.name),
                    this.element('div', 'relic-eff', relic.description),
                    this.element('span', 'relic-status', '미보유'), this.element('span', 'relic-owned', '보유 중'));
                relicList.append(row);
            }
            this.relicRows.set(index, row);
        });
        for (const [id, key] of [['up-click','click'],['up-auto','auto'],['up-crit','crit'],['up-comp1','comp1'],['up-comp2','comp2']]) {
            const button = document.getElementById(id);
            if (button) { button.dataset.repeatAction = 'upgrade'; button.dataset.upgrade = key; }
        }
        document.querySelectorAll('#item-category-filters button').forEach(button => {
            button.addEventListener('click', () => this.filter(button.dataset.itemCategory));
        });
        this.initialized = true;
        this.render();
    },

    filter(category) {
        RepeatInput.stop();
        this.filterCategory = category;
        for (const item of Catalog.items) this.itemRows.get(item.id).card.hidden = category !== 'all' && item.category !== category;
        document.querySelectorAll('#item-category-filters button').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.itemCategory === category));
        });
    },

    render() {
        if (!this.initialized) return;
        const state = Data.state;
        for (const item of Catalog.items) {
            const row = this.itemRows.get(item.id);
            const level = Catalog.itemLevel(item, state);
            const maximum = level >= item.maxLevel;
            const cost = maximum ? 'MAX' : fNum(Catalog.itemCost(item, state));
            row.level.textContent = 'Lv.' + level + ' / ' + item.maxLevel;
            row.cost.textContent = maximum ? cost : cost + ' 골드';
            row.button.disabled = !Data.canWrite || !GameApp.playing || maximum || !Catalog.canBuyItem(item, state);
            row.button.setAttribute('aria-label', item.name + ', 현재 레벨 ' + level + '. ' +
                (maximum ? '최대 레벨 달성' : '강화 비용 ' + cost + ' 골드. 길게 누르면 연속 구매'));
        }
        for (const [index, row] of this.relicRows) row.classList.toggle('unlocked', Catalog.ownedRelic(index, state));
        const itemSummary = document.getElementById('item-summary');
        if (itemSummary) itemSummary.textContent = '아이템 ' + Catalog.itemCount(state) + ' / ' + Catalog.items.length + '종 · 총 강화 ' + Catalog.totalItemLevels(state) + '회';
        const relicSummary = document.getElementById('relic-summary');
        if (relicSummary) relicSummary.textContent = '유물 ' + Catalog.relicCount(state) + ' / ' + Catalog.relics.length + '종 수집';
    }
};
