"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("const RepeatInput =");
const end = source.indexOf("const GameApp =", start);
assert.ok(start >= 0 && end > start, "the actual input controller must be present");

// Execute the unchanged controller with a deterministic clock. Deliver the same
// contextmenu event that a mobile long press produces, without relying on an OS
// emulator to generate it or waiting for a real timer in every regression.
function harness() {
    let now = 0;
    let nextTimer = 0;
    const timers = new Map();
    const listeners = { document: new Map(), window: new Map() };
    const counts = { attack: 0, item: 0, upgrade: 0, gacha: 0 };
    const listen = surface => (type, callback) => {
        const callbacks = listeners[surface].get(type) || [];
        callbacks.push(callback);
        listeners[surface].set(type, callbacks);
    };
    const document = { addEventListener: listen("document"), querySelector: () => null, activeElement: null };
    const window = { addEventListener: listen("window"), innerHeight: 844, innerWidth: 390, scrollX: 0, scrollY: 0 };
    const context = vm.createContext({
        document,
        window,
        performance: { now: () => now },
        setTimeout(callback, delay) {
            const id = ++nextTimer;
            timers.set(id, { callback, at: now + delay });
            return id;
        },
        clearTimeout: id => timers.delete(id),
        Logic: {
            canAct: () => true,
            buyItem: () => { counts.item++; return true; },
            upgrade: () => { counts.upgrade++; return true; },
            pullGacha: () => { counts.gacha++; return true; }
        },
        Combat: { attack: () => { counts.attack++; return {}; } },
        GameApp: { recoveryPending: false },
        Sys: { init: async () => {} },
        VFX: { point: (x, y) => ({ x, y }), center: () => ({ x: 0, y: 0 }) }
    });
    vm.runInContext(source.slice(start, end) + "\nglobalThis.controller = RepeatInput;", context, { filename: "app.js:RepeatInput" });
    const controller = context.controller;
    controller.init();

    const element = (id = "battle-view", dataset = {}) => {
        const captures = new Set();
        return {
            id, dataset: { ...dataset }, isConnected: true, disabled: false,
            rect: { top: 20, bottom: 300, left: 10, right: 380 },
            closest(selector) { return selector.includes("[hidden]") ? null : this; },
            getClientRects: () => [{}],
            getBoundingClientRect() { return { ...this.rect }; },
            focus() { document.activeElement = this; },
            setPointerCapture: id => captures.add(id),
            hasPointerCapture: id => captures.has(id),
            releasePointerCapture: id => captures.delete(id)
        };
    };
    const emit = (type, input = {}, surface = "document") => {
        const event = {
            button: 0, isPrimary: true, pointerId: 1, pointerType: "touch",
            clientX: 40, clientY: 100, defaultPrevented: false, propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.propagationStopped = true; },
            ...input
        };
        for (const callback of listeners[surface].get(type) || []) {
            callback(event);
            if (event.propagationStopped) break;
        }
        return event;
    };
    const advance = milliseconds => {
        const target = now + milliseconds;
        let iterations = 0;
        while (true) {
            const due = [...timers.entries()].filter(([, timer]) => timer.at <= target)
                .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
            if (!due) break;
            assert.ok(++iterations < 10000, "a repeat timer must remain bounded");
            timers.delete(due[0]);
            now = due[1].at;
            due[1].callback();
        }
        now = target;
    };
    return { controller, counts, timers, element, emit, advance, window };
}

test("the mobile context menu at 505 ms no longer ends attack hold after its first three repeats", () => {
    const h = harness();
    const battle = h.element();
    h.emit("pointerdown", { target: battle });
    h.advance(505);
    assert.equal(h.counts.attack, 3, "the reported long-press threshold must be exercised");
    const menu = h.emit("contextmenu", { target: battle, pointerType: undefined });
    assert.equal(menu.defaultPrevented, true);
    assert.ok(h.controller.active);
    h.advance(1495);
    assert.ok(h.counts.attack >= 15, "hold must continue well beyond the long-press menu threshold");
    h.emit("pointerup", { target: battle });
    const released = h.counts.attack;
    h.advance(1000);
    assert.equal(h.counts.attack, released);
    assert.equal(h.controller.active, null);
    assert.equal(h.timers.size, 0);
});

