'use strict';

const $ = id => document.getElementById(id);
const fNum = value => {
    const n = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (n < 10000) return Math.floor(n).toLocaleString('ko-KR');
    const units = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극'];
    const index = Math.floor(Math.log10(n) / 4);
    if (index >= units.length) return n.toExponential(1).replace('e+', 'e');
    return (n / Math.pow(10000, index)).toFixed(2).replace(/\.00$/, '') + units[index];
};

const Sys = {
    ctx: null,
    toastTimer: null,
    levelNoticeTimer: null,
    shakeTimer: null,
    audioWarning: false,
    lastAttackSound: -Infinity,
    lastGachaSound: -Infinity,
    get sound() { return Data.state.sound !== false; },

    async init() {
        if (!this.sound) return;
        try {
            const Audio = window.AudioContext || window.webkitAudioContext;
            if (!Audio) return;
            if (!this.ctx || this.ctx.state === 'closed') this.ctx = new Audio();
            if (this.ctx.state === 'suspended') await this.ctx.resume();
        } catch (error) {
            if (!this.audioWarning) {
                this.audioWarning = true;
                this.toast('소리를 시작하지 못했습니다. 소리 버튼을 다시 눌러 주세요.');
            }
        }
    },

    toggleSound() {
        if (!Data.canWrite) return;
        Data.state.sound = !this.sound;
        UI.renderSound();
        Data.save();
        if (this.sound) void this.init();
        else if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
    },

    play(frequency, type, duration, volume = 0.018, delay = 0, endFrequency = frequency) {
        if (!this.sound || !this.ctx || this.ctx.state !== 'running') return;
        try {
            const oscillator = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            oscillator.type = type;
            const start = this.ctx.currentTime + delay;
            oscillator.frequency.setValueAtTime(frequency, start);
            oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
            // A short soft attack avoids the sharp click of an instant gain change.
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.linearRampToValueAtTime(Math.min(0.025, volume), start + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            oscillator.connect(gain);
            gain.connect(this.ctx.destination);
            oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
            oscillator.start(start);
            oscillator.stop(start + duration);
        } catch (error) { /* Audio interruption must never interrupt the game. */ }
    },

    sfx: {
        hit: () => {
            const now = performance.now();
            if (now - Sys.lastAttackSound < 70) return;
            Sys.lastAttackSound = now;
            Sys.play(660, 'sine', 0.12, 0.014, 0, 880);
        },
        crit: () => {
            const now = performance.now();
            if (now - Sys.lastAttackSound < 70) return;
            Sys.lastAttackSound = now;
            Sys.play(784, 'sine', 0.15, 0.015);
            Sys.play(1047, 'sine', 0.18, 0.012, 0.07);
        },
        coin: () => {
            Sys.play(659, 'sine', 0.14, 0.012);
            Sys.play(880, 'sine', 0.2, 0.012, 0.07);
        },
        err: () => Sys.play(440, 'sine', 0.2, 0.012, 0, 392),
        btn: () => Sys.play(698, 'sine', 0.1, 0.012, 0, 784),
        gacha: () => {
            const now = performance.now();
            if (now - Sys.lastGachaSound < 320) return;
            Sys.lastGachaSound = now;
            [523, 659, 784, 1047].forEach((note, i) => Sys.play(note, 'sine', 0.24, 0.014, i * 0.09));
        },
        ach: () => {
            Sys.play(659, 'sine', 0.2, 0.014);
            Sys.play(988, 'sine', 0.26, 0.014, 0.1);
        }
    },

    toast(message) {
        const text = String(message).replace(/<br\s*\/?>/gi, '\n');
        const level = text.match(/^✨\s*Lv\s+(\d+)\s+달성!/);
        const notice = $('level-notice');
        if (notice && level && !text.includes('\n')) {
            notice.textContent = '레벨 업 · Lv.' + level[1];
            notice.classList.add('show');
            clearTimeout(this.levelNoticeTimer);
            this.levelNoticeTimer = setTimeout(() => notice.classList.remove('show'), 2200);
            return;
        }
        $('toast').textContent = text;
        $('toast').classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2500);
    },

    shake(type = 'light') {
        const app = $('game-app');
        clearTimeout(this.shakeTimer);
        app.classList.remove('shake-light', 'shake-hard');
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        void app.offsetWidth;
        app.classList.add(type === 'hard' ? 'shake-hard' : 'shake-light');
        this.shakeTimer = setTimeout(() => app.classList.remove('shake-light', 'shake-hard'), 450);
    },

    showDialog(id, focusId) {
        RepeatInput.stop();
        const dialog = $(id);
        if (!dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }
        if (focusId) $(focusId).focus();
    },

    closeDialog(id) {
        const dialog = $(id);
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
    },

    download(text, filename, type = 'text/plain;charset=utf-8') {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    async export() {
        GameApp.flush();
        const code = btoa(encodeURIComponent(JSON.stringify(Data.state)));
        $('backup-code').value = code;
        this.showDialog('backup-dialog', 'backup-code');
        $('backup-code').select();
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            this.toast('아래 코드를 복사하거나 백업 파일을 내려받으세요.');
            return;
        }
        try {
            await navigator.clipboard.writeText(code);
            this.toast('세이브 코드가 복사되었습니다.');
        } catch (error) {
            this.toast('자동 복사가 되지 않았습니다. 코드를 직접 복사하거나 파일로 보관하세요.');
        }
    },

    import() {
        if (!Data.canWrite) return;
        this.closeDialog('recovery-dialog');
        $('import-code').value = '';
        $('import-error').textContent = '';
        this.showDialog('import-dialog', 'import-code');
    },

    applyImport() {
        if (!Data.canWrite) return;
        let candidate;
        try {
            const code = $('import-code').value.trim();
            if (!code) throw new Error('세이브 코드를 입력해 주세요.');
            candidate = JSON.parse(decodeURIComponent(atob(code)));
        } catch (error) {
            $('import-error').textContent = '세이브 코드를 읽지 못했습니다. 복사한 코드를 확인해 주세요.';
            return;
        }
        const result = Data.import(candidate);
        if (!result.ok) {
            $('import-error').textContent = result.error || '백업을 적용하지 못했습니다. 기존 진행은 유지됩니다.';
            return;
        }
        GameApp.recoveryPending = false;
        this.closeDialog('import-dialog');
        GameApp.resume(false);
        UI.renderAll();
        this.toast('백업을 가져왔습니다.');
    },

    hardReset() {
        if (!Data.canWrite) return;
        if (!confirm('모든 게임 진행을 초기화할까요? 필요한 백업을 먼저 보관하세요.')) return;
        const result = Data.reset();
        if (!result.ok) {
            this.toast(result.error || '초기화를 저장하지 못했습니다. 기존 진행은 유지됩니다.');
            return;
        }
        GameApp.recoveryPending = false;
        this.closeDialog('recovery-dialog');
        this.closeDialog('import-dialog');
        VFX.reset();
        GameApp.resume(false);
        UI.renderAll();
        this.toast('새 게임을 시작했습니다.');
    }
};

