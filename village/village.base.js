/* ==========================================================================
   Villaggio : base commune.

   Le Villaggio est decoupe en plusieurs fichiers qui partagent l'espace de
   noms window.Villaggio (V), charges dans cet ordre :
     village.base.js    configuration, outils, etat, API, notifications, panneaux
     village.render.js  camera isometrique, gestes, dessin du terrain et des batiments
     village.home.js    ton village : selection, boutique, armee, laboratoire
     village.war.js     la guerre : menu, reperage, bataille, replays, resultats
     village.boot.js    demarrage, horloges, evenements globaux

   Le serveur fait autorite sur tout (couts, temps, recoltes, placement,
   resultat des batailles). Le client affiche et extrapole entre deux
   reponses : or qui monte, stock des mines, comptes a rebours.
   ========================================================================== */
(() => {
    "use strict";

    const V = (window.Villaggio = window.Villaggio || {});

    /* ======================================================================
       CONFIGURATION
       ====================================================================== */

    V.cfg = {
        API: String(window.API_BASE_URL || "").replace(/\/+$/, ""),
        TILE_W: 64,
        TILE_H: 32,
        MIN_ZOOM: 0.4,
        MAX_ZOOM: 2.4,
        TAP_SLOP: 10,
        LONG_PRESS_MS: 420,
        RESYNC_MS: 90_000,
        HELP_SEEN_KEY: "villaggio_help_seen_v2",
        SHOP_URL: "../shop/shop.html",
        REDUCED_MOTION: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
        EMOJI_FONT: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        UI_FONT: '"Inter",-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",Roboto,sans-serif'
    };

    /* ======================================================================
       ELEMENTS DE LA PAGE
       ====================================================================== */

    const $ = (id) => document.getElementById(id);
    const ids = {
        app: "v-app", canvas: "v-canvas", sea: "v-sea", nav: "v-nav",
        top: "v-top", title: "v-title", subtitle: "v-subtitle",
        trophyPill: "v-trophy-pill", trophies: "v-trophies", league: "v-league",
        shieldPill: "v-shield-pill", shield: "v-shield",
        gold: "v-gold", goldPill: "v-gold-pill", cps: "v-cps",
        builders: "v-builders", buildersPill: "v-builders-pill",
        toasts: "v-toasts",
        bottom: "v-bottom", collectAll: "v-collect-all", collectCount: "v-collect-count",
        helpBtn: "v-help-btn", armyBtn: "v-army-btn", armyCount: "v-army-count",
        buildBtn: "v-build-btn", attackBtn: "v-attack-btn", attackBadge: "v-attack-badge",
        selbar: "v-selbar", selEmoji: "v-sel-emoji", selName: "v-sel-name", selLevel: "v-sel-level",
        selClose: "v-sel-close", selStatus: "v-sel-status", selActions: "v-sel-actions",
        placebar: "v-placebar", placeEmoji: "v-place-emoji", placeTitle: "v-place-title", placeHint: "v-place-hint",
        placeCancel: "v-place-cancel", placeConfirm: "v-place-confirm",
        sheet: "v-sheet", sheetBackdrop: "v-sheet-backdrop", sheetTitle: "v-sheet-title",
        sheetBody: "v-sheet-body", sheetClose: "v-sheet-close",
        battle: "v-battle", btTop: "v-bt-top", btBottom: "v-bt-bottom", btName: "v-bt-name", btSub: "v-bt-sub", btLoot: "v-bt-loot", btStakes: "v-bt-stakes",
        btTimerLabel: "v-bt-timer-label", btTimer: "v-bt-timer", btStars: "v-bt-stars", btPct: "v-bt-pct",
        btLooted: "v-bt-looted", btTroops: "v-bt-troops", btHint: "v-bt-hint",
        btNext: "v-bt-next", btEnd: "v-bt-end", btSpeed: "v-bt-speed",
        loading: "v-loading", loadingText: "v-loading-text",
        error: "v-error", errorText: "v-error-text", errorRetry: "v-error-retry"
    };
    V.ui = {};
    for (const [key, id] of Object.entries(ids)) V.ui[key] = $(id);

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

    /** Chrono "2:05". */
    function fmtClock(totalSec) {
        const s = Math.max(0, Math.ceil(Number(totalSec) || 0));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }

    /** "il y a 3 h", "il y a 2 j". */
    function fmtAgo(ts) {
        const sec = Math.max(0, (Date.now() - Number(ts)) / 1000);
        if (sec < 60) return "à l'instant";
        if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
        if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
        return `il y a ${Math.floor(sec / 86400)} j`;
    }

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function stars(n, max = 3) {
        return `<span class="v-stars" aria-label="${n} étoile(s) sur ${max}">${"★".repeat(n)}<i>${"★".repeat(Math.max(0, max - n))}</i></span>`;
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

    V.util = { clamp, fmt, fmtDur, fmtClock, fmtAgo, esc, stars, storageGet, storageSet, track, shade };

    /* ======================================================================
       ETAT
       ====================================================================== */

    const S = (V.S = {
        data: null,
        receivedAt: 0,
        clockOffset: 0,
        byId: new Map(),
        catalog: new Map(),
        troops: new Map(),
        /** Scene affichee : "home" (ton village) ou "battle" (bataille, replay). */
        scene: "home",
        /** Interaction dans le village : view | place | move. */
        mode: "view",
        selectedId: null,
        ghost: null,
        pending: 0,
        sheet: null,
        finishedSeen: new Set(),
        refreshTimer: 0
    });

    V.serverNow = () => Date.now() + S.clockOffset;
    V.cat = (type) => S.catalog.get(type);
    V.troop = (type) => S.troops.get(type);

    V.liveGold = () => {
        if (!S.data) return 0;
        return S.data.gold + S.data.cps * Math.max(0, Date.now() - S.receivedAt) / 1000;
    };

    V.freeBuilders = () => (S.data ? Math.max(0, S.data.builders.total - S.data.builders.busy) : 0);

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
    V.getToken = getToken;

    async function api(method, path, body) {
        const token = await getToken();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await fetch(`${V.cfg.API}${path}`, {
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
            return { success: false, network: true, message: "Connexion au serveur impossible. Vérifie ton réseau." };
        } finally {
            clearTimeout(timer);
        }
    }
    V.api = api;

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
    V.enqueue = enqueue;

    const busyListeners = [];
    V.onBusy = (fn) => busyListeners.push(fn);
    const notifyBusy = () => busyListeners.forEach((fn) => fn(S.pending > 0));

    /**
     * Action sur le village. L'etat renvoye (meme en cas de refus) est
     * applique ; renvoie la reponse si elle a reussi, null sinon.
     */
    V.doAction = (method, path, body, { quiet = false } = {}) => enqueue(async () => {
        S.pending++;
        notifyBusy();
        try {
            const res = await api(method, path, body);
            if (res?.village) V.applyState(res.village);
            if (!res?.success) {
                if (!quiet) toast(res?.message || "Action impossible pour le moment.", "error");
                return null;
            }
            return res;
        } finally {
            S.pending--;
            notifyBusy();
        }
    });

    V.refresh = () => enqueue(async () => {
        const res = await api("GET", "/village");
        if (res?.success && res.village) V.applyState(res.village);
        return res;
    });

    V.scheduleRefresh = (delayMs = 350) => {
        clearTimeout(S.refreshTimer);
        S.refreshTimer = setTimeout(() => V.refresh(), delayMs);
    };

    /* ======================================================================
       APPLICATION DE L'ETAT SERVEUR
       ====================================================================== */

    const stateListeners = [];
    /** fn(data, first) : appelee a chaque nouvel etat du serveur. */
    V.onState = (fn) => stateListeners.push(fn);

    V.applyState = (data) => {
        const first = !S.data;
        S.data = data;
        S.receivedAt = Date.now();
        S.clockOffset = Number(data.serverTime || Date.now()) - Date.now();
        S.byId = new Map(data.buildings.map((b) => [b.id, b]));
        S.catalog = new Map(data.catalog.map((c) => [c.type, c]));
        S.troops = new Map((data.troops || []).map((t) => [t.type, t]));
        for (const fn of stateListeners) fn(data, first);
        rerenderSheet();
    };

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
        } else if (action?.onClick) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = action.label || "Voir";
            btn.addEventListener("click", () => {
                el.remove();
                action.onClick();
            });
            el.appendChild(btn);
        }
        V.ui.toasts.prepend(el);
        while (V.ui.toasts.children.length > 4) V.ui.toasts.lastElementChild.remove();
        const ttl = kind === "error" ? 4200 : kind === "reward" ? 5200 : 3200;
        setTimeout(() => {
            el.classList.add("is-leaving");
            setTimeout(() => el.remove(), 260);
        }, ttl);
    }
    V.toast = toast;

    /* ======================================================================
       CHARGEMENT
       Plein ecran : le logo PlayWeb anime. En superposition (lancement d'une
       bataille) : un simple voile avec une roue.
       ====================================================================== */

    /** Duree de l'entree du logo : on ne coupe pas l'animation en plein milieu. */
    const LOGO_INTRO_MS = V.cfg.REDUCED_MOTION ? 0 : 1750;
    let loaderShownAt = performance.now();
    let loaderTimer = 0;

    V.loader = {
        show(text, overlay = false) {
            const el = V.ui.loading;
            clearTimeout(loaderTimer);
            V.ui.loadingText.textContent = text;
            el.classList.toggle("is-overlay", overlay);
            if (el.classList.contains("hidden")) {
                // Repasser de display:none a visible relance les animations CSS.
                el.classList.remove("hidden");
                loaderShownAt = performance.now();
            }
            el.classList.remove("is-done");
        },
        /** Se resout quand le voile commence a disparaitre. */
        hide() {
            const el = V.ui.loading;
            const wait = el.classList.contains("is-overlay") ? 0 : Math.max(0, LOGO_INTRO_MS - (performance.now() - loaderShownAt));
            clearTimeout(loaderTimer);
            return new Promise((resolve) => {
                loaderTimer = setTimeout(() => {
                    el.classList.add("is-done");
                    // Une fois invisible, display:none arrete toutes ses animations.
                    loaderTimer = setTimeout(() => el.classList.add("hidden"), 400);
                    resolve();
                }, wait);
            });
        }
    };

    /* ======================================================================
       PANNEAUX DU BAS (feuilles)
       Chaque type de feuille s'enregistre dans V.sheets :
         { title(sheet), html(sheet), onAct?(act, el, sheet), onClose?(sheet) }
       ====================================================================== */

    V.sheets = {};

    function openSheet(sheet) {
        const previous = S.sheet;
        if (previous && previous.kind !== sheet.kind) V.sheets[previous.kind]?.onClose?.(previous);
        S.sheet = sheet;
        renderSheet();
        V.ui.sheetBody.scrollTop = 0;
        V.ui.sheetBackdrop.classList.remove("hidden");
        V.ui.sheet.classList.add("is-open");
        V.ui.sheet.setAttribute("aria-hidden", "false");
        V.ui.sheet.dataset.kind = sheet.kind;
    }

    function closeSheet() {
        const sheet = S.sheet;
        if (!sheet) return;
        S.sheet = null;
        V.ui.sheet.classList.remove("is-open");
        V.ui.sheet.setAttribute("aria-hidden", "true");
        V.ui.sheetBackdrop.classList.add("hidden");
        V.sheets[sheet.kind]?.onClose?.(sheet);
    }

    function renderSheet() {
        const sheet = S.sheet;
        if (!sheet) return;
        const def = V.sheets[sheet.kind];
        if (!def) return;
        if (sheet.kind !== "result" && !S.data) return;
        const html = def.html(sheet);
        if (html === null) {
            closeSheet();
            return;
        }
        V.ui.sheetTitle.textContent = def.title(sheet);
        V.ui.sheetBody.innerHTML = html;
    }

    function rerenderSheet() {
        if (!S.sheet) return;
        const scroll = V.ui.sheetBody.scrollTop;
        renderSheet();
        V.ui.sheetBody.scrollTop = scroll;
    }

    V.openSheet = openSheet;
    V.closeSheet = closeSheet;
    V.renderSheet = renderSheet;
    V.rerenderSheet = rerenderSheet;

    /**
     * Actions communes a toutes les feuilles (ouvrir l'armee, revoir une
     * bataille...) : V.acts[act](element, feuille). Les autres sont confiees
     * a la feuille ouverte.
     */
    V.acts = {
        close: () => closeSheet()
    };

    V.ui.sheetBody.addEventListener("click", (event) => {
        const target = event.target.closest("[data-act]");
        if (!target || target.disabled || !S.sheet) return;
        const act = target.dataset.act;
        const common = V.acts[act];
        if (common) common(target, S.sheet);
        else V.sheets[S.sheet.kind]?.onAct?.(act, target, S.sheet);
    });
    V.ui.sheetClose.addEventListener("click", closeSheet);
    V.ui.sheetBackdrop.addEventListener("click", closeSheet);
})();
