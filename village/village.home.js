/* ==========================================================================
   Villaggio : ton village.

   Scene "home" : batiments, recoltes, chantiers, placement (murs a la
   chaine), boutique en 4 onglets, fiches detaillees, Armee et Laboratorio.
   ========================================================================== */
(() => {
    "use strict";

    const V = window.Villaggio;
    const { cfg, ui, S, view } = V;
    const { clamp, fmt, fmtDur, esc, storageGet, storageSet, track } = V.util;
    const { REDUCED_MOTION, LONG_PRESS_MS, UI_FONT } = cfg;

    /* ======================================================================
       PRODUCTION (extrapolee entre deux reponses du serveur)
       ====================================================================== */

    /** Seuil d'affichage des bulles de recolte (et du bouton "Tout recolter"). */
    const BUBBLE_FILL = 0.1;

    function mineFill(b, now = V.serverNow()) {
        if (!b.mine || b.upgradeEndsAt || b.mine.capacitySec <= 0) return 0;
        const elapsed = Math.max(0, (now - b.lastCollectAt) / 1000);
        return Math.min(1, elapsed / b.mine.capacitySec);
    }

    function mineStored(b, now = V.serverNow()) {
        if (!b.mine) return 0;
        return mineFill(b, now) * b.mine.capacitySec * b.mine.ratePerSec;
    }

    function forgeReady(b, now = V.serverNow()) {
        return Boolean(b.forge && !b.upgradeEndsAt && b.forge.readyAt && b.forge.readyAt <= now);
    }

    function collectableSummary() {
        let gold = 0;
        let chests = 0;
        let spots = 0;
        if (!S.data) return { gold, chests, spots };
        const now = V.serverNow();
        for (const b of S.data.buildings) {
            const stored = Math.floor(mineStored(b, now));
            if (stored >= 1) {
                gold += stored;
                if (mineFill(b, now) >= BUBBLE_FILL) spots++;
            }
            if (forgeReady(b, now)) {
                chests++;
                spots++;
            }
        }
        return { gold, chests, spots };
    }

    const isDefense = (c) => c?.category === "defense";
    const levelOf = (type) => S.data?.buildings.find((b) => b.type === type)?.level ?? 0;

    /* ======================================================================
       HUD
       ====================================================================== */

    function updateGoldText() {
        if (!S.data) return;
        ui.gold.textContent = fmt(V.liveGold());
    }

    function updateHud() {
        const d = S.data;
        if (!d) return;
        updateGoldText();
        ui.cps.textContent = `+${fmt(d.cps)}/s`;
        const free = V.freeBuilders();
        ui.builders.textContent = `${free}/${d.builders.total}`;
        ui.buildersPill.classList.toggle("is-full", free === 0);
        ui.buildersPill.title = free === 0 ? "Tous tes constructeurs sont occupés" : `${free} constructeur(s) libre(s)`;
        ui.title.textContent = d.pseudo ? `Villaggio di ${d.pseudo}` : "Villaggio";
        ui.subtitle.textContent = `Palazzo niv. ${d.th}`;

        const war = d.war;
        ui.trophies.textContent = String(war.trophies);
        ui.league.textContent = war.league.emoji;
        ui.trophyPill.title = `Ligue ${war.league.name}`;
        const shieldLeft = war.shieldUntil ? (war.shieldUntil - V.serverNow()) / 1000 : 0;
        ui.shieldPill.classList.toggle("hidden", shieldLeft <= 0);
        if (shieldLeft > 0) ui.shield.textContent = fmtDur(shieldLeft);

        const army = d.army;
        ui.armyCount.textContent = army.capacity > 0 ? `${army.used}/${army.capacity}` : "";
        ui.armyBtn.classList.toggle("is-training", army.queue.length > 0);
        const unseen = war.unseenDefenses || 0;
        ui.attackBadge.textContent = String(unseen);
        ui.attackBadge.classList.toggle("hidden", unseen === 0);

        const docked = S.mode !== "view" || Boolean(S.selectedId);
        ui.bottom.classList.toggle("hidden", docked || S.scene !== "home");

        const sum = collectableSummary();
        const canCollect = sum.spots > 0;
        ui.collectAll.classList.toggle("hidden", !canCollect);
        if (canCollect) {
            ui.collectCount.textContent = sum.gold >= 1
                ? `+${fmt(sum.gold)}${sum.chests ? " 📦" : ""}`
                : `📦 ${sum.chests}`;
        }
    }

    function updateBusy(busy = S.pending > 0) {
        ui.placeConfirm.disabled = busy || !S.ghost?.valid;
        ui.collectAll.disabled = busy;
    }
    V.onBusy(updateBusy);

    /* ======================================================================
       EVENEMENTS DU SERVEUR -> retours visuels
       ====================================================================== */

    function center(b) {
        return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }

    function handleEvents(events) {
        let collected = 0;
        for (const e of events) {
            const b = S.byId.get(e.buildingId);
            const c = V.cat(e.type || b?.type);
            switch (e.kind) {
                case "collected":
                    collected += e.gold;
                    if (b) {
                        const p = center(b);
                        view.fx.float(p.x, p.y, `+${fmt(e.gold)}`, "#fde047");
                        view.fx.coins(p.x, p.y, ui.goldPill);
                    }
                    break;
                case "chest":
                    if (b) view.fx.float(center(b).x, center(b).y, "📦 +1", "#e9d5ff");
                    V.toast(`📦 ${e.chest.name} ajouté à ton inventaire !`, "reward", { label: "Ouvrir", href: cfg.SHOP_URL });
                    break;
                case "completed":
                    if (c?.category !== "wall") {
                        V.toast(e.level === 1
                            ? `✅ ${c?.emoji || ""} ${e.name} est construit !`
                            : `✅ ${c?.emoji || ""} ${e.name} passe au niveau ${e.level} !`, "success");
                    }
                    for (const chest of e.chests || []) {
                        V.toast(`🎁 Palier du Palazzo : ${chest.qty} × ${chest.name} !`, "reward", { label: "Ouvrir", href: cfg.SHOP_URL });
                    }
                    if (b) view.fx.spark(center(b).x, center(b).y);
                    break;
                case "built":
                    if (e.type !== "mura") {
                        V.toast(e.instant ? `${c?.emoji || "✨"} ${e.name} posé !` : `🏗️ Construction de ${e.name} lancée !`, "success");
                    }
                    track("village_build");
                    break;
                case "upgrade":
                    V.toast(`⬆️ ${e.name} : amélioration vers le niveau ${e.level} lancée !`, "success");
                    track("village_upgrade");
                    break;
                case "walls":
                    V.toast(`🧱 ${e.count} mur${e.count > 1 ? "s" : ""} passé${e.count > 1 ? "s" : ""} au niveau ${e.level} !`, "success");
                    break;
                case "train":
                    track("village_train");
                    break;
                case "trained": {
                    const parts = Object.entries(e.troops).map(([type, n]) => `${V.troop(type)?.emoji || ""}×${n}`);
                    V.toast(`⚔️ Troupes prêtes : ${parts.join(" ")}`, "success");
                    break;
                }
                case "research":
                    V.toast(`🧪 Recherche lancée : ${e.name} niveau ${e.level}.`, "success");
                    track("village_research");
                    break;
                case "researched":
                    V.toast(`🧪 ${e.name} passe au niveau ${e.level} !`, "reward");
                    break;
                case "shield":
                    V.toast(e.reason === "starter"
                        ? `🛡️ Ton village peut maintenant être attaqué : bouclier de ${e.hours} h offert pour te préparer !`
                        : `🛡️ La guerre arrive au Villaggio ! Bouclier de ${e.hours} h offert pour organiser tes défenses.`, "reward");
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

    V.onState((data, first) => {
        if (S.selectedId && !S.byId.has(S.selectedId)) S.selectedId = null;
        if (S.mode === "move" && S.ghost && !S.byId.has(S.ghost.buildingId)) exitPlacement();
        if (S.ghost) updateGhostValidity();
        handleEvents(Array.isArray(data.events) ? data.events : []);
        if (S.scene !== "home") return;
        if (first) view.centerCamera();
        updateHud();
        renderSelbar(true);
        renderPlacebar();
        view.requestDraw();
    });

    /* ======================================================================
       SCENE : DESSIN
       ====================================================================== */

    let hitBubbles = [];
    let animatedBubbles = false;
    let drawnItems = [];

    function drawList() {
        const items = [];
        for (const b of S.data.buildings) {
            if (S.mode === "move" && S.ghost?.buildingId === b.id) continue;
            items.push({
                b, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, level: b.level,
                constructing: b.level === 0,
                selected: b.id === S.selectedId
            });
        }
        if (S.ghost) {
            const g = S.ghost;
            const source = g.buildingId ? S.byId.get(g.buildingId) : null;
            items.push({ b: source, ghost: true, type: g.type, x: g.x, y: g.y, w: g.w, h: g.h, level: source ? source.level : 1 });
        }
        view.linkWalls(items);
        return view.isoSort(items);
    }

    function rangeColor(targets) {
        if (targets === "air") return "rgba(56,189,248,ALPHA)";
        if (targets === "both") return "rgba(250,204,21,ALPHA)";
        return "rgba(251,146,60,ALPHA)";
    }

    function drawRangeFor(type, x, y, w, h) {
        const c = V.cat(type);
        if (!c?.combat) return;
        const cx = x + w / 2;
        const cy = y + h / 2;
        if (c.category === "trap") view.drawRange(cx, cy, c.combat.trigger, 0, rangeColor(c.combat.targets));
        else view.drawRange(cx, cy, c.combat.range, c.combat.minRange, rangeColor(c.combat.targets));
    }

    /** Petites troupes pretes, reparties sur les camps. */
    function drawCampTroops(items) {
        const army = S.data.army;
        const camps = items.filter((it) => it.type === "accampamento" && !it.ghost && it.level >= 1);
        if (!camps.length || army.used <= 0) return;
        const icons = [];
        for (const t of S.data.troops.slice().sort((a, b) => b.space - a.space)) {
            const n = army.troops[t.type] || 0;
            for (let i = 0; i < n; i++) icons.push(t);
        }
        const perCamp = Math.ceil(icons.length / camps.length);
        const z = view.cam.zoom;
        camps.forEach((it, ci) => {
            const mine = icons.slice(ci * perCamp, ci * perCamp + perCamp).slice(0, 9);
            const c = V.cat("accampamento");
            const height = (c.height + (Math.max(1, it.level) - 1) * 3) * z;
            mine.forEach((t, k) => {
                const col = k % 3;
                const row = Math.floor(k / 3);
                const p = view.iso(it.x + 0.6 + col * 0.9, it.y + 0.6 + row * 0.9);
                view.drawEmoji(t.emoji, p.x, p.y - height - 8 * z, (14 + Math.min(t.space, 10)) * z);
            });
        });
    }

    function drawBubble(x, y, emoji, ring, progress, kind, id, ts) {
        const ctx = view.ctx;
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

        view.drawEmoji(emoji, x, by, 25);
        hitBubbles.push({ x, y: by, r: r + 10, kind, id });
        animatedBubbles = true;
    }

    function drawProgress(x, y, progress, label) {
        const ctx = view.ctx;
        const w = 92;
        const h = 12;
        const px = x - w / 2;
        const py = y - 18;
        view.roundRect(px - 2, py - 2, w + 4, h + 4, 8);
        ctx.fillStyle = "rgba(10,10,14,0.82)";
        ctx.fill();
        view.roundRect(px, py, w, h, 6);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fill();
        if (progress > 0) {
            view.roundRect(px, py, Math.max(h, w * clamp(progress, 0, 1)), h, 6);
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
        if (x < -80 || x > view.vw + 80 || y < -80 || y > view.vh + 120) return;

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
        if (forgeReady(b, now)) {
            drawBubble(x, y, "📦", "#a855f7", 1, "collect", b.id, ts);
            return;
        }
        // Recherche terminee : le labo appelle.
        const lab = S.data.army.researching;
        if (b.type === "laboratorio" && lab && lab.endsAt <= now) drawBubble(x, y, "🧪", "#a855f7", 1, "done", b.id, ts);
    }

    function draw(ts) {
        if (!S.data) return;
        const g = S.ghost;
        if (g) {
            view.drawFootprintHighlight(g.x, g.y, g.w, g.h,
                g.valid ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.4)",
                g.valid ? "rgba(134,239,172,0.95)" : "rgba(252,165,165,0.95)");
            drawRangeFor(g.type, g.x, g.y, g.w, g.h);
        }
        const selected = S.selectedId ? S.byId.get(S.selectedId) : null;
        if (selected && S.mode === "view") {
            view.drawFootprintHighlight(selected.x, selected.y, selected.w, selected.h, "rgba(255,255,255,0.14)", "rgba(253,186,116,0.95)");
            if (selected.level >= 1) drawRangeFor(selected.type, selected.x, selected.y, selected.w, selected.h);
        }

        drawnItems = drawList();
        for (const it of drawnItems) view.drawBuilding(it, { badges: true });
        drawCampTroops(drawnItems);

        hitBubbles = [];
        animatedBubbles = false;
        const now = V.serverNow();
        for (const it of drawnItems) drawOverlay(it, ts, now);
    }

    /* ======================================================================
       PLACEMENT / DEPLACEMENT (avec pose des murs a la chaine)
       ====================================================================== */

    function canPlaceAt(x, y, w, h, ignoreId) {
        const n = S.data.mapSize;
        if (x < 0 || y < 0 || x + w > n || y + h > n) return false;
        return !S.data.buildings.some((b) => b.id !== ignoreId && x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h);
    }

    function updateGhostValidity() {
        const g = S.ghost;
        if (g) g.valid = canPlaceAt(g.x, g.y, g.w, g.h, g.buildingId);
    }

    /**
     * Emplacement libre propose par defaut : proche du centre de l'ecran, mais
     * degage (une case de marge) et jamais cache derriere un autre batiment.
     */
    function findFreeSpot(w, h, near, tight) {
        const n = S.data.mapSize;
        let best = null;
        for (let x = 0; x <= n - w; x++) {
            for (let y = 0; y <= n - h; y++) {
                if (!canPlaceAt(x, y, w, h)) continue;
                let score = Math.hypot(x + w / 2 - near.x, y + h / 2 - near.y);
                if (!tight && !canPlaceAt(x - 1, y - 1, w + 2, h + 2)) score += 3;
                const hidden = S.data.buildings.some((b) =>
                    (x + w <= b.x && x + w >= b.x - 2 && y < b.y + b.h && y + h > b.y) ||
                    (y + h <= b.y && y + h >= b.y - 2 && x < b.x + b.w && x + w > b.x));
                if (hidden && !tight) score += 4;
                if (!best || score < best.score) best = { x, y, score };
            }
        }
        return best;
    }

    function startPlacement(type, spot) {
        const c = V.cat(type);
        if (!c) return;
        V.closeSheet();
        S.selectedId = null;
        const at = spot || findFreeSpot(c.w, c.h, view.gridAt(view.vw / 2, view.vh / 2 - 40), c.category === "wall" || c.category === "trap");
        if (!at) {
            V.toast("Plus aucune place libre sur ton terrain !", "error");
            return;
        }
        S.mode = "place";
        S.ghost = { type, x: at.x, y: at.y, w: c.w, h: c.h };
        updateGhostValidity();
        refreshAll();
    }

    function startMove(b) {
        const c = V.cat(b.type);
        if (!c) return;
        S.selectedId = null;
        S.wallChain = null;
        S.mode = "move";
        S.ghost = { type: b.type, x: b.x, y: b.y, w: c.w, h: c.h, buildingId: b.id, origin: { x: b.x, y: b.y } };
        updateGhostValidity();
        refreshAll();
    }

    function exitPlacement(selectId) {
        S.mode = "view";
        S.ghost = null;
        S.wallChain = null;
        if (selectId && S.byId.has(selectId)) S.selectedId = selectId;
        refreshAll();
    }

    function refreshAll() {
        renderSelbar(true);
        renderPlacebar();
        updateHud();
        view.requestDraw();
    }

    function moveGhostTo(x, y) {
        const g = S.ghost;
        if (!g) return;
        const n = S.data.mapSize;
        const nx = clamp(Math.round(x), 0, n - g.w);
        const ny = clamp(Math.round(y), 0, n - g.h);
        if (nx === g.x && ny === g.y) return;
        g.x = nx;
        g.y = ny;
        updateGhostValidity();
        renderPlacebar();
        view.requestDraw();
    }

    /** Un mur de plus est-il constructible (limite, Palazzo, or) ? Renvoie la raison sinon. */
    function wallBlockReason() {
        const c = V.cat("mura");
        if (!c) return "Indisponible";
        return shopBlockReason(c);
    }

    /**
     * Apres la pose d'un mur, on propose directement le suivant dans le
     * prolongement (ou a angle droit si la voie est bloquee).
     */
    function continueWallChain(placed) {
        const chain = S.wallChain;
        let dir = { dx: 1, dy: 0 };
        if (chain?.last) {
            const dx = placed.x - chain.last.x;
            const dy = placed.y - chain.last.y;
            if (Math.abs(dx) + Math.abs(dy) === 1) dir = { dx, dy };
            else if (chain.dir) dir = chain.dir;
        } else if (chain?.dir) {
            dir = chain.dir;
        }
        const reason = wallBlockReason();
        if (reason) {
            if (!/Maximum|Palazzo niv/.test(reason)) V.toast(`🧱 ${reason}`, "error");
            exitPlacement();
            return;
        }
        const options = [dir, { dx: dir.dy, dy: dir.dx }, { dx: -dir.dy, dy: -dir.dx }];
        for (const o of options) {
            const x = placed.x + o.dx;
            const y = placed.y + o.dy;
            if (canPlaceAt(x, y, 1, 1)) {
                S.wallChain = { last: { x: placed.x, y: placed.y }, dir: o };
                S.mode = "place";
                S.ghost = { type: "mura", x, y, w: 1, h: 1, chain: true };
                updateGhostValidity();
                refreshAll();
                return;
            }
        }
        S.wallChain = { last: { x: placed.x, y: placed.y }, dir };
        startPlacement("mura", findFreeSpot(1, 1, placed, true));
        if (S.ghost) S.ghost.chain = true;
    }

    function renderPlacebar() {
        const g = S.ghost;
        if (!g || S.mode === "view" || S.scene !== "home") {
            ui.placebar.classList.add("hidden");
            return;
        }
        const c = V.cat(g.type);
        ui.placebar.classList.remove("hidden");
        ui.placeEmoji.textContent = c?.emoji || "🏗️";
        if (S.mode === "place") {
            ui.placeTitle.textContent = g.chain ? `Mur suivant (${c.owned}/${c.maxCount})` : `Placer : ${c?.name || ""}`;
            const build = c?.build;
            const costText = build ? `🪙 ${fmt(build.cost)} · ${build.buildSec > 0 ? `⏱ ${fmtDur(build.buildSec)}` : "instantané"}` : "";
            ui.placeHint.textContent = g.valid
                ? `${costText} — ${g.chain ? "✓ pour poser et continuer, ✕ pour arrêter" : "glisse ou touche une case"}`
                : "Emplacement occupé ou hors du terrain";
            ui.placeConfirm.textContent = g.chain ? "✓ Poser" : "✓ Construire";
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
            V.toast("Cet emplacement est occupé.", "error");
            return;
        }
        if (S.mode === "place") {
            const res = await V.doAction("POST", "/village/build", { type: g.type, x: g.x, y: g.y });
            if (!res) return;
            const built = (res.village.events || []).find((e) => e.kind === "built");
            if (g.type === "mura" && built) {
                continueWallChain({ x: g.x, y: g.y });
                return;
            }
            exitPlacement(built?.buildingId);
            const b = built?.buildingId ? S.byId.get(built.buildingId) : null;
            if (b) view.ensureVisible(b.x + b.w / 2, b.y + b.h / 2, ui.selbar.offsetHeight || 220);
        } else if (S.mode === "move") {
            if (g.origin && g.origin.x === g.x && g.origin.y === g.y) {
                exitPlacement(g.buildingId);
                return;
            }
            const res = await V.doAction("POST", `/village/buildings/${encodeURIComponent(g.buildingId)}/move`, { x: g.x, y: g.y });
            if (res) {
                exitPlacement(g.buildingId);
                const b = S.byId.get(g.buildingId);
                if (b) requestAnimationFrame(() => view.ensureVisible(b.x + b.w / 2, b.y + b.h / 2, ui.selbar.offsetHeight || 220));
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
        view.requestDraw();
        const b = S.byId.get(id);
        if (b) requestAnimationFrame(() => view.ensureVisible(b.x + b.w / 2, b.y + b.h / 2, ui.selbar.offsetHeight || 220));
    }

    function deselect() {
        if (!S.selectedId) return;
        S.selectedId = null;
        S.armedRemoveId = null;
        renderSelbar(true);
        updateHud();
        view.requestDraw();
    }

    function targetsLabel(targets) {
        return targets === "air" ? "Air" : targets === "both" ? "Sol + air" : "Sol";
    }

    function selectionStatus(b, c) {
        const now = V.serverNow();
        if (b.upgradeEndsAt) {
            const remaining = Math.max(0, (b.upgradeEndsAt - now) / 1000);
            const total = b.upgradeTotalSec || remaining || 1;
            const label = b.level === 0 ? "Construction" : `Amélioration vers le niv. ${b.level + 1}`;
            const off = isDefense(c) && b.level >= 1 ? " · ne tire pas pendant les travaux" : "";
            return `<div>⏳ ${esc(label)} — ${remaining > 0 ? `encore ${fmtDur(remaining)}` : "terminé !"}${off}</div>
                <div class="v-meter is-build"><i style="width:${(100 * (1 - remaining / total)).toFixed(1)}%"></i></div>`;
        }
        if (b.mine) {
            const fill = mineFill(b, now);
            const cap = b.mine.capacitySec * b.mine.ratePerSec;
            const left = (1 - fill) * b.mine.capacitySec;
            return `<div>🪙 ${fmt(mineStored(b, now))} / ${fmt(cap)} · ${fmt(b.mine.ratePerSec)}/s</div>
                <div class="v-meter${fill >= 0.999 ? " is-full" : ""}"><i style="width:${(fill * 100).toFixed(1)}%"></i></div>
                <div class="v-dim${fill >= 0.999 ? " is-bad" : ""}">${fill >= 0.999 ? "Stock plein : la mine ne produit plus, récolte !" : `Plein dans ${fmtDur(left)} · l'or non récolté peut être pillé`}</div>`;
        }
        if (b.forge) {
            const chest = b.forge.chest?.name || "Coffre";
            if (forgeReady(b, now)) return `<div>📦 ${esc(chest)} prêt ! Touche pour le récupérer.</div>`;
            const remaining = Math.max(0, (b.forge.readyAt - now) / 1000);
            const progress = 1 - remaining / (b.forge.cycleSec || 1);
            return `<div>📦 ${esc(chest)} dans ${fmtDur(remaining)}</div>
                <div class="v-meter is-magic"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>`;
        }
        const lv = c.levels[b.level - 1] || {};
        if (isDefense(c)) {
            return `<div>❤️ ${fmt(lv.hp)} · 💥 ${lv.dmg}/tir · 🎯 ${targetsLabel(c.combat.targets)} · portée ${c.combat.range}</div>`;
        }
        if (c.category === "trap") {
            return `<div>${lv.eject ? `🍌 Éjecte ${lv.eject} places de troupes` : `💥 ${lv.dmg} dégâts de zone`} · 🎯 ${targetsLabel(c.combat.targets)} · invisible pour l'ennemi</div>`;
        }
        if (c.category === "wall") {
            const same = S.data.buildings.filter((w) => w.type === "mura" && w.level === b.level).length;
            return `<div>❤️ ${fmt(lv.hp)} · ${same} mur${same > 1 ? "s" : ""} de ce niveau</div>`;
        }
        switch (b.type) {
            case "palazzo":
                return `<div>🛖 Constructeurs libres : ${V.freeBuilders()}/${S.data.builders.total} · 🌴 Décorations : ${S.data.decorations.count}/${S.data.decorations.limit}</div>`;
            case "banca":
                return `<div>🏦 Stock de toutes tes mines : +${Math.round((S.data.capacityBonus || 0) * 100)} %</div>`;
            case "cassaforte":
                return `<div>🔐 Protège ${Math.round((lv.protect || 0) * 100)} % de l'or de tes mines contre les pillards</div>`;
            case "capanna":
                return "<div>🛖 Abrite un constructeur.</div>";
            case "accampamento":
                return `<div>⛺ ${lv.capacity} places · armée : ${S.data.army.used}/${S.data.army.capacity}</div>`;
            case "caserma": {
                const unlocked = S.data.troops.filter((t) => t.unlocked).map((t) => t.emoji).join(" ");
                return `<div>⚔️ Troupes débloquées : ${unlocked || "aucune"}</div>`;
            }
            case "laboratorio": {
                const r = S.data.army.researching;
                if (!r) return "<div>🧪 Aucune recherche en cours.</div>";
                const t = V.troop(r.type);
                const remaining = Math.max(0, (r.endsAt - now) / 1000);
                return `<div>🧪 ${t?.emoji || ""} ${esc(t?.name || r.type)} niv. ${r.level} — ${remaining > 0 ? fmtDur(remaining) : "terminé !"}</div>
                    <div class="v-meter is-magic"><i style="width:${(100 * (1 - remaining / (r.sec || 1))).toFixed(1)}%"></i></div>`;
            }
            default:
                return `<div class="v-dim">${esc(c.description)}</div>`;
        }
    }

    /** Murs du meme niveau ameliorables d'un coup, et leur cout total. */
    function wallBatch(level) {
        const c = V.cat("mura");
        const next = c?.levels[level];
        if (!next) return null;
        const count = S.data.buildings.filter((w) => w.type === "mura" && w.level === level && !w.upgradeEndsAt).length;
        return { count, unit: next.cost, locked: next.th > S.data.th, th: next.th };
    }

    function selectionActions(b, c) {
        const now = V.serverNow();
        const actions = [];
        if (b.mine && !b.upgradeEndsAt) {
            const stored = Math.floor(mineStored(b, now));
            actions.push({ act: "collect", label: `🪙 Récolter${stored >= 1 ? ` +${fmt(stored)}` : ""}`, cls: "v-btn-collect", disabled: stored < 1 });
        }
        if (b.forge && forgeReady(b, now)) actions.push({ act: "collect", label: "📦 Récupérer", cls: "v-btn-gold" });
        if ((b.type === "caserma" || b.type === "accampamento") && b.level >= 1) actions.push({ act: "army", label: "⚔️ Armée", cls: "v-btn-army" });
        if (b.type === "laboratorio" && b.level >= 1) actions.push({ act: "lab", label: "🧪 Recherche", cls: "v-btn-magic" });
        if (c.category === "wall" && b.level < c.maxLevel) {
            const batch = wallBatch(b.level);
            if (batch && batch.count > 1 && !batch.locked) actions.push({ act: "walls", label: `🧱 Tous (${batch.count}) · ${fmt(batch.unit * batch.count)}`, cls: "v-btn-gold" });
        }
        if (!b.upgradeEndsAt && b.level >= 1 && b.level < c.maxLevel) {
            const next = c.levels[b.level];
            actions.push({ act: "detail", label: `⬆️ Améliorer · ${fmt(next.cost)}`, cls: c.category === "wall" ? "" : "v-btn-gold" });
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
        const c = b ? V.cat(b.type) : null;
        if (!b || !c || S.mode !== "view" || S.scene !== "home") {
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
            : `${c.role} · niveau ${b.level}${b.level >= c.maxLevel && c.maxLevel > 1 ? " (max)" : ""}`;
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
        if (act === "detail") return V.openSheet({ kind: "detail", id: b.id });
        if (act === "move") return startMove(b);
        if (act === "army") return V.openSheet({ kind: "army" });
        if (act === "lab") return V.openSheet({ kind: "lab" });
        if (act === "walls") return upgradeWalls(b.level);
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
            const res = await V.doAction("DELETE", `/village/buildings/${encodeURIComponent(b.id)}`);
            if (res) {
                V.toast(`${V.cat(b.type)?.emoji || ""} Décoration retirée.`);
                deselect();
            }
        }
    }

    function collectBuilding(b) {
        // Retour visuel immediat : la bulle disparait sans attendre le serveur,
        // qui renverra de toute facon l'etat exact.
        if (b.mine && !b.upgradeEndsAt) {
            if (mineStored(b) < 1) {
                V.toast("Rien à récolter pour l'instant.");
                return;
            }
            b.lastCollectAt = V.serverNow();
        } else if (b.forge && forgeReady(b)) {
            b.forge = { ...b.forge, readyAt: V.serverNow() + b.forge.cycleSec * 1000 };
        } else {
            return;
        }
        view.requestDraw();
        updateHud();
        renderSelbar();
        V.doAction("POST", `/village/buildings/${encodeURIComponent(b.id)}/collect`);
    }

    async function upgradeWalls(level) {
        const res = await V.doAction("POST", "/village/walls/upgrade", { level });
        if (res) V.closeSheet();
    }

    /* ======================================================================
       SCENE : GESTES
       ====================================================================== */

    let dragOffset = { x: 0, y: 0 };

    function hitBubble(x, y) {
        for (let i = hitBubbles.length - 1; i >= 0; i--) {
            const h = hitBubbles[i];
            if (Math.hypot(x - h.x, y - h.y) <= h.r) return h;
        }
        return null;
    }

    function hitBuilding(x, y) {
        return view.hitItem(drawnItems, x, y, (it) => !it.ghost && it.b)?.b ?? null;
    }

    function hitGhost(x, y) {
        const g = S.ghost;
        if (!g) return false;
        const cell = view.gridAt(x, y);
        if (cell.x >= g.x - 0.5 && cell.x <= g.x + g.w + 0.5 && cell.y >= g.y - 0.5 && cell.y <= g.y + g.h + 0.5) return true;
        const it = drawnItems.find((item) => item.ghost);
        return Boolean(it?.hitPoly && view.pointInPoly(x, y, it.hitPoly));
    }

    const homeScene = {
        mapSize: () => S.data?.mapSize || 24,
        margin: () => S.data?.deployMargin ?? 2,
        showGrid: () => S.mode !== "view",
        animating: () => animatedBubbles,
        draw,
        tap(x, y) {
            if (S.mode !== "view") {
                const cell = view.gridAt(x, y);
                const g = S.ghost;
                if (g) moveGhostTo(cell.x - g.w / 2, cell.y - g.h / 2);
                return;
            }
            const bubble = hitBubble(x, y);
            if (bubble) {
                const b = S.byId.get(bubble.id);
                if (!b) return;
                if (bubble.kind === "collect") collectBuilding(b);
                else if (bubble.kind === "done") V.scheduleRefresh(0);
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
        },
        dragStart(x, y) {
            if (S.mode === "view" || !hitGhost(x, y)) return false;
            const cell = view.gridAt(x, y);
            dragOffset = { x: cell.x - S.ghost.x, y: cell.y - S.ghost.y };
            return true;
        },
        dragMove(x, y) {
            const cell = view.gridAt(x, y);
            moveGhostTo(cell.x - dragOffset.x, cell.y - dragOffset.y);
        },
        dragEnd() {},
        longPressDelay(x, y) {
            if (S.mode !== "view" || hitBubble(x, y)) return 0;
            return hitBuilding(x, y) ? LONG_PRESS_MS : 0;
        },
        longPress(x, y) {
            const b = hitBuilding(x, y);
            if (!b) return null;
            startMove(b);
            const cell = view.gridAt(x, y);
            dragOffset = { x: cell.x - b.x, y: cell.y - b.y };
            return "drag";
        }
    };

    /* ======================================================================
       BOUTIQUE (4 onglets)
       ====================================================================== */

    const SHOP_TABS = [
        { key: "eco", label: "💰 Économie", match: (c) => ["core", "production", "support"].includes(c.category) },
        { key: "army", label: "⚔️ Armée", match: (c) => c.category === "military" },
        { key: "defense", label: "🛡️ Défense", match: (c) => ["defense", "wall", "trap"].includes(c.category) },
        { key: "deco", label: "🌴 Décos", match: (c) => c.category === "decoration" }
    ];

    function shopBlockReason(c) {
        const d = S.data;
        if (!c.build) return c.nextCountTh ? `Palazzo niv. ${c.nextCountTh} pour en avoir plus` : "Maximum atteint";
        if (c.category === "decoration") {
            if (c.build.th > d.th) return `🔒 Palazzo niv. ${c.build.th}`;
            const trophies = c.levels[0]?.trophies || 0;
            if (trophies > d.war.trophies) return `🔒 ${trophies} trophées`;
            if (d.decorations.count >= d.decorations.limit) return "Limite de décorations atteinte";
        } else {
            if (c.maxCount !== null && c.owned >= c.maxCount) {
                return c.nextCountTh ? `Palazzo niv. ${c.nextCountTh} pour +1` : "Maximum atteint";
            }
            if (c.build.th > d.th) return `🔒 Palazzo niv. ${c.build.th}`;
        }
        if (c.build.buildSec > 0 && V.freeBuilders() === 0) return "Aucun constructeur libre";
        if (V.liveGold() < c.build.cost) return `Il manque 🪙 ${fmt(c.build.cost - V.liveGold())}`;
        return null;
    }

    function shopStat(c) {
        const first = c.levels[0] || {};
        switch (c.type) {
            case "miniera": return `≈ ${fmt(first.ratePerSec)}/s au niv. 1`;
            case "fucina": return `${first.chest?.name || "Coffre"} / ${fmtDur(first.cycleSec)}`;
            case "banca": return `Stock des mines +${Math.round((first.capacityBonus || 0) * 100)} %`;
            case "cassaforte": return `Protège ${Math.round((first.protect || 0) * 100)} % du butin`;
            case "capanna": return "+1 constructeur";
            case "accampamento": return `${first.capacity} places de troupes`;
            case "caserma": return "Entraîne tes troupes";
            case "laboratorio": return "Améliore tes troupes";
            case "mura": return `❤️ ${fmt(first.hp)} · pose à la chaîne`;
            default:
                if (c.category === "defense") return `💥 ${first.dmg} · 🎯 ${targetsLabel(c.combat.targets)}`;
                if (c.category === "trap") return first.eject ? `Éjecte ${first.eject} places` : `💥 ${first.dmg} · 🎯 ${targetsLabel(c.combat.targets)}`;
                return c.description;
        }
    }

    function shopHtml(sheet) {
        const d = S.data;
        const tab = SHOP_TABS.find((t) => t.key === sheet.tab) || SHOP_TABS[0];
        const list = d.catalog.filter((c) => c.buildable && tab.match(c));
        const cards = list.map((c) => {
            const reason = shopBlockReason(c);
            const cost = c.build ? c.build.cost : null;
            const short = cost !== null && V.liveGold() < cost;
            const count = c.category === "decoration" || !c.maxCount ? "" : `${c.owned}/${c.maxCount}`;
            return `<button class="v-card ${reason ? "is-blocked" : "is-available"}" type="button" data-act="shop-pick" data-type="${esc(c.type)}">
                ${count ? `<span class="v-card-count">${count}</span>` : ""}
                <span class="v-card-emoji" aria-hidden="true">${c.emoji}</span>
                <span class="v-card-name">${esc(c.name)}</span>
                <span class="v-card-role">${esc(c.role)}</span>
                <span class="v-card-stat">${esc(shopStat(c))}</span>
                ${cost !== null ? `<span class="v-card-foot"><span class="v-cost${short ? " is-short" : ""}">🪙 ${fmt(cost)}</span>
                    <span class="v-time">${c.build.buildSec > 0 ? `⏱ ${fmtDur(c.build.buildSec)}` : "⚡ instantané"}</span></span>` : ""}
                ${reason ? `<span class="v-card-lock">${esc(reason)}</span>` : ""}
            </button>`;
        }).join("");

        const metaByTab = {
            eco: `Constructeurs libres : ${V.freeBuilders()}/${d.builders.total} · les prix s'adaptent à ta production.`,
            army: "Caserma pour entraîner, Accampamento pour loger, Laboratorio pour améliorer tes troupes.",
            defense: "Les défenses tirent sur les pillards. Les murs bloquent le sol, les pièges sont invisibles pour l'ennemi.",
            deco: `Décorations posées : ${d.decorations.count}/${d.decorations.limit} · certaines récompensent les meilleures ligues.`
        };

        return `<div class="v-tabs" role="tablist">${SHOP_TABS.map((t) =>
            `<button class="v-tab${t.key === tab.key ? " is-active" : ""}" type="button" data-act="shop-tab" data-tab="${t.key}">${t.label}</button>`
        ).join("")}</div>
            <p class="v-shop-meta">${esc(metaByTab[tab.key])}</p>
            <div class="v-shop-grid">${cards || '<p class="v-empty">Rien ici pour le moment.</p>'}</div>`;
    }

    V.sheets.shop = {
        title: () => "🔨 Construire",
        html: shopHtml,
        onAct(act, el, sheet) {
            if (act === "shop-tab") {
                sheet.tab = el.dataset.tab;
                V.renderSheet();
                ui.sheetBody.scrollTop = 0;
                return;
            }
            if (act === "shop-pick") {
                const c = V.cat(el.dataset.type);
                if (!c) return;
                const reason = shopBlockReason(c);
                if (reason) {
                    V.toast(reason.replace(/^🔒 /, "Débloqué à : "), "error");
                    return;
                }
                S.wallChain = null;
                startPlacement(c.type);
            }
        }
    };

    V.openShop = (tab = "eco") => V.openSheet({ kind: "shop", tab });

    /* ======================================================================
       FICHE DETAILLEE / AMELIORATION
       ====================================================================== */

    function levelStats(c, level) {
        const lv = c.levels[level - 1];
        if (!lv) return [];
        const bonus = S.data.capacityBonus || 0;
        const rows = [];
        switch (c.type) {
            case "miniera":
                rows.push(["Production", `${fmt(lv.ratePerSec)}/s`], ["Stock max", fmtDur(lv.fillSec * (1 + bonus))],
                    ["Part de ta production", `${(lv.cpsShare * 100).toFixed(1).replace(/\.0$/, "")} %`]);
                break;
            case "fucina":
                rows.push(["Coffre", lv.chest?.name || "—"], ["Fréquence", `toutes les ${fmtDur(lv.cycleSec)}`]);
                break;
            case "banca":
                rows.push(["Stock des mines", `+${Math.round((lv.capacityBonus || 0) * 100)} %`]);
                break;
            case "cassaforte":
                rows.push(["Or protégé", `${Math.round((lv.protect || 0) * 100)} %`]);
                break;
            case "accampamento":
                rows.push(["Places de troupes", String(lv.capacity)]);
                break;
            case "caserma": {
                const troop = S.data.troops.find((t) => t.barracks === level);
                if (troop) rows.push(["Débloque", `${troop.emoji} ${troop.name}`]);
                break;
            }
            default:
                break;
        }
        if (isDefense(c)) {
            rows.push(["Dégâts par tir", String(lv.dmg)], ["Cadence", `${(c.combat.interval / 10).toFixed(1)} s`]);
        }
        if (c.category === "trap") {
            if (lv.eject) rows.push(["Éjecte", `${lv.eject} places`]);
            else rows.push(["Dégâts", String(lv.dmg)]);
        }
        if (lv.hp) rows.push(["Points de vie", fmt(lv.hp)]);
        return rows;
    }

    function fixedStats(c) {
        if (!c.combat) return "";
        const rows = [["Cible", targetsLabel(c.combat.targets)]];
        if (c.category === "trap") rows.push(["Déclenchement", `${c.combat.trigger} case(s)`]);
        else rows.push(["Portée", `${c.combat.range} cases${c.combat.minRange ? ` (aveugle sous ${c.combat.minRange})` : ""}`]);
        if (c.combat.splash) rows.push(["Zone", `${c.combat.splash} case(s)`]);
        return `<div class="v-rows">${rows.map(([l, v]) => `<div class="v-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("")}</div>`;
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
        if (nextTh === S.data.war.minTh) out.push("⚔️ Ton village devient attaquable (bouclier de 24 h offert)");
        return out;
    }

    function detailHtml(sheet) {
        const b = S.byId.get(sheet.id);
        const c = b ? V.cat(b.type) : null;
        if (!b || !c) return null;
        const now = V.serverNow();
        const parts = [];
        parts.push(`<div class="v-detail-hero">
            <div class="v-dock-emoji" aria-hidden="true">${b.level === 0 ? "🏗️" : c.emoji}</div>
            <div><p class="v-detail-role">${esc(c.role)}</p><p>${esc(c.description)}</p></div>
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
            parts.push(`<div class="v-rows">${current.map(([label, value]) => {
                const after = nextStats.find(([l]) => l === label)?.[1];
                return `<div class="v-row"><span>${esc(label)}</span><b>${esc(value)}${after && after !== value ? ` <span class="v-up">→ ${esc(after)}</span>` : ""}</b></div>`;
            }).join("")}</div>`);
        }
        parts.push(fixedStats(c));

        if (b.type === "caserma" || b.type === "accampamento") {
            parts.push(`<button class="v-btn v-btn-army v-sheet-cta" type="button" data-act="open-army">⚔️ Gérer mon armée</button>`);
        }
        if (b.type === "laboratorio") {
            parts.push(`<button class="v-btn v-btn-magic v-sheet-cta" type="button" data-act="open-lab">🧪 Ouvrir le Laboratorio</button>`);
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
        const gold = V.liveGold();
        const locked = c.type !== "palazzo" && next.th > S.data.th;
        const noBuilder = next.buildSec > 0 && V.freeBuilders() === 0;
        const labBusy = c.type === "laboratorio" && Boolean(S.data.army.researching);
        const short = gold < cost;
        const indexed = S.data.cps > 0 && next.incomeMinutes * 60 * S.data.cps >= cost * 0.98;

        parts.push(`<p class="v-section-title">Amélioration</p>`);
        parts.push(`<div class="v-rows">
            <div class="v-row"><span>Coût</span><b class="v-cost${short ? " is-short" : ""}">🪙 ${fmt(cost)}</b></div>
            <div class="v-row"><span>Soit</span><b>${indexed ? `≈ ${next.incomeMinutes} min de ta production` : "prix de base"}</b></div>
            <div class="v-row"><span>Durée</span><b>⏱ ${next.buildSec > 0 ? fmtDur(next.buildSec) : "instantané"}</b></div>
            ${next.xp > 0 ? `<div class="v-row"><span>Bonus</span><b>+${next.xp} XP de passe</b></div>` : ""}
        </div>`);

        if (locked) parts.push(`<div class="v-warning">🔒 Améliore d'abord ton Palazzo au niveau ${next.th}.</div>`);
        else if (labBusy) parts.push(`<div class="v-warning">🧪 Une recherche est en cours : attends qu'elle se termine.</div>`);
        else if (noBuilder) parts.push(`<div class="v-warning">🛖 Tous tes constructeurs sont occupés.</div>`);
        else if (short) parts.push(`<div class="v-warning">🪙 Il te manque ${fmt(cost - gold)} d'or.</div>`);
        if (b.mine && mineStored(b, now) >= 1) {
            parts.push(`<div class="v-note">Le stock de la mine (🪙 ${fmt(mineStored(b, now))}) sera récolté automatiquement : elle ne produit pas pendant le chantier.</div>`);
        }
        if (isDefense(c) && next.buildSec > 0) {
            parts.push(`<div class="v-note">⚠️ Pendant les travaux, cette défense ne tire pas si on t'attaque.</div>`);
        }

        const disabled = locked || noBuilder || labBusy || short || S.pending > 0;
        parts.push(`<button class="v-btn v-btn-confirm v-sheet-cta" type="button" data-act="upgrade" data-id="${esc(b.id)}"${disabled ? " disabled" : ""}>
            ⬆️ Améliorer au niveau ${nextLevel} · 🪙 ${fmt(cost)}</button>`);

        if (c.category === "wall") {
            const batch = wallBatch(b.level);
            if (batch && batch.count > 1 && !batch.locked) {
                const total = batch.unit * batch.count;
                const affordable = Math.min(batch.count, Math.floor(gold / batch.unit));
                parts.push(`<button class="v-btn v-btn-gold v-sheet-cta" type="button" data-act="walls" data-level="${b.level}"${affordable < 1 || S.pending > 0 ? " disabled" : ""}>
                    🧱 Améliorer ${affordable < batch.count ? `${affordable} des ${batch.count}` : `les ${batch.count}`} murs niv. ${b.level} · 🪙 ${fmt(affordable < batch.count ? affordable * batch.unit : total)}</button>`);
            }
        }
        return parts.join("");
    }

    V.sheets.detail = {
        title(sheet) {
            const b = S.byId.get(sheet.id);
            const c = b ? V.cat(b.type) : null;
            return c ? `${c.emoji} ${c.name}` : "";
        },
        html: detailHtml,
        async onAct(act, el) {
            if (act === "upgrade") {
                const res = await V.doAction("POST", `/village/buildings/${encodeURIComponent(el.dataset.id)}/upgrade`);
                if (res) V.closeSheet();
            } else if (act === "walls") {
                upgradeWalls(Number(el.dataset.level));
            }
        }
    };

    /* ======================================================================
       ARMEE
       ====================================================================== */

    function troopLockReason(t) {
        const army = S.data.army;
        if (army.barracks < 1) return "Construis une Caserma";
        if (!t.unlocked) return `🔒 Caserma niv. ${t.barracks}`;
        if (army.capacity <= 0) return "Construis un Accampamento";
        const free = army.capacity - army.used - army.queued;
        if (free < t.space) return "Camps pleins";
        if (V.liveGold() < t.cost) return "Pas assez d'or";
        return null;
    }

    function armyHtml() {
        const d = S.data;
        const army = d.army;
        const now = V.serverNow();
        const parts = [];

        if (army.barracks < 1 || army.capacity <= 0) {
            parts.push(`<div class="v-note">⚔️ Pour lever une armée, il te faut une <b>Caserma</b> (entraînement) et un <b>Accampamento</b> (logement). Débloqués au Palazzo niveau 2.</div>
                <button class="v-btn v-btn-build v-sheet-cta" type="button" data-act="open-shop" data-tab="army">🔨 Construire</button>`);
            if (army.barracks < 1 && army.capacity <= 0) return parts.join("");
        }

        const total = Math.max(1, army.capacity);
        parts.push(`<div class="v-capacity">
            <div class="v-capacity-head"><span>⛺ Places</span><b>${army.used}${army.queued ? ` + ${army.queued}` : ""} / ${army.capacity}</b></div>
            <div class="v-meter is-stack"><i style="width:${(100 * army.used / total).toFixed(1)}%"></i><em style="left:${(100 * army.used / total).toFixed(1)}%;width:${(100 * army.queued / total).toFixed(1)}%"></em></div>
        </div>`);

        const ready = d.troops.filter((t) => army.troops[t.type] > 0);
        parts.push(`<p class="v-section-title">Troupes prêtes</p>`);
        parts.push(ready.length
            ? `<div class="v-chips">${ready.map((t) => `<span class="v-chip"><span aria-hidden="true">${t.emoji}</span>×${army.troops[t.type]}<small>niv. ${t.level}</small></span>`).join("")}</div>`
            : `<p class="v-empty">Aucune troupe prête. Entraîne-en ci-dessous !</p>`);

        if (army.queue.length) {
            const endsIn = Math.max(0, (army.endsAt - now) / 1000);
            parts.push(`<p class="v-section-title">Entraînement · fini dans ${fmtDur(endsIn)}</p>`);
            parts.push(`<div class="v-queue">${army.queue.map((e, i) => {
                const t = V.troop(e.type);
                let meter = "";
                if (i === 0 && army.headEndsAt) {
                    const left = Math.max(0, (army.headEndsAt - now) / 1000);
                    meter = `<div class="v-meter is-build"><i style="width:${(100 * (1 - left / (t?.trainSec || 1))).toFixed(1)}%"></i></div><small>${fmtDur(left)}</small>`;
                }
                return `<div class="v-queue-item">
                    <span class="v-queue-emoji" aria-hidden="true">${t?.emoji || "?"}</span>
                    <div class="v-queue-info"><b>${esc(t?.name || e.type)} ×${e.count}</b>${meter}</div>
                    <button class="v-btn v-btn-icon v-btn-danger" type="button" data-act="untrain" data-index="${i}" aria-label="Annuler une unité">−</button>
                </div>`;
            }).join("")}</div>`);
        }

        parts.push(`<p class="v-section-title">Entraîner</p>`);
        parts.push(`<div class="v-troop-grid">${d.troops.map((t) => {
            const reason = troopLockReason(t);
            const free = army.capacity - army.used - army.queued;
            const five = Math.min(5, Math.floor(free / t.space));
            const lockedTroop = army.barracks < 1 || !t.unlocked;
            return `<div class="v-troop${lockedTroop ? " is-locked" : ""}">
                <button class="v-troop-main" type="button" data-act="train" data-type="${t.type}" data-count="1"${reason ? " disabled" : ""}>
                    <span class="v-troop-emoji" aria-hidden="true">${t.emoji}</span>
                    <span class="v-troop-level">niv. ${t.level}</span>
                    <b>${esc(t.name)}</b>
                    <span class="v-troop-role">${t.roleEmoji} ${esc(t.role)}${t.flying ? " · vole" : ""}</span>
                    <span class="v-troop-meta">🏠 ${t.space} · ⏱ ${fmtDur(t.trainSec)} · <span class="v-cost">🪙 ${fmt(t.cost)}</span></span>
                    ${reason ? `<span class="v-card-lock">${esc(reason)}</span>` : ""}
                </button>
                ${!lockedTroop && five > 1 ? `<button class="v-btn v-troop-more" type="button" data-act="train" data-type="${t.type}" data-count="${five}"${reason || S.pending > 0 ? " disabled" : ""}>+${five}</button>` : ""}
                <button class="v-troop-info" type="button" data-act="troop-info" data-type="${t.type}" aria-label="Infos">ℹ️</button>
            </div>`;
        }).join("")}</div>`);
        parts.push(`<p class="v-dim v-small">Touche une troupe pour en entraîner une. Les troupes déployées en bataille sont perdues, même si tu gagnes.</p>`);
        return parts.join("");
    }

    function troopInfoHtml(sheet) {
        const t = V.troop(sheet.type);
        if (!t) return null;
        const lv = t.levels[t.level - 1];
        const target = { any: "Le bâtiment le plus proche", defense: "Les défenses", resource: "Mines, forge, banque", wall: "Les murs", heal: "Soigne les alliés" }[t.target];
        return `<div class="v-detail-hero"><div class="v-dock-emoji" aria-hidden="true">${t.emoji}</div>
            <div><p class="v-detail-role">${t.roleEmoji} ${esc(t.role)} · niveau ${t.level}/${t.maxLevel}</p><p>${esc(t.description)}</p></div></div>
            <div class="v-rows">
                <div class="v-row"><span>Points de vie</span><b>${lv.hp}</b></div>
                ${t.target === "heal" ? `<div class="v-row"><span>Soin</span><b>${lv.heal}</b></div>` : `<div class="v-row"><span>Dégâts par coup</span><b>${lv.dmg}</b></div>`}
                <div class="v-row"><span>Cible</span><b>${esc(target)}</b></div>
                <div class="v-row"><span>Portée</span><b>${t.range} case(s)${t.splash ? ` · zone ${t.splash}` : ""}</b></div>
                <div class="v-row"><span>Vitesse</span><b>${t.speed} cases/s${t.flying ? " · vole" : ""}</b></div>
                <div class="v-row"><span>Places</span><b>${t.space}</b></div>
                <div class="v-row"><span>Entraînement</span><b>⏱ ${fmtDur(t.trainSec)} · 🪙 ${fmt(t.cost)}</b></div>
            </div>
            <button class="v-btn v-sheet-cta" type="button" data-act="open-army">← Retour à l'armée</button>`;
    }

    V.sheets.army = {
        title: () => "⚔️ Armée",
        html: armyHtml,
        async onAct(act, el) {
            if (act === "train") {
                const count = Number(el.dataset.count) || 1;
                await V.doAction("POST", "/village/army/train", { type: el.dataset.type, count });
            } else if (act === "untrain") {
                await V.doAction("POST", "/village/army/cancel", { index: Number(el.dataset.index) });
            } else if (act === "troop-info") {
                V.openSheet({ kind: "troop", type: el.dataset.type });
            }
        }
    };

    V.sheets.troop = {
        title(sheet) {
            const t = V.troop(sheet.type);
            return t ? `${t.emoji} ${t.name}` : "Troupe";
        },
        html: troopInfoHtml
    };

    /* ======================================================================
       LABORATORIO
       ====================================================================== */

    function labHtml() {
        const d = S.data;
        const army = d.army;
        const now = V.serverNow();
        const parts = [];
        if (army.lab < 1) {
            parts.push(`<div class="v-note">🧪 Construis un <b>Laboratorio</b> (Palazzo niveau 3) pour renforcer tes troupes : plus de vie, plus de dégâts.</div>
                <button class="v-btn v-btn-build v-sheet-cta" type="button" data-act="open-shop" data-tab="army">🔨 Construire</button>`);
            return parts.join("");
        }
        const r = army.researching;
        if (r) {
            const t = V.troop(r.type);
            const left = Math.max(0, (r.endsAt - now) / 1000);
            parts.push(`<div class="v-research">
                <span class="v-queue-emoji" aria-hidden="true">${t?.emoji || "🧪"}</span>
                <div class="v-queue-info"><b>${esc(t?.name || r.type)} → niveau ${r.level}</b>
                <div class="v-meter is-magic"><i style="width:${(100 * (1 - left / (r.sec || 1))).toFixed(1)}%"></i></div>
                <small>${left > 0 ? `encore ${fmtDur(left)}` : "terminé !"}</small></div>
            </div>`);
        }
        if (army.labUpgrading) parts.push(`<div class="v-warning">🏗️ Le Laboratorio est en travaux : pas de nouvelle recherche en attendant.</div>`);
        parts.push(`<p class="v-section-title">Laboratorio niveau ${army.lab} · une recherche à la fois</p>`);
        parts.push(`<div class="v-lab-list">${d.troops.map((t) => {
            const next = t.levels[t.level];
            let reason = null;
            if (!t.unlocked) reason = `🔒 Caserma niv. ${t.barracks}`;
            else if (!next) reason = "🏆 Niveau max";
            else if (next.lab > army.lab) reason = `🔒 Labo niv. ${next.lab}`;
            else if (r) reason = "Recherche en cours";
            else if (army.labUpgrading) reason = "Labo en travaux";
            const short = next?.research && V.liveGold() < next.research.cost;
            const cur = t.levels[t.level - 1];
            const stats = next
                ? `❤️ ${cur.hp} → <span class="v-up">${next.hp}</span> · ${t.target === "heal" ? `💚 ${cur.heal} → <span class="v-up">${next.heal}</span>` : `💥 ${cur.dmg} → <span class="v-up">${next.dmg}</span>`}`
                : `❤️ ${cur.hp} · ${t.target === "heal" ? `💚 ${cur.heal}` : `💥 ${cur.dmg}`}`;
            return `<div class="v-lab-item${reason && reason !== "Recherche en cours" ? " is-locked" : ""}">
                <span class="v-queue-emoji" aria-hidden="true">${t.emoji}</span>
                <div class="v-queue-info">
                    <b>${esc(t.name)} <small>niv. ${t.level}/${t.maxLevel}</small></b>
                    <span class="v-dim">${stats}</span>
                </div>
                ${next?.research && !reason
                ? `<button class="v-btn v-btn-magic" type="button" data-act="research" data-type="${t.type}"${short || S.pending > 0 ? " disabled" : ""}>
                        <span>🪙 ${fmt(next.research.cost)}</span><small>⏱ ${fmtDur(next.research.sec)}</small></button>`
                : `<span class="v-lab-lock">${esc(reason || "")}</span>`}
            </div>`;
        }).join("")}</div>`);
        return parts.join("");
    }

    V.sheets.lab = {
        title: () => "🧪 Laboratorio",
        html: labHtml,
        async onAct(act, el) {
            if (act === "research") await V.doAction("POST", "/village/lab/research", { type: el.dataset.type });
        }
    };

    /* ======================================================================
       AIDE
       ====================================================================== */

    function helpHtml(sheet) {
        const items = [
            ["🏰", "Le Palazzo", "Le cœur de ton village. Chaque niveau débloque de nouveaux bâtiments, des niveaux plus hauts et des coffres bonus."],
            ["⛏️", "Les mines d'or", "Un petit fixe plus une part de ta production, dans un stock limité. Récolte souvent : l'or qui dort dans les mines peut être pillé !"],
            ["⚒️", "La Fucina", "Fabrique un coffre gratuit à intervalle régulier. Les coffres arrivent dans ton inventaire, à ouvrir depuis la Boutique."],
            ["⚔️", "L'armée", "Entraîne des brainrots à la Caserma, loge-les dans les Accampamento et renforce-les au Laboratorio."],
            ["🗡️", "Attaquer", "Pille les mines des autres joueurs ou les Briganti, gagne des trophées et grimpe de ligue. Ton or principal, lui, ne peut jamais être volé."],
            ["🛡️", "Te défendre", "Canons, tours, mortiers, murs et pièges invisibles. Après une attaque, un bouclier te protège quelques heures."],
            ["⚖️", "Équitable pour tous", "Les prix et le butin s'adaptent à ta production : chacun joue avec le même « temps de jeu »."],
            ["👆", "Les contrôles", "Glisse pour te déplacer, pince pour zoomer. Touche un bâtiment pour le gérer, garde le doigt appuyé pour le déplacer."]
        ];
        const hasMine = S.data.buildings.some((b) => b.type === "miniera");
        return `<div class="v-help">${items.map(([icon, title, text]) =>
            `<div class="v-help-item"><span aria-hidden="true">${icon}</span><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`
        ).join("")}</div>
        ${sheet.welcome && !hasMine
            ? `<button class="v-btn v-btn-build v-sheet-cta" type="button" data-act="open-shop" data-tab="eco">⛏️ Construire ma première mine</button>`
            : `<button class="v-btn v-btn-confirm v-sheet-cta" type="button" data-act="close">C'est parti !</button>`}`;
    }

    V.sheets.help = {
        title: (sheet) => (sheet.welcome ? "🏰 Bienvenue dans ton Villaggio !" : "❔ Comment ça marche ?"),
        html: helpHtml,
        onClose(sheet) {
            if (sheet.welcome) storageSet(cfg.HELP_SEEN_KEY, "1");
        }
    };

    /* --- Actions communes aux feuilles ------------------------------------------- */

    V.acts["open-shop"] = (el) => V.openShop(el.dataset.tab || "eco");
    V.acts["open-army"] = () => V.openSheet({ kind: "army" });
    V.acts["open-lab"] = () => V.openSheet({ kind: "lab" });

    /* ======================================================================
       HORLOGE DU VILLAGE
       ====================================================================== */

    /** Appele chaque seconde : comptes a rebours, fins de chantier, entrainement. */
    function tick() {
        if (!S.data || S.scene !== "home") return;
        const now = V.serverNow();
        updateHud();
        renderSelbar();
        const kind = S.sheet?.kind;
        if (kind === "army" || kind === "lab" || kind === "detail") V.rerenderSheet();

        // Un chantier, une unite ou une recherche vient de finir : le serveur
        // le finalise au prochain appel.
        const due = [];
        for (const b of S.data.buildings) if (b.upgradeEndsAt && b.upgradeEndsAt <= now) due.push(`${b.id}:${b.upgradeEndsAt}`);
        const army = S.data.army;
        if (army.headEndsAt && army.headEndsAt <= now) due.push(`train:${army.headEndsAt}`);
        if (army.researching && army.researching.endsAt <= now) due.push(`lab:${army.researching.endsAt}`);
        for (const key of due) {
            if (S.finishedSeen.has(key)) continue;
            S.finishedSeen.add(key);
            V.scheduleRefresh(400);
        }
        view.requestDraw();
    }

    function maybeShowWelcome() {
        if (storageGet(cfg.HELP_SEEN_KEY)) return false;
        V.openSheet({ kind: "help", welcome: true });
        return true;
    }

    /** Revient sur le village (apres une bataille ou un replay). */
    function enter() {
        S.scene = "home";
        S.mode = "view";
        S.ghost = null;
        ui.top.classList.remove("hidden");
        ui.battle.classList.add("hidden");
        view.setScene(homeScene);
        view.centerCamera();
        refreshAll();
    }

    /* --- Boutons du village --------------------------------------------------------- */

    ui.buildBtn.addEventListener("click", () => V.openShop("eco"));
    ui.armyBtn.addEventListener("click", () => V.openSheet({ kind: "army" }));
    ui.helpBtn.addEventListener("click", () => V.openSheet({ kind: "help" }));
    ui.collectAll.addEventListener("click", () => {
        if (S.pending > 0) return;
        V.doAction("POST", "/village/collect-all");
    });
    ui.selClose.addEventListener("click", deselect);
    ui.selActions.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (btn && !btn.disabled) onSelAction(btn.dataset.act);
    });
    ui.placeCancel.addEventListener("click", () => exitPlacement(S.ghost?.buildingId));
    ui.placeConfirm.addEventListener("click", confirmPlacement);

    V.home = {
        scene: homeScene,
        enter,
        tick,
        updateHud,
        updateGoldText,
        maybeShowWelcome,
        escape() {
            if (S.mode !== "view") exitPlacement(S.ghost?.buildingId);
            else deselect();
        }
    };
})();
