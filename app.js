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
    shakeTimer: null,
    audioWarning: false,
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

    play(frequency, type, duration, volume = 0.05) {
        if (!this.sound || !this.ctx || this.ctx.state !== 'running') return;
        try {
            const oscillator = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            oscillator.type = type;
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(volume, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            oscillator.connect(gain);
            gain.connect(this.ctx.destination);
            oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
            oscillator.start();
            oscillator.stop(this.ctx.currentTime + duration);
        } catch (error) { /* Audio interruption must never interrupt the game. */ }
    },

    sfx: {
        hit: () => Sys.play(150, 'square', 0.1, 0.03),
        crit: () => Sys.play(300, 'sawtooth', 0.15, 0.05),
        coin: () => {
            Sys.play(800, 'sine', 0.1, 0.02);
            setTimeout(() => Sys.play(1200, 'sine', 0.15, 0.02), 80);
        },
        err: () => Sys.play(100, 'triangle', 0.3, 0.05),
        btn: () => Sys.play(500, 'sine', 0.05, 0.02),
        gacha: () => {
            Sys.play(400, 'square', 0.1, 0.04);
            setTimeout(() => Sys.play(600, 'square', 0.2, 0.04), 150);
        },
        ach: () => {
            Sys.play(500, 'sine', 0.1, 0.04);
            setTimeout(() => Sys.play(800, 'sine', 0.2, 0.04), 100);
        }
    },

    toast(message) {
        $('toast').textContent = String(message).replace(/<br\s*\/?>/gi, '\n');
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

    center() { return { x: this.width / 2, y: this.height / 2 }; },

    hit() {
        const monster = $('monster');
        clearTimeout(this.hitTimer);
        monster.classList.remove('hit');
        void monster.offsetWidth;
        monster.classList.add('hit');
        this.hitTimer = setTimeout(() => monster.classList.remove('hit'), 100);
    },

    reset() {
        clearTimeout(this.hitTimer);
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
            c: critical ? '#e84118' : type === 'auto' ? '#00a8ff' : gold ? '#4cd137' : '#fbc531',
            s: critical ? 40 : gold ? 25 : 20,
            life: 1, vx: (Math.random() - 0.5) * 240,
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
            this.ctx.font = '900 ' + particle.s + 'px Pretendard, sans-serif';
            this.ctx.fillStyle = '#000';
            this.ctx.fillText(particle.t, particle.x + 2, particle.y + 2);
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
        button.textContent = Sys.sound ? '🔊' : '🔇';
        button.setAttribute('aria-pressed', String(Sys.sound));
        button.setAttribute('aria-label', Sys.sound ? '소리 끄기' : '소리 켜기');
    },

    renderRes() {
        const state = Data.state;
        const hour = 16 + Math.floor(state.min / 60);
        $('clock').textContent = '🕒 ' + hour + ':' + String(state.min % 60).padStart(2, '0');
        $('hud-gold').textContent = fNum(state.gold);
        $('hud-gem').textContent = fNum(state.gem);
        $('hud-token').textContent = fNum(state.token);
        $('preview-token').textContent = fNum(state.min);
        $('btn-gacha').disabled = !Data.canWrite || state.gem < 10 || state.relic.every(Boolean);
        $('btn-gacha').setAttribute('aria-label', state.relic.every(Boolean) ? '교보재 수집 완료' : '보석 10개로 교보재 뽑기');
        const descriptors = [
            ['click', state.stat.c, Logic.getC_Dmg(), '캔버스 타건력'],
            ['auto', state.stat.a, Logic.getA_Dmg(), '자동 파쇄기'],
            ['crit', state.stat.crit, state.stat.crit.p, '크리티컬 결재'],
            ['comp1', state.comp.na, state.comp.na.p, '나명심 코치님'],
            ['comp2', state.comp.yu, state.comp.yu.p, '유미혜 선생님']
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
    },

    renderHp(now = Date.now()) {
        const state = Data.state;
        const maxHP = Math.max(1, Logic.curMaxHp);
        const ratio = Math.max(0, Math.min(1, state.mob.hp / maxHP));
        $('mob-hp').style.width = ratio * 100 + '%';
        $('mob-hp-track').setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
        $('mob-hp-track').setAttribute('aria-valuetext', '남은 체력 ' + fNum(state.mob.hp) + ', 최대 체력 ' + fNum(maxHP));
        $('battle-view').classList.toggle('boss-mode', state.mob.boss);
        $('monster').classList.toggle('boss', state.mob.boss);
        $('battle-view').classList.toggle('night-mode', now < state.buff.nightUntil);
        const names = state.mob.boss ? Logic.bosses : Logic.names;
        const index = state.mob.boss
            ? Math.min(Math.max(0, Math.floor(state.kills / 100) - 1), names.length - 1)
            : state.kills % names.length;
        $('mob-name').textContent = names[index];
        $('battle-view').setAttribute('aria-label', names[index] + ' 공격. 남은 체력 ' + Math.round(ratio * 100) + '퍼센트.');
        const timer = $('boss-timer-wrap');
        timer.hidden = !state.mob.boss;
        timer.style.display = state.mob.boss ? 'block' : 'none';
        if (state.mob.boss) {
            const maximum = state.relic[3] ? 40 : 30;
            const seconds = Math.max(0, (state.mob.deadline - now) / 1000);
            const percentage = Math.max(0, Math.min(100, seconds / maximum * 100));
            $('boss-timer-fill').style.width = percentage + '%';
            $('boss-timer-fill').style.backgroundColor = percentage < 30 ? '#e84118' : '#fbc531';
            timer.setAttribute('aria-valuenow', String(Math.ceil(seconds)));
            timer.setAttribute('aria-valuemax', String(maximum));
            timer.setAttribute('aria-valuetext', '보스 제한 시간 ' + Math.ceil(seconds) + '초 남음');
        }
    },

    renderAch() {
        const state = Data.state;
        const signature = state.ach.map(Number).join('') + ':' +
            state.achReady.map(Number).join('') + ':' + Data.canWrite;
        if (signature === this.achievementSignature) return;
        this.achievementSignature = signature;
        const list = $('ach-list');
        list.replaceChildren();
        for (const achievement of Ach.list) {
            const done = state.ach[achievement.id];
            const ready = state.achReady[achievement.id];
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
            button.textContent = done ? '완료' : '💎 ' + achievement.rwd;
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
            ['rush', 1, '랜덤 조퇴 사유'], ['night', 2, '밤편지 노동요']
        ]) {
            const duration = Combat.sk[name].cd * 1000;
            const remaining = Math.max(0, Data.state.skill[name] + duration - now);
            const button = $('btn-s' + number);
            button.disabled = !Data.canWrite || remaining > 0;
            $('cd-' + name).style.height = Math.min(100, remaining / duration * 100) + '%';
            button.setAttribute('aria-label', title +
                (remaining > 0 ? '. ' + Math.ceil(remaining / 1000) + '초 뒤 사용 가능' : '. 사용 가능'));
        }
    },

    selectTab(button) {
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

    renderAll() {
        this.renderRes();
        this.renderHp();
        this.renderAch();
        this.renderSound();
        this.lastSkillSecond = -1;
        this.renderSkills();
        Data.state.relic.forEach((owned, index) => $('relic-' + index).classList.toggle('unlocked', owned));
    }
};

const GameApp = {
    booted: false,
    recoveryPending: false,
    lastVisual: 0,
    lastRender: 0,
    savedStatus: null,
    errorMessage: '',
    ready: null,

    status(status) {
        this.savedStatus = status;
        const wasRecovering = this.recoveryPending;
        this.recoveryPending = Boolean(status.recoveryAvailable);
        if (!this.booted) return;
        if (wasRecovering && !this.recoveryPending) Sys.closeDialog('recovery-dialog');
        const overlay = $('session-overlay');
        const blocked = !Data.canWrite || this.recoveryPending;
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
        if (status.code === 'ownership-acquired' && !this.recoveryPending) this.resume(true);
        if (['synced', 'imported', 'reset'].includes(status.code)) {
            Logic.reconcile(Date.now());
            VFX.reset();
        }
        UI.renderAll();
    },

    resume(offline = true) {
        if (!this.booted || !Data.canWrite || this.recoveryPending) return;
        const now = Date.now();
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
        if (!document.hidden || force) {
            const now = Date.now();
            Logic.advance(Math.min(now, Data.state.lastActiveAt), now, { render: false });
        }
        Data.save();
    },

    frame(now) {
        const elapsed = this.lastVisual ? Math.max(0, now - this.lastVisual) : 0;
        this.lastVisual = now;
        if (!document.hidden && Data.canWrite && !this.recoveryPending) {
            const clock = Date.now();
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
        this.booted = true;
        this.recoveryPending = Boolean(Data.getRecovery());
        this.installEvents();
        Ach.check();
        Logic.reconcile(Math.min(Date.now(), Data.state.lastActiveAt));
        if (Data.canWrite && !this.recoveryPending) this.resume(true);
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
        $('battle-view').addEventListener('pointerdown', event => {
            if (!Data.canWrite || this.recoveryPending || document.hidden) return;
            const point = VFX.point(event.clientX, event.clientY);
            Combat.attack(point.x, point.y);
        });
        $('battle-view').addEventListener('keydown', event => {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            if (event.repeat || !Data.canWrite || this.recoveryPending) return;
            void Sys.init();
            const point = VFX.center();
            Combat.attack(point.x, point.y);
        });
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
        for (const type of ['click', 'auto', 'crit', 'comp1', 'comp2']) {
            $('up-' + type).addEventListener('click', () => Logic.upgrade(type));
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
            if (document.hidden) this.flush(true);
            else this.resume(true);
        });
        // A tab may be closed long after it became hidden. Keep that away
        // interval for the next offline settlement instead of paying it as live play.
        window.addEventListener('pagehide', () => this.flush());
        window.addEventListener('pageshow', event => {
            if (event.persisted && typeof Data.resume === 'function') {
                void Data.resume().then(() => this.resume(true));
            }
        });
    }
};

GameApp.ready = GameApp.start();