const VFX = {
    cvs: $('fx-canvas'),
    ctx: null,
    width: 0,
    height: 0,
    ptc: [],
    hitTimer: null,
    actorTimers: new Map(),

    init() {
        this.ctx = this.cvs.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => this.resize());
            observer.observe(this.cvs);
        }
    },

    resize() {
        const rect = this.cvs.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const ratio = Math.min(window.devicePixelRatio || 1, 3);
        if (this.width === width && this.height === height &&
            this.cvs.width === Math.round(width * ratio)) return;
        this.width = width;
        this.height = height;
        this.cvs.width = Math.round(width * ratio);
        this.cvs.height = Math.round(height * ratio);
        if (this.ctx) this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    },

    point(clientX, clientY) {
        const rect = this.cvs.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    },

    center() {
        const rect = $('monster').getBoundingClientRect();
        return this.point(rect.left + rect.width / 2, rect.top + rect.height / 2);
    },

    animate(id, name, duration) {
        const actor = $(id);
        if (!actor) return;
        const key = id + ':' + name;
        clearTimeout(this.actorTimers.get(key));
        actor.classList.remove(name);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        void actor.offsetWidth;
        actor.classList.add(name);
        this.actorTimers.set(key, setTimeout(() => {
            actor.classList.remove(name);
            this.actorTimers.delete(key);
        }, duration));
    },

    heroAttack() {
        this.animate('teacher-hero', 'attacking', 360);
        this.animate('attack-projectile', 'flying', 360);
    },

    celebrate() { this.animate('teacher-hero', 'celebrate', 600); },
    levelUp() { this.animate('teacher-hero', 'level-up', 900); },

    hit() {
        this.heroAttack();
        const monster = $('monster');
        clearTimeout(this.hitTimer);
        monster.classList.remove('hit');
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        void monster.offsetWidth;
        monster.classList.add('hit');
        this.hitTimer = setTimeout(() => monster.classList.remove('hit'), 100);
    },

    reset() {
        clearTimeout(this.hitTimer);
        for (const timer of this.actorTimers.values()) clearTimeout(timer);
        this.actorTimers.clear();
        if ($('teacher-hero')) $('teacher-hero').classList.remove('attacking', 'celebrate', 'level-up');
        if ($('attack-projectile')) $('attack-projectile').classList.remove('flying');
        $('monster').classList.remove('hit');
        $('monster').style.transform = '';
        this.ptc.length = 0;
    },

    add(text, x, y, type) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const gold = type === 'gold';
        const critical = type === 'crit';
        if (!Number.isFinite(x) || !Number.isFinite(y)) ({ x, y } = this.center());
        if (this.ptc.length >= 120) this.ptc.shift();
        this.ptc.push({
            t: String(text), x: x + (Math.random() - 0.5) * 30, y,
            c: critical ? '#dc8067' : type === 'auto' ? '#6f9c8b' : gold ? '#bba26b' : '#d4ded6',
            s: critical ? 22 : 14,
            life: 1, vx: (Math.random() - 0.5) * 120,
            vy: gold ? -120 : critical ? -360 : -240, g: 720
        });
    },

    update(milliseconds) {
        if (!this.ctx) return;
        const seconds = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000;
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        for (let index = this.ptc.length - 1; index >= 0; index--) {
            const particle = this.ptc[index];
            particle.x += particle.vx * seconds;
            particle.y += particle.vy * seconds + 0.5 * particle.g * seconds * seconds;
            particle.vy += particle.g * seconds;
            particle.life -= 0.9 * seconds;
            if (particle.life <= 0) { this.ptc.splice(index, 1); continue; }
            this.ctx.globalAlpha = Math.max(0, particle.life);
            this.ctx.font = '700 ' + particle.s + 'px Pretendard, sans-serif';
            this.ctx.fillStyle = 'rgba(13, 25, 21, 0.35)';
            this.ctx.fillText(particle.t, particle.x + 1, particle.y + 1);
            this.ctx.fillStyle = particle.c;
            this.ctx.fillText(particle.t, particle.x, particle.y);
        }
        this.ctx.globalAlpha = 1;
    }
};