test("a touch context menu on a held shop button child keeps repeated purchases running", () => {
    const h = harness();
    const button = h.element("shop-chalk-spark", { repeatAction: "item", itemId: "chalk-spark" });
    const priceLabel = { closest: () => button };
    h.emit("pointerdown", { target: priceLabel });
    h.advance(505);
    assert.equal(h.counts.item, 3);
    const menu = h.emit("contextmenu", { target: priceLabel });
    assert.equal(menu.defaultPrevented, true);
    h.advance(1495);
    assert.ok(h.counts.item >= 15);
    h.emit("pointerup", { target: priceLabel });
    assert.equal(h.controller.active, null);
    assert.equal(h.timers.size, 0);
});

test("a context menu outside the active touch control remains available and cancels hold", () => {
    const h = harness();
    const battle = h.element();
    h.emit("pointerdown", { target: battle });
    h.advance(505);
    const outside = { closest: () => null };
    const menu = h.emit("contextmenu", { target: outside });
    assert.equal(menu.defaultPrevented, false);
    assert.equal(h.controller.active, null);
    h.advance(1000);
    assert.equal(h.counts.attack, 3);
    assert.equal(h.timers.size, 0);
});

test("mouse and keyboard context menus continue to cancel holds without blocking their menus", () => {
    for (const input of ["mouse", "keyboard"]) {
        const h = harness();
        const battle = h.element();
        if (input === "mouse") h.emit("pointerdown", { target: battle, pointerType: "mouse" });
        else h.emit("keydown", { target: battle, key: "Enter", repeat: false });
        h.advance(505);
        assert.equal(h.counts.attack, 4);
        const menu = h.emit("contextmenu", { target: battle });
        assert.equal(menu.defaultPrevented, false);
        assert.equal(h.controller.active, null);
        h.advance(1000);
        assert.equal(h.counts.attack, 4);
        assert.equal(h.timers.size, 0);
    }
});

test("a separate mouse or pen context menu can interrupt touch hold on the same control", () => {
    for (const pointerType of ["mouse", "pen"]) {
        const h = harness();
        const battle = h.element();
        h.emit("pointerdown", { target: battle });
        h.advance(505);
        const menu = h.emit("contextmenu", { target: battle, pointerType });
        assert.equal(menu.defaultPrevented, false);
        assert.equal(h.controller.active, null);
        h.advance(1000);
        assert.equal(h.counts.attack, 3);
        assert.equal(h.timers.size, 0);
    }
});

test("pointer cancellation and lost capture still stop a held touch immediately", () => {
    for (const event of ["pointercancel", "lostpointercapture"]) {
        const h = harness();
        const battle = h.element();
        h.emit("pointerdown", { target: battle });
        h.advance(505);
        h.emit(event, { target: battle });
        assert.equal(h.controller.active, null);
        h.advance(1000);
        assert.equal(h.counts.attack, 3);
        assert.equal(h.timers.size, 0);
    }
});

test("touch movement before the first repeat and actual scrolling after repeats both cancel safely", () => {
    const gesture = harness();
    const first = gesture.element();
    gesture.emit("pointerdown", { target: first });
    gesture.advance(70);
    gesture.emit("pointermove", { target: first, clientY: 140 });
    gesture.emit("pointerup", { target: first, clientY: 140 });
    gesture.advance(1000);
    assert.equal(gesture.counts.attack, 0);
    assert.equal(gesture.controller.active, null);
    assert.equal(gesture.timers.size, 0);

    const scroll = harness();
    const second = scroll.element();
    scroll.emit("pointerdown", { target: second });
    scroll.advance(505);
    scroll.window.scrollY += 100;
    second.rect.top -= 100;
    second.rect.bottom -= 100;
    scroll.emit("scroll", {}, "window");
    scroll.advance(1000);
    assert.equal(scroll.counts.attack, 3);
    assert.equal(scroll.controller.active, null);
    assert.equal(scroll.timers.size, 0);
});

