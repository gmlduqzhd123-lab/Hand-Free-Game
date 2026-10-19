'use strict';

const Progression = {
    _pendingAutoReport: null,

    normalizeTarget(targetSpec) {
        if (!targetSpec) return null;
        if (typeof targetSpec === 'object' && targetSpec.kind) return targetSpec;
        const raw = String(targetSpec).trim();
        const basicMap = {
            click: 'click', 'up-click': 'click', c: 'click',
            auto: 'auto', 'up-auto': 'auto', a: 'auto',
            crit: 'crit', 'up-crit': 'crit',
            comp1: 'comp1', 'up-comp1': 'comp1', na: 'comp1',
            comp2: 'comp2', 'up-comp2': 'comp2', yu: 'comp2'
        };
        if (basicMap[raw]) {
            const key = basicMap[raw];
            const names = {
                click: '분필 마법 (추가 공격)',
                auto: '자동 분필 (자동 공격)',
                crit: '핵심 찌르기 (치명타 확률)',
                comp1: '체육 요정 (자동 공격 동료)',
                comp2: '응원 요정 (추가 공격 동료)'
            };
            return { kind: 'upgrade', id: key, key: `upgrade:${key}`, name: names[key] };
        }
        if (raw.startsWith('comp:')) {
            const compId = raw.slice(5);
            if (compId === 'na') return this.normalizeTarget('comp1');
            if (compId === 'yu') return this.normalizeTarget('comp2');
            const def = typeof Adventure !== 'undefined' ? Adventure.companionById(compId) : null;
            if (!def) return null;
            return { kind: 'companion', id: compId, key: `comp:${compId}`, name: def.name };
        }
        if (raw.startsWith('item:')) {
            const itemId = raw.slice(5);
            const item = typeof Catalog !== 'undefined' ? Catalog.getItem(itemId) : null;
            if (!item) return null;
            return { kind: 'item', id: item.id, key: `item:${item.id}`, name: item.name };
        }
        const maybeItem = typeof Catalog !== 'undefined' ? Catalog.getItem(raw) : null;
        if (maybeItem) {
            return { kind: 'item', id: maybeItem.id, key: `item:${maybeItem.id}`, name: maybeItem.name };
        }
        const maybeComp = typeof Adventure !== 'undefined' ? Adventure.companionById(raw) : null;
        if (maybeComp && !maybeComp.legacy) {
            return { kind: 'companion', id: maybeComp.id, key: `comp:${maybeComp.id}`, name: maybeComp.name };
        }
        return null;
    },

    snapshotMetrics(state, now = Date.now()) {
        const catBonuses = typeof Catalog !== 'undefined' ? Catalog.bonuses(state) : { clickPct: 0, autoPct: 0, xpPct: 0, goldPct: 0, critPoints: 0, bossSeconds: 0 };
        const advBonuses = typeof Adventure !== 'undefined' ? Adventure.bonuses(state) : { xpBonus: 0, goldBonus: 0, bossSeconds: 0, cooldownReduction: 0 };
        const baseCrit = Math.min(50, Math.round(((state.stat && state.stat.crit ? state.stat.crit.p : 0) + catBonuses.critPoints) * 100) / 100);
        const nightActive = Boolean(state.buff && state.buff.nightUntil > now);
        return {
            clickDamage: Simulation.getClickDamage(state),
            autoDamage: Simulation.getAutoDamage(state),
            baseCritChance: baseCrit,
            effectiveCritChance: nightActive ? 100 : baseCrit,
            nightActive,
            xpBonusPct: Math.round(Math.min(1.8, catBonuses.xpPct + advBonuses.xpBonus) * 1000) / 10,
            goldBonusPct: Math.round(Math.min(1.8, catBonuses.goldPct + advBonuses.goldBonus) * 1000) / 10,
            bossDurationSec: Math.round(Simulation.bossDuration(state) / 100) / 10,
            cooldownReductionPct: Math.round(advBonuses.cooldownReduction * 100)
        };
    },

    _getTargetProgress(state, target) {
        if (target.kind === 'upgrade') {
            const up = Logic.getUpgrade(target.id, state);
            if (!up) return { level: 0, maxLevel: 0, cost: Infinity, isMaxed: true, unlocked: false, power: 0 };
            const isCritCapped = up.key === 'crit' && (up.current.p + Catalog.bonuses(state).critPoints >= 50);
            const isMaxed = up.current.l >= GameLimits.MAX_LEVEL || up.current.p >= GameLimits.MAX_NUMBER || isCritCapped;
            return {
                level: up.current.l,
                maxLevel: up.key === 'crit' ? Math.max(up.current.l, up.current.l + Math.max(0, Math.ceil(50 - (up.current.p + Catalog.bonuses(state).critPoints)))) : GameLimits.MAX_LEVEL,
                cost: up.current.c,
                isMaxed,
                isCritCapped,
                unlocked: true,
                power: up.current.p
            };
        }
        if (target.kind === 'companion') {
            const def = typeof Adventure !== 'undefined' ? Adventure.companionById(target.id) : null;
            const entry = state.extraCompanions && state.extraCompanions[target.id];
            if (!def || !entry) return { level: 0, maxLevel: 0, cost: Infinity, isMaxed: true, unlocked: false, power: 0 };
            const isMaxed = entry.l >= def.maxLevel;
            return {
                level: entry.l,
                maxLevel: def.maxLevel,
                cost: entry.c,
                isMaxed,
                isCritCapped: false,
                unlocked: Boolean(entry.unlocked),
                power: def.getEffectValue(state)
            };
        }
        if (target.kind === 'item') {
            const item = Catalog.getItem(target.id);
            if (!item) return { level: 0, maxLevel: 0, cost: Infinity, isMaxed: true, unlocked: false, power: 0 };
            const level = Catalog.itemLevel(item, state);
            const isCritCapped = item.category === 'crit' && (state.stat.crit.p + Catalog.bonuses(state).critPoints >= 50);
            const isMaxed = level >= item.maxLevel;
            return {
                level,
                maxLevel: item.maxLevel,
                cost: Catalog.itemCost(item, state),
                isMaxed,
                isCritCapped,
                unlocked: true,
                power: Math.round(level * item.bonusPerLevel * 1000) / 1000
            };
        }
        return { level: 0, maxLevel: 0, cost: Infinity, isMaxed: true, unlocked: false, power: 0 };
    },

    _applySingleStep(candidate, target) {
        if (target.kind === 'upgrade') {
            const up = Logic.getUpgrade(target.id, candidate);
            if (!up || Logic.isUpgradeMaxed(target.id, candidate)) return 0;
            const cost = up.current.c;
            if (candidate.gold < cost) return 0;
            candidate.gold = Math.max(0, candidate.gold - cost);
            up.current.l += 1;
            up.current.c = Math.floor(GameLimits.multiply(up.current.c, up.growth));
            up.apply(up.current);
            return cost;
        }
        if (target.kind === 'companion') {
            const def = typeof Adventure !== 'undefined' ? Adventure.companionById(target.id) : null;
            const entry = candidate.extraCompanions && candidate.extraCompanions[target.id];
            if (!def || !entry || !entry.unlocked || entry.l >= def.maxLevel) return 0;
            const cost = entry.c;
            if (candidate.gold < cost) return 0;
            candidate.gold = Math.max(0, candidate.gold - cost);
            entry.l += 1;
            entry.p = Math.round(entry.l * def.perLevel * 1000) / 1000;
            entry.c = Math.max(1, Math.floor(GameLimits.multiply(entry.c, def.costGrowth)));
            return cost;
        }
        if (target.kind === 'item') {
            const item = Catalog.getItem(target.id);
            if (!item) return 0;
            const level = Catalog.itemLevel(item, candidate);
            if (level >= item.maxLevel) return 0;
            const cost = Catalog.itemCost(item, candidate);
            if (candidate.gold < cost) return 0;
            candidate.gold = Math.max(0, candidate.gold - cost);
            if (!candidate.items) candidate.items = {};
            candidate.items[item.id] = level + 1;
            return cost;
        }
        return 0;
    },

    getPurchaseStateSignature(state = Data.state) {
        if (!state) return '';
        const pref = state.preferences ? `${state.preferences.purchaseQty}:${state.preferences.playStyle}` : '1:idle';
        const stats = state.stat && state.comp
            ? `${state.stat.c.l}:${state.stat.c.p}:${state.stat.c.c}:${state.stat.a.l}:${state.stat.a.p}:${state.stat.a.c}:${state.stat.crit.l}:${state.stat.crit.p}:${state.stat.crit.c}:${state.comp.na.l}:${state.comp.na.p}:${state.comp.na.c}:${state.comp.yu.l}:${state.comp.yu.p}:${state.comp.yu.c}`
            : '';
        const extras = state.extraCompanions
            ? GameLimits.EXTRA_COMPANION_IDS.map(k => {
                const e = state.extraCompanions[k];
                return e ? `${Number(e.unlocked)}:${e.l}:${e.c}` : '';
            }).join(',')
            : '';
        const loadout = Array.isArray(state.companionLoadout) ? state.companionLoadout.join(',') : '';
        const presets = Array.isArray(state.companionPresets)
            ? state.companionPresets.map(p => `${p.name}:${(p.slots || []).join('+')}`).join('|')
            : '';
        const items = state.items ? GameLimits.ITEM_IDS.map(k => state.items[k] || 0).join(',') : '';
        const relics = `${(state.relic || []).map(Number).join('')}:${(state.extraRelics || []).map(Number).join('')}`;
        const canWrite = typeof Data !== 'undefined' ? Number(Boolean(Data.canWrite)) : 1;
        const playing = typeof GameApp !== 'undefined' ? Number(Boolean(GameApp.playing)) : 1;
        const boss = state.mob ? Number(Boolean(state.mob.boss)) : 0;
        const bossStatus = state.bossControl ? state.bossControl.status : 'idle';
        const lv = state.player ? state.player.level : 1;
        return `${state.gold}|${state.gem}|${state.token}|${lv}|${pref}|${stats}|${extras}|${loadout}|${presets}|${items}|${relics}|${canWrite}|${playing}|${boss}|${bossStatus}`;
    },

    quotePurchase(state = Data.state, targetSpec = 'click', qtyMode = null, now = Date.now()) {
        const target = this.normalizeTarget(targetSpec);
        if (!state || !target) return null;
        const mode = GameLimits.PURCHASE_QUANTITIES.includes(qtyMode)
            ? qtyMode
            : (state.preferences && GameLimits.PURCHASE_QUANTITIES.includes(state.preferences.purchaseQty)
                ? state.preferences.purchaseQty
                : '1');
        const initialInfo = this._getTargetProgress(state, target);
        const beforeMetrics = this.snapshotMetrics(state, now);
        const remainingLevels = Math.max(0, initialInfo.maxLevel - initialInfo.level);
        const desiredCount = mode === '1' ? Math.min(1, remainingLevels)
            : mode === '10' ? Math.min(10, remainingLevels)
            : remainingLevels;

        const sim = JSON.parse(JSON.stringify(state));
        let actualCount = 0;
        let totalCost = 0;

        if (initialInfo.unlocked && !initialInfo.isMaxed && desiredCount > 0) {
            for (let i = 0; i < desiredCount; i++) {
                const info = this._getTargetProgress(sim, target);
                if (info.isMaxed || sim.gold < info.cost) break;
                const spent = this._applySingleStep(sim, target);
                if (!(spent > 0)) break;
                actualCount += 1;
                totalCost = GameLimits.add(totalCost, spent);
            }
        }

        const afterInfo = this._getTargetProgress(sim, target);
        const afterMetrics = this.snapshotMetrics(sim, now);

        // One-step preview when currently unaffordable so UI can still explain what +1 level gives
        let oneStepMetrics = afterMetrics;
        let oneStepInfo = afterInfo;
        if (actualCount === 0 && initialInfo.unlocked && !initialInfo.isMaxed) {
            const oneSim = JSON.parse(JSON.stringify(state));
            oneSim.gold = GameLimits.add(oneSim.gold, initialInfo.cost);
            this._applySingleStep(oneSim, target);
            oneStepInfo = this._getTargetProgress(oneSim, target);
            oneStepMetrics = this.snapshotMetrics(oneSim, now);
        }

        const nextCost = initialInfo.isMaxed ? 0 : initialInfo.cost;
        const shortfall = initialInfo.isMaxed ? 0 : Math.max(0, nextCost - state.gold);
        const canBuy = Boolean(initialInfo.unlocked && !initialInfo.isMaxed && actualCount > 0);

        const deltas = {
            level: afterInfo.level - initialInfo.level,
            clickDamage: afterMetrics.clickDamage - beforeMetrics.clickDamage,
            autoDamage: afterMetrics.autoDamage - beforeMetrics.autoDamage,
            baseCritChance: Math.round((afterMetrics.baseCritChance - beforeMetrics.baseCritChance) * 100) / 100,
            xpBonusPct: Math.round((afterMetrics.xpBonusPct - beforeMetrics.xpBonusPct) * 10) / 10,
            goldBonusPct: Math.round((afterMetrics.goldBonusPct - beforeMetrics.goldBonusPct) * 10) / 10,
            bossDurationSec: Math.round((afterMetrics.bossDurationSec - beforeMetrics.bossDurationSec) * 10) / 10,
            cooldownReductionPct: afterMetrics.cooldownReductionPct - beforeMetrics.cooldownReductionPct
        };

        const previewMetrics = actualCount > 0 ? afterMetrics : oneStepMetrics;
        const previewCount = actualCount > 0 ? actualCount : (initialInfo.isMaxed ? 0 : 1);
        const summary = this._formatEffectSummary(target, initialInfo, actualCount > 0 ? afterInfo : oneStepInfo, beforeMetrics, previewMetrics, previewCount);

        return {
            target,
            mode,
            unlocked: initialInfo.unlocked,
            isMaxed: initialInfo.isMaxed,
            isCritCapped: initialInfo.isCritCapped,
            canBuy,
            actualCount,
            previewCount,
            totalCost,
            nextCost,
            shortfall,
            remainingGold: Math.max(0, state.gold - totalCost),
            beforeLevel: initialInfo.level,
            afterLevel: afterInfo.level,
            previewAfterLevel: (actualCount > 0 ? afterInfo : oneStepInfo).level,
            maxLevel: initialInfo.maxLevel,
            beforePower: initialInfo.power,
            afterPower: afterInfo.power,
            previewAfterPower: (actualCount > 0 ? afterInfo : oneStepInfo).power,
            before: beforeMetrics,
            after: afterMetrics,
            previewAfter: previewMetrics,
            deltas,
            summary
        };
    },

    _formatEffectSummary(target, beforeInfo, afterInfo, before, after, count) {
        if (!beforeInfo.unlocked) return '보스 격파 후 해금됩니다.';
        if (beforeInfo.isMaxed) {
            if (beforeInfo.isCritCapped) return '일반 치명타 상한(50%)에 도달했습니다 (자동 공격에는 치명타 미적용).';
            return '최대 레벨에 도달했습니다.';
        }
        const stepLabel = count > 1 ? `${count}회 구매 시` : '1회 구매 시';
        if (target.kind === 'upgrade') {
            if (target.id === 'click' || target.id === 'comp2') {
                const diff = after.clickDamage - before.clickDamage;
                return `${stepLabel} 추가 공격 ${before.clickDamage} → ${after.clickDamage} (+${diff})`;
            }
            if (target.id === 'auto' || target.id === 'comp1') {
                const diff = after.autoDamage - before.autoDamage;
                return `${stepLabel} 자동 공격 ${before.autoDamage} → ${after.autoDamage} (+${diff}/초)`;
            }
            if (target.id === 'crit') {
                const diff = Math.round((after.baseCritChance - before.baseCritChance) * 100) / 100;
                const nightNote = before.nightActive ? ' · 칭찬의 마법 일시 100% 활성 중' : '';
                return `${stepLabel} 추가 공격 치명타 ${before.baseCritChance}% → ${after.baseCritChance}% (+${diff}%p, 상한 50% · 자동 공격 제외${nightNote})`;
            }
        }
        if (target.kind === 'companion') {
            const equipped = typeof Adventure !== 'undefined' && Adventure.isCompanionEquipped(Data.state, target.id);
            const equipNote = equipped ? '' : ' (동행 장착 시 적용)';
            if (target.id === 'library') return `${stepLabel} 동료 경험치 +${beforeInfo.level}% → +${afterInfo.level}%${equipNote}`;
            if (target.id === 'science') return `${stepLabel} 동료 보스 시간 +${(beforeInfo.level * 0.2).toFixed(1)}초 → +${(afterInfo.level * 0.2).toFixed(1)}초${equipNote}`;
            if (target.id === 'music') return `${stepLabel} 스킬 재사용 -${beforeInfo.level}% → -${afterInfo.level}%${equipNote}`;
            if (target.id === 'tidy') return `${stepLabel} 동료 골드 +${beforeInfo.level}% → +${afterInfo.level}%${equipNote}`;
        }
        if (target.kind === 'item') {
            const item = Catalog.getItem(target.id);
            if (!item) return '';
            if (item.category === 'click') return `${stepLabel} 추가 공격 ${before.clickDamage} → ${after.clickDamage} (+${after.clickDamage - before.clickDamage})`;
            if (item.category === 'auto') return `${stepLabel} 자동 공격 ${before.autoDamage} → ${after.autoDamage} (+${after.autoDamage - before.autoDamage}/초)`;
            if (item.category === 'xp') return `${stepLabel} 경험치 보너스 +${before.xpBonusPct}% → +${after.xpBonusPct}%`;
            if (item.category === 'gold') return `${stepLabel} 골드 보너스 +${before.goldBonusPct}% → +${after.goldBonusPct}%`;
            if (item.category === 'crit') {
                if (before.baseCritChance >= 50) return '일반 치명타 상한(50%) 도달 · 추가 구매 시 치명타 확률이 더 오르지 않습니다 (자동 공격 제외)';
                return `${stepLabel} 추가 공격 치명타 ${before.baseCritChance}% → ${after.baseCritChance}% (상한 50% · 자동 공격 제외)`;
            }
            if (item.category === 'boss') return `${stepLabel} 보스 제한 시간 ${before.bossDurationSec}초 → ${after.bossDurationSec}초`;
        }
        return '';
    },

    applyPurchaseToCandidate(candidate, targetSpec, qtyMode = '1', now = Date.now()) {
        const quote = this.quotePurchase(candidate, targetSpec, qtyMode, now);
        if (!quote || !quote.canBuy || quote.actualCount <= 0) {
            return { applied: false, count: 0, totalCost: 0, quote };
        }
        const prevBossDurationMs = Simulation.bossDuration(candidate);
        let count = 0;
        let totalCost = 0;
        for (let i = 0; i < quote.actualCount; i++) {
            const spent = this._applySingleStep(candidate, quote.target);
            if (!(spent > 0)) break;
            count += 1;
            totalCost = GameLimits.add(totalCost, spent);
        }
        if (count <= 0) return { applied: false, count: 0, totalCost: 0, quote };

        const nextBossDurationMs = Simulation.bossDuration(candidate);
        const deltaBossMs = nextBossDurationMs - prevBossDurationMs;
        if (deltaBossMs > 0 && Simulation.isBossActive(candidate) && candidate.mob.deadline > 0) {
            candidate.mob.deadline = Math.min(8640000000000000, Math.ceil(candidate.mob.deadline + deltaBossMs));
        }
        if (candidate.onboarding && candidate.onboarding.steps) {
            candidate.onboarding.steps.firstUpgrade = true;
        }
        Ach.evaluate(candidate);
        if (typeof Adventure !== 'undefined') Adventure.syncUnlocks(candidate);
        return { applied: true, count, totalCost, quote };
    },

    applyPurchase(targetSpec, qtyMode = null, options = {}) {
        if (!Logic.canAct()) return false;
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        Logic.catchUp(now);
        const mode = qtyMode || (Data.state.preferences && Data.state.preferences.purchaseQty) || '1';
        const candidate = Logic.cloneState();
        const result = this.applyPurchaseToCandidate(candidate, targetSpec, mode, now);
        if (!result.applied) return false;
        const saveOptions = options.requirePersistent
            ? { allowMemory: false }
            : { allowMemory: Data.storageAvailable === false };
        if (!Data.save(candidate, saveOptions)) {
            if (!options.silent) {
                Logic.toast('저장하지 못해 변경을 취소했습니다. 저장 공간과 브라우저 설정을 확인하세요.');
            }
            return false;
        }
        if (!options.silent) Logic.sound('btn');
        Logic.sync(now);
        Ach.check();
        Logic.render();
        return result;
    },

    recommendUpgrades(state = Data.state, playStyle = null, now = Date.now()) {
        if (!state) return { primary: null, list: [] };
        const style = playStyle || (state.preferences && state.preferences.playStyle) || 'idle';
        const candidates = [
            'click', 'auto', 'crit', 'comp1', 'comp2',
            ...GameLimits.EXTRA_COMPANION_IDS.map(id => `comp:${id}`),
            ...GameLimits.ITEM_IDS.map(id => `item:${id}`)
        ];

        const scored = [];
        for (const spec of candidates) {
            const quote = this.quotePurchase(state, spec, '1', now);
            if (!quote || !quote.unlocked || quote.isMaxed || quote.isCritCapped) continue;
            if (quote.target.kind === 'companion' && typeof Adventure !== 'undefined' && !Adventure.isCompanionEquipped(state, quote.target.id)) {
                continue;
            }
            if (quote.target.id === 'comp1' && typeof Adventure !== 'undefined' && !Adventure.isCompanionEquipped(state, 'na')) {
                continue;
            }
            if (quote.target.id === 'comp2' && typeof Adventure !== 'undefined' && !Adventure.isCompanionEquipped(state, 'yu')) {
                continue;
            }
            const cost = Math.max(1, quote.nextCost);
            const dAuto = Math.max(0, quote.previewAfter.autoDamage - quote.before.autoDamage);
            const dClick = Math.max(0, quote.previewAfter.clickDamage - quote.before.clickDamage);
            const dCrit = Math.max(0, quote.previewAfter.baseCritChance - quote.before.baseCritChance);
            const dXp = Math.max(0, quote.previewAfter.xpBonusPct - quote.before.xpBonusPct);
            const dGold = Math.max(0, quote.previewAfter.goldBonusPct - quote.before.goldBonusPct);
            const dBoss = Math.max(0, quote.previewAfter.bossDurationSec - quote.before.bossDurationSec);
            const dCd = Math.max(0, quote.previewAfter.cooldownReductionPct - quote.before.cooldownReductionPct);

            let score = 0;
            let reason = '';
            if (style === 'idle') {
                const autoWeight = (dAuto * 120) / cost;
                const xpWeight = (dXp * 80) / cost;
                const goldWeight = (dGold * 75) / cost;
                const bossWeight = (dBoss * 60) / cost;
                score = autoWeight + xpWeight + goldWeight + bossWeight;
                if (dAuto > 0 && autoWeight >= xpWeight && autoWeight >= goldWeight) {
                    reason = `현재 비용 대비 자동 공격 증가량(+${dAuto}/초)이 가장 큽니다`;
                } else if (dXp > 0 && xpWeight >= goldWeight) {
                    reason = `방치 중 레벨 성장을 높이는 경험치 보너스(+${dXp}%p) 효율이 높습니다`;
                } else if (dGold > 0) {
                    reason = `몬스터 처치 골드 보너스(+${dGold}%p)를 높여 수집 속도를 키웁니다`;
                } else if (dBoss > 0) {
                    reason = `보스 제한 시간(+${dBoss}초)을 늘려 도전을 안정화합니다`;
                }
            } else {
                const clickWeight = (dClick * 120) / cost;
                const critWeight = (dCrit * 180) / cost;
                const cdWeight = (dCd * 90) / cost;
                const autoSub = (dAuto * 20) / cost;
                score = clickWeight + critWeight + cdWeight + autoSub;
                if (dClick > 0 && clickWeight >= critWeight && clickWeight >= cdWeight) {
                    reason = `현재 비용 대비 추가 공격력 증가량(+${dClick})이 가장 큽니다`;
                } else if (dCrit > 0 && critWeight >= cdWeight) {
                    reason = `추가 공격 치명타 확률(+${dCrit}%p)을 높여 직접 공격 피해량을 키웁니다`;
                } else if (dCd > 0) {
                    reason = `마법 스킬 재사용 시간(-${dCd}%p)을 줄여 버프 빈도를 높입니다`;
                } else if (dAuto > 0) {
                    reason = `보조 자동 공격력(+${dAuto}/초)을 함께 높입니다`;
                }
            }

            if (score <= 0) continue;
            scored.push({
                key: quote.target.key,
                target: quote.target,
                quote,
                affordable: quote.canBuy,
                score,
                reason
            });
        }

        scored.sort((a, b) => {
            if (a.affordable !== b.affordable) return a.affordable ? -1 : 1;
            if (Math.abs(b.score - a.score) > 1e-12) return b.score - a.score;
            return a.key.localeCompare(b.key);
        });

        return {
            playStyle: style,
            primary: scored[0] || null,
            list: scored.slice(0, 5)
        };
    },

    predictBoss(state = Data.state, now = Date.now()) {
        if (!state) return null;
        const sim = JSON.parse(JSON.stringify(state));
        const isCurrentlyBoss = Boolean(sim.mob && sim.mob.boss);
        const targetCheckpoint = isCurrentlyBoss
            ? sim.kills
            : Math.max(100, Math.ceil((sim.kills + 1) / 100) * 100);
        const killsRemaining = isCurrentlyBoss ? 0 : Math.max(0, targetCheckpoint - sim.kills);

        sim.kills = targetCheckpoint;
        sim.mob.boss = true;
        const bossMaxHp = Simulation.calcMobStats(sim).hp;
        sim.mob.hp = isCurrentlyBoss && sim.mob.hp > 0 ? Math.min(sim.mob.hp, bossMaxHp) : bossMaxHp;
        const initialHp = sim.mob.hp;
        const durationMs = Simulation.bossDuration(sim);
        sim.mob.deadline = now + durationMs;
        if (!sim.bossControl) sim.bossControl = {};
        sim.bossControl.status = 'active';
        sim.bossControl.startedAt = now;
        sim.buff.rushUntil = 0;
        sim.buff.nightUntil = 0;
        sim.autoRemainder = 0;

        let cursor = now;
        const endAt = now + durationMs;
        let won = false;
        let expired = false;
        let elapsedMs = 0;

        while (cursor < endAt) {
            const stepEnd = Math.min(endAt, cursor + 1000);
            const ev = Simulation.simulate(sim, cursor, stepEnd, { offline: false });
            elapsedMs = stepEnd - now;
            cursor = stepEnd;
            if (ev.bossKills > 0) {
                won = true;
                break;
            }
            if (ev.bossExpired > 0) {
                expired = true;
                break;
            }
        }

        const remainingHp = won
            ? 0
            : (expired && sim.bossControl && sim.bossControl.lastResult
                ? sim.bossControl.lastResult.remainingHp
                : Math.max(1, Math.ceil(sim.mob.hp)));
        const durationSec = Math.round(durationMs / 100) / 10;
        const estimatedSec = Math.max(1, Math.round(elapsedMs / 100) / 10);
        const rushReady = typeof Adventure !== 'undefined' ? Adventure.getSkillReadyAt(state, 'rush') <= now : true;
        const nightReady = typeof Adventure !== 'undefined' ? Adventure.getSkillReadyAt(state, 'night') <= now : true;

        return {
            checkpoint: targetCheckpoint,
            isCurrentlyBoss,
            isPending: Simulation.isBossPending(state),
            killsRemaining,
            bossMaxHp,
            initialHp,
            estimatedRemainingHp: remainingHp,
            willWin: won,
            durationSec,
            estimatedSec,
            autoDamage: Simulation.getAutoDamage(state),
            readySkills: { rush: rushReady, night: nightReady },
            basisText: '현재 조합의 자동 공격과 시간에 따른 레벨 성장 기준 예상',
            summaryText: won
                ? `현재 자동 공격과 레벨 성장 기준 약 ${estimatedSec}초 만에 격파 예상`
                : `자동 공격만으로는 제한 시간(${durationSec}초) 뒤 체력이 약 ${remainingHp} 남을 것으로 예상`
        };
    },

    analyzeBossFailure(state = Data.state) {
        if (!state || !state.bossControl || !state.bossControl.lastResult) return null;
        const res = state.bossControl.lastResult;
        if (res.outcome !== 'failed') return null;
        const actions = [];
        if (!res.skillsUsed || !res.skillsUsed.rush) {
            actions.push('보스 진입 직후 반짝 분필(5초 고속 공격)을 사용해 초반 체력을 크게 줄여 보세요.');
        }
        if (!res.skillsUsed || !res.skillsUsed.night) {
            actions.push('반짝 분필과 함께 칭찬의 마법(치명타 100%)을 사용하면 추가 공격 피해가 크게 늘어납니다.');
        }
        if (res.durationSec < 36) {
            actions.push('느긋한 모래시계·포근한 꽃차 아이템이나 과학 요정을 동행해 보스 제한 시간을 늘려 보세요.');
        }
        const rec = this.recommendUpgrades(state, 'idle');
        if (rec && rec.primary) {
            actions.push(`추천 강화: ${rec.primary.target.name} (${rec.primary.reason})`);
        } else {
            actions.push('자동 분필과 체육 요정 레벨을 올려 초당 자동 공격력을 높여 보세요.');
        }
        return {
            checkpoint: res.checkpoint || 100,
            maxHp: res.maxHp,
            remainingHp: res.remainingHp,
            durationSec: res.durationSec,
            autoDamage: res.autoDamage,
            skillsUsed: res.skillsUsed || { rush: false, night: false },
            rollbackNotice: '보스가 달아나 진행 시각 1분과 처치 수 1마리가 되돌아갔습니다.',
            actions
        };
    },

    getTrackedOrRecommendedGoals(state = Data.state) {
        if (!state || typeof Ach === 'undefined') return [];
        const trackedIds = Array.isArray(state.trackedGoals) ? state.trackedGoals : [];
        const pinned = [];
        for (const id of trackedIds) {
            const ach = Ach.list[id];
            if (!ach) continue;
            pinned.push({
                ...Ach.getProgress(id, state),
                pinned: true
            });
        }
        if (pinned.length >= GameLimits.MAX_TRACKED_GOALS) {
            return pinned.slice(0, GameLimits.MAX_TRACKED_GOALS);
        }

        const style = state.preferences && state.preferences.playStyle === 'active' ? 'active' : 'idle';
        const candidates = [];
        for (const ach of Ach.list) {
            if (trackedIds.includes(ach.id)) continue;
            if (Ach.isClaimed(ach.id, state)) continue;
            const prog = Ach.getProgress(ach.id, state);
            // Weight easy/early goals and current playstyle higher than huge endgame targets
            let weight = prog.percent;
            if (prog.ready) weight += 1000;
            if (ach.target <= 25) weight += 35;
            else if (ach.target <= 100) weight += 20;
            else if (ach.target >= 10000) weight -= 25;
            if (style === 'idle' && (ach.kind === 'combat' || ach.kind === 'level' || ach.kind === 'item')) weight += 15;
            if (style === 'active' && (ach.kind === 'click' || ach.kind === 'upgrade')) weight += 15;
            candidates.push({ ...prog, pinned: false, _weight: weight });
        }
        candidates.sort((a, b) => b._weight - a._weight || a.id - b.id);
        const needed = GameLimits.MAX_TRACKED_GOALS - pinned.length;
        return [...pinned, ...candidates.slice(0, needed)];
    },

    toggleTrackedGoal(id) {
        if (!Logic.canAct()) return false;
        const achId = Number(id);
        if (!Number.isInteger(achId) || achId < 0 || achId > GameLimits.MAX_ACHIEVEMENT_ID) return false;
        Logic.catchUp();
        const candidate = Logic.cloneState();
        if (!Array.isArray(candidate.trackedGoals)) candidate.trackedGoals = [];
        const idx = candidate.trackedGoals.indexOf(achId);
        if (idx >= 0) {
            candidate.trackedGoals.splice(idx, 1);
        } else {
            if (candidate.trackedGoals.length >= GameLimits.MAX_TRACKED_GOALS) {
                Logic.toast('목표는 최대 3개까지 고정할 수 있어요.');
                return false;
            }
            candidate.trackedGoals.push(achId);
        }
        if (!Logic.commit(candidate)) return false;
        Logic.render();
        return true;
    },

    settleAway(now = Date.now(), options = {}) {
        if (Data.canWrite === false || !Data.state) {
            Logic.sync(now);
            return { settled: false, events: Simulation.events(), report: null, shouldAutoShow: false };
        }
        const candidate = Logic.cloneState();
        // Rebase clock on candidate if device clock moved backwards
        const anchor = Math.max(candidate.lastActiveAt || 0, candidate.savedAt || 0);
        if (anchor > now) {
            const offset = anchor - now;
            const shift = ts => ts > 0 ? Math.max(0, Math.ceil(ts - offset)) : 0;
            candidate.lastActiveAt = shift(candidate.lastActiveAt);
            candidate.savedAt = shift(candidate.savedAt);
            for (const name of ['rush', 'night']) candidate.skill[name] = shift(candidate.skill[name]);
            if (candidate.skillTimers) {
                candidate.skillTimers.rushReadyAt = shift(candidate.skillTimers.rushReadyAt);
                candidate.skillTimers.nightReadyAt = shift(candidate.skillTimers.nightReadyAt);
            }
            for (const name of ['rushUntil', 'nightUntil']) candidate.buff[name] = shift(candidate.buff[name]);
            candidate.mob.deadline = shift(candidate.mob.deadline);
            if (candidate.bossControl && candidate.bossControl.startedAt > 0) {
                candidate.bossControl.startedAt = shift(candidate.bossControl.startedAt);
            }
            if (candidate.bossControl && candidate.bossControl.lastResult && candidate.bossControl.lastResult.at > 0) {
                candidate.bossControl.lastResult.at = shift(candidate.bossControl.lastResult.at);
            }
            if (candidate.automation && candidate.automation.lastDecisionAt > 0) {
                candidate.automation.lastDecisionAt = shift(candidate.automation.lastDecisionAt);
            }
            if (Array.isArray(candidate.recentReports)) {
                for (const rep of candidate.recentReports) {
                    if (rep && rep.createdAt > 0) rep.createdAt = shift(rep.createdAt);
                }
            }
        }

        const from = Number.isFinite(candidate.lastActiveAt) ? Math.min(now, candidate.lastActiveAt) : now;
        const isOffline = options.offline !== false;
        if (!(from < now)) {
            candidate.lastActiveAt = now;
            Simulation.reconcile(candidate, now);
            Data.save(candidate, { allowMemory: Data.storageAvailable === false });
            Logic.reconcile(now);
            return {
                settled: false,
                events: Simulation.events(),
                report: this._pendingAutoReport,
                shouldAutoShow: Boolean(this._pendingAutoReport)
            };
        }

        const rawElapsedMs = Math.max(0, now - from);
        const beforeLevel = candidate.player.level;
        Simulation.reconcile(candidate, from);
        const events = Simulation.simulate(candidate, from, now, { offline: isOffline });
        Simulation.reconcile(candidate, now);
        if (typeof Adventure !== 'undefined') Adventure.syncUnlocks(candidate);

        const significant = isOffline && (rawElapsedMs >= 60000 || events.levelsGained > 0 || events.bossKills > 0 || events.bossExpired > 0);
        const shouldAutoShow = isOffline && rawElapsedMs >= 60000;
        let report = null;

        if (significant) {
            const loc = typeof Adventure !== 'undefined' ? Adventure.getCurrentLocation(candidate) : { id: 'classroom', name: '햇살 교실' };
            report = {
                id: `rep-${now}-${Math.min(GameLimits.MAX_COUNTER, (candidate.revision || 0) + 1)}`,
                createdAt: now,
                rawElapsedMs,
                appliedElapsedMs: events.elapsedMs,
                capped: Boolean(events.capped),
                beforeLevel,
                afterLevel: candidate.player.level,
                xpGained: events.xpGained,
                goldGained: events.gold,
                gemsGained: events.gems,
                kills: events.kills,
                bossKills: events.bossKills,
                bossExpired: events.bossExpired,
                character: candidate.character === 'male' ? 'male' : 'female',
                locationId: loc.id,
                headline: events.bossKills > 0
                    ? `자리 비움 중 보스 ${events.bossKills}마리 격파!`
                    : events.levelsGained > 0
                        ? `선생님 Lv.${beforeLevel} → Lv.${candidate.player.level} 성장!`
                        : `몬스터 ${events.kills}마리 처치 · 골드 +${events.gold}`
            };
            if (!Array.isArray(candidate.recentReports)) candidate.recentReports = [];
            candidate.recentReports.unshift(report);
            if (candidate.recentReports.length > GameLimits.MAX_RECENT_REPORTS) {
                candidate.recentReports.length = GameLimits.MAX_RECENT_REPORTS;
            }
        }

        const saved = Data.save(candidate, { allowMemory: Data.storageAvailable === false });
        if (!saved) {
            Logic.sync(now);
            return { settled: false, events: Simulation.events(), report: null, shouldAutoShow: false };
        }

        if (shouldAutoShow && report) {
            this._pendingAutoReport = report;
        }
        Logic.reconcile(now);
        if (!options.silent && options.notify !== false) {
            Logic.notify(events, isOffline);
        }
        if (options.render !== false) {
            Logic.render();
        }
        return {
            settled: true,
            events,
            report: report || this._pendingAutoReport,
            shouldAutoShow: Boolean(shouldAutoShow && report)
        };
    },

    consumePendingAutoReport() {
        const rep = this._pendingAutoReport;
        this._pendingAutoReport = null;
        return rep;
    },

    buildPrestigePlan(state = Data.state) {
        if (!state) return null;
        const previous = JSON.parse(JSON.stringify(state));
        Ach.evaluate(previous);
        const candidate = Data.createDefault();

        const prevRunMatch = previous.adventure && typeof previous.adventure.runId === 'string'
            ? /^run-(\d+)$/.exec(previous.adventure.runId)
            : null;
        const nextRunNum = prevRunMatch ? Math.min(GameLimits.MAX_COUNTER, Number(prevRunMatch[1]) + 1) : 2;
        const nextRunId = `run-${nextRunNum}`;

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
        candidate.skillTimers = previous.skillTimers
            ? { rushReadyAt: previous.skillTimers.rushReadyAt || 0, nightReadyAt: previous.skillTimers.nightReadyAt || 0 }
            : { rushReadyAt: 0, nightReadyAt: 0 };
        candidate.sound = previous.sound;
        candidate.character = previous.character;
        candidate.hasStarted = previous.hasStarted;
        candidate.revision = previous.revision;
        candidate.lastActiveAt = previous.lastActiveAt;

        if (previous.onboarding) candidate.onboarding = JSON.parse(JSON.stringify(previous.onboarding));
        if (previous.preferences) candidate.preferences = JSON.parse(JSON.stringify(previous.preferences));
        if (previous.automation) candidate.automation = JSON.parse(JSON.stringify(previous.automation));

        candidate.adventure = {
            runId: nextRunId,
            currentLocation: 'classroom',
            clearedBossCheckpoints: [],
            unlockedLocations: previous.adventure && Array.isArray(previous.adventure.unlockedLocations)
                ? previous.adventure.unlockedLocations.slice()
                : ['classroom'],
            seenStories: previous.adventure && Array.isArray(previous.adventure.seenStories)
                ? previous.adventure.seenStories.slice()
                : ['enter-classroom']
        };

        candidate.bossControl = {
            entryMode: previous.bossControl && previous.bossControl.entryMode === 'prepare' ? 'prepare' : 'auto',
            status: 'none',
            challengeId: previous.bossControl ? previous.bossControl.challengeId || 0 : 0,
            startedAt: 0,
            startAutoDamage: 0,
            skillsUsed: { rush: false, night: false },
            lastResult: null
        };

        if (previous.extraCompanions) {
            for (const id of GameLimits.EXTRA_COMPANION_IDS) {
                if (previous.extraCompanions[id]) {
                    candidate.extraCompanions[id].unlocked = Boolean(previous.extraCompanions[id].unlocked);
                }
            }
        }
        if (Array.isArray(previous.companionLoadout)) {
            candidate.companionLoadout = previous.companionLoadout.slice(0, 2);
        }
        if (Array.isArray(previous.companionPresets)) {
            candidate.companionPresets = JSON.parse(JSON.stringify(previous.companionPresets));
        }
        if (previous.cosmetics) {
            candidate.cosmetics = JSON.parse(JSON.stringify(previous.cosmetics));
        }
        if (Array.isArray(previous.trackedGoals)) {
            candidate.trackedGoals = previous.trackedGoals.slice(0, GameLimits.MAX_TRACKED_GOALS);
        }
        if (Array.isArray(previous.recentReports)) {
            candidate.recentReports = JSON.parse(JSON.stringify(previous.recentReports.slice(0, GameLimits.MAX_RECENT_REPORTS)));
        }

        if (typeof Adventure !== 'undefined') Adventure.syncUnlocks(candidate);

        const currentMultiplier = Simulation.getMultiplier(previous);
        const nextMultiplier = Simulation.getMultiplier(candidate);
        const currentClickDamage = Simulation.getClickDamage(previous);
        const nextClickDamage = Simulation.getClickDamage(candidate);
        const currentAutoDamage = Simulation.getAutoDamage(previous);
        const nextAutoDamage = Simulation.getAutoDamage(candidate);

        const synInfo = typeof Adventure !== 'undefined'
            ? Adventure.evaluateLoadoutSynergy(candidate)
            : { pending: false, reason: '' };

        return {
            canPrestige: previous.min > 0,
            gainTokens: previous.min,
            currentTokens: previous.token,
            nextTokens: candidate.token,
            currentMultiplier,
            nextMultiplier,
            currentClickDamage,
            nextClickDamage,
            currentAutoDamage,
            nextAutoDamage,
            nextRunId,
            synergyNotice: synInfo.pending ? synInfo.reason : '',
            signature: `${previous.min}:${previous.token}:${previous.player.level}:${previous.kills}:${previous.mob && previous.mob.boss ? 1 : 0}`,
            retainedList: [
                `선생님 레벨 (Lv.${candidate.player.level}) 및 경험치`,
                `연수학점 (${previous.token} → ${candidate.token}) 및 보석 (${candidate.gem})`,
                `보유 상점 아이템 (${Catalog.itemCount(candidate)}종) 및 유물 (${Catalog.relicCount(candidate)}종)`,
                `업적 달성·보상 상태 및 고정 목표 (${candidate.trackedGoals.length}개)`,
                `영구 해금 장소 (${candidate.adventure.unlockedLocations.length}곳), 동료 해금 및 동행 슬롯`,
                `캐릭터·교실 꾸미기 외형 및 자동화 설정·예산 사용액 (${candidate.automation.budgetSpent})`
            ],
            resetList: [
                '현재 모험 시간 (16:00부터 다시 시작) 및 처치 수',
                '보유 골드 (0골드)',
                '기본 강화 (분필 마법·자동 분필·핵심 찌르기 Lv.1/Lv.0)',
                '동료 강화 레벨 (체육·응원 및 신규 요정 Lv.0 초기화)',
                '이번 모험의 장소 이동 구간 및 활성 보스·스킬 버프'
            ],
            candidate
        };
    }
};

if (typeof window !== 'undefined') window.Progression = Progression;
if (typeof globalThis !== 'undefined') globalThis.Progression = Progression;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Progression };
}
