'use strict';

const ExperienceUI = {
    initialized: false,
    lastFocusElement: null,
    selectedMapLocationId: null,
    previewCosmetics: null,
    selectedReportId: null,
    pendingPrestigePlan: null,
    achRows: new Map(),

    init() {
        if (this.initialized) return;
        this.bindEvents();
        this.initialized = true;
    },

    formatDuration(ms) {
        const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        if (hours > 0) return `${hours}시간 ${minutes}분`;
        if (minutes > 0) return `${minutes}분 ${seconds}초`;
        return `${seconds}초`;
    },

    openDialog(dialogId, focusId = null) {
        if (typeof RepeatInput !== 'undefined') RepeatInput.stop();
        const dialog = document.getElementById(dialogId);
        if (!dialog) return;
        if (document.activeElement && document.activeElement !== document.body) {
            this.lastFocusElement = document.activeElement;
        }
        if (!dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }
        const target = focusId ? document.getElementById(focusId) : dialog.querySelector('button, [href], input, select, textarea');
        if (target && typeof target.focus === 'function') {
            target.focus({ preventScroll: true });
        }
    },

    closeDialog(dialogId, restoreFocus = true) {
        const dialog = document.getElementById(dialogId);
        if (!dialog) return;
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        else dialog.removeAttribute('open');
        if (restoreFocus && this.lastFocusElement && typeof this.lastFocusElement.focus === 'function' && this.lastFocusElement.isConnected) {
            this.lastFocusElement.focus({ preventScroll: true });
        }
    },

    bindEvents() {
        // Onboarding
        const dismissBtn = document.getElementById('btn-onboarding-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => this.dismissOnboarding());
        }
        const reopenBtn = document.getElementById('btn-reopen-onboarding');
        if (reopenBtn) {
            reopenBtn.addEventListener('click', () => this.reopenOnboarding());
        }

        // Purchase qty & playstyle selectors
        document.querySelectorAll('[data-qty-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                Logic.setPreferences({ purchaseQty: btn.dataset.qtyMode });
            });
        });
        document.querySelectorAll('[data-play-style]').forEach(btn => {
            btn.addEventListener('click', () => {
                Logic.setPreferences({ playStyle: btn.dataset.playStyle });
            });
        });

        // Boss entry mode & pending start
        const entryToggle = document.getElementById('boss-entry-mode-select');
        if (entryToggle) {
            entryToggle.addEventListener('change', () => {
                Logic.setBossEntryMode(entryToggle.value);
            });
        }
        const startBossInline = document.getElementById('btn-start-boss-inline');
        if (startBossInline) {
            startBossInline.addEventListener('click', () => {
                if (Logic.startBoss()) this.closeDialog('boss-prep-dialog', false);
            });
        }
        const openBossPrep = document.getElementById('btn-open-boss-prep');
        if (openBossPrep) {
            openBossPrep.addEventListener('click', () => this.showBossPrepDialog());
        }
        const prepStart = document.getElementById('btn-boss-prep-start');
        if (prepStart) {
            prepStart.addEventListener('click', () => {
                if (Logic.startBoss()) {
                    this.closeDialog('boss-prep-dialog', false);
                    const bv = document.getElementById('battle-view');
                    if (bv) bv.focus({ preventScroll: true });
                }
            });
        }
        const prepUpgrade = document.getElementById('btn-boss-prep-upgrade');
        if (prepUpgrade) {
            prepUpgrade.addEventListener('click', () => {
                this.closeDialog('boss-prep-dialog', false);
                const statTab = document.getElementById('tab-button-stat');
                if (statTab) UI.selectTab(statTab);
                const upClick = document.getElementById('up-auto');
                if (upClick) upClick.focus({ preventScroll: true });
            });
        }
        const prepClose = document.getElementById('btn-boss-prep-close');
        if (prepClose) {
            prepClose.addEventListener('click', () => this.closeDialog('boss-prep-dialog'));
        }

        // Map dialog
        const openMapBtn = document.getElementById('btn-open-map');
        if (openMapBtn) {
            openMapBtn.addEventListener('click', () => this.showMapDialog());
        }
        const closeMapBtn = document.getElementById('btn-map-close');
        if (closeMapBtn) {
            closeMapBtn.addEventListener('click', () => this.closeDialog('map-dialog'));
        }

        // Cosmetics dialog
        const openCosBtn = document.getElementById('btn-open-cosmetics');
        if (openCosBtn) {
            openCosBtn.addEventListener('click', () => this.showCosmeticsDialog());
        }
        const applyCosBtn = document.getElementById('btn-cosmetics-apply');
        if (applyCosBtn) {
            applyCosBtn.addEventListener('click', () => {
                if (this.previewCosmetics && Logic.equipCosmetics(this.previewCosmetics)) {
                    Sys.toast('✨ 캐릭터와 교실 꾸미기를 적용했어요.');
                    this.closeDialog('cosmetics-dialog');
                }
            });
        }
        const resetCosBtn = document.getElementById('btn-cosmetics-reset');
        if (resetCosBtn) {
            resetCosBtn.addEventListener('click', () => {
                this.previewCosmetics = { ...GameLimits.COSMETIC_DEFAULTS };
                if (Logic.resetCosmetics()) {
                    Sys.toast('기본 모습으로 되돌렸어요.');
                    this.renderCosmeticsDialog();
                }
            });
        }
        const closeCosBtn = document.getElementById('btn-cosmetics-close');
        if (closeCosBtn) {
            closeCosBtn.addEventListener('click', () => {
                this.previewCosmetics = null;
                this.closeDialog('cosmetics-dialog');
            });
        }

        // Reports dialog
        const openRepBtn = document.getElementById('btn-open-reports');
        if (openRepBtn) {
            openRepBtn.addEventListener('click', () => this.showReportDialog());
        }
        const closeRepBtn = document.getElementById('btn-report-close');
        if (closeRepBtn) {
            closeRepBtn.addEventListener('click', () => this.closeDialog('report-dialog'));
        }
        const gotoRecBtn = document.getElementById('btn-report-goto-rec');
        if (gotoRecBtn) {
            gotoRecBtn.addEventListener('click', () => {
                this.closeDialog('report-dialog', false);
                this.focusRecommendedUpgrade();
            });
        }
        const downloadCardBtn = document.getElementById('btn-report-download-card');
        if (downloadCardBtn) {
            downloadCardBtn.addEventListener('click', () => {
                void this.downloadRecordCard();
            });
        }

        // Prestige preview dialog
        const openPrestigeBtn = document.getElementById('btn-prestige-preview');
        if (openPrestigeBtn) {
            openPrestigeBtn.addEventListener('click', () => this.showPrestigeDialog());
        }
        const confirmPrestigeBtn = document.getElementById('btn-prestige-confirm');
        if (confirmPrestigeBtn) {
            confirmPrestigeBtn.addEventListener('click', () => this.confirmPrestigeFromDialog());
        }
        const closePrestigeBtn = document.getElementById('btn-prestige-close');
        if (closePrestigeBtn) {
            closePrestigeBtn.addEventListener('click', () => {
                this.pendingPrestigePlan = null;
                this.closeDialog('prestige-dialog');
            });
        }

        // Claim all achievements
        const claimAllBtn = document.getElementById('btn-claim-all-ach');
        if (claimAllBtn) {
            claimAllBtn.addEventListener('click', () => Ach.claimAll());
        }

        // Automation controls
        const autoEnable = document.getElementById('auto-enabled-toggle');
        if (autoEnable) {
            autoEnable.addEventListener('change', () => {
                AutomationEngine.updateSettings({ enabled: autoEnable.checked });
            });
        }
        const autoStrategy = document.getElementById('auto-strategy-select');
        if (autoStrategy) {
            autoStrategy.addEventListener('change', () => {
                AutomationEngine.updateSettings({ strategy: autoStrategy.value });
            });
        }
        const autoSkillRush = document.getElementById('auto-skill-rush');
        const autoSkillNight = document.getElementById('auto-skill-night');
        if (autoSkillRush && autoSkillNight) {
            const onSkillModeChange = () => {
                AutomationEngine.updateSettings({
                    skills: { rush: autoSkillRush.value, night: autoSkillNight.value }
                });
            };
            autoSkillRush.addEventListener('change', onSkillModeChange);
            autoSkillNight.addEventListener('change', onSkillModeChange);
        }
        const autoAllowPending = document.getElementById('auto-allow-pending');
        if (autoAllowPending) {
            autoAllowPending.addEventListener('change', () => {
                AutomationEngine.updateSettings({ allowDuringBossPending: autoAllowPending.checked });
            });
        }
        const autoApplyBtn = document.getElementById('btn-auto-apply');
        if (autoApplyBtn) {
            autoApplyBtn.addEventListener('click', () => {
                const limitInput = document.getElementById('auto-budget-limit');
                const reserveInput = document.getElementById('auto-reserve-gold');
                const checkedTargets = Array.from(document.querySelectorAll('.auto-target-cb:checked')).map(cb => cb.value);
                AutomationEngine.updateSettings({
                    budgetLimit: Math.max(0, Number(limitInput ? limitInput.value : 0) || 0),
                    reserveGold: Math.max(0, Number(reserveInput ? reserveInput.value : 0) || 0),
                    targets: checkedTargets.length > 0 ? checkedTargets : ['auto']
                });
                Sys.toast('⚙️ 자동 강화 설정을 저장했습니다.');
            });
        }
        const autoRestartBtn = document.getElementById('btn-auto-restart-budget');
        if (autoRestartBtn) {
            autoRestartBtn.addEventListener('click', () => {
                const limitInput = document.getElementById('auto-budget-limit');
                const newLimit = Math.max(0, Number(limitInput ? limitInput.value : Data.state.automation.budgetLimit) || 0);
                AutomationEngine.restartBudget(newLimit);
            });
        }
    },

    focusRecommendedUpgrade() {
        const rec = Progression.recommendUpgrades(Data.state);
        if (!rec || !rec.primary) return;
        const t = rec.primary.target;
        if (t.kind === 'upgrade') {
            if (t.id === 'comp1' || t.id === 'comp2') {
                const tab = document.getElementById('tab-button-comp');
                if (tab) UI.selectTab(tab);
            } else {
                const tab = document.getElementById('tab-button-stat');
                if (tab) UI.selectTab(tab);
            }
            const btn = document.getElementById(`up-${t.id}`);
            if (btn) btn.focus({ preventScroll: false });
        } else if (t.kind === 'companion') {
            const tab = document.getElementById('tab-button-comp');
            if (tab) UI.selectTab(tab);
            const btn = document.getElementById(`up-extra-${t.id}`);
            if (btn) btn.focus({ preventScroll: false });
        } else if (t.kind === 'item') {
            const tab = document.getElementById('tab-button-shop');
            if (tab) UI.selectTab(tab);
            CatalogUI.filter('all');
            const btn = document.getElementById(`shop-${t.id}`);
            if (btn) btn.focus({ preventScroll: false });
        }
    },

    syncOnboardingProgress(state = Data.state) {
        if (!state || !state.onboarding) return;
        const steps = state.onboarding.steps;
        if (state.kills > 0 || state.player.xp > 0 || state.player.level > 1) {
            steps.observeAuto = true;
        }
        if (state.stat.c.l > 1 || state.stat.a.l > 1 || state.stat.crit.l > 0 ||
            state.comp.na.l > 0 || state.comp.yu.l > 0 || Catalog.totalItemLevels(state) > 0) {
            steps.firstUpgrade = true;
        }
        if (state.skill.rush > 0) {
            steps.useRush = true;
        }
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.dataset.target === 'tab-ach') {
            steps.viewAch = true;
        }
        const order = ['observeAuto', 'firstUpgrade', 'useRush', 'viewAch'];
        const doneCount = order.filter(k => steps[k]).length;
        state.onboarding.step = Math.min(3, doneCount);
        if (doneCount === 4) {
            state.onboarding.completed = true;
        }
    },

    dismissOnboarding() {
        if (!Logic.canAct()) return;
        const candidate = Logic.cloneState();
        candidate.onboarding.skipped = true;
        if (!Logic.commit(candidate)) return;
        this.renderOnboarding();
        const bv = document.getElementById('battle-view');
        if (bv) bv.focus({ preventScroll: true });
    },

    reopenOnboarding() {
        if (!Logic.canAct()) return;
        const candidate = Logic.cloneState();
        candidate.onboarding.skipped = false;
        candidate.onboarding.completed = false;
        if (!Logic.commit(candidate)) return;
        this.renderOnboarding();
        const card = document.getElementById('onboarding-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    renderOnboarding() {
        const card = document.getElementById('onboarding-card');
        if (!card || !Data.state || !Data.state.onboarding) return;
        this.syncOnboardingProgress(Data.state);
        const ob = Data.state.onboarding;
        const hide = Boolean(ob.completed || ob.skipped);
        card.hidden = hide;
        if (hide) return;

        const stepDefs = [
            { key: 'observeAuto', label: '1. 자동 공격으로 몬스터 체력이 줄어드는 모습 지켜보기' },
            { key: 'firstUpgrade', label: '2. 성장 탭이나 상점에서 골드로 첫 강화 해보기' },
            { key: 'useRush', label: '3. 반짝 분필 마법 스킬 한 번 사용해 보기' },
            { key: 'viewAch', label: '4. 업적 탭을 열어 달성 보상 확인하기' }
        ];
        const sig = stepDefs.map(s => Number(Boolean(ob.steps[s.key]))).join(':');
        const listEl = document.getElementById('onboarding-steps-list');
        if (listEl && (this.onboardingSignature !== sig || listEl.children.length !== stepDefs.length)) {
            this.onboardingSignature = sig;
            listEl.replaceChildren();
            for (const s of stepDefs) {
                const li = document.createElement('li');
                const done = Boolean(ob.steps[s.key]);
                li.className = done ? 'ob-step done' : 'ob-step';
                li.textContent = `${done ? '✓ ' : '○ '}${s.label}`;
                listEl.appendChild(li);
            }
        }
    },

    renderPurchaseControlsAndRecommendations() {
        const state = Data.state;
        if (!state) return;
        if (typeof Progression !== 'undefined' && typeof Progression.getPurchaseStateSignature === 'function') {
            const sig = Progression.getPurchaseStateSignature(state);
            if (this.lastPurchaseSignature === sig) return;
            this.lastPurchaseSignature = sig;
        }
        const qtyMode = (state.preferences && state.preferences.purchaseQty) || '1';
        const playStyle = (state.preferences && state.preferences.playStyle) || 'idle';

        document.querySelectorAll('[data-qty-mode]').forEach(btn => {
            const active = btn.dataset.qtyMode === qtyMode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        document.querySelectorAll('[data-play-style]').forEach(btn => {
            const active = btn.dataset.playStyle === playStyle;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });

        const rec = Progression.recommendUpgrades(state, playStyle);
        const recText = rec && rec.primary
            ? `💡 추천(${playStyle === 'idle' ? '방치 중심' : '직접 공격 중심'}): ${rec.primary.target.name} · ${rec.primary.reason}`
            : '💡 현재 구매 가능한 모든 강화가 상한에 도달했습니다.';
        for (const id of ['rec-banner-stat', 'rec-banner-shop']) {
            const el = document.getElementById(id);
            if (el) el.textContent = recText;
        }

        // Update preview lines on the 5 basic upgrades
        for (const key of ['click', 'auto', 'crit', 'comp1', 'comp2']) {
            const quote = Progression.quotePurchase(state, key, qtyMode);
            const previewEl = document.getElementById(`preview-${key}`);
            if (previewEl && quote) {
                if (quote.isMaxed) {
                    previewEl.textContent = quote.summary;
                } else if (quote.canBuy) {
                    previewEl.textContent = `${quote.summary} · 실제 ${quote.actualCount}회 / 비용 ${fNum(quote.totalCost)} 골드`;
                } else {
                    previewEl.textContent = `${quote.summary} · 다음 1회 ${fNum(quote.nextCost)} 골드 (${fNum(quote.shortfall)} 부족)`;
                }
            }
        }
    },

    renderCompanionsPanel() {
        const state = Data.state;
        if (!state || typeof Adventure === 'undefined') return;
        const container = document.getElementById('extra-companions-list');
        if (typeof Progression !== 'undefined' && typeof Progression.getPurchaseStateSignature === 'function' &&
            container && container.dataset.built) {
            const sig = Progression.getPurchaseStateSignature(state);
            if (this.lastCompanionsSignature === sig) return;
            this.lastCompanionsSignature = sig;
        }
        const loadoutEl = document.getElementById('companion-loadout-summary');
        const synergyEl = document.getElementById('companion-synergy-summary');
        const presetsEl = document.getElementById('companion-presets-row');
        const canSwap = Adventure.canSwapCompanions(state);
        const qtyMode = (state.preferences && state.preferences.purchaseQty) || '1';

        const loadout = Adventure.getLoadout(state);
        if (loadoutEl) {
            const names = loadout.map(id => {
                const def = Adventure.companionById(id);
                return def ? `${def.name}(${def.formatEffect(state)})` : id;
            });
            loadoutEl.textContent = `현재 동행(최대 2명): ${names.join(' · ') || '없음'}${canSwap ? '' : ' · 보스 전투 중 교체 잠금'}`;
        }

        const syn = Adventure.evaluateLoadoutSynergy(state);
        if (synergyEl) {
            synergyEl.textContent = `조합 효과: ${syn.reason}`;
        }

        // Equip toggles for legacy na / yu
        for (const legacyId of ['na', 'yu']) {
            const toggleBtn = document.getElementById(`btn-equip-${legacyId}`);
            if (toggleBtn) {
                const equipped = loadout.includes(legacyId);
                toggleBtn.textContent = equipped ? '동행 중' : '동행 선택';
                toggleBtn.setAttribute('aria-pressed', String(equipped));
                toggleBtn.disabled = !Data.canWrite || !canSwap || (equipped && loadout.length <= 1);
                toggleBtn.onclick = () => this.toggleCompanionEquip(legacyId);
            }
        }

        if (presetsEl && !presetsEl.dataset.bound) {
            presetsEl.dataset.bound = 'true';
            presetsEl.replaceChildren();
            for (let i = 0; i < 3; i++) {
                const preset = (state.companionPresets && state.companionPresets[i]) || { name: `조합 ${i + 1}`, slots: ['na', 'yu'] };
                const wrap = document.createElement('div');
                wrap.className = 'preset-chip';
                const applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'preset-btn';
                applyBtn.id = `btn-preset-apply-${i}`;
                applyBtn.textContent = `${preset.name} 적용`;
                applyBtn.addEventListener('click', () => Logic.applyCompanionPreset(i));
                const saveBtn = document.createElement('button');
                saveBtn.type = 'button';
                saveBtn.className = 'preset-save-btn';
                saveBtn.id = `btn-preset-save-${i}`;
                saveBtn.textContent = '현재 저장';
                saveBtn.addEventListener('click', () => Logic.saveCompanionPreset(i));
                wrap.append(applyBtn, saveBtn);
                presetsEl.appendChild(wrap);
            }
        }
        for (let i = 0; i < 3; i++) {
            const preset = (state.companionPresets && state.companionPresets[i]) || { name: `조합 ${i + 1}`, slots: ['na', 'yu'] };
            const applyBtn = document.getElementById(`btn-preset-apply-${i}`);
            const saveBtn = document.getElementById(`btn-preset-save-${i}`);
            if (applyBtn) {
                const slotNames = preset.slots.map(id => (Adventure.companionById(id) || { name: id }).name).join('+');
                applyBtn.textContent = `${preset.name} (${slotNames})`;
                applyBtn.disabled = !Data.canWrite || !canSwap;
            }
            if (saveBtn) saveBtn.disabled = !Data.canWrite;
        }

        if (!container) return;
        if (!container.dataset.built) {
            container.dataset.built = 'true';
            container.replaceChildren();
            for (const def of Adventure.companions.filter(c => !c.legacy)) {
                const card = document.createElement('div');
                card.className = 'up-card extra-comp-card';
                card.id = `extra-comp-card-${def.id}`;
                card.innerHTML = `
                    <div class="up-info">
                        <div class="up-title">${def.name} <span class="upgrade-level">Lv.<span id="lv-extra-${def.id}">0</span> / ${def.maxLevel}</span></div>
                        <div class="up-stat"><strong id="val-extra-${def.id}">+0</strong> <span class="up-desc" id="desc-extra-${def.id}">${def.unlockText}</span></div>
                        <div class="up-preview-line" id="preview-extra-${def.id}"></div>
                    </div>
                    <div class="comp-card-actions">
                        <button class="comp-equip-btn" id="btn-equip-${def.id}" type="button">동행 선택</button>
                        <button class="up-btn" id="up-extra-${def.id}" type="button" data-repeat-action="companion" data-companion-id="${def.id}">
                            <span>강화 <span id="cost-extra-${def.id}">${fNum(def.baseCost)}</span></span>
                        </button>
                    </div>
                `;
                container.appendChild(card);
                const equipBtn = document.getElementById(`btn-equip-${def.id}`);
                if (equipBtn) {
                    equipBtn.addEventListener('click', () => this.toggleCompanionEquip(def.id));
                }
            }
        }

        for (const def of Adventure.companions.filter(c => !c.legacy)) {
            const cState = Adventure.getCompanionState(state, def.id);
            const equipped = loadout.includes(def.id);
            const quote = Progression.quotePurchase(state, `comp:${def.id}`, qtyMode);
            const lvEl = document.getElementById(`lv-extra-${def.id}`);
            const valEl = document.getElementById(`val-extra-${def.id}`);
            const descEl = document.getElementById(`desc-extra-${def.id}`);
            const prevEl = document.getElementById(`preview-extra-${def.id}`);
            const costEl = document.getElementById(`cost-extra-${def.id}`);
            const upBtn = document.getElementById(`up-extra-${def.id}`);
            const eqBtn = document.getElementById(`btn-equip-${def.id}`);

            if (lvEl) lvEl.textContent = String(cState.l);
            if (valEl) valEl.textContent = def.formatEffect(state);
            if (descEl) descEl.textContent = cState.unlocked ? (equipped ? '현재 동행 중' : '해금됨 · 대기 중') : `🔒 ${def.unlockText}`;
            if (prevEl && quote) {
                prevEl.textContent = !cState.unlocked
                    ? `해금 조건: ${def.unlockText}`
                    : quote.isMaxed
                        ? '최대 레벨 달성'
                        : quote.canBuy
                            ? `${quote.summary} · ${quote.actualCount}회 / ${fNum(quote.totalCost)} 골드`
                            : `${quote.summary} · 다음 1회 ${fNum(quote.nextCost)} 골드 (${fNum(quote.shortfall)} 부족)`;
            }
            if (costEl) {
                costEl.textContent = !cState.unlocked ? '미해금' : quote && quote.isMaxed ? 'MAX' : fNum(quote ? (quote.canBuy ? quote.totalCost : quote.nextCost) : cState.c);
            }
            if (upBtn) {
                upBtn.disabled = !Data.canWrite || !cState.unlocked || Boolean(quote && !quote.canBuy);
            }
            if (eqBtn) {
                eqBtn.textContent = equipped ? '동행 중' : '동행 선택';
                eqBtn.setAttribute('aria-pressed', String(equipped));
                eqBtn.disabled = !Data.canWrite || !canSwap || !cState.unlocked || (equipped && loadout.length <= 1);
            }
        }
    },

    toggleCompanionEquip(compId) {
        if (!Data.state || typeof Adventure === 'undefined') return;
        const current = Adventure.getLoadout(Data.state).slice();
        const idx = current.indexOf(compId);
        let nextSlots;
        if (idx >= 0) {
            if (current.length <= 1) return;
            current.splice(idx, 1);
            nextSlots = current;
        } else {
            if (current.length < 2) {
                nextSlots = [...current, compId];
            } else {
                nextSlots = [current[1], compId];
            }
        }
        Logic.setCompanionLoadout(nextSlots);
    },

    renderAutomationPanel() {
        const state = Data.state;
        if (!state || !state.automation || typeof AutomationEngine === 'undefined') return;
        const auto = state.automation;
        const status = AutomationEngine.getStatus(state);

        const enableEl = document.getElementById('auto-enabled-toggle');
        if (enableEl && document.activeElement !== enableEl) enableEl.checked = Boolean(auto.enabled);

        const stratEl = document.getElementById('auto-strategy-select');
        if (stratEl && document.activeElement !== stratEl) stratEl.value = auto.strategy;

        const rushEl = document.getElementById('auto-skill-rush');
        if (rushEl && document.activeElement !== rushEl) rushEl.value = auto.skills.rush;

        const nightEl = document.getElementById('auto-skill-night');
        if (nightEl && document.activeElement !== nightEl) nightEl.value = auto.skills.night;

        const allowPendEl = document.getElementById('auto-allow-pending');
        if (allowPendEl && document.activeElement !== allowPendEl) allowPendEl.checked = Boolean(auto.allowDuringBossPending);

        const limitInput = document.getElementById('auto-budget-limit');
        if (limitInput && document.activeElement !== limitInput) limitInput.value = String(auto.budgetLimit);

        const reserveInput = document.getElementById('auto-reserve-gold');
        if (reserveInput && document.activeElement !== reserveInput) reserveInput.value = String(auto.reserveGold);

        document.querySelectorAll('.auto-target-cb').forEach(cb => {
            if (document.activeElement !== cb) {
                if (cb.value === 'extraComp') {
                    cb.checked = GameLimits.EXTRA_COMPANION_IDS.some(id => auto.targets.includes('comp:' + id));
                } else if (cb.value === 'items') {
                    cb.checked = GameLimits.ITEM_IDS.some(id => auto.targets.includes('item:' + id));
                } else {
                    cb.checked = auto.targets.includes(cb.value);
                }
            }
        });

        const spentEl = document.getElementById('auto-budget-spent');
        if (spentEl) spentEl.textContent = fNum(auto.budgetSpent);

        const remEl = document.getElementById('auto-budget-remaining');
        if (remEl) remEl.textContent = fNum(status.remainingBudget);

        const statusEl = document.getElementById('auto-status-text');
        if (statusEl) statusEl.textContent = status.reason;
    },

    renderBossAndLocationControls() {
        const state = Data.state;
        if (!state) return;
        const entrySelect = document.getElementById('boss-entry-mode-select');
        if (entrySelect && document.activeElement !== entrySelect) {
            entrySelect.value = state.bossControl ? state.bossControl.entryMode : 'auto';
        }

        const isPending = Simulation.isBossPending(state);
        const pendingBanner = document.getElementById('boss-pending-banner');
        if (pendingBanner) {
            pendingBanner.hidden = !isPending;
            if (isPending) {
                const pred = Progression.predictBoss(state);
                const summaryEl = document.getElementById('boss-pending-summary');
                if (summaryEl && pred) {
                    summaryEl.textContent = `보스 준비 대기 중 · ${pred.summaryText}`;
                }
            }
        }

        const failureCard = document.getElementById('boss-failure-card');
        if (failureCard) {
            const analysis = Progression.analyzeBossFailure(state);
            const showFailure = Boolean(analysis && !state.mob.boss);
            failureCard.hidden = !showFailure;
            if (showFailure && analysis) {
                const bodyEl = document.getElementById('boss-failure-body');
                if (bodyEl) {
                    const skText = `반짝 분필 ${analysis.skillsUsed.rush ? '사용' : '미사용'} · 칭찬의 마법 ${analysis.skillsUsed.night ? '사용' : '미사용'}`;
                    bodyEl.textContent = `남은 체력 ${fNum(analysis.remainingHp)} / 최대 ${fNum(analysis.maxHp)} (제한 ${analysis.durationSec}초 · 자동 공격 ${fNum(analysis.autoDamage)}/초 · ${skText}). ${analysis.rollbackNotice} ${analysis.actions[0] || ''}`;
                }
            }
        }

        // Location & Cosmetics visual application on #battle-view and #teacher-hero
        if (typeof Adventure !== 'undefined') {
            const loc = Adventure.getCurrentLocation(state);
            const bv = document.getElementById('battle-view');
            const caption = document.querySelector('#battle-view .scene-caption');
            const locBadge = document.getElementById('current-location-label');
            const eq = (state.cosmetics && state.cosmetics.equipped) || GameLimits.COSMETIC_DEFAULTS;
            if (bv) {
                bv.dataset.location = loc.id;
                bv.dataset.bg = loc.id === 'classroom' ? eq.background : `loc-${loc.id}`;
                bv.dataset.decor = loc.id === 'classroom' ? eq.decor : 'decor-none';
            }
            if (caption) caption.textContent = loc.name;
            if (locBadge) locBadge.textContent = loc.shortName;
            this.renderCosmeticLayers(state.character, eq, loc.id);
        }

        // Tracked goals in .goal-card
        this.renderTrackedGoals(state);
    },

    renderCosmeticLayers(character, equipped, locationId = 'classroom') {
        const heroLayer = document.getElementById('hero-cosmetic-layer');
        const decorLayer = document.getElementById('classroom-decor-layer');
        const eq = equipped || GameLimits.COSMETIC_DEFAULTS;
        if (heroLayer) {
            heroLayer.dataset.outfit = eq.outfit;
            heroLayer.dataset.accessory = eq.accessory;
            heroLayer.dataset.wand = eq.wand;
            heroLayer.dataset.character = character === 'male' ? 'male' : 'female';
            const badges = [];
            if (eq.outfit === 'outfit-vest') badges.push('🧥');
            else if (eq.outfit === 'outfit-cape') badges.push('🦸');
            if (eq.accessory === 'accessory-mug') badges.push('☕');
            else if (eq.accessory === 'accessory-notebook') badges.push('📒');
            if (eq.wand === 'wand-star') badges.push('⭐');
            else if (eq.wand === 'wand-rainbow') badges.push('🌈');
            heroLayer.textContent = badges.join(' ');
        }
        if (decorLayer) {
            if (locationId !== 'classroom' || eq.decor === 'decor-none') {
                decorLayer.textContent = '';
                decorLayer.dataset.decor = 'decor-none';
            } else {
                decorLayer.dataset.decor = eq.decor;
                decorLayer.textContent = eq.decor === 'decor-plant' ? '🪴' : eq.decor === 'decor-trophy' ? '🏆' : '';
            }
        }
    },

    renderTrackedGoals(state = Data.state) {
        const box = document.getElementById('tracked-goals-list');
        if (!box || !state) return;
        const show = !state.preferences || state.preferences.showGoals !== false;
        box.hidden = !show;
        if (!show) return;
        const goals = Progression.getTrackedOrRecommendedGoals(state);
        const sig = goals.map(g => `${g.id}:${Number(g.pinned)}:${g.current}:${g.target}:${g.percent}`).join('|');
        if (this.trackedGoalsSignature === sig && box.children.length === goals.length) return;
        this.trackedGoalsSignature = sig;
        box.replaceChildren();
        for (const g of goals) {
            const item = document.createElement('div');
            item.className = 'tracked-goal-chip';
            const tag = g.pinned ? '📌' : '🎯';
            item.textContent = `${tag} ${g.title}: ${fNum(g.current)} / ${fNum(g.target)} (${g.percent}%)`;
            box.appendChild(item);
        }
    },

    showBossPrepDialog() {
        const state = Data.state;
        if (!state) return;
        const pred = Progression.predictBoss(state);
        if (!pred) return;
        const body = document.getElementById('boss-prep-content');
        if (body) {
            const rushText = pred.readySkills.rush ? '반짝 분필 준비됨' : '반짝 분필 대기 중';
            const nightText = pred.readySkills.night ? '칭찬의 마법 준비됨' : '칭찬의 마법 대기 중';
            body.innerHTML = `
                <p><strong>${pred.checkpoint}구간 보스 정보</strong> · 최대 체력 ${fNum(pred.bossMaxHp)} / 제한 시간 ${pred.durationSec}초</p>
                <p>현재 자동 공격력: <strong>${fNum(pred.autoDamage)} / 초</strong> · 스킬 상태: ${rushText}, ${nightText}</p>
                <p class="boss-pred-note">📊 ${pred.basisText}:<br><strong>${pred.summaryText}</strong></p>
            `;
        }
        const startBtn = document.getElementById('btn-boss-prep-start');
        if (startBtn) {
            startBtn.disabled = !Simulation.isBossPending(state);
        }
        this.openDialog('boss-prep-dialog', Simulation.isBossPending(state) ? 'btn-boss-prep-start' : 'btn-boss-prep-upgrade');
    },

    showMapDialog() {
        const state = Data.state;
        if (!state || typeof Adventure === 'undefined') return;
        this.selectedMapLocationId = state.adventure.currentLocation || 'classroom';
        this.renderMapDialog();
        this.openDialog('map-dialog', 'btn-map-close');
    },

    renderMapDialog() {
        const state = Data.state;
        if (!state || typeof Adventure === 'undefined') return;
        const listEl = document.getElementById('map-locations-list');
        const detailEl = document.getElementById('map-location-detail');
        if (!listEl || !detailEl) return;

        const currentId = Adventure.getCurrentLocation(state).id;
        const unlocked = state.adventure.unlockedLocations || ['classroom'];
        const cleared = state.adventure.clearedBossCheckpoints || [];

        listEl.replaceChildren();
        for (const loc of Adventure.locations) {
            const isUnlocked = unlocked.includes(loc.id);
            const isCurrent = loc.id === currentId;
            const isSelected = loc.id === (this.selectedMapLocationId || currentId);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `map-loc-btn${isSelected ? ' selected' : ''}${isCurrent ? ' current' : ''}`;
            btn.disabled = !isUnlocked;
            const statusLabel = isCurrent
                ? '현재 전투 장소'
                : isUnlocked
                    ? '영구 해금됨 (미리보기 가능)'
                    : `🔒 ${loc.checkpoint}구간 보스 격파 시 해금`;
            btn.textContent = `${loc.name} · ${statusLabel}`;
            btn.addEventListener('click', () => {
                this.selectedMapLocationId = loc.id;
                this.renderMapDialog();
            });
            listEl.appendChild(btn);
        }

        const selLoc = Adventure.locationById(this.selectedMapLocationId || currentId);
        const clearDone = selLoc.checkpoint === 0 ? cleared.includes(100) : cleared.includes(selLoc.checkpoint + 100);
        detailEl.innerHTML = `
            <div class="map-preview-banner ${selLoc.themeClass}">
                <h3>${selLoc.name} ${selLoc.id === currentId ? '(현재 모험 중)' : '(배경·이야기 미리보기)'}</h3>
                <p>${selLoc.desc}</p>
            </div>
            <div class="map-story-box">
                <p><strong>📖 입장 이야기:</strong> ${selLoc.enterStory}</p>
                ${selLoc.clearStory ? `<p><strong>🏆 구간 돌파 이야기:</strong> ${clearDone || unlocked.length > Adventure.locations.indexOf(selLoc) + 1 ? selLoc.clearStory : '이 구간의 보스를 물리치면 이야기가 기록됩니다.'}</p>` : ''}
            </div>
        `;
    },

    showCosmeticsDialog() {
        const state = Data.state;
        if (!state || !state.cosmetics) return;
        Adventure.syncUnlocks(state);
        this.previewCosmetics = { ...state.cosmetics.equipped };
        this.renderCosmeticsDialog();
        this.openDialog('cosmetics-dialog', 'btn-cosmetics-close');
    },

    renderCosmeticsDialog() {
        const state = Data.state;
        if (!state || typeof Adventure === 'undefined') return;
        const eq = this.previewCosmetics || state.cosmetics.equipped;
        const container = document.getElementById('cosmetics-slots-container');
        const previewBox = document.getElementById('cosmetics-preview-box');
        if (!container || !previewBox) return;

        const slotNames = {
            outfit: '의상',
            accessory: '소품',
            wand: '분필 지팡이',
            background: '교실 배경',
            decor: '교실 장식'
        };

        const outDef = Adventure.cosmeticById('outfit', eq.outfit);
        const accDef = Adventure.cosmeticById('accessory', eq.accessory);
        const wandDef = Adventure.cosmeticById('wand', eq.wand);
        const bgDef = Adventure.cosmeticById('background', eq.background);
        const decDef = Adventure.cosmeticById('decor', eq.decor);

        previewBox.dataset.bg = eq.background;
        previewBox.innerHTML = `
            <strong>미리보기 (${state.character === 'male' ? '남교사' : '여교사'} · 전투 수치 영향 없음)</strong>
            <p>${outDef ? outDef.name : ''} · ${accDef ? accDef.name : ''} · ${wandDef ? wandDef.name : ''} · ${bgDef ? bgDef.name : ''} · ${decDef ? decDef.name : ''}</p>
        `;

        container.replaceChildren();
        for (const slot of GameLimits.COSMETIC_SLOTS) {
            const group = document.createElement('div');
            group.className = 'cosmetic-slot-group';
            const title = document.createElement('h3');
            title.textContent = slotNames[slot];
            group.appendChild(title);

            const row = document.createElement('div');
            row.className = 'cosmetic-options-row';
            for (const item of Adventure.cosmetics[slot]) {
                const unlocked = Adventure.isCosmeticUnlocked(state, slot, item.id);
                const selected = eq[slot] === item.id;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `cosmetic-item-btn${selected ? ' selected' : ''}`;
                btn.disabled = !unlocked;
                btn.textContent = unlocked
                    ? `${item.name}${selected ? ' ✓' : ''}`
                    : `🔒 ${item.name} (${item.unlockText})`;
                btn.addEventListener('click', () => {
                    this.previewCosmetics[slot] = item.id;
                    this.renderCosmeticsDialog();
                });
                row.appendChild(btn);
            }
            group.appendChild(row);
            container.appendChild(group);
        }
    },

    showReportDialog(reportOverride = null) {
        const state = Data.state;
        if (!state) return;
        const reports = Array.isArray(state.recentReports) ? state.recentReports : [];
        const target = reportOverride || reports[0] || null;
        this.selectedReportId = target ? target.id : null;
        this.renderReportDialog();
        this.openDialog('report-dialog', 'btn-report-close');
    },

    getSelectedReport() {
        const state = Data.state;
        if (!state || !Array.isArray(state.recentReports) || !state.recentReports.length) return null;
        return state.recentReports.find(r => r.id === this.selectedReportId) || state.recentReports[0];
    },

    renderReportDialog() {
        const state = Data.state;
        const contentEl = document.getElementById('report-dialog-content');
        const historyEl = document.getElementById('report-history-list');
        const dlBtn = document.getElementById('btn-report-download-card');
        if (!contentEl || !state) return;

        const reports = Array.isArray(state.recentReports) ? state.recentReports : [];
        const rep = this.getSelectedReport();

        if (!rep) {
            contentEl.innerHTML = '<p>아직 기록된 자리비움 성장 보고서가 없습니다. 1분 이상 자리를 비우거나 레벨 상승·보스 결과가 발생하면 보고서가 보관됩니다.</p>';
            if (dlBtn) dlBtn.disabled = true;
            if (historyEl) historyEl.replaceChildren();
            return;
        }

        if (dlBtn) dlBtn.disabled = false;
        const loc = typeof Adventure !== 'undefined' ? Adventure.locationById(rep.locationId) : { name: '햇살 교실' };
        const rec = Progression.recommendUpgrades(state);
        const recLine = rec && rec.primary
            ? `다음 추천 강화: ${rec.primary.target.name} (${rec.primary.reason})`
            : '현재 모든 강화가 상한에 도달했습니다.';

        contentEl.innerHTML = `
            <div class="report-summary-box">
                <p><strong>${rep.headline || '자리비움 성장 결과'}</strong> (${loc.name})</p>
                <ul>
                    <li>실제 자리비움 시간: <strong>${this.formatDuration(rep.rawElapsedMs)}</strong></li>
                    <li>보상 반영 시간: <strong>${this.formatDuration(rep.appliedElapsedMs)}</strong>${rep.capped ? ' (최대 24시간 상한 적용)' : ''}</li>
                    <li>선생님 레벨: <strong>Lv.${rep.beforeLevel} → Lv.${rep.afterLevel}</strong> (EXP +${fNum(rep.xpGained)})</li>
                    <li>획득 재화: <strong>골드 +${fNum(rep.goldGained)} · 보석 +${fNum(rep.gemsGained)}</strong></li>
                    <li>전투 성과: <strong>몬스터 ${fNum(rep.kills)}마리 처치 · 보스 격파 ${rep.bossKills}회${rep.bossExpired > 0 ? ` · 보스 후퇴 ${rep.bossExpired}회` : ''}</strong></li>
                </ul>
                <p class="report-rec-line">💡 ${recLine}</p>
            </div>
        `;

        if (historyEl) {
            historyEl.replaceChildren();
            reports.slice(0, 5).forEach((item, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `report-hist-btn${item.id === rep.id ? ' active' : ''}`;
                btn.textContent = `#${idx + 1} ${this.formatDuration(item.appliedElapsedMs)} · Lv.${item.afterLevel}`;
                btn.addEventListener('click', () => {
                    this.selectedReportId = item.id;
                    this.renderReportDialog();
                });
                historyEl.appendChild(btn);
            });
        }
    },

    openReportDialog(reportOverride = null, _autoOpened = false) {
        this.showReportDialog(reportOverride);
    },

    renderResExtras() {
        this.renderOnboarding();
        this.renderPurchaseControlsAndRecommendations();
        this.renderCompanionsPanel();
        this.renderAutomationPanel();
    },

    renderHpExtras(_now = Date.now()) {
        this.renderBossAndLocationControls();
    },

    renderGoalBanner() {
        this.renderTrackedGoals(Data.state);
    },

    renderAll() {
        this.renderOnboarding();
        this.renderPurchaseControlsAndRecommendations();
        this.renderCompanionsPanel();
        this.renderAutomationPanel();
        this.renderBossAndLocationControls();
        this.renderTrackedGoals(Data.state);
    },

    async downloadRecordCard() {
        const rep = this.getSelectedReport();
        if (!rep) return false;
        try {
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }
            const spriteSrc = rep.character === 'male' ? 'assets/teacher-male.svg' : 'assets/teacher.svg';
            const spriteImg = new Image();
            spriteImg.src = spriteSrc;
            if (typeof spriteImg.decode === 'function') {
                await spriteImg.decode();
            }

            const canvas = document.createElement('canvas');
            canvas.width = 1200;
            canvas.height = 1200;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context unavailable');

            const loc = typeof Adventure !== 'undefined' ? Adventure.locationById(rep.locationId) : { name: '햇살 교실' };
            const charLabel = rep.character === 'male' ? '남교사' : '여교사';
            const dateStr = new Date(rep.createdAt || Date.now()).toLocaleDateString('ko-KR');

            const grad = ctx.createLinearGradient(0, 0, 1200, 1200);
            grad.addColorStop(0, '#2a2744');
            grad.addColorStop(1, '#1d3532');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1200, 1200);

            ctx.strokeStyle = 'rgba(243, 212, 136, 0.55)';
            ctx.lineWidth = 6;
            ctx.strokeRect(48, 48, 1104, 1104);

            ctx.fillStyle = '#f3d488';
            ctx.font = '700 54px Pretendard, sans-serif';
            ctx.fillText('4시 40분의 용사 · 모험 기록 카드', 96, 150);

            ctx.fillStyle = '#e9f1ee';
            ctx.font = '600 36px Pretendard, sans-serif';
            ctx.fillText(`${dateStr} · ${charLabel} · ${loc.name}`, 96, 220);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(96, 270, 1008, 720);

            if (spriteImg.naturalWidth > 0) {
                ctx.drawImage(spriteImg, 860, 620, 210, 260);
            }

            const lines = [
                `대표 성과: ${rep.headline || '꾸준한 교실 모험'}`,
                `선생님 성장: Lv.${rep.beforeLevel} → Lv.${rep.afterLevel} (EXP +${fNum(rep.xpGained)})`,
                `반영 시간: ${this.formatDuration(rep.appliedElapsedMs)}${rep.capped ? ' (최대 24시간 반영)' : ''}`,
                `처치 기록: 몬스터 ${fNum(rep.kills)}마리 · 보스 격파 ${rep.bossKills}회`,
                `획득 보상: 골드 +${fNum(rep.goldGained)} · 보석 +${fNum(rep.gemsGained)}`
            ];
            ctx.fillStyle = '#ffffff';
            ctx.font = '600 38px Pretendard, sans-serif';
            lines.forEach((line, i) => {
                ctx.fillText(line, 130, 380 + i * 115);
            });

            ctx.fillStyle = '#b9cfc7';
            ctx.font = '500 30px Pretendard, sans-serif';
            ctx.fillText('4시 40분의 용사 · 선생님의 작은 방치형 RPG', 96, 1080);

            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = 'hand-free-adventure-card.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
            Sys.toast('🖼️ 1200×1200 모험 기록 카드 PNG를 저장했습니다.');
            return true;
        } catch (err) {
            Sys.toast('기록 카드 이미지를 만들지 못했습니다. 다시 시도해 주세요.');
            return false;
        }
    },

    showPrestigeDialog() {
        if (!Data.state) return;
        Logic.catchUp();
        const plan = Progression.buildPrestigePlan(Data.state);
        this.pendingPrestigePlan = plan;
        this.renderPrestigeDialog(plan, false);
        this.openDialog('prestige-dialog', plan && plan.canPrestige ? 'btn-prestige-confirm' : 'btn-prestige-close');
    },

    renderPrestigeDialog(plan, updatedNotice = false) {
        const contentEl = document.getElementById('prestige-dialog-content');
        const confirmBtn = document.getElementById('btn-prestige-confirm');
        if (!contentEl || !plan) return;

        if (confirmBtn) confirmBtn.disabled = !Data.canWrite || !plan.canPrestige;
        const noticeHtml = updatedNotice
            ? '<p class="prestige-reconfirm-alert">⚠️ 확인 중 진행 상황이 바뀌어 최신 수치로 견적을 갱신했습니다. 아래 값을 확인하고 다시 눌러 주세요.</p>'
            : '';
        const synHtml = plan.synergyNotice
            ? `<p class="prestige-synergy-note">📌 ${plan.synergyNotice}</p>`
            : '';

        contentEl.innerHTML = `
            ${noticeHtml}
            <div class="prestige-compare-grid">
                <div><span>받을 연수학점</span><strong>+${fNum(plan.gainTokens)}</strong></div>
                <div><span>정산 후 총 연수학점</span><strong>${fNum(plan.currentTokens)} → ${fNum(plan.nextTokens)}</strong></div>
                <div><span>연수학점 공격 배율</span><strong>×${plan.currentMultiplier.toFixed(1)} → ×${plan.nextMultiplier.toFixed(1)}</strong></div>
                <div><span>다음 모험 시작 자동 공격</span><strong>${fNum(plan.currentAutoDamage)}/초 → ${fNum(plan.nextAutoDamage)}/초</strong></div>
                <div><span>다음 모험 시작 추가 공격</span><strong>${fNum(plan.currentClickDamage)} → ${fNum(plan.nextClickDamage)}</strong></div>
            </div>
            <p class="prestige-explain-note">💡 레벨·아이템·유물·연수학점은 유지되지만, 이번 모험의 골드 기본 강화와 동료 레벨이 Lv.1/Lv.0으로 초기화되어 시작 즉시 공격력은 현재보다 낮아질 수 있습니다.</p>
            ${synHtml}
            <div class="prestige-lists">
                <div>
                    <h3>✅ 다음 모험에도 유지되는 항목</h3>
                    <ul>${plan.retainedList.map(item => `<li>${item}</li>`).join('')}</ul>
                </div>
                <div>
                    <h3>🔄 새 모험에서 초기화되는 항목</h3>
                    <ul>${plan.resetList.map(item => `<li>${item}</li>`).join('')}</ul>
                </div>
            </div>
        `;
    },

    confirmPrestigeFromDialog() {
        if (!this.pendingPrestigePlan) return;
        const res = Logic.prestige({
            skipConfirm: true,
            expectedSignature: this.pendingPrestigePlan.signature,
            expectedGainTokens: this.pendingPrestigePlan.gainTokens
        });
        if (res && typeof res === 'object' && res.needsReconfirm) {
            this.pendingPrestigePlan = res.plan;
            this.renderPrestigeDialog(res.plan, true);
            return;
        }
        if (res === true) {
            this.pendingPrestigePlan = null;
            this.closeDialog('prestige-dialog');
        }
    }
};

if (typeof window !== 'undefined') window.ExperienceUI = ExperienceUI;
if (typeof globalThis !== 'undefined') globalThis.ExperienceUI = ExperienceUI;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ExperienceUI };
}