const UI = {
    achievementSignature: '',
    lastSkillSecond: -1,

    renderSound() {
        const button = $('btn-sound');
        button.dataset.muted = String(!Sys.sound);
        if ($('sound-label')) $('sound-label').textContent = Sys.sound ? '효과음 켜짐' : '효과음 꺼짐';
        button.setAttribute('aria-pressed', String(Sys.sound));
        button.setAttribute('aria-label', Sys.sound ? '소리 끄기' : '소리 켜기');
    },

    renderRes() {
        const state = Data.state;
        const maximumLevel = state.player.level >= GameLimits.MAX_LEVEL;
        const requiredXP = Simulation.xpForLevel(state.player.level);
        $('player-level').textContent = 'Lv.' + fNum(state.player.level);
        if ($('hero-level')) $('hero-level').textContent = 'Lv.' + fNum(state.player.level);
        $('player-level').setAttribute('aria-label', '선생님 레벨 ' + fNum(state.player.level));
        $('player-xp').textContent = maximumLevel ? '최고 레벨 달성' :
            fNum(state.player.xp) + ' / ' + fNum(requiredXP) + ' EXP';
        $('player-xp-fill').style.width = (maximumLevel ? 100 : state.player.xp / requiredXP * 100) + '%';
        $('player-xp-track').setAttribute('aria-valuemax', String(maximumLevel ? 1 : requiredXP));
        $('player-xp-track').setAttribute('aria-valuenow', String(maximumLevel ? 1 : state.player.xp));
        const xpRate = (GameLimits.XP_PER_SECOND * (1 + Catalog.bonuses(state).xpPct)).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
        $('player-xp-track').setAttribute('aria-valuetext', maximumLevel ? '최고 레벨 달성' :
            '레벨 ' + state.player.level + ', 경험치 ' + state.player.xp + ' / ' + requiredXP + '. 초당 ' + xpRate + ' 경험치 자동 획득.');
        document.querySelector('.growth-caption').textContent = '경험치 +' + xpRate + ' / 초 ✦ 선생님은 오늘도 성장 중!';
        const hour = 16 + Math.floor(state.min / 60);
        $('clock').textContent = hour + ':' + String(state.min % 60).padStart(2, '0');
        $('hud-gold').textContent = fNum(state.gold);
        $('hud-gem').textContent = fNum(state.gem);
        $('hud-token').textContent = fNum(state.token);
        if ($('hud-auto')) $('hud-auto').textContent = fNum(Logic.getA_Dmg());
        if ($('hud-click')) $('hud-click').textContent = fNum(Logic.getC_Dmg());
        if ($('day-progress-text')) $('day-progress-text').textContent = state.min >= 40
            ? '오늘의 모험 달성' : fNum(state.min) + ' / 40분';
        if ($('day-progress-fill')) $('day-progress-fill').style.width = Math.min(100, state.min / 40 * 100) + '%';
        $('preview-token').textContent = fNum(state.min);
        const relicComplete = Catalog.relicCount(state) === Catalog.relics.length;
        $('btn-gacha').disabled = !Data.canWrite || state.gem < 10 || relicComplete;
        $('btn-gacha').setAttribute('aria-label', relicComplete ? '유물 수집 완료' : '보석 10개로 유물 뽑기. 누르고 있으면 연속 구매.');
        const descriptors = [
            ['click', state.stat.c, Logic.getC_Dmg(), '분필 마법'],
            ['auto', state.stat.a, Logic.getA_Dmg(), '자동 공격'],
            ['crit', state.stat.crit, Math.min(50, state.stat.crit.p + Catalog.bonuses(state).critPoints), '치명타'],
            ['comp1', state.comp.na, state.comp.na.p, '체육 요정'],
            ['comp2', state.comp.yu, state.comp.yu.p, '응원 요정']
        ];
        for (const [name, entry, value, title] of descriptors) {
            $('lv-' + name).textContent = fNum(entry.l);
            $('val-' + name).textContent = fNum(value);
            const maximum = Logic.isUpgradeMaxed(name);
            $('cost-' + name).textContent = maximum ? 'MAX' : fNum(entry.c);
            $('up-' + name).disabled = !Data.canWrite || maximum || state.gold < entry.c;
            const description = name === 'crit' && maximum ? '최대 확률 50퍼센트 달성' :
                maximum ? '최대 강화 단계 달성' : '강화 비용 골드 ' + fNum(entry.c);
            $('up-' + name).setAttribute('aria-label', title + '. ' + description);
        }
        const milestone = level => {
            const next = [10, 25, 50, 100].find(target => target > level);
            if (!next) return 100;
            const previous = [0, 10, 25, 50].filter(target => target < next).pop();
            return Math.max(0, Math.min(100, (level - previous) / (next - previous) * 100));
        };
        $('mile-click').style.width = milestone(state.stat.c.l) + '%';
        $('mile-auto').style.width = milestone(state.stat.a.l) + '%';
        CatalogUI.render();
    },

    renderHp(now = Date.now()) {
        const state = Data.state;
        const maxHP = Math.max(1, Logic.curMaxHp);
        const ratio = Math.max(0, Math.min(1, state.mob.hp / maxHP));
        $('mob-hp').style.width = ratio * 100 + '%';
        $('mob-hp-track').setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
        $('mob-hp-track').setAttribute('aria-valuetext', '남은 체력 ' + fNum(state.mob.hp) + ', 최대 체력 ' + fNum(maxHP));
        if ($('hp-text')) $('hp-text').textContent = fNum(state.mob.hp) + ' / ' + fNum(maxHP);
        if ($('work-stage')) $('work-stage').textContent = fNum(state.kills + 1);
        if ($('work-status')) $('work-status').textContent = !GameApp.playing || !Data.canWrite || GameApp.recoveryPending || document.hidden
            ? '일시 정지' : state.mob.boss ? '보스 전투 중' : '자동 전투 중';
        if ($('next-boss')) $('next-boss').textContent = state.mob.boss ? '보스를 물리쳐 보석을 모으세요'
            : state.kills >= GameLimits.MAX_COUNTER ? '최고 모험 단계' : (100 - state.kills % 100) + '마리 뒤 보스 등장';
        $('battle-view').classList.toggle('boss-mode', state.mob.boss);
        $('monster').classList.toggle('boss', state.mob.boss);
        $('battle-view').classList.toggle('night-mode', now < state.buff.nightUntil);
        const names = state.mob.boss ? Logic.bosses : Logic.names;
        const index = state.mob.boss
            ? Math.min(Math.max(0, Math.floor(state.kills / 100) - 1), names.length - 1)
            : state.kills % names.length;
        $('monster').dataset.variant = String(index);
        $('mob-name').textContent = names[index];
        $('battle-view').setAttribute('aria-label', names[index] + ' 공격. 남은 체력 ' + Math.round(ratio * 100) + '퍼센트.');
        const timer = $('boss-timer-wrap');
        timer.hidden = !state.mob.boss;
        timer.style.display = state.mob.boss ? 'block' : 'none';
        if ($('boss-seconds')) $('boss-seconds').textContent = '';
        if (state.mob.boss) {
            const maximum = Simulation.bossDuration(state) / 1000;
            const seconds = Math.max(0, (state.mob.deadline - now) / 1000);
            const percentage = Math.max(0, Math.min(100, seconds / maximum * 100));
            $('boss-timer-fill').style.width = percentage + '%';
            timer.dataset.urgent = String(percentage < 30);
            if ($('boss-seconds')) $('boss-seconds').textContent = Math.ceil(seconds) + '초';
            timer.setAttribute('aria-valuenow', String(Math.ceil(seconds)));
            timer.setAttribute('aria-valuemax', String(maximum));
            timer.setAttribute('aria-valuetext', '보스 제한 시간 ' + Math.ceil(seconds) + '초 남음');
        }
    },

    renderAch() {
        const state = Data.state;
        const signature = Ach.list.map(a => Number(Ach.isClaimed(a.id, state))).join('') + ':' +
            Ach.list.map(a => Number(Ach.isReady(a.id, state))).join('') + ':' + Data.canWrite;
        if (signature === this.achievementSignature) return;
        this.achievementSignature = signature;
        const list = $('ach-list');
        list.replaceChildren();
        for (const achievement of Ach.list) {
            const done = Ach.isClaimed(achievement.id, state);
            const ready = Ach.isReady(achievement.id, state);
            const row = document.createElement('div');
            row.className = 'achieve-item' + (done ? ' done' : '');
            const information = document.createElement('div');
            information.className = 'ach-info';
            const title = document.createElement('div');
            title.className = 'ach-title';
            title.textContent = achievement.title;
            const description = document.createElement('div');
            description.className = 'ach-desc';
            description.textContent = achievement.desc;
            information.append(title, description);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-claim';
            button.dataset.achievement = String(achievement.id);
            button.disabled = done || !ready || !Data.canWrite;
            button.textContent = done ? '완료' : '보석 +' + achievement.rwd;
            button.setAttribute('aria-label', achievement.title +
                (done ? ' 수령 완료' : ' 보상 보석 ' + achievement.rwd + '개 수령'));
            button.addEventListener('click', () => Ach.claim(achievement.id));
            row.append(information, button);
            list.appendChild(row);
        }
    },

    renderSkills(now = Date.now()) {
        if (Math.floor(now / 1000) === this.lastSkillSecond) return;
        this.lastSkillSecond = Math.floor(now / 1000);
        for (const [name, number, title] of [
            ['rush', 1, '반짝 분필'], ['night', 2, '칭찬의 마법']
        ]) {
            const duration = Combat.sk[name].cd * 1000;
            const remaining = Math.max(0, Data.state.skill[name] + duration - now);
            const active = Math.max(0, Data.state.buff[name + 'Until'] - now);
            const status = !Data.canWrite ? '일시 정지' : active > 0 ? '작동 중 · ' + Math.ceil(active / 1000) + '초'
                : remaining > 0 ? Math.ceil(remaining / 1000) + '초 대기' : '사용 가능';
            const button = $('btn-s' + number);
            button.disabled = !Data.canWrite || remaining > 0 || active > 0;
            button.dataset.active = String(active > 0);
            button.dataset.state = !Data.canWrite ? 'paused' : active > 0 ? 'active' : remaining > 0 ? 'cooldown' : 'ready';
            $('cd-' + name).style.width = Math.min(100, remaining / duration * 100) + '%';
            if ($('skill-status-' + name)) $('skill-status-' + name).textContent = status;
            button.setAttribute('aria-label', title + '. ' + status);
        }
    },

    selectTab(button) {
        RepeatInput.stop();
        const target = button.dataset.target;
        for (const tab of document.querySelectorAll('.tab-btn')) {
            const active = tab === button;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        }
        for (const panel of document.querySelectorAll('.tab-view')) {
            const active = panel.id === target;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        }
        Ach.check();
        this.renderAch();
        Sys.sfx.btn();
    },

    renderCharacter() {
        const male = Data.state.character === 'male';
        const source = male ? 'assets/teacher-male.svg' : 'assets/teacher.svg';
        if ($('teacher-sprite').getAttribute('src') !== source) $('teacher-sprite').setAttribute('src', source);
        $('chosen-character-name').textContent = male ? '남교사' : '여교사';
    },

    renderAll() {
        this.renderCharacter();
        this.renderRes();
        this.renderHp();
        this.renderAch();
        this.renderSound();
        this.lastSkillSecond = -1;
        this.renderSkills();
        Data.state.relic.forEach((owned, index) => $('relic-' + index).classList.toggle('unlocked', owned));
    }
};