test("HUD growth with browser scroll anchoring keeps the held shop button repeating at the same screen position", () => {
    const h = harness();
    const button = h.element("shop-chalk-spark", { repeatAction: "item", itemId: "chalk-spark" });
    button.rect.top = 783.46875;
    button.rect.bottom = 829.46875;
    h.window.scrollY = 483;
    h.emit("pointerdown", { target: button, clientY: 805 });
    h.advance(505);
    assert.equal(h.counts.item, 3);

    // The gold HUD wraps and adds 30 px above the button. Scroll anchoring
    // moves the document by the same amount, leaving the button under the finger.
    h.window.scrollY = 513;
    h.emit("scroll", {}, "window");
    assert.ok(h.controller.active, "an anchored layout change must preserve the existing hold");
    h.advance(1495);
    assert.ok(h.counts.item >= 15, "purchases must continue beyond the reported three-repeat cutoff");

    h.emit("pointerup", { target: button, clientY: 805 });
    const released = h.counts.item;
    h.advance(1000);
    assert.equal(h.counts.item, released);
    assert.equal(h.controller.active, null);
    assert.equal(h.timers.size, 0);
});

test("real vertical scrolling after an anchored HUD change still stops touch purchases immediately", () => {
    const h = harness();
    const button = h.element("shop-chalk-spark", { repeatAction: "item", itemId: "chalk-spark" });
    button.rect.top = 783.46875;
    button.rect.bottom = 829.46875;
    h.window.scrollY = 483;
    h.emit("pointerdown", { target: button, clientY: 805 });
    h.advance(505);
    h.window.scrollY = 513;
    h.emit("scroll", {}, "window");
    h.advance(300);
    assert.equal(h.counts.item, 6);

    h.window.scrollY += 80;
    button.rect.top -= 80;
    button.rect.bottom -= 80;
    h.emit("scroll", {}, "window");
    assert.equal(h.controller.active, null);
    h.advance(1000);
    assert.equal(h.counts.item, 6, "scrolling the button away must cancel the pending repeat");
    assert.equal(h.timers.size, 0);
});

test("horizontal scrolling cancels a touch hold even when its vertical position stays unchanged", () => {
    const h = harness();
    const battle = h.element();
    h.emit("pointerdown", { target: battle });
    h.advance(505);
    h.window.scrollX = 40;
    battle.rect.left -= 40;
    battle.rect.right -= 40;
    h.emit("scroll", {}, "window");
    assert.equal(h.controller.active, null);
    h.advance(1000);
    assert.equal(h.counts.attack, 3);
    assert.equal(h.timers.size, 0);
});

test("releasing a protected long touch and an ordinary quick tap never produce duplicate native clicks", () => {
    const h = harness();
    const button = h.element("shop-chalk-spark", { repeatAction: "item", itemId: "chalk-spark" });
    h.emit("pointerdown", { target: button });
    h.advance(505);
    h.emit("contextmenu", { target: button });
    h.advance(1495);
    h.emit("pointerup", { target: button });
    const released = h.counts.item;
    const nativeClick = h.emit("click", { target: button, detail: 1 });
    assert.equal(nativeClick.defaultPrevented, true);
    assert.equal(h.counts.item, released);
    h.advance(1000);
    assert.equal(h.counts.item, released);

    h.emit("pointerdown", { target: button, pointerId: 2 });
    h.advance(100);
    h.emit("pointerup", { target: button, pointerId: 2 });
    h.emit("click", { target: button, detail: 1 });
    assert.equal(h.counts.item, released + 1);
    assert.equal(h.controller.active, null);
    assert.equal(h.timers.size, 0);
});
