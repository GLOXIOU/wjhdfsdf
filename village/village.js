/* ==========================================================================
   Villaggio : le village brainrot du joueur.

   Le serveur fait autorite sur tout (couts, temps, recoltes, placement). Le
   client ne fait qu'afficher et extrapoler entre deux reponses : or qui
   monte, stock des mines, comptes a rebours.

   Pense pour l'iPad : rendu canvas isometrique, gestes tactiles (glisser,
   pincer, appui long pour deplacer), grosses cibles, rendu a la demande
   pour menager la batterie.
   ========================================================================== */
(() => {
    "use strict";

    /* ======================================================================
       CONFIGURATION
       ====================================================================== */

    const API_BASE_URL = String(window.API_BASE_URL || "").replace(/\/+$/, "");
    const TILE_W = 64;
    const TILE_H = 32;
    const MIN_ZOOM = 0.45;
    const MAX_ZOOM = 2.4;
    const TAP_SLOP = 10;
    const LONG_PRESS_MS = 420;
    const RESYNC_MS = 90_000;
    const HELP_SEEN_KEY = "villaggio_help_seen_v1";
    const SHOP_URL = "../shop/shop.html";
    const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    const UI_FONT = '-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",Roboto,sans-serif';

    const $ = (id) => document.getElementById(id);
    const ui = {
        app: $("v-app"),
        canvas: $("v-canvas"),
        title: $("v-title"),
        subtitle: $("v-subtitle"),
        gold: $("v-gold"),
        goldPill: $("v-gold-pill"),
        cps: $("v-cps"),
        builders: $("v-builders"),
        buildersPill: $("v-builders-pill"),
        toasts: $("v-toasts"),
        bottom: $("v-bottom"),
        collectAll: $("v-collect-all"),
        collectCount: $("v-collect-count"),
        helpBtn: $("v-help-btn"),
        buildBtn: $("v-build-btn"),
        selbar: $("v-selbar"),
        selEmoji: $("v-sel-emoji"),
        selName: $("v-sel-name"),
        selLevel: $("v-sel-level"),
        selClose: $("v-sel-close"),
        selStatus: $("v-sel-status"),
        selActions: $("v-sel-actions"),
        placebar: $("v-placebar"),
        placeEmoji: $("v-place-emoji"),
        placeTitle: $("v-place-title"),
        placeHint: $("v-place-hint"),
        placeCancel: $("v-place-cancel"),
        placeConfirm: $("v-place-confirm"),
        sheet: $("v-sheet"),
        sheetBackdrop: $("v-sheet-backdrop"),
        sheetTitle: $("v-sheet-title"),
        sheetBody: $("v-sheet-body"),
        sheetClose: $("v-sheet-close"),
        loading: $("v-loading"),
        error: $("v-error"),
        errorText: $("v-error-text"),
        errorRetry: $("v-error-retry")
    };

    /* ======================================================================
       OUTILS
       ====================================================================== */

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    /** 1234 -> "1.23K" ; gere les tres grands nombres des gros joueurs. */
    function fmt(value) {
        const n = Number(value) || 0;
        const abs = Math.abs(n);
        const units = [[1e18, "Qi"], [1e15, "Qa"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
        for (const [size, suffix] of units) {
            if (abs >= size) {
                const v = n / size;
                const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
                return `${v.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1")}${suffix}`;
            }
        }
        if (abs >= 10) return String(Math.floor(n));
        return String(Math.floor(n * 10) / 10);
    }

    /** Duree lisible : "2j 4h", "3h 12m", "12m 05s", "45s". */
    function fmtDur(totalSec) {
        const s = Math.max(0, Math.ceil(Number(totalSec) || 0));
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (d > 0) return h ? `${d}j ${h}h` : `${d}j`;
        if (h > 0) return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
        if (m > 0) return m >= 10 || !sec ? `${m}m` : `${m}m ${String(sec).padStart(2, "0")}s`;
        return `${sec}s`;
    }

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function storageGet(key) {
        try { return window.localStorage.getItem(key); } catch { return null; }
    }

    function storageSet(key, value) {
        try { window.localStorage.setItem(key, value); } catch { /* navigation privee */ }
    }

    function track(event) {
        try { window.PlayWebAnalytics?.track?.(event); } catch { /* analytics facultatives */ }
    }

    /** Eclaircit (amount > 0) ou assombrit (amount < 0) une couleur #rrggbb. */
    const shadeCache = new Map();
    function shade(hex, amount) {
        const key = hex + amount;
        const hit = shadeCache.get(key);
        if (hit) return hit;
        const n = parseInt(hex.slice(1), 16);
        const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
        const out = `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
        shadeCache.set(key, out);
        return out;
    }

    /* ======================================================================
       ETAT
       ====================================================================== */

    const S = {
        data: null,
        receivedAt: 0,
        clockOffset: 0,
        byId: new Map(),
        catalog: new Map(),
        mode: "view",          // view | place | move
        selectedId: null,
        ghost: null,           // { type, x, y, w, h, buildingId?, valid }
        pending: 0,
        sheet: null,           // { kind: "shop" | "detail" | "help", id?, welcome? }
        shopTab: "buildings",
        armedRemoveId: null,
        armedTimer: 0,
        finishedSeen: new Set(),
        refreshTimer: 0,
        selActionsSig: ""
    };

    const serverNow = () => Date.now() + S.clockOffset;
    const cat = (type) => S.catalog.get(type);

    function liveGold() {
        if (!S.data) return 0;
        return S.data.gold + S.data.cps * Math.max(0, Date.now() - S.receivedAt) / 1000;
    }

    function mineFill(b, now = serverNow()) {
        if (!b.mine || b.upgradeEndsAt || b.mine.capacitySec <= 0) return 0;
        const elapsed = Math.max(0, (now - b.lastCollectAt) / 1000);
        return Math.min(1, elapsed / b.mine.capacitySec);
    }

    function mineStored(b, now = serverNow()) {
        if (!b.mine) return 0;
        return mineFill(b, now) * b.mine.capacitySec * b.mine.ratePerSec;
    }

    function forgeReady(b, now = serverNow()) {
        return Boolean(b.forge && !b.upgradeEndsAt && b.forge.readyAt && b.forge.readyAt <= now);
    }

    function freeBuilders() {
        return S.data ? Math.max(0, S.data.builders.total - S.data.builders.busy) : 0;
    }

    /** Seuil d'affichage des bulles de recolte (et du bouton "Tout recolter"). */
    const BUBBLE_FILL = 0.1;

    function collectableSummary() {
        let gold = 0;
        let chests = 0;
        let spots = 0;
        if (!S.data) return { gold, chests, spots };
        const now = serverNow();
        for (const b of S.data.buildings) {
            const stored = Math.floor(mineStored(b, now));
            if (stored >= 1) {
                gold += stored;
                if (mineFill(b, now) >= BUBBLE_FILL) spots++;
            }
            if (forgeReady(b, now)) { chests++; spots++; }
        }
        return { gold, chests, spots };
    }

    /* ======================================================================
       API
       ====================================================================== */

    async function getToken() {
        try {
            const token = await window.BrainrotAuth?.waitUntilReady?.();
            return token || window.BrainrotAuth?.getToken?.() || "";
        } catch {
            return "";
        }
    }

    async function api(method, path, body) {
        const token = await getToken();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(`${API_BASE_URL}${path}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            const payload = await response.json().catch(() => null);
            if (response.status === 401) {
                return { success: false, unauthorized: true, message: "Ta session a expiré, reconnecte-toi." };
            }
            if (!payload) return { success: false, message: `Erreur serveur (${response.status}).` };
            return payload;
        } catch {
            return { success: false, message: "Connexion au serveur impossible. Vérifie ton réseau." };
        } finally {
            clearTimeout(timer);
        }
    }

    /** Les actions partent une par une : jamais deux ecritures en vol en meme temps. */
    let chain = Promise.resolve();
    function enqueue(task) {
        const run = () => task().catch((error) => {
            console.error("[villaggio]", error);
            return null;
        });
        chain = chain.then(run, run);
        return chain;
    }

    function doAction(method, path, body) {
        return enqueue(async () => {
            S.pending++;
            updateBusy();
            try {
                const res = await api(method, path, body);
                if (res?.village) applyState(res.village);
                if (!res?.success) {
                    toast(res?.message || "Action impossible pour le moment.", "error");
                    return null;
                }
                return res;
            } finally {
                S.pending--;
                updateBusy();
            }
        });
    }

    function refresh() {
        return enqueue(async () => {
            const res = await api("GET", "/village");
            if (res?.success && res.village) applyState(res.village);
            return res;
        });
    }

    function scheduleRefresh(delayMs = 350) {
        clearTimeout(S.refreshTimer);
        S.refreshTimer = setTimeout(() => refresh(), delayMs);
    }

    /* ======================================================================
       APPLICATION DE L'ETAT SERVEUR
       ====================================================================== */

    function applyState(data) {
        const first = !S.data;
        S.data = data;
        S.receivedAt = Date.now();
        S.clockOffset = Number(data.serverTime || Date.now()) - Date.now();
        S.byId = new Map(data.buildings.map((b) => [b.id, b]));
        S.catalog = new Map(data.catalog.map((c) => [c.type, c]));

        if (S.selectedId && !S.byId.has(S.selectedId)) S.selectedId = null;
        if (S.mode === "move" && S.ghost && !S.byId.has(S.ghost.buildingId)) exitPlacement();
        if (S.ghost) updateGhostValidity();

        if (first) {
            resize();
            centerCamera();
        }

        handleEvents(Array.isArray(data.events) ? data.events : []);
        updateHud();
        renderSelbar(true);
        renderPlacebar();
        rerenderSheet();
        requestDraw();

        if (first) maybeShowWelcome();
    }

    function handleEvents(events) {
        let collected = 0;
        for (const e of events) {
            const b = S.byId.get(e.buildingId);
            const c = cat(e.type || b?.type);
            switch (e.kind) {
                case "collected":
                    collected += e.gold;
                    if (b) {
                        spawnFloat(b, `+${fmt(e.gold)}`, "#fde047");
                        spawnCoins(b);
                    }
                    break;
                case "chest":
                    if (b) spawnFloat(b, "📦 +1", "#e9d5ff");
                    toast(`📦 ${e.chest.name} ajouté à ton inventaire !`, "reward", { label: "Ouvrir", href: SHOP_URL });
                    break;
                case "completed":
                    toast(e.level === 1
                        ? `✅ ${c?.emoji || ""} ${e.name} est construit !`
                        : `✅ ${c?.emoji || ""} ${e.name} passe au niveau ${e.level} !`, "success");
                    for (const chest of e.chests || []) {
                        toast(`🎁 Palier du Palazzo : ${chest.qty} × ${chest.name} !`, "reward", { label: "Ouvrir", href: SHOP_URL });
                    }
                    if (b) spawnSparkles(b);
                    break;
                case "built":
                    toast(e.instant ? `${c?.emoji || "✨"} ${e.name} posé !` : `🏗️ Construction de ${e.name} lancée !`, "success");
                    track("village_build");
                    break;
                case "upgrade":
                    toast(`⬆️ ${e.name} : amélioration vers le niveau ${e.level} lancée !`, "success");
                    track("village_upgrade");
                    break;
                default:
                    break;
            }
        }
        if (collected > 0) {
            ui.goldPill.classList.remove("is-bump");
            void ui.goldPill.offsetWidth;
            ui.goldPill.classList.add("is-bump");
        }
    }

    /* ======================================================================
       HUD
       ====================================================================== */

    function updateGoldText() {
        if (!S.data) return;
        ui.gold.textContent = fmt(liveGold());
    }

    function updateHud() {
        if (!S.data) return;
        updateGoldText();
        ui.cps.textContent = `+${fmt(S.data.cps)}/s`;
        const free = freeBuilders();
        ui.builders.textContent = `${free}/${S.data.builders.total}`;
        ui.buildersPill.classList.toggle("is-full", free === 0);
        ui.buildersPill.title = free === 0 ? "Tous tes constructeurs sont occupés" : `${free} constructeur(s) libre(s)`;
        ui.title.textContent = S.data.pseudo ? `Villaggio di ${S.data.pseudo}` : "Villaggio";
        ui.subtitle.textContent = `Palazzo niv. ${S.data.th}`;

        const docked = S.mode !== "view" || Boolean(S.selectedId);
        ui.bottom.classList.toggle("hidden", docked);

        const sum = collectableSummary();
        const canCollect = sum.spots > 0;
        ui.collectAll.classList.toggle("hidden", !canCollect);
        if (canCollect) {
            ui.collectCount.textContent = sum.gold >= 1
                ? `+${fmt(sum.gold)}${sum.chests ? " 📦" : ""}`
                : `📦 ${sum.chests}`;
        }
    }

    function updateBusy() {
        const busy = S.pending > 0;
        ui.placeConfirm.disabled = busy || !S.ghost?.valid;
        ui.collectAll.disabled = busy;
    }

    /* ======================================================================
       NOTIFICATIONS
       ====================================================================== */

    function toast(message, kind = "info", action) {
        const el = document.createElement("div");
        el.className = `v-toast${kind !== "info" ? ` is-${kind}` : ""}`;
        const text = document.createElement("span");
        text.textContent = message;
        el.appendChild(text);
        if (action?.href) {
            const link = document.createElement("a");
            link.href = action.href;
            link.textContent = action.label || "Voir";
            el.appendChild(link);
        }
        ui.toasts.prepend(el);
        while (ui.toasts.children.length > 4) ui.toasts.lastElementChild.remove();
        const ttl = kind === "error" ? 4200 : kind === "reward" ? 5200 : 3200;
        setTimeout(() => {
            el.classList.add("is-leaving");
            setTimeout(() => el.remove(), 260);
        }, ttl);
    }

    /* ======================================================================
       RENDU : CAMERA ET PROJECTION ISOMETRIQUE
       ====================================================================== */

    const canvas = ui.canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    const cam = { x: 0, y: 0, zoom: 1 };
    let vw = 0;
    let vh = 0;
    let dpr = 1;
    let bgGradient = null;
    let camTween = null;

    const mapSize = () => S.data?.mapSize || 20;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        vw = ui.app.clientWidth || window.innerWidth;
        vh = ui.app.clientHeight || window.innerHeight;
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
        bgGradient = null;
        clampCamera();
        requestDraw();
    }

    function isoWorld(gx, gy) {
        return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 };
    }

    function toScreen(wx, wy) {
        return { x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 };
    }

    function iso(gx, gy) {
        const w = isoWorld(gx, gy);
        return toScreen(w.x, w.y);
    }

    function screenToWorld(sx, sy) {
        return { x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y };
    }

    /** Case (fractionnaire) sous un point de l'ecran. */
    function gridAt(sx, sy) {
        const w = screenToWorld(sx, sy);
        const a = w.x / (TILE_W / 2);
        const b = w.y / (TILE_H / 2);
        return { x: (a + b) / 2, y: (b - a) / 2 };
    }

    function clampCamera() {
        const n = mapSize();
        cam.zoom = clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM);
        cam.x = clamp(cam.x, -n * TILE_W / 2, n * TILE_W / 2);
        cam.y = clamp(cam.y, 0, n * TILE_H);
    }

    function centerCamera() {
        const n = mapSize();
        const mapW = n * TILE_W;
        const mapH = n * TILE_H + 40;
        const fitWidth = (vw - 32) / mapW;
        const fitHeight = (vh - 190) / mapH;
        // En portrait, la carte entiere en largeur laisserait la moitie de
        // l'ecran vide : on zoome un peu plus, les bords restent accessibles.
        const fit = Math.min(fitHeight, fitWidth * (vh > vw ? 1.4 : 1));
        cam.zoom = clamp(fit, MIN_ZOOM, 1.3);
        const center = isoWorld(n / 2, n / 2);
        cam.x = center.x;
        cam.y = center.y + 10;
        clampCamera();
    }

    function zoomAt(sx, sy, nextZoom) {
        const before = screenToWorld(sx, sy);
        cam.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
        const after = screenToWorld(sx, sy);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        clampCamera();
        requestDraw();
    }

    /** Glisse doucement la camera pour que le batiment reste visible au-dessus du panneau. */
    function ensureVisible(b) {
        const c = cat(b.type);
        if (!c) return;
        const center = iso(b.x + c.w / 2, b.y + c.h / 2);
        const dockTop = vh - (ui.selbar.offsetHeight || 220) - 40;
        const topLimit = 110;
        let dy = 0;
        if (center.y > dockTop) dy = center.y - dockTop;
        else if (center.y - 80 < topLimit) dy = center.y - 80 - topLimit;
        if (Math.abs(dy) < 4) return;
        camTween = { fromY: cam.y, toY: cam.y + dy / cam.zoom, start: performance.now(), dur: 260 };
        requestDraw();
    }

    /* ======================================================================
       RENDU : SPRITES EMOJI (mis en cache, indispensable pour la fluidite)
       ====================================================================== */

    const spriteCache = new Map();

    function emojiSprite(emoji, size) {
        const dev = Math.max(8, Math.round((size * dpr) / 4) * 4);
        const key = `${emoji}|${dev}`;
        let sprite = spriteCache.get(key);
        if (!sprite) {
            sprite = document.createElement("canvas");
            const pad = Math.ceil(dev * 0.28);
            sprite.width = sprite.height = dev + pad * 2;
            const g = sprite.getContext("2d");
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.font = `${dev}px ${EMOJI_FONT}`;
            g.fillText(emoji, sprite.width / 2, sprite.height / 2 + dev * 0.06);
            if (spriteCache.size > 400) spriteCache.clear();
            spriteCache.set(key, sprite);
        }
        return sprite;
    }

    function drawEmoji(emoji, cx, cy, size, alpha = 1) {
        const sprite = emojiSprite(emoji, size);
        const w = sprite.width / dpr;
        if (alpha !== 1) ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, cx - w / 2, cy - w / 2, w, w);
        if (alpha !== 1) ctx.globalAlpha = 1;
    }

    function poly(points) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /* ======================================================================
       RENDU : TERRAIN
       ====================================================================== */

    // Touffes d'herbe deterministes (meme village = meme decor a chaque visite).
    const tufts = (() => {
        const out = [];
        let seed = 1337;
        const rnd = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        for (let i = 0; i < 90; i++) out.push({ x: rnd() * 20, y: rnd() * 20, s: 0.6 + rnd() * 0.6 });
        return out;
    })();

    function drawBackground() {
        if (!bgGradient) {
            bgGradient = ctx.createRadialGradient(vw / 2, vh * 0.45, 40, vw / 2, vh * 0.5, Math.max(vw, vh) * 0.8);
            bgGradient.addColorStop(0, "#15284a");
            bgGradient.addColorStop(0.55, "#0b1427");
            bgGradient.addColorStop(1, "#060912");
        }
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, vw, vh);
    }

    function drawIsland() {
        const n = mapSize();
        const z = cam.zoom;
        const top = iso(0, 0);
        const right = iso(n, 0);
        const bottom = iso(n, n);
        const left = iso(0, n);
        const depth = 30 * z;
        const down = (p) => ({ x: p.x, y: p.y + depth });

        // Ombre portee sous l'ile
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        poly([{ x: top.x, y: top.y + depth * 1.6 }, { x: right.x + 10 * z, y: right.y + depth * 1.6 },
            { x: bottom.x, y: bottom.y + depth * 1.9 }, { x: left.x - 10 * z, y: left.y + depth * 1.6 }]);
        ctx.fill();

        // Falaises
        ctx.fillStyle = "#7a4a28";
        poly([left, bottom, down(bottom), down(left)]);
        ctx.fill();
        ctx.fillStyle = "#5c381e";
        poly([bottom, right, down(right), down(bottom)]);
        ctx.fill();

        // Herbe
        ctx.fillStyle = "#3f9d3c";
        poly([top, right, bottom, left]);
        ctx.fill();

        // Damier discret
        const ex = { x: (TILE_W / 2) * z, y: (TILE_H / 2) * z };
        const ey = { x: -(TILE_W / 2) * z, y: (TILE_H / 2) * z };
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        for (let gx = 0; gx < n; gx++) {
            for (let gy = (gx % 2); gy < n; gy += 2) {
                const x = top.x + gx * ex.x + gy * ey.x;
                const y = top.y + gx * ex.y + gy * ey.y;
                ctx.moveTo(x, y);
                ctx.lineTo(x + ex.x, y + ex.y);
                ctx.lineTo(x + ex.x + ey.x, y + ex.y + ey.y);
                ctx.lineTo(x + ey.x, y + ey.y);
                ctx.closePath();
            }
        }
        ctx.fill();

        // Bordure lumineuse
        ctx.strokeStyle = "rgba(190,242,100,0.45)";
        ctx.lineWidth = Math.max(1, 2 * z);
        poly([top, right, bottom, left]);
        ctx.stroke();

        // Touffes d'herbe
        if (z > 0.55) {
            ctx.fillStyle = "rgba(20,83,45,0.55)";
            for (const t of tufts) {
                if (t.x >= n || t.y >= n) continue;
                const p = iso(t.x, t.y);
                ctx.beginPath();
                ctx.ellipse(p.x, p.y, 3.2 * z * t.s, 1.6 * z * t.s, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawGrid() {
        const n = mapSize();
        ctx.strokeStyle = "rgba(255,255,255,0.13)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = iso(i, 0);
            const b = iso(i, n);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            const c = iso(0, i);
            const d = iso(n, i);
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(d.x, d.y);
        }
        ctx.stroke();
    }

    function footprint(x, y, w, h, inset = 0) {
        return [iso(x + inset, y + inset), iso(x + w - inset, y + inset), iso(x + w - inset, y + h - inset), iso(x + inset, y + h - inset)];
    }

    /* ======================================================================
       RENDU : BATIMENTS
       ====================================================================== */

    /** Liste a dessiner (batiments + fantome), triee de l'arriere vers l'avant. */
    function drawList() {
        const items = [];
        for (const b of S.data.buildings) {
            if (S.mode === "move" && S.ghost?.buildingId === b.id) continue;
            items.push({ b, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, level: b.level });
        }
        if (S.ghost) {
            const g = S.ghost;
            const source = g.buildingId ? S.byId.get(g.buildingId) : null;
            items.push({ b: source, ghost: true, type: g.type, x: g.x, y: g.y, w: g.w, h: g.h, level: source ? source.level : 1 });
        }
        return isoSort(items);
    }

    /**
     * Tri topologique : A passe derriere B si A est entierement avant B sur un
     * axe et chevauche B sur l'autre. Plus fiable qu'un simple x + y pour des
     * batiments de tailles differentes.
     */
    function isoSort(items) {
        const n = items.length;
        const behind = (a, b) =>
            (a.x + a.w <= b.x && a.y < b.y + b.h) || (a.y + a.h <= b.y && a.x < b.x + b.w);
        const incoming = new Array(n).fill(0);
        const edges = Array.from({ length: n }, () => []);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j && behind(items[i], items[j])) {
                    edges[i].push(j);
                    incoming[j]++;
                }
            }
        }
        const depth = (it) => it.x + it.y + (it.w + it.h) / 2;
        const ready = [];
        for (let i = 0; i < n; i++) if (incoming[i] === 0) ready.push(i);
        const out = [];
        while (ready.length) {
            ready.sort((a, b) => depth(items[b]) - depth(items[a]));
            const i = ready.pop();
            out.push(items[i]);
            for (const j of edges[i]) if (--incoming[j] === 0) ready.push(j);
        }
        if (out.length < n) {
            // Cycle (ne devrait pas arriver) : repli sur la profondeur.
            return items.slice().sort((a, b) => depth(a) - depth(b));
        }
        return out;
    }

    function drawFootprintHighlight(x, y, w, h, fill, stroke) {
        const pts = footprint(x, y, w, h);
        ctx.fillStyle = fill;
        poly(pts);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function drawBuilding(it) {
        const c = cat(it.type);
        if (!c) return;
        const z = cam.zoom;
        const selected = !it.ghost && it.b && it.b.id === S.selectedId;
        const constructing = !it.ghost && it.level === 0;
        const alpha = it.ghost ? 0.82 : 1;

        if (c.category === "decoration") {
            const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.1);
            const cx = (left.x + right.x) / 2;
            const cy = (top.y + bottom.y) / 2;
            const size = TILE_W * 0.62 * it.w * z * (selected ? 1.1 : 1);
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.beginPath();
            ctx.ellipse(cx, cy, (right.x - left.x) * 0.3, (bottom.y - top.y) * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            drawEmoji(c.emoji, cx, cy - size * 0.36, size, alpha);
            it.hitPoly = [
                { x: cx - size * 0.5, y: cy - size * 0.95 }, { x: cx + size * 0.5, y: cy - size * 0.95 },
                right, bottom, left
            ];
            it.anchor = { x: cx, y: cy - size * 0.9 };
            return;
        }

        const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.1);
        const level = Math.max(1, it.level);
        const height = (c.height + (level - 1) * 3) * z * (constructing ? 0.45 : 1);
        const up = (p) => ({ x: p.x, y: p.y - height });
        const base = c.color;

        if (alpha !== 1) ctx.globalAlpha = alpha;

        // Ombre
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        poly([{ x: top.x + 4 * z, y: top.y + 3 * z }, { x: right.x + 6 * z, y: right.y + 3 * z },
            { x: bottom.x + 4 * z, y: bottom.y + 4 * z }, { x: left.x, y: left.y + 3 * z }]);
        ctx.fill();

        // Faces
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.fillStyle = constructing ? "#8a6a45" : shade(base, -0.25);
        poly([left, bottom, up(bottom), up(left)]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = constructing ? "#6e5236" : shade(base, -0.45);
        poly([bottom, right, up(right), up(bottom)]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = constructing ? "#b08a5c" : shade(base, selected ? 0.3 : 0.14);
        poly([up(top), up(right), up(bottom), up(left)]);
        ctx.fill();
        ctx.stroke();

        // Toit : losange interieur plus clair
        const cx = (left.x + right.x) / 2;
        const cy = (top.y + bottom.y) / 2 - height;
        const inner = [up(top), up(right), up(bottom), up(left)].map((p) => ({ x: cx + (p.x - cx) * 0.62, y: cy + (p.y - (cy)) * 0.62 }));
        ctx.fillStyle = constructing ? "rgba(250,204,21,0.35)" : shade(base, 0.32);
        poly(inner);
        ctx.fill();

        // Emoji du batiment, pose sur le toit
        const size = Math.max(14, Math.min(it.w, it.h) * TILE_W * 0.56 * z) * (selected ? 1.08 : 1);
        const ey = cy - size * 0.3;
        drawEmoji(constructing ? "🏗️" : c.emoji, cx, ey, size, 1);

        if (alpha !== 1) ctx.globalAlpha = 1;

        // Pastille de niveau
        if (!it.ghost && it.level >= 1 && c.maxLevel > 1) {
            const r = clamp(9 * z, 8, 13);
            const bx = (left.x + bottom.x) / 2;
            const by = (left.y + bottom.y) / 2 - height * 0.45;
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, Math.PI * 2);
            ctx.fillStyle = "#111827";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = shade(base, 0.2);
            ctx.stroke();
            ctx.fillStyle = "#fff";
            ctx.font = `900 ${Math.round(r * 1.15)}px ${UI_FONT}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(it.level), bx, by + 0.5);
        }

        it.hitPoly = [
            { x: cx, y: ey - size * 0.55 }, { x: right.x, y: up(right).y - size * 0.2 }, right, bottom, left,
            { x: left.x, y: up(left).y - size * 0.2 }
        ];
        it.anchor = { x: cx, y: ey - size * 0.62 };
    }

    /* ======================================================================
       RENDU : BULLES, BARRES DE CHANTIER, EFFETS
       ====================================================================== */

    let hitBubbles = [];
    let animatedBubbles = false;

    function drawBubble(x, y, emoji, ring, progress, kind, id, ts) {
        const bob = REDUCED_MOTION ? 0 : Math.sin(ts / 380 + x * 0.05) * 3;
        const r = 22;
        const by = y - r - 6 + bob;

        ctx.beginPath();
        ctx.moveTo(x - 7, by + r - 3);
        ctx.lineTo(x, by + r + 8);
        ctx.lineTo(x + 7, by + r - 3);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, by, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.beginPath();
        ctx.arc(x, by, r - 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = ring;
        ctx.beginPath();
        ctx.arc(x, by, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(progress, 0, 1));
        ctx.stroke();

        drawEmoji(emoji, x, by, 25);
        hitBubbles.push({ x, y: by, r: r + 10, kind, id });
        animatedBubbles = true;
    }

    function drawProgress(x, y, progress, label) {
        const w = 92;
        const h = 12;
        const px = x - w / 2;
        const py = y - 18;
        roundRect(px - 2, py - 2, w + 4, h + 4, 8);
        ctx.fillStyle = "rgba(10,10,14,0.82)";
        ctx.fill();
        roundRect(px, py, w, h, 6);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fill();
        if (progress > 0) {
            roundRect(px, py, Math.max(h, w * clamp(progress, 0, 1)), h, 6);
            ctx.fillStyle = "#f97316";
            ctx.fill();
        }
        ctx.font = `800 13px ${UI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.strokeText(label, x, py - 4);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x, py - 4);
    }

    function drawOverlay(it, ts, now) {
        const b = it.b;
        if (it.ghost || !b || !it.anchor) return;
        const { x, y } = it.anchor;
        if (x < -80 || x > vw + 80 || y < -80 || y > vh + 120) return;

        if (b.upgradeEndsAt) {
            const remaining = (b.upgradeEndsAt - now) / 1000;
            if (remaining > 0) {
                const total = b.upgradeTotalSec || remaining;
                drawProgress(x, y, 1 - remaining / total, fmtDur(remaining));
            } else {
                drawBubble(x, y, "✅", "#22c55e", 1, "done", b.id, ts);
            }
            return;
        }
        if (b.mine) {
            const fill = mineFill(b, now);
            if (fill >= BUBBLE_FILL && mineStored(b, now) >= 1) {
                drawBubble(x, y, "🪙", fill >= 0.999 ? "#ef4444" : "#eab308", fill, "collect", b.id, ts);
            }
            return;
        }
        if (forgeReady(b, now)) drawBubble(x, y, "📦", "#a855f7", 1, "collect", b.id, ts);
    }

    const effects = [];

    function buildingScreenCenter(b) {
        const c = cat(b.type);
        return iso(b.x + (c?.w || 1) / 2, b.y + (c?.h || 1) / 2);
    }

    function spawnFloat(b, text, color) {
        const c = cat(b.type);
        const world = isoWorld(b.x + (c?.w || 1) / 2, b.y + (c?.h || 1) / 2);
        effects.push({ kind: "float", text, color, wx: world.x, wy: world.y, start: performance.now(), dur: 1500 });
        requestDraw();
    }

    function spawnCoins(b) {
        if (REDUCED_MOTION) return;
        const from = buildingScreenCenter(b);
        const rect = ui.goldPill.getBoundingClientRect();
        const appRect = ui.app.getBoundingClientRect();
        const to = { x: rect.left - appRect.left + 24, y: rect.top - appRect.top + rect.height / 2 };
        const now = performance.now();
        for (let i = 0; i < 7; i++) {
            effects.push({
                kind: "coin",
                from: { x: from.x + (Math.random() - 0.5) * 40, y: from.y - 20 + (Math.random() - 0.5) * 20 },
                to,
                lift: 60 + Math.random() * 60,
                start: now + i * 55,
                dur: 650
            });
        }
        requestDraw();
    }

    function spawnSparkles(b) {
        if (REDUCED_MOTION) return;
        const now = performance.now();
        const c = cat(b.type);
        const world = isoWorld(b.x + (c?.w || 1) / 2, b.y + (c?.h || 1) / 2);
        for (let i = 0; i < 10; i++) {
            const angle = (Math.PI * 2 * i) / 10;
            effects.push({ kind: "spark", wx: world.x, wy: world.y, vx: Math.cos(angle), vy: Math.sin(angle), start: now, dur: 900 });
        }
        requestDraw();
    }

    function drawEffects(ts) {
        const now = performance.now();
        for (let i = effects.length - 1; i >= 0; i--) {
            const e = effects[i];
            const t = (now - e.start) / e.dur;
            if (t < 0) continue;
            if (t >= 1) {
                effects.splice(i, 1);
                continue;
            }
            if (e.kind === "float") {
                const p = toScreen(e.wx, e.wy);
                ctx.globalAlpha = 1 - t * t;
                ctx.font = `900 24px ${UI_FONT}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.lineWidth = 5;
                ctx.strokeStyle = "rgba(0,0,0,0.8)";
                const y = p.y - 60 * cam.zoom - t * 70;
                ctx.strokeText(e.text, p.x, y);
                ctx.fillStyle = e.color;
                ctx.fillText(e.text, p.x, y);
                ctx.globalAlpha = 1;
            } else if (e.kind === "coin") {
                const k = t * t * (3 - 2 * t);
                const x = e.from.x + (e.to.x - e.from.x) * k;
                const y = e.from.y + (e.to.y - e.from.y) * k - Math.sin(Math.PI * k) * e.lift;
                drawEmoji("🪙", x, y, 22 - 8 * k);
            } else if (e.kind === "spark") {
                const p = toScreen(e.wx, e.wy);
                const dist = 30 + t * 70;
                drawEmoji("✨", p.x + e.vx * dist * cam.zoom, p.y - 40 * cam.zoom + e.vy * dist * 0.6 * cam.zoom, 20, 1 - t);
            }
        }
        void ts;
    }

    /* ======================================================================
       RENDU : BOUCLE (a la demande)
       ====================================================================== */

    let rafId = 0;
    let dirty = false;
    let lastDraw = 0;
    let drawnItems = [];

    function requestDraw() {
        dirty = true;
        if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame);
    }

    function frame(ts) {
        rafId = 0;
        if (!S.data) return;

        if (camTween) {
            const t = clamp((performance.now() - camTween.start) / camTween.dur, 0, 1);
            const k = 1 - Math.pow(1 - t, 3);
            cam.y = camTween.fromY + (camTween.toY - camTween.fromY) * k;
            clampCamera();
            if (t >= 1) camTween = null;
            dirty = true;
        }
        if (inertia) {
            stepInertia();
            dirty = true;
        }

        const fastAnim = effects.length > 0 || camTween || inertia;
        // Les bulles qui flottent n'ont pas besoin de 60 i/s : 30 suffisent.
        if (dirty || fastAnim || (animatedBubbles && !REDUCED_MOTION && ts - lastDraw > 33)) {
            draw(ts);
            lastDraw = ts;
            dirty = false;
        }

        if (effects.length > 0 || camTween || inertia || (animatedBubbles && !REDUCED_MOTION)) {
            rafId = requestAnimationFrame(frame);
        }
    }

    function draw(ts) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackground();
        drawIsland();
        if (S.mode !== "view") drawGrid();

        if (S.ghost) {
            const valid = S.ghost.valid;
            drawFootprintHighlight(S.ghost.x, S.ghost.y, S.ghost.w, S.ghost.h,
                valid ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.4)",
                valid ? "rgba(134,239,172,0.95)" : "rgba(252,165,165,0.95)");
        }
        const selected = S.selectedId ? S.byId.get(S.selectedId) : null;
        if (selected && S.mode === "view") {
            drawFootprintHighlight(selected.x, selected.y, selected.w, selected.h, "rgba(255,255,255,0.14)", "rgba(253,186,116,0.95)");
        }

        drawnItems = drawList();
        for (const it of drawnItems) drawBuilding(it);

        hitBubbles = [];
        animatedBubbles = false;
        const now = serverNow();
        for (const it of drawnItems) drawOverlay(it, ts, now);

        drawEffects(ts);
    }

    /* ======================================================================
       PLACEMENT / DEPLACEMENT
       ====================================================================== */

    function rectsOverlap(a, b) {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    function canPlaceAt(x, y, w, h, ignoreId) {
        const n = mapSize();
        if (x < 0 || y < 0 || x + w > n || y + h > n) return false;
        const r = { x, y, w, h };
        return !S.data.buildings.some((b) => b.id !== ignoreId && rectsOverlap(r, b));
    }

    function updateGhostValidity() {
        const g = S.ghost;
        if (!g) return;
        g.valid = canPlaceAt(g.x, g.y, g.w, g.h, g.buildingId);
    }

    /**
     * Emplacement libre propose par defaut : proche du centre de l'ecran, mais
     * degage (une case de marge) et jamais cache derriere un autre batiment.
     */
    function findFreeSpot(w, h, near) {
        const n = mapSize();
        const candidates = [];
        for (let x = 0; x <= n - w; x++) {
            for (let y = 0; y <= n - h; y++) {
                if (!canPlaceAt(x, y, w, h)) continue;
                let score = Math.hypot(x + w / 2 - near.x, y + h / 2 - near.y);
                if (!canPlaceAt(x - 1, y - 1, w + 2, h + 2)) score += 3;
                const hidden = S.data.buildings.some((b) =>
                    (x + w <= b.x && x + w >= b.x - 2 && y < b.y + b.h && y + h > b.y) ||
                    (y + h <= b.y && y + h >= b.y - 2 && x < b.x + b.w && x + w > b.x));
                if (hidden) score += 4;
                candidates.push({ x, y, score });
            }
        }
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0] || null;
    }

    function startPlacement(type) {
        const c = cat(type);
        if (!c) return;
        closeSheet();
        S.selectedId = null;
        const center = gridAt(vw / 2, vh / 2 - 40);
        const spot = findFreeSpot(c.w, c.h, center);
        if (!spot) {
            toast("Plus aucune place libre sur ton terrain !", "error");
            return;
        }
        S.mode = "place";
        S.ghost = { type, x: spot.x, y: spot.y, w: c.w, h: c.h };
        updateGhostValidity();
        renderSelbar();
        renderPlacebar();
        updateHud();
        requestDraw();
    }

    function startMove(b) {
        const c = cat(b.type);
        if (!c) return;
        S.selectedId = null;
        S.mode = "move";
        S.ghost = { type: b.type, x: b.x, y: b.y, w: c.w, h: c.h, buildingId: b.id, origin: { x: b.x, y: b.y } };
        updateGhostValidity();
        renderSelbar();
        renderPlacebar();
        updateHud();
        requestDraw();
    }

    function exitPlacement(selectId) {
        S.mode = "view";
        S.ghost = null;
        if (selectId && S.byId.has(selectId)) S.selectedId = selectId;
        renderSelbar(true);
        renderPlacebar();
        updateHud();
        requestDraw();
    }

    function moveGhostTo(x, y) {
        const g = S.ghost;
        if (!g) return;
        const n = mapSize();
        const nx = clamp(Math.round(x), 0, n - g.w);
        const ny = clamp(Math.round(y), 0, n - g.h);
        if (nx === g.x && ny === g.y) return;
        g.x = nx;
        g.y = ny;
        updateGhostValidity();
        renderPlacebar();
        requestDraw();
    }

    function renderPlacebar() {
        const g = S.ghost;
        if (!g || S.mode === "view") {
            ui.placebar.classList.add("hidden");
            return;
        }
        const c = cat(g.type);
        ui.placebar.classList.remove("hidden");
        ui.placeEmoji.textContent = c?.emoji || "🏗️";
        if (S.mode === "place") {
            ui.placeTitle.textContent = `Placer : ${c?.name || ""}`;
            const build = c?.build;
            const costText = build ? `🪙 ${fmt(build.cost)} · ${build.buildSec > 0 ? `⏱ ${fmtDur(build.buildSec)}` : "instantané"}` : "";
            ui.placeHint.textContent = g.valid ? `${costText} — glisse ou touche une case` : "Emplacement occupé ou hors du terrain";
            ui.placeConfirm.textContent = "✓ Construire";
        } else {
            ui.placeTitle.textContent = `Déplacer : ${c?.name || ""}`;
            ui.placeHint.textContent = g.valid ? "Glisse le bâtiment ou touche une case" : "Emplacement occupé ou hors du terrain";
            ui.placeConfirm.textContent = "✓ Poser ici";
        }
        ui.placeHint.classList.toggle("is-bad", !g.valid);
        updateBusy();
    }

    async function confirmPlacement() {
        const g = S.ghost;
        if (!g || S.pending > 0) return;
        if (!g.valid) {
            toast("Cet emplacement est occupé.", "error");
            return;
        }
        if (S.mode === "place") {
            const res = await doAction("POST", "/village/build", { type: g.type, x: g.x, y: g.y });
            if (res) {
                const built = (res.village.events || []).find((e) => e.kind === "built");
                exitPlacement(built?.buildingId);
                if (built?.buildingId) {
                    const b = S.byId.get(built.buildingId);
                    if (b) ensureVisible(b);
                }
            }
        } else if (S.mode === "move") {
            if (g.origin && g.origin.x === g.x && g.origin.y === g.y) {
                exitPlacement(g.buildingId);
                return;
            }
            const res = await doAction("POST", `/village/buildings/${encodeURIComponent(g.buildingId)}/move`, { x: g.x, y: g.y });
            if (res) {
                exitPlacement(g.buildingId);
                const b = S.byId.get(g.buildingId);
                if (b) requestAnimationFrame(() => ensureVisible(b));
            }
        }
    }

    /* ======================================================================
       SELECTION
       ====================================================================== */

    function select(id) {
        if (S.mode !== "view") return;
        S.selectedId = id;
        S.armedRemoveId = null;
        renderSelbar(true);
        updateHud();
        requestDraw();
        const b = S.byId.get(id);
        if (b) requestAnimationFrame(() => ensureVisible(b));
    }

    function deselect() {
        if (!S.selectedId) return;
        S.selectedId = null;
        S.armedRemoveId = null;
        renderSelbar(true);
        updateHud();
        requestDraw();
    }

    function selectionStatus(b, c) {
        const now = serverNow();
        if (b.upgradeEndsAt) {
            const remaining = Math.max(0, (b.upgradeEndsAt - now) / 1000);
            const total = b.upgradeTotalSec || remaining || 1;
            const label = b.level === 0 ? "Construction" : `Amélioration vers le niv. ${b.level + 1}`;
            return `<div>⏳ ${esc(label)} — ${remaining > 0 ? `encore ${fmtDur(remaining)}` : "terminé !"}</div>
                <div class="v-meter is-build"><i style="width:${(100 * (1 - remaining / total)).toFixed(1)}%"></i></div>`;
        }
        if (b.mine) {
            const fill = mineFill(b, now);
            const cap = b.mine.capacitySec * b.mine.ratePerSec;
            const left = (1 - fill) * b.mine.capacitySec;
            return `<div>🪙 ${fmt(mineStored(b, now))} / ${fmt(cap)} · ${fmt(b.mine.ratePerSec)}/s</div>
                <div class="v-meter${fill >= 0.999 ? " is-full" : ""}"><i style="width:${(fill * 100).toFixed(1)}%"></i></div>
                <div style="color:${fill >= 0.999 ? "#fca5a5" : "#a3a3a3"};font-size:.85rem">${fill >= 0.999 ? "Stock plein : la mine ne produit plus, récolte !" : `Plein dans ${fmtDur(left)}`}</div>`;
        }
        if (b.forge) {
            const chest = b.forge.chest?.name || "Coffre";
            if (forgeReady(b, now)) return `<div>📦 ${esc(chest)} prêt ! Touche pour le récupérer.</div>`;
            const remaining = Math.max(0, (b.forge.readyAt - now) / 1000);
            const progress = 1 - remaining / (b.forge.cycleSec || 1);
            return `<div>📦 ${esc(chest)} dans ${fmtDur(remaining)}</div>
                <div class="v-meter" style="--c:#a855f7"><i style="width:${(progress * 100).toFixed(1)}%;background:linear-gradient(90deg,#c084fc,#a855f7)"></i></div>`;
        }
        if (b.type === "palazzo") {
            return `<div>🛖 Constructeurs libres : ${freeBuilders()}/${S.data.builders.total} · 🌴 Décorations : ${S.data.decorations.count}/${S.data.decorations.limit}</div>`;
        }
        if (b.type === "banca") return `<div>🏦 Stock de toutes tes mines : +${Math.round((S.data.capacityBonus || 0) * 100)} %</div>`;
        if (b.type === "capanna") return "<div>🛖 Abrite un constructeur.</div>";
        return `<div style="color:#a3a3a3">${esc(c.description)}</div>`;
    }

    function selectionActions(b, c) {
        const now = serverNow();
        const actions = [];
        if (b.mine && !b.upgradeEndsAt) {
            const stored = Math.floor(mineStored(b, now));
            actions.push({ act: "collect", label: `🪙 Récolter${stored >= 1 ? ` +${fmt(stored)}` : ""}`, cls: "v-btn-collect", disabled: stored < 1 });
        }
        if (b.forge && forgeReady(b, now)) actions.push({ act: "collect", label: "📦 Récupérer", cls: "v-btn-gold" });
        if (!b.upgradeEndsAt && b.level >= 1 && b.level < c.maxLevel) {
            const next = c.levels[b.level];
            actions.push({ act: "detail", label: `⬆️ Améliorer · ${fmt(next.cost)}`, cls: "v-btn-gold" });
        } else {
            actions.push({ act: "detail", label: "ℹ️ Infos", cls: "" });
        }
        actions.push({ act: "move", label: "✥ Déplacer", cls: "" });
        if (c.removable) {
            const armed = S.armedRemoveId === b.id;
            actions.push({ act: "remove", label: armed ? "Confirmer ?" : "🗑️ Retirer", cls: `v-btn-danger${armed ? " is-armed" : ""}` });
        }
        return actions;
    }

    /**
     * Met a jour la barre de selection. `full` reconstruit tout ; sinon seuls
     * le statut (compte a rebours, jauges) et les boutons qui changent sont
     * touches, pour ne pas "clignoter" sous le doigt.
     */
    function renderSelbar(full = false) {
        const b = S.selectedId ? S.byId.get(S.selectedId) : null;
        const c = b ? cat(b.type) : null;
        if (!b || !c || S.mode !== "view") {
            ui.selbar.classList.add("hidden");
            S.selActionsSig = "";
            return;
        }
        if (full || ui.selbar.classList.contains("hidden")) {
            ui.selEmoji.textContent = b.level === 0 ? "🏗️" : c.emoji;
            ui.selName.textContent = c.name;
            ui.selbar.classList.remove("hidden");
        }
        ui.selLevel.textContent = b.level === 0
            ? "En construction"
            : `Niveau ${b.level}${b.level >= c.maxLevel && c.maxLevel > 1 ? " (max)" : ""}`;
        ui.selStatus.innerHTML = selectionStatus(b, c);

        // On ne reconstruit les boutons que si leur structure change : un libelle
        // qui evolue chaque seconde ("Recolter +1.2K") est mis a jour sur place,
        // sinon un toucher pourrait tomber pendant la reconstruction et se perdre.
        const actions = selectionActions(b, c);
        const sig = actions.map((a) => `${a.act}|${a.cls}|${a.disabled ? 1 : 0}`).join(";");
        if (sig !== S.selActionsSig || ui.selActions.children.length !== actions.length) {
            S.selActionsSig = sig;
            ui.selActions.innerHTML = actions.map((a) =>
                `<button class="v-btn ${a.cls}" type="button" data-act="${a.act}"${a.disabled ? " disabled" : ""}>${esc(a.label)}</button>`
            ).join("");
        } else {
            actions.forEach((a, i) => {
                const btn = ui.selActions.children[i];
                if (btn.textContent !== a.label) btn.textContent = a.label;
            });
        }
    }

    async function onSelAction(act) {
        const b = S.selectedId ? S.byId.get(S.selectedId) : null;
        if (!b) return;
        if (act === "collect") return collectBuilding(b);
        if (act === "detail") return openDetail(b.id);
        if (act === "move") return startMove(b);
        if (act === "remove") {
            if (S.armedRemoveId !== b.id) {
                S.armedRemoveId = b.id;
                clearTimeout(S.armedTimer);
                S.armedTimer = setTimeout(() => {
                    S.armedRemoveId = null;
                    renderSelbar();
                }, 3500);
                renderSelbar();
                return;
            }
            S.armedRemoveId = null;
            const res = await doAction("DELETE", `/village/buildings/${encodeURIComponent(b.id)}`);
            if (res) {
                toast(`${cat(b.type)?.emoji || ""} Décoration retirée.`);
                deselect();
            }
        }
    }

    function collectBuilding(b) {
        // Retour visuel immediat : la bulle disparait sans attendre le serveur,
        // qui renverra de toute facon l'etat exact.
        if (b.mine && !b.upgradeEndsAt) {
            if (mineStored(b) < 1) {
                toast("Rien à récolter pour l'instant.");
                return;
            }
            b.lastCollectAt = serverNow();
        } else if (b.forge && forgeReady(b)) {
            b.forge = { ...b.forge, readyAt: serverNow() + b.forge.cycleSec * 1000 };
        } else {
            return;
        }
        requestDraw();
        updateHud();
        renderSelbar();
        doAction("POST", `/village/buildings/${encodeURIComponent(b.id)}/collect`);
    }

    /* ======================================================================
       PANNEAUX DU BAS : BOUTIQUE, DETAILS, AIDE
       ====================================================================== */

    function openSheet(sheet) {
        S.sheet = sheet;
        renderSheet();
        ui.sheetBody.scrollTop = 0;
        ui.sheetBackdrop.classList.remove("hidden");
        ui.sheet.classList.add("is-open");
        ui.sheet.setAttribute("aria-hidden", "false");
    }

    function closeSheet() {
        if (!S.sheet) return;
        if (S.sheet.welcome) storageSet(HELP_SEEN_KEY, "1");
        S.sheet = null;
        ui.sheet.classList.remove("is-open");
        ui.sheet.setAttribute("aria-hidden", "true");
        ui.sheetBackdrop.classList.add("hidden");
    }

    function rerenderSheet() {
        if (!S.sheet) return;
        const scroll = ui.sheetBody.scrollTop;
        renderSheet();
        ui.sheetBody.scrollTop = scroll;
    }

    function renderSheet() {
        const sheet = S.sheet;
        if (!sheet || !S.data) return;
        if (sheet.kind === "shop") {
            ui.sheetTitle.textContent = "🔨 Construire";
            ui.sheetBody.innerHTML = shopHtml();
        } else if (sheet.kind === "detail") {
            const b = S.byId.get(sheet.id);
            const c = b ? cat(b.type) : null;
            if (!b || !c) {
                closeSheet();
                return;
            }
            ui.sheetTitle.textContent = `${c.emoji} ${c.name}`;
            ui.sheetBody.innerHTML = detailHtml(b, c);
        } else if (sheet.kind === "help") {
            ui.sheetTitle.textContent = sheet.welcome ? "🏰 Bienvenue dans ton Villaggio !" : "❔ Comment ça marche ?";
            ui.sheetBody.innerHTML = helpHtml(sheet.welcome);
        }
    }

    /* --- Boutique ----------------------------------------------------------------- */

    function shopBlockReason(c) {
        const d = S.data;
        if (!c.build) return c.nextCountTh ? `Palazzo niv. ${c.nextCountTh} pour en avoir plus` : "Maximum atteint";
        if (c.category === "decoration") {
            if (c.build.th > d.th) return `🔒 Palazzo niv. ${c.build.th}`;
            if (d.decorations.count >= d.decorations.limit) return "Limite de décorations atteinte";
        } else {
            if (c.maxCount !== null && c.owned >= c.maxCount) {
                return c.nextCountTh ? `Palazzo niv. ${c.nextCountTh} pour +1` : "Maximum atteint";
            }
            if (c.build.th > d.th) return `🔒 Palazzo niv. ${c.build.th}`;
        }
        if (c.build.buildSec > 0 && freeBuilders() === 0) return "Aucun constructeur libre";
        if (liveGold() < c.build.cost) return `Il manque 🪙 ${fmt(c.build.cost - liveGold())}`;
        return null;
    }

    function shopStat(c) {
        const first = c.levels[0] || {};
        switch (c.type) {
            case "miniera": return `≈ ${fmt(first.ratePerSec)}/s au niv. 1`;
            case "fucina": return `${first.chest?.name || "Coffre"} / ${fmtDur(first.cycleSec)}`;
            case "banca": return `Stock des mines +${Math.round((first.capacityBonus || 0) * 100)} %`;
            case "capanna": return "+1 constructeur";
            default: return c.category === "decoration" ? c.description : "";
        }
    }

    function shopHtml() {
        const d = S.data;
        const tab = S.shopTab;
        const list = d.catalog.filter((c) => c.buildable && (tab === "decorations" ? c.category === "decoration" : c.category !== "decoration"));
        const cards = list.map((c) => {
            const reason = shopBlockReason(c);
            const cost = c.build ? c.build.cost : null;
            const short = cost !== null && liveGold() < cost;
            const count = c.category === "decoration" || !c.maxCount ? "" : `${c.owned}/${c.maxCount}`;
            return `<button class="v-card ${reason ? "is-blocked" : "is-available"}" type="button" data-act="shop-pick" data-type="${esc(c.type)}">
                ${count ? `<span class="v-card-count">${count}</span>` : ""}
                <span class="v-card-emoji" aria-hidden="true">${c.emoji}</span>
                <span class="v-card-name">${esc(c.name)}</span>
                <span class="v-card-stat">${esc(shopStat(c))}</span>
                ${cost !== null ? `<span class="v-card-foot"><span class="v-cost${short ? " is-short" : ""}">🪙 ${fmt(cost)}</span>
                    <span class="v-time">${c.build.buildSec > 0 ? `⏱ ${fmtDur(c.build.buildSec)}` : "⚡ instantané"}</span></span>` : ""}
                ${reason ? `<span class="v-card-lock">${esc(reason)}</span>` : ""}
            </button>`;
        }).join("");

        const meta = tab === "decorations"
            ? `Décorations posées : ${d.decorations.count}/${d.decorations.limit} · posées instantanément, sans constructeur.`
            : `Constructeurs libres : ${freeBuilders()}/${d.builders.total} · les prix s'adaptent à ta production.`;

        return `<div class="v-tabs" role="tablist">
                <button class="v-tab${tab === "buildings" ? " is-active" : ""}" type="button" data-act="shop-tab" data-tab="buildings">🏗️ Bâtiments</button>
                <button class="v-tab${tab === "decorations" ? " is-active" : ""}" type="button" data-act="shop-tab" data-tab="decorations">🌴 Décorations</button>
            </div>
            <p class="v-shop-meta">${esc(meta)}</p>
            <div class="v-shop-grid">${cards}</div>`;
    }

    function onShopPick(type) {
        const c = cat(type);
        if (!c) return;
        const reason = shopBlockReason(c);
        if (reason) {
            toast(reason.replace(/^🔒 /, "Débloqué au "), "error");
            return;
        }
        startPlacement(type);
    }

    /* --- Details / amelioration ---------------------------------------------------- */

    function levelStats(c, level) {
        const lv = c.levels[level - 1];
        if (!lv) return [];
        const bonus = S.data.capacityBonus || 0;
        switch (c.type) {
            case "miniera":
                return [
                    ["Production", `${fmt(lv.ratePerSec)}/s`],
                    ["Stock max", fmtDur(lv.fillSec * (1 + bonus))],
                    ["Part de ta production", `${(lv.cpsShare * 100).toFixed(1).replace(/\.0$/, "")} %`]
                ];
            case "fucina":
                return [
                    ["Coffre", lv.chest?.name || "—"],
                    ["Fréquence", `toutes les ${fmtDur(lv.cycleSec)}`]
                ];
            case "banca":
                return [["Stock des mines", `+${Math.round((lv.capacityBonus || 0) * 100)} %`]];
            default:
                return [];
        }
    }

    function maxLevelAt(c, th) {
        let max = 0;
        c.levels.forEach((lv, i) => {
            if (lv.th <= th) max = i + 1;
        });
        return max;
    }

    function palazzoUnlocks(nextTh) {
        const th = nextTh - 1;
        const out = [];
        for (const c of S.data.catalog) {
            if (c.type === "palazzo") continue;
            if (c.category === "decoration") {
                if (c.levels[0]?.th === nextTh) out.push(`${c.emoji} Nouvelle décoration : ${c.name}`);
                continue;
            }
            const before = c.maxCountByTh?.[th - 1] ?? 0;
            const after = c.maxCountByTh?.[nextTh - 1] ?? 0;
            if (after > before) {
                out.push(before === 0 ? `${c.emoji} Nouveau : ${c.name}` : `${c.emoji} ${c.name} : ${after} maximum (+${after - before})`);
            }
            if (before > 0 && c.maxLevel > 1) {
                const lvBefore = maxLevelAt(c, th);
                const lvAfter = maxLevelAt(c, nextTh);
                if (lvAfter > lvBefore) out.push(`${c.emoji} ${c.name} jusqu'au niveau ${lvAfter}`);
            }
        }
        const limits = S.data.decorationLimitByTh || [];
        if ((limits[nextTh - 1] ?? 0) > (limits[th - 1] ?? 0)) out.push(`🌴 Jusqu'à ${limits[nextTh - 1]} décorations`);
        return out;
    }

    function detailHtml(b, c) {
        const now = serverNow();
        const parts = [];
        parts.push(`<div class="v-detail-hero">
            <div class="v-dock-emoji" aria-hidden="true">${b.level === 0 ? "🏗️" : c.emoji}</div>
            <p>${esc(c.description)}</p>
        </div>`);

        if (b.upgradeEndsAt) {
            const remaining = Math.max(0, (b.upgradeEndsAt - now) / 1000);
            parts.push(`<div class="v-note">⏳ ${b.level === 0 ? "Construction" : `Amélioration vers le niveau ${b.level + 1}`} : ${remaining > 0 ? `encore ${fmtDur(remaining)}` : "terminé, un instant…"}</div>`);
        }

        const current = b.level >= 1 ? levelStats(c, b.level) : [];
        const nextLevel = b.level + 1;
        const next = c.levels[nextLevel - 1];
        const canUpgrade = !b.upgradeEndsAt && b.level >= 1 && next;
        const nextStats = canUpgrade ? levelStats(c, nextLevel) : [];

        if (current.length) {
            parts.push(`<p class="v-section-title">${canUpgrade ? `Niveau ${b.level} → ${nextLevel}` : `Niveau ${b.level}`}</p>`);
            parts.push(`<div class="v-rows">${current.map(([label, value], i) => {
                const after = nextStats[i]?.[1];
                return `<div class="v-row"><span>${esc(label)}</span><b>${esc(value)}${after && after !== value ? ` <span class="v-up">→ ${esc(after)}</span>` : ""}</b></div>`;
            }).join("")}</div>`);
        }

        if (c.type === "palazzo" && canUpgrade) {
            const unlocks = palazzoUnlocks(nextLevel);
            if (unlocks.length) {
                parts.push(`<p class="v-section-title">Débloque au niveau ${nextLevel}</p>`);
                parts.push(`<ul class="v-list">${unlocks.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>`);
            }
            if (next.milestone?.length) {
                parts.push(`<p class="v-section-title">Récompense de palier</p>`);
                parts.push(`<ul class="v-list">${next.milestone.map((m) => `<li>🎁 ${m.qty} × ${esc(m.name)}</li>`).join("")}</ul>`);
            }
        }

        if (!canUpgrade) {
            if (b.level >= 1 && b.level >= c.maxLevel && c.maxLevel > 1) {
                parts.push(`<div class="v-note">🏆 Niveau maximum atteint.</div>`);
            }
            return parts.join("");
        }

        const cost = next.cost;
        const gold = liveGold();
        const locked = c.type !== "palazzo" && next.th > S.data.th;
        const noBuilder = next.buildSec > 0 && freeBuilders() === 0;
        const short = gold < cost;
        const indexed = S.data.cps > 0 && next.incomeMinutes * 60 * S.data.cps >= cost * 0.98;

        parts.push(`<p class="v-section-title">Amélioration</p>`);
        parts.push(`<div class="v-rows">
            <div class="v-row"><span>Coût</span><b class="v-cost${short ? " is-short" : ""}">🪙 ${fmt(cost)}</b></div>
            <div class="v-row"><span>Soit</span><b>${indexed ? `≈ ${next.incomeMinutes} min de ta production` : "prix de base"}</b></div>
            <div class="v-row"><span>Durée</span><b>⏱ ${next.buildSec > 0 ? fmtDur(next.buildSec) : "instantané"}</b></div>
            <div class="v-row"><span>Bonus</span><b>+${next.xp} XP de passe</b></div>
        </div>`);

        if (locked) parts.push(`<div class="v-warning">🔒 Améliore d'abord ton Palazzo au niveau ${next.th}.</div>`);
        else if (noBuilder) parts.push(`<div class="v-warning">🛖 Tous tes constructeurs sont occupés.</div>`);
        else if (short) parts.push(`<div class="v-warning">🪙 Il te manque ${fmt(cost - gold)} d'or.</div>`);
        if (b.mine && mineStored(b, now) >= 1) {
            parts.push(`<div class="v-note">Le stock de la mine (🪙 ${fmt(mineStored(b, now))}) sera récolté automatiquement : elle ne produit pas pendant le chantier.</div>`);
        }

        const disabled = locked || noBuilder || short || S.pending > 0;
        parts.push(`<button class="v-btn v-btn-confirm v-sheet-cta" type="button" data-act="upgrade" data-id="${esc(b.id)}"${disabled ? " disabled" : ""}>
            ⬆️ Améliorer au niveau ${nextLevel} · 🪙 ${fmt(cost)}</button>`);
        return parts.join("");
    }

    function openDetail(id) {
        openSheet({ kind: "detail", id });
    }

    async function upgradeBuilding(id) {
        const res = await doAction("POST", `/village/buildings/${encodeURIComponent(id)}/upgrade`);
        if (res) closeSheet();
    }

    /* --- Aide ------------------------------------------------------------------------ */

    function helpHtml(welcome) {
        const items = [
            ["🏰", "Le Palazzo", "C'est le cœur de ton village. Chaque niveau débloque de nouveaux bâtiments, des niveaux plus hauts et des coffres bonus."],
            ["⛏️", "Les mines d'or", "Elles produisent un petit fixe plus une part de ta production. Leur stock est limité : passe récolter avant qu'elles soient pleines !"],
            ["⚒️", "La Fucina", "Fabrique un coffre gratuit à intervalle régulier. Les coffres arrivent dans ton inventaire, à ouvrir depuis la Boutique."],
            ["🛖", "Les constructeurs", "Un constructeur = un chantier à la fois. Construis des Capanna pour en avoir jusqu'à 3."],
            ["⚖️", "Équitable pour tous", "Les prix s'adaptent à ta production : chacun paie le même « temps de jeu ». Les chantiers prennent du temps pour tout le monde, impossible de tout finir en une soirée."],
            ["👆", "Les contrôles", "Glisse pour te déplacer, pince pour zoomer. Touche un bâtiment pour le gérer, garde le doigt appuyé pour le déplacer."]
        ];
        const hasMine = S.data.buildings.some((b) => b.type === "miniera");
        return `<div class="v-help">${items.map(([icon, title, text]) =>
            `<div class="v-help-item"><span aria-hidden="true">${icon}</span><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`
        ).join("")}</div>
        ${welcome && !hasMine
            ? `<button class="v-btn v-btn-build v-sheet-cta" type="button" data-act="open-shop">⛏️ Construire ma première mine</button>`
            : `<button class="v-btn v-btn-confirm v-sheet-cta" type="button" data-act="close">C'est parti !</button>`}`;
    }

    function maybeShowWelcome() {
        if (storageGet(HELP_SEEN_KEY)) return;
        openSheet({ kind: "help", welcome: true });
    }

    function onSheetClick(event) {
        const target = event.target.closest("[data-act]");
        if (!target || target.disabled) return;
        const act = target.dataset.act;
        if (act === "shop-tab") {
            S.shopTab = target.dataset.tab === "decorations" ? "decorations" : "buildings";
            renderSheet();
            ui.sheetBody.scrollTop = 0;
        } else if (act === "shop-pick") {
            onShopPick(target.dataset.type);
        } else if (act === "upgrade") {
            upgradeBuilding(target.dataset.id);
        } else if (act === "open-shop") {
            closeSheet();
            S.shopTab = "buildings";
            openSheet({ kind: "shop" });
        } else if (act === "close") {
            closeSheet();
        }
    }

    /* ======================================================================
       GESTES (Pointer Events : doigt, stylet et souris)
       ====================================================================== */

    const pointers = new Map();
    let gesture = null;   // { kind: "pan" | "drag" | "pinch", ... }
    let longPressTimer = 0;
    let inertia = null;

    function pointInPoly(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i];
            const b = pts[j];
            if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }

    function hitBuilding(x, y) {
        for (let i = drawnItems.length - 1; i >= 0; i--) {
            const it = drawnItems[i];
            if (it.ghost || !it.b || !it.hitPoly) continue;
            if (pointInPoly(x, y, it.hitPoly)) return it.b;
        }
        return null;
    }

    function hitGhost(x, y) {
        const g = S.ghost;
        if (!g) return false;
        const cell = gridAt(x, y);
        if (cell.x >= g.x - 0.5 && cell.x <= g.x + g.w + 0.5 && cell.y >= g.y - 0.5 && cell.y <= g.y + g.h + 0.5) return true;
        const it = drawnItems.find((item) => item.ghost);
        return Boolean(it?.hitPoly && pointInPoly(x, y, it.hitPoly));
    }

    function hitBubble(x, y) {
        for (let i = hitBubbles.length - 1; i >= 0; i--) {
            const h = hitBubbles[i];
            if (Math.hypot(x - h.x, y - h.y) <= h.r) return h;
        }
        return null;
    }

    function localPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function stepInertia() {
        if (!inertia) return;
        const now = performance.now();
        const dt = Math.min(40, now - inertia.last);
        inertia.last = now;
        cam.x -= (inertia.vx * dt) / cam.zoom;
        cam.y -= (inertia.vy * dt) / cam.zoom;
        clampCamera();
        const decay = Math.pow(0.9, dt / 16);
        inertia.vx *= decay;
        inertia.vy *= decay;
        if (Math.hypot(inertia.vx, inertia.vy) < 0.02) inertia = null;
    }

    function startPinch() {
        const [a, b] = [...pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gesture = {
            kind: "pinch",
            dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
            zoom: cam.zoom,
            world: screenToWorld(mid.x, mid.y)
        };
    }

    function onPointerDown(event) {
        if (!S.data) return;
        const p = localPoint(event);
        canvas.setPointerCapture?.(event.pointerId);
        pointers.set(event.pointerId, p);
        inertia = null;
        camTween = null;
        clearTimeout(longPressTimer);

        if (pointers.size === 2) {
            startPinch();
            return;
        }
        if (pointers.size > 2) return;

        const start = { x: p.x, y: p.y, t: performance.now() };
        if (S.mode !== "view" && hitGhost(p.x, p.y)) {
            const cell = gridAt(p.x, p.y);
            gesture = { kind: "drag", start, moved: false, offset: { x: cell.x - S.ghost.x, y: cell.y - S.ghost.y } };
            canvas.classList.add("is-dragging");
            return;
        }

        gesture = { kind: "pan", start, moved: false, last: p, lastT: start.t, vx: 0, vy: 0 };

        if (S.mode === "view" && !hitBubble(p.x, p.y)) {
            const b = hitBuilding(p.x, p.y);
            if (b) {
                longPressTimer = setTimeout(() => {
                    if (!gesture || gesture.kind !== "pan" || gesture.moved || pointers.size !== 1) return;
                    startMove(b);
                    const cell = gridAt(p.x, p.y);
                    gesture = { kind: "drag", start, moved: true, offset: { x: cell.x - b.x, y: cell.y - b.y } };
                    canvas.classList.add("is-dragging");
                }, LONG_PRESS_MS);
            }
        }
    }

    function onPointerMove(event) {
        if (!pointers.has(event.pointerId)) return;
        const p = localPoint(event);
        pointers.set(event.pointerId, p);
        if (!gesture) return;

        if (gesture.kind === "pinch" && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            cam.zoom = clamp(gesture.zoom * (dist / gesture.dist), MIN_ZOOM, MAX_ZOOM);
            cam.x = gesture.world.x - (mid.x - vw / 2) / cam.zoom;
            cam.y = gesture.world.y - (mid.y - vh / 2) / cam.zoom;
            clampCamera();
            requestDraw();
            return;
        }

        const dx = p.x - gesture.start.x;
        const dy = p.y - gesture.start.y;
        if (!gesture.moved && Math.hypot(dx, dy) > TAP_SLOP) {
            gesture.moved = true;
            clearTimeout(longPressTimer);
        }

        if (gesture.kind === "drag") {
            const cell = gridAt(p.x, p.y);
            moveGhostTo(cell.x - gesture.offset.x, cell.y - gesture.offset.y);
            return;
        }

        if (gesture.kind === "pan" && gesture.moved) {
            const now = performance.now();
            const ddx = p.x - gesture.last.x;
            const ddy = p.y - gesture.last.y;
            const dt = Math.max(1, now - gesture.lastT);
            cam.x -= ddx / cam.zoom;
            cam.y -= ddy / cam.zoom;
            clampCamera();
            gesture.vx = 0.8 * (ddx / dt) + 0.2 * gesture.vx;
            gesture.vy = 0.8 * (ddy / dt) + 0.2 * gesture.vy;
            gesture.last = p;
            gesture.lastT = now;
            canvas.classList.add("is-dragging");
            requestDraw();
        }
    }

    function onPointerUp(event) {
        if (!pointers.has(event.pointerId)) return;
        const p = localPoint(event);
        pointers.delete(event.pointerId);
        clearTimeout(longPressTimer);

        if (gesture?.kind === "pinch") {
            if (pointers.size === 1) {
                // Il reste un doigt : on enchaine sur un deplacement sans saut.
                const [rest] = [...pointers.values()];
                gesture = { kind: "pan", start: { x: rest.x, y: rest.y, t: performance.now() }, moved: true, last: rest, lastT: performance.now(), vx: 0, vy: 0 };
            } else if (pointers.size === 0) {
                gesture = null;
            }
            return;
        }
        if (pointers.size > 0) return;

        const g = gesture;
        gesture = null;
        canvas.classList.remove("is-dragging");
        if (!g) return;

        if (!g.moved && event.type !== "pointercancel") {
            onTap(p.x, p.y);
            return;
        }
        if (g.kind === "pan" && event.type !== "pointercancel" && performance.now() - g.lastT < 80) {
            const speed = Math.hypot(g.vx, g.vy);
            if (speed > 0.15) {
                inertia = { vx: g.vx, vy: g.vy, last: performance.now() };
                requestDraw();
            }
        }
    }

    function onTap(x, y) {
        if (S.mode !== "view") {
            const cell = gridAt(x, y);
            const g = S.ghost;
            if (g) moveGhostTo(cell.x - g.w / 2, cell.y - g.h / 2);
            return;
        }
        const bubble = hitBubble(x, y);
        if (bubble) {
            const b = S.byId.get(bubble.id);
            if (!b) return;
            if (bubble.kind === "collect") collectBuilding(b);
            else if (bubble.kind === "done") scheduleRefresh(0);
            return;
        }
        const b = hitBuilding(x, y);
        if (b) {
            if (S.selectedId === b.id) {
                // Deuxieme toucher sur un batiment qui produit : on recolte directement.
                if ((b.mine && mineStored(b) >= 1) || forgeReady(b)) collectBuilding(b);
                return;
            }
            select(b.id);
            return;
        }
        deselect();
    }

    function onWheel(event) {
        event.preventDefault();
        const p = localPoint(event);
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
        zoomAt(p.x, p.y, cam.zoom * factor);
    }

    /* ======================================================================
       HORLOGE : comptes a rebours, fin de chantier, resynchronisation
       ====================================================================== */

    let goldTimer = 0;
    let tickTimer = 0;
    let resyncTimer = 0;

    function tick() {
        if (!S.data) return;
        const now = serverNow();
        updateHud();
        renderSelbar();
        if (S.sheet?.kind === "detail") {
            const b = S.byId.get(S.sheet.id);
            if (b?.upgradeEndsAt) rerenderSheet();
        }
        // Un chantier vient de finir : le serveur le finalise au prochain appel.
        for (const b of S.data.buildings) {
            if (!b.upgradeEndsAt || b.upgradeEndsAt > now) continue;
            const key = `${b.id}:${b.upgradeEndsAt}`;
            if (S.finishedSeen.has(key)) continue;
            S.finishedSeen.add(key);
            scheduleRefresh(400);
        }
        requestDraw();
    }

    function startTimers() {
        stopTimers();
        goldTimer = setInterval(updateGoldText, 250);
        tickTimer = setInterval(tick, 1000);
        resyncTimer = setInterval(() => {
            if (S.pending === 0) refresh();
        }, RESYNC_MS);
    }

    function stopTimers() {
        clearInterval(goldTimer);
        clearInterval(tickTimer);
        clearInterval(resyncTimer);
    }

    /* ======================================================================
       DEMARRAGE
       ====================================================================== */

    function showError(message) {
        ui.loading.classList.add("is-done");
        ui.errorText.textContent = message;
        ui.error.classList.remove("hidden");
    }

    async function boot() {
        ui.error.classList.add("hidden");
        ui.loading.classList.remove("is-done");
        const token = await getToken();
        if (!token) {
            // auth-gate redirige vers PlayWeb.
            showError("Connexion requise… redirection en cours.");
            return;
        }
        const res = await api("GET", "/village");
        if (!res?.success || !res.village) {
            showError(res?.message || "Impossible de charger ton Villaggio.");
            return;
        }
        applyState(res.village);
        ui.loading.classList.add("is-done");
        startTimers();
    }

    function bindEvents() {
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        // Safari iPad : empeche le zoom de la page entiere pendant un pincement.
        for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
            document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
        }
        document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

        window.addEventListener("resize", resize);
        window.addEventListener("orientationchange", () => setTimeout(resize, 250));
        window.visualViewport?.addEventListener("resize", resize);

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                stopTimers();
                if (rafId) cancelAnimationFrame(rafId);
                rafId = 0;
            } else if (S.data) {
                startTimers();
                refresh();
                requestDraw();
            }
        });

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (S.sheet) closeSheet();
            else if (S.mode !== "view") exitPlacement();
            else deselect();
        });

        ui.buildBtn.addEventListener("click", () => {
            S.shopTab = "buildings";
            openSheet({ kind: "shop" });
        });
        ui.helpBtn.addEventListener("click", () => openSheet({ kind: "help" }));
        ui.collectAll.addEventListener("click", () => {
            if (S.pending > 0) return;
            doAction("POST", "/village/collect-all");
        });
        ui.selClose.addEventListener("click", deselect);
        ui.selActions.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-act]");
            if (btn && !btn.disabled) onSelAction(btn.dataset.act);
        });
        ui.placeCancel.addEventListener("click", () => {
            const id = S.ghost?.buildingId;
            exitPlacement(id);
        });
        ui.placeConfirm.addEventListener("click", confirmPlacement);
        ui.sheetClose.addEventListener("click", closeSheet);
        ui.sheetBackdrop.addEventListener("click", closeSheet);
        ui.sheetBody.addEventListener("click", onSheetClick);
        ui.errorRetry.addEventListener("click", boot);
    }

    bindEvents();
    resize();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
