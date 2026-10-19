'use strict';

const AutomationEngine = {
    DECISION_INTERVAL_MS: 1000,
    MAX_PURCHASES_PER_TICK: 10,
    FIXED_TARGET_ORDER: Object.freeze([
        'click', 'auto', 'crit', 'comp1', 'comp2',
        ...GameLimits.EXTRA_COMPANION_IDS.map(id => `comp:${id}`),
        ...GameLimits.ITEM_IDS.map(id => `item:${id}`)
    ]),
    lastStopReason: '',

    getStatus(state = Data.state, now = Date.now()) {
        if (!state || !state.automation) {
            return { active: false, reason: '자동화 설정을 불러오는 중입니다.', remainingBudget: 0 };
        }
        const auto = state.automation;
        const remainingBudget = Math.max(0, GameLimits.finite(auto.budgetLimit) - GameLimits.finite(auto.budgetSpent));
        if (!auto.enabled) {
            return { active: false, reason: '자동 강화가 꺼져 있습니다.', remainingBudget };
        }
        if (!state.hasStarted) {
            return { active: false, reason: '모험 시작 전(소개 화면)에는 작동하지 않습니다.', remainingBudget };
        }
        if (typeof document !== 'undefined' && document.hidden) {
            return { active: false, reason: '화면이 숨겨진 동안에는 자동 강화와 스킬이 중지됩니다.', remainingBudget };
        }
        if (Data.canWrite === false) {
            return { active: false, reason: '다른 탭이 저장 소유권을 가지고 있거나 읽기 전용 상태입니다.', remainingBudget };
        }
        if (Data.storageAvailable === false) {
            return { active: false, reason: '영구 저장소를 사용할 수 없어 자동 행동이 중지되었습니다.', remainingBudget };
        }
        if (this.isDialogBlocking()) {
            return { active: false, reason: '대화상자가 열려 있는 동안 자동화를 잠시 멈춥니다.', remainingBudget };
        }
        const pending = Simulation.isBossPending(state);
        if (pending && !auto.allowDuringBossPending) {
            return { active: false, reason: '보스 준비 대기 중에는 자동 행동이 멈춥니다.', remainingBudget };
        }
        if (this.lastStopReason) {
            return { active: false, reason: this.lastStopReason, remainingBudget };
        }
        return {
            active: true,
            reason: '자동 강화와 스킬은 이 화면이 열려 있을 때 작동합니다.',
            remainingBudget
        };
    },

    isDialogBlocking() {
        if (typeof GameApp !== 'undefined' && typeof GameApp.isModalBlockingAutomation === 'function') {
            if (GameApp.isModalBlockingAutomation()) return true;
        }
        if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
            const openDialog = document.querySelector('.exp-modal-backdrop.open, dialog[open]');
            if (openDialog) return true;
        }
        return false;
    },

    canRun(state = Data.state) {
        if (!state || !state.automation || !state.automation.enabled) return false;
        if (!state.hasStarted) return false;
        if (Data.canWrite === false || Data.storageAvailable === false) return false;
        if (typeof GameApp !== 'undefined' && !GameApp.playing) return false;
        if (typeof document !== 'undefined' && document.hidden) return false;
        if (this.isDialogBlocking()) return false;
        return true;
    },

    _canAffordWithinBudget(candidate, cost) {
        if (!(cost > 0) || !Number.isFinite(cost)) return false;
        const auto = candidate.automation;
        const remainingBudget = GameLimits.finite(auto.budgetLimit) - GameLimits.finite(auto.budgetSpent);
        if (cost > remainingBudget) return false;
        if (candidate.gold - cost < GameLimits.finite(auto.reserveGold)) return false;
        return true;
    },

    expandTargets(rawTargets) {
        if (!Array.isArray(rawTargets)) return [];
        const expanded = [];
        for (const item of rawTargets) {
            if (item === 'extraComp') {
                for (const id of GameLimits.EXTRA_COMPANION_IDS) expanded.push(`comp:${id}`);
            } else if (item === 'items') {
                for (const id of GameLimits.ITEM_IDS) expanded.push(`item:${id}`);
            } else if (typeof item === 'string' && AUTOMATION_TARGET_SET.has(item)) {
                expanded.push(item);
            }
        }
        return Array.from(new Set(expanded));
    },

    _pickNextPurchaseTarget(candidate, now) {
        const auto = candidate.automation;
        if (!auto || auto.strategy === 'hold') return null;
        const targets = this.expandTargets(auto.targets);
        if (!targets.length) return null;

        if (auto.strategy === 'auto-priority') {
            let bestSpec = null;
            let bestScore = 0;
            let bestOrder = Infinity;
            for (const spec of targets) {
                const quote = Progression.quotePurchase(candidate, spec, '1', now);
                if (!quote || !quote.canBuy || quote.actualCount < 1 || quote.isCritCapped) continue;
                const cost = quote.totalCost;
                if (!this._canAffordWithinBudget(candidate, cost)) continue;
                const deltaAuto = quote.after.autoDamage - quote.before.autoDamage;
                if (!(deltaAuto > 0)) continue;
                const score = deltaAuto / cost;
                const orderIdx = this.FIXED_TARGET_ORDER.indexOf(spec);
                const normalizedOrder = orderIdx >= 0 ? orderIdx : 999;
                if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && normalizedOrder < bestOrder)) {
                    bestScore = score;
                    bestSpec = spec;
                    bestOrder = normalizedOrder;
                }
            }
            return bestSpec ? { spec: bestSpec, nextCursor: auto.cursor } : null;
        }

        if (auto.strategy === 'balanced') {
            const len = targets.length;
            const startCursor = Math.max(0, Math.floor(auto.cursor || 0)) % len;
            for (let offset = 0; offset < len; offset++) {
                const idx = (startCursor + offset) % len;
                const spec = targets[idx];
                const quote = Progression.quotePurchase(candidate, spec, '1', now);
                if (!quote || !quote.canBuy || quote.actualCount < 1 || quote.isCritCapped) continue;
                if (!this._canAffordWithinBudget(candidate, quote.totalCost)) continue;
                return { spec, nextCursor: (idx + 1) % len };
            }
            return null;
        }

        return null;
    },

    _decideSkills(candidate, now) {
        if (!Simulation.canAttack(candidate) || Simulation.isBossPending(candidate)) {
            return [];
        }
        const autoSkills = (candidate.automation && candidate.automation.skills) || { rush: 'manual', night: 'manual' };
        const isBoss = Simulation.isBossActive(candidate);
        const castList = [];

        const canCastType = type => {
            const mode = autoSkills[type];
            if (mode !== 'ready' && mode !== 'boss') return false;
            if (mode === 'boss' && !isBoss) return false;
            const readyAt = typeof Adventure !== 'undefined'
                ? Adventure.getSkillReadyAt(candidate, type)
                : (candidate.skill[type] > 0 ? candidate.skill[type] + Combat.sk[type].cd * 1000 : 0);
            return readyAt <= now;
        };

        const willCastRush = canCastType('rush');
        if (willCastRush) {
            const cdMs = typeof Adventure !== 'undefined' ? Adventure.getSkillCooldownMs(candidate, 'rush') : 60000;
            candidate.skill.rush = now;
            if (!candidate.skillTimers) candidate.skillTimers = { rushReadyAt: 0, nightReadyAt: 0 };
            candidate.skillTimers.rushReadyAt = now + cdMs;
            candidate.buff.rushUntil = now + Combat.sk.rush.d * 1000;
            if (isBoss && candidate.bossControl && candidate.bossControl.skillsUsed) {
                candidate.bossControl.skillsUsed.rush = true;
            }
            if (candidate.onboarding && candidate.onboarding.steps) {
                candidate.onboarding.steps.useRush = true;
            }
            castList.push('rush');
        }

        const rushActiveOrStarting = Boolean(candidate.buff.rushUntil > now || willCastRush);
        if (rushActiveOrStarting && canCastType('night')) {
            const cdMs = typeof Adventure !== 'undefined' ? Adventure.getSkillCooldownMs(candidate, 'night') : 90000;
            candidate.skill.night = now;
            if (!candidate.skillTimers) candidate.skillTimers = { rushReadyAt: 0, nightReadyAt: 0 };
            candidate.skillTimers.nightReadyAt = now + cdMs;
            candidate.buff.nightUntil = now + Combat.sk.night.d * 1000;
            if (isBoss && candidate.bossControl && candidate.bossControl.skillsUsed) {
                candidate.bossControl.skillsUsed.night = true;
            }
            castList.push('night');
        }

        return castList;
    },

    tick(now = Date.now()) {
        if (!this.canRun(Data.state)) {
            return { executed: false, purchases: 0, skills: [] };
        }
        const state = Data.state;
        const lastAt = state.automation.lastDecisionAt || 0;
        if (lastAt > 0 && now - lastAt < this.DECISION_INTERVAL_MS) {
            return { executed: false, purchases: 0, skills: [] };
        }

        const candidate = Logic.cloneState();
        candidate.automation.lastDecisionAt = now;
        const isPending = Simulation.isBossPending(candidate);
        const allowPurchases = !isPending || Boolean(candidate.automation.allowDuringBossPending);

        let purchases = 0;
        let totalSpent = 0;

        if (allowPurchases && candidate.automation.strategy !== 'hold') {
            for (let step = 0; step < this.MAX_PURCHASES_PER_TICK; step++) {
                const choice = this._pickNextPurchaseTarget(candidate, now);
                if (!choice) break;
                const res = Progression.applyPurchaseToCandidate(candidate, choice.spec, '1', now);
                if (!res.applied || !(res.totalCost > 0)) break;
                candidate.automation.budgetSpent = GameLimits.add(candidate.automation.budgetSpent, res.totalCost);
                if (typeof choice.nextCursor === 'number') {
                    candidate.automation.cursor = choice.nextCursor;
                }
                purchases += res.count;
                totalSpent = GameLimits.add(totalSpent, res.totalCost);
            }
        }

        const skills = this._decideSkills(candidate, now);
        if (purchases === 0 && skills.length === 0) {
            Data.state.automation.lastDecisionAt = now;
            this.lastStopReason = '';
            return { executed: true, purchases: 0, skills: [] };
        }

        if (!Data.save(candidate, { allowMemory: false })) {
            this.lastStopReason = '영구 저장에 실패하여 자동 강화·스킬을 중지했습니다.';
            return { executed: false, purchases: 0, skills: [], error: 'save_failed' };
        }

        this.lastStopReason = '';
        Logic.sync(now);
        Ach.check();
        Logic.render();
        return { executed: true, purchases, totalSpent, skills };
    },

    updateSettings(patch = {}) {
        if (!Logic.canAct()) return false;
        Logic.catchUp();
        const candidate = Logic.cloneState();
        const auto = candidate.automation;
        if (typeof patch.enabled === 'boolean') auto.enabled = patch.enabled;
        if (GameLimits.AUTOMATION_STRATEGIES.includes(patch.strategy)) auto.strategy = patch.strategy;
        if (Array.isArray(patch.targets)) {
            auto.targets = this.expandTargets(patch.targets);
            if (auto.cursor >= auto.targets.length) auto.cursor = 0;
        }
        if (typeof patch.budgetLimit === 'number' && Number.isFinite(patch.budgetLimit) && patch.budgetLimit >= 0) {
            auto.budgetLimit = Math.floor(GameLimits.finite(patch.budgetLimit));
        }
        if (typeof patch.reserveGold === 'number' && Number.isFinite(patch.reserveGold) && patch.reserveGold >= 0) {
            auto.reserveGold = Math.floor(GameLimits.finite(patch.reserveGold));
        }
        if (typeof patch.allowDuringBossPending === 'boolean') {
            auto.allowDuringBossPending = patch.allowDuringBossPending;
        }
        if (patch.skills && typeof patch.skills === 'object') {
            if (GameLimits.SKILL_MODES.includes(patch.skills.rush)) auto.skills.rush = patch.skills.rush;
            if (GameLimits.SKILL_MODES.includes(patch.skills.night)) auto.skills.night = patch.skills.night;
        }
        if (!Data.save(candidate, { allowMemory: false })) {
            Logic.toast('저장하지 못해 자동화 설정 변경을 취소했습니다.');
            return false;
        }
        this.lastStopReason = '';
        Logic.render();
        return true;
    },

    restartBudget(newLimit = null) {
        if (!Logic.canAct()) return false;
        Logic.catchUp();
        const candidate = Logic.cloneState();
        if (typeof newLimit === 'number' && Number.isFinite(newLimit) && newLimit >= 0) {
            candidate.automation.budgetLimit = Math.floor(GameLimits.finite(newLimit));
        }
        candidate.automation.budgetSpent = 0;
        if (!Data.save(candidate, { allowMemory: false })) {
            Logic.toast('저장하지 못해 예산 초기화를 취소했습니다.');
            return false;
        }
        this.lastStopReason = '';
        Logic.toast('🔄 자동 강화 예산 사용액을 0으로 새로 시작했습니다.');
        Logic.render();
        return true;
    }
};

if (typeof window !== 'undefined') window.AutomationEngine = AutomationEngine;
if (typeof globalThis !== 'undefined') globalThis.AutomationEngine = AutomationEngine;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AutomationEngine };
}