const RepeatInput = {
    delay: 280,
    interval: 100,
    active: null,
    timer: null,
    suppressedClick: null,

    resolve(target) {
        if (!target || typeof target.closest !== 'function') return null;
        const element = target.closest('[data-repeat-action], #battle-view, #up-click, #up-auto, #up-crit, #up-comp1, #up-comp2, #btn-gacha');
        if (!element) return null;
        if (element.id === 'battle-view') return { element, kind: 'attack' };
        if (element.id === 'btn-gacha') return { element, kind: 'gacha' };
        if (element.dataset.repeatAction === 'item') return { element, kind: 'item', id: element.dataset.itemId };
        if (element.id.startsWith('up-')) return { element, kind: 'upgrade', id: element.id.slice(3) };
        if (element.dataset.repeatAction === 'upgrade') return { element, kind: 'upgrade', id: element.dataset.upgrade };
        return null;
    },

    valid(action) {
        return Boolean(action && Logic.canAct() && !GameApp.recoveryPending &&
            action.element.isConnected && !action.element.disabled &&
            !action.element.closest('[hidden], [inert]') && action.element.getClientRects().length &&
            !document.querySelector('dialog[open]'));
    },

    perform(action) {
        if (!this.valid(action)) return false;
        if (action.kind === 'attack') {
            const point = Number.isFinite(action.x) ? VFX.point(action.x, action.y) : VFX.center();
            return Boolean(Combat.attack(point.x, point.y));
        }
        if (action.kind === 'upgrade') return Logic.upgrade(action.id);
        if (action.kind === 'item') return Logic.buyItem(action.id);
        return Logic.pullGacha();
    },

    start(action, input) {
        this.stop();
        if (!this.valid(action)) return;
        const session = { ...action, ...input, performed: false };
        if (input.source === 'touch') {
            const rect = session.element.getBoundingClientRect();
            session.viewportTop = rect.top;
            session.viewportBottom = rect.bottom;
            session.startScrollX = window.scrollX;
        }
        this.active = session;
        session.element.dataset.holding = 'true';
        this.suppress(session.element);
        if (input.source !== 'touch') {
            session.performed = true;
            if (!this.perform(session)) { this.stop(); return; }
        }
        if (this.active === session) this.timer = setTimeout(() => this.tick(session), this.delay);
    },

    tick(session) {
        if (this.active !== session) return;
        session.performed = true;
        if (!this.perform(session)) { this.stop(); return; }
        if (this.active === session) this.timer = setTimeout(() => this.tick(session), this.interval);
    },

    suppress(element) { this.suppressedClick = { element, until: performance.now() + 1200 }; },

    stop() {
        clearTimeout(this.timer);
        this.timer = null;
        const session = this.active;
        this.active = null;
        if (!session) return;
        this.suppress(session.element);
        delete session.element.dataset.holding;
        try {
            if (session.pointerId !== undefined && session.element.hasPointerCapture(session.pointerId)) {
                session.element.releasePointerCapture(session.pointerId);
            }
        } catch (error) { /* The browser may have cancelled the pointer already. */ }
    },

    init() {
        document.addEventListener('pointerdown', event => {
            if (this.active && this.active.source === 'keyboard') this.stop();
            if (event.button !== 0 || event.isPrimary === false) return;
            const action = this.resolve(event.target);
            if (!action || !this.valid(action)) return;
            const touch = event.pointerType === 'touch';
            if (!touch) {
                event.preventDefault();
                action.element.focus({ preventScroll: true });
            }
            this.start(action, { source: touch ? 'touch' : 'pointer', pointerId: event.pointerId,
                x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
            if (this.active) {
                try { action.element.setPointerCapture(event.pointerId); } catch (error) { /* Synthetic events have no native pointer. */ }
            }
        });
        document.addEventListener('pointermove', event => {
            const session = this.active;
            if (session && session.source === 'touch' && session.pointerId === event.pointerId &&
                Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 12) this.stop();
        });
        document.addEventListener('pointerup', event => {
            const session = this.active;
            if (!session || session.pointerId !== event.pointerId) return;
            if (session.source === 'touch' && !session.performed &&
                Math.hypot(event.clientX - session.startX, event.clientY - session.startY) <= 12) {
                this.perform(session);
            }
            this.stop();
        });
        document.addEventListener('pointercancel', () => this.stop());
        document.addEventListener('contextmenu', event => {
            const action = this.resolve(event.target);
            // Mobile long presses may request a menu while the finger is still
            // down. That menu must not end the active attack or purchase hold.
            if (this.active && this.active.source === 'touch' && action &&
                action.element === this.active.element && !['mouse', 'pen'].includes(event.pointerType)) {
                event.preventDefault();
                return;
            }
            this.stop();
        });
        document.addEventListener('lostpointercapture', event => {
            if (this.active && this.active.pointerId === event.pointerId) this.stop();
        });
        document.addEventListener('click', event => {
            const action = this.resolve(event.target);
            if (!action) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (this.suppressedClick && this.suppressedClick.element === action.element &&
                performance.now() < this.suppressedClick.until && event.detail !== 0) return;
            this.perform(action);
        }, true);
        document.addEventListener('keydown', event => {
            if (this.active && this.active.source === 'keyboard' &&
                ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) this.stop();
            if (!['Enter', ' '].includes(event.key)) return;
            const action = this.resolve(event.target);
            if (!action) return;
            event.preventDefault();
            if (event.repeat || !this.valid(action)) return;
            void Sys.init();
            this.start(action, { source: 'keyboard', key: event.key });
        });
        document.addEventListener('keyup', event => {
            if (this.active && this.active.source === 'keyboard' && this.active.key === event.key) {
                event.preventDefault();
                this.stop();
            }
        });
        document.addEventListener('focusout', event => {
            if (this.active && this.active.source === 'keyboard' && event.target === this.active.element) this.stop();
        });
        window.addEventListener('blur', () => this.stop());
        window.addEventListener('wheel', () => this.stop(), { passive: true });
        window.addEventListener('scroll', () => {
            const session = this.active;
            // HUD wrapping can make the browser adjust its scroll anchor while
            // the held control stays under the stationary finger.
            if (session && session.source === 'touch' && window.scrollX === session.startScrollX) {
                const rect = session.element.getBoundingClientRect();
                if (Math.abs(rect.top - session.viewportTop) <= 0.5 &&
                    Math.abs(rect.bottom - session.viewportBottom) <= 0.5) return;
            }
            // Focus scrolling can finish after keydown. Keep its visible target
            // repeating; wheel, scroll keys and pointer input stop navigation.
            if (session && session.source === 'keyboard' && document.activeElement === session.element) {
                const rect = session.element.getBoundingClientRect();
                if (rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) return;
            }
            this.stop();
        }, { passive: true });
    }
};

const GameApp = {
    booted: false,
    playing: false,
    recoveryPending: false,
    lastVisual: 0,
    lastRender: 0,
    savedStatus: null,
    errorMessage: '',
    ready: null,

    renderIntro(syncSelection = false) {
        if (syncSelection) {
            $('character-male').checked = Data.state.character === 'male';
            $('character-female').checked = Data.state.character !== 'male';
        }
        const blocked = !Data.canWrite || this.recoveryPending;
        $('btn-start-game').disabled = blocked;
        $('intro-error').textContent = blocked ? this.recoveryPending
            ? '저장 데이터 복구 후 시작할 수 있어요.' : '다른 탭을 닫거나 이 탭에서 이어하기를 선택해 주세요.' : '';
        const started = Data.state.hasStarted;
        $('intro-progress').textContent = started
            ? '저장된 모험 · Lv.' + Data.state.player.level + ' · ' + fNum(Data.state.kills) + '마리 처치'
            : '새로운 모험이 선생님을 기다리고 있어요.';
        $('btn-start-game').innerHTML = (started ? '모험 이어하기' : '모험 시작하기') +
            ' <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
    },

    prepareIntroProgress() {
        if (!Data.canWrite || this.recoveryPending || this.playing) return;
        const now = Date.now();
        Logic.rebaseClock(now);
        if (Data.state.hasStarted) {
            const from = Math.min(now, Data.state.lastActiveAt);
            Logic.reconcile(from);
            Logic.advance(from, now, { offline: true, silent: true, render: false });
        }
        Data.state.lastActiveAt = now;
        Logic.reconcile(now);
        Data.save();
        this.renderIntro(true);
    },

    enterGame() {
        if (this.playing || !this.booted || !Data.canWrite || this.recoveryPending || document.hidden) return false;
        const now = Date.now();
        Logic.rebaseClock(now);
        const candidate = Logic.cloneState();
        candidate.character = $('character-male').checked ? 'male' : 'female';
        candidate.hasStarted = true;
        // Introduction time never becomes a combat or experience interval.
        candidate.lastActiveAt = now;
        if (!Logic.commit(candidate)) {
            $('intro-error').textContent = '진행을 저장하지 못했습니다. 잠시 뒤 다시 시작해 주세요.';
            return false;
        }
        this.playing = true;
        $('intro-screen').hidden = true;
        $('game-app').hidden = false;
        VFX.reset();
        VFX.resize();
        Logic.reconcile(now);
        this.lastVisual = performance.now();
        this.lastRender = 0;
        UI.renderAll();
        window.scrollTo(0, 0);
        $('battle-view').focus({ preventScroll: true });
        void Sys.init().then(() => Sys.sfx.ach());
        return true;
    },

    goToIntro(settle = true) {
        if (!this.playing) return;
        RepeatInput.stop();
        if (settle) this.flush(true);
        this.playing = false;
        VFX.reset();
        $('game-app').hidden = true;
        $('intro-screen').hidden = false;
        this.renderIntro(true);
        UI.renderAll();
        window.scrollTo(0, 0);
        $('intro-title').focus({ preventScroll: true });
    },

    status(status) {
        this.savedStatus = status;
        const wasRecovering = this.recoveryPending;
        this.recoveryPending = Boolean(status.recoveryAvailable);
        if (!this.booted) return;
        if (wasRecovering && !this.recoveryPending) Sys.closeDialog('recovery-dialog');
        const overlay = $('session-overlay');
        const blocked = !Data.canWrite || this.recoveryPending;
        if (blocked || ['synced', 'imported', 'reset'].includes(status.code)) RepeatInput.stop();
        const justOpened = overlay.hidden && blocked;
        overlay.hidden = !blocked;
        $('game-app').inert = blocked;
        if (blocked) {
            overlay.setAttribute('aria-modal', 'true');
            $('session-title').textContent = this.recoveryPending
                ? '저장 데이터를 복구해 주세요' : '다른 탭에서 플레이 중입니다';
            $('session-message').textContent = this.recoveryPending
                ? '손상된 원본을 보존했습니다. 백업을 가져오거나 원본을 보관한 뒤 새 게임을 시작할 수 있습니다.'
                : '진행을 안전하게 저장하기 위해 이 탭의 게임을 일시 정지했습니다.';
            $('btn-takeover').textContent = this.recoveryPending ? '저장 복구 열기' : '이 탭에서 이어하기';
            if (justOpened) $('btn-takeover').focus();
        } else {
            overlay.removeAttribute('aria-modal');
        }
        const saveStatus = $('save-status');
        if (this.recoveryPending) saveStatus.textContent = '원본 저장은 보존되어 있습니다. 복구할 때까지 새 진행을 덮어쓰지 않습니다.';
        else if (!Data.storageAvailable) saveStatus.textContent = '이 브라우저에 저장하지 못했습니다. 진행을 잃지 않도록 백업 코드나 파일을 보관하세요.';
        else if (!Data.canWrite) saveStatus.textContent = '다른 탭에서 진행을 저장하고 있습니다.';
        else if (status.code === 'saved' || status.code === 'imported' || status.code === 'reset') saveStatus.textContent = '진행이 저장되었습니다.';
        else saveStatus.textContent = '이 탭에서 진행을 저장합니다.';
        if (['storage-read', 'storage-write', 'stale-save'].includes(status.code) &&
            this.errorMessage !== status.code) {
            this.errorMessage = status.code;
            Sys.toast(saveStatus.textContent);
        }
        if (status.code === 'ownership-acquired' && !this.recoveryPending) {
            if (this.playing) this.resume(true);
            else this.prepareIntroProgress();
        }
        if (['synced', 'imported', 'reset'].includes(status.code)) {
            if (status.code === 'imported' && !Data.state.hasStarted && this.playing) this.goToIntro(false);
            if (status.code === 'imported' && !this.playing) this.prepareIntroProgress();
            Logic.reconcile(Date.now());
            VFX.reset();
        }
        UI.renderAll();
        this.renderIntro(['synced', 'imported', 'reset'].includes(status.code));
    },

    resume(offline = true) {
        if (!this.playing || !this.booted || !Data.canWrite || this.recoveryPending) return;
        const now = Date.now();
        Logic.rebaseClock(now);
        const from = Math.min(now, Data.state.lastActiveAt);
        Logic.reconcile(from);
        Logic.advance(from, now, { offline, render: false });
        Logic.reconcile(now);
        this.lastVisual = performance.now();
        this.lastRender = 0;
        UI.renderAll();
        Data.save();
    },

    flush(force = false) {
        if (!this.booted || !Data.canWrite || this.recoveryPending) return;
        const now = Date.now();
        Logic.rebaseClock(now);
        if (!this.playing) {
            Data.state.lastActiveAt = now;
            Data.save();
            return;
        }
        if (!document.hidden || force) {
            Logic.advance(Math.min(now, Data.state.lastActiveAt), now, { render: false });
        }
        Data.save();
    },

    frame(now) {
        const elapsed = this.lastVisual ? Math.max(0, now - this.lastVisual) : 0;
        this.lastVisual = now;
        if (this.playing && !document.hidden && Data.canWrite && !this.recoveryPending) {
            const clock = Date.now();
            Logic.rebaseClock(clock);
            Logic.advance(Math.min(clock, Data.state.lastActiveAt), clock, { render: false });
            VFX.update(elapsed);
            if (now - this.lastRender >= 100) {
                UI.renderRes();
                UI.renderHp(clock);
                UI.renderAch();
                UI.renderSkills(clock);
                this.lastRender = now;
            }
        }
        requestAnimationFrame(next => this.frame(next));
    },

    async start() {
        Data.onStatus(status => this.status(status));
        await Data.ready;
        VFX.init();
        CatalogUI.init();
        this.booted = true;
        this.recoveryPending = Boolean(Data.getRecovery());
        this.installEvents();
        Ach.check();
        Logic.reconcile(Math.min(Date.now(), Data.state.lastActiveAt));
        this.prepareIntroProgress();
        this.renderIntro(true);
        UI.renderAll();
        this.status(this.savedStatus || { code: 'ready' });
        if (this.recoveryPending) Sys.showDialog('recovery-dialog', 'recovery-download');
        requestAnimationFrame(now => this.frame(now));
        setInterval(() => {
            if (!document.hidden && Data.canWrite && !this.recoveryPending) this.flush();
        }, 5000);
        if (document.fonts && document.fonts.ready) void document.fonts.ready.then(() => VFX.resize());
    },

    installEvents() {
        document.addEventListener('pointerdown', () => { void Sys.init(); }, { capture: true });
        RepeatInput.init();
        $('btn-start-game').addEventListener('click', () => this.enterGame());
        $('btn-return-intro').addEventListener('click', () => this.goToIntro());
        const tabs = Array.from(document.querySelectorAll('.tab-btn'));
        for (const button of tabs) {
            button.addEventListener('click', () => UI.selectTab(button));
            button.addEventListener('keydown', event => {
                const index = tabs.indexOf(button);
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                UI.selectTab(tabs[next]);
                tabs[next].focus();
            });
        }
        $('backup-download').addEventListener('click', () => Sys.download($('backup-code').value, 'hand-free-game-save.txt'));
        $('backup-close').addEventListener('click', () => Sys.closeDialog('backup-dialog'));
        $('import-submit').addEventListener('click', () => Sys.applyImport());
        $('import-cancel').addEventListener('click', () => Sys.closeDialog('import-dialog'));
        $('recovery-download').addEventListener('click', () => Sys.download(Data.getRecovery() || '', 'hand-free-game-original-save.txt'));
        $('recovery-restart').addEventListener('click', () => Sys.hardReset());
        $('recovery-close').addEventListener('click', () => Sys.closeDialog('recovery-dialog'));
        const recoveryImport = document.createElement('button');
        recoveryImport.type = 'button';
        recoveryImport.className = 'dialog-button';
        recoveryImport.textContent = '백업 코드 가져오기';
        recoveryImport.addEventListener('click', () => Sys.import());
        $('recovery-dialog').querySelector('.dialog-actions').prepend(recoveryImport);
        $('btn-takeover').addEventListener('click', async () => {
            if (this.recoveryPending) { Sys.showDialog('recovery-dialog', 'recovery-download'); return; }
            const button = $('btn-takeover');
            button.disabled = true;
            try {
                if (!await Data.requestOwnership()) {
                    $('session-message').textContent = '다른 탭을 닫거나 잠시 뒤 다시 시도해 주세요. 현재 진행은 유지됩니다.';
                }
            } finally { button.disabled = false; }
        });
        $('session-overlay').addEventListener('keydown', event => {
            if (event.key === 'Tab') { event.preventDefault(); $('btn-takeover').focus(); }
        });
        $('game-app').addEventListener('animationend', event => {
            if (event.target === $('game-app')) $('game-app').classList.remove('shake-light', 'shake-hard');
        });
        document.addEventListener('visibilitychange', () => {
            RepeatInput.stop();
            if (document.hidden) this.flush(true);
            else this.resume(true);
        });
        // A tab may be closed long after it became hidden. Keep that away
        // interval for the next offline settlement instead of paying it as live play.
        window.addEventListener('pagehide', () => { RepeatInput.stop(); this.flush(); });
        window.addEventListener('pageshow', event => {
            if (event.persisted && typeof Data.resume === 'function') {
                void Data.resume().then(() => this.resume(true));
            }
        });
    }
};

GameApp.ready = GameApp.start();
