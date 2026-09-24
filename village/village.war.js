/* ==========================================================================
   Villaggio : la guerre.

   Menu de guerre (attaque, campagne, journal, classement, amis), reperage
   du village adverse, bataille en direct, ecran de resultat, replays et
   rapport des attaques subies.

   Le moteur de combat (battle.sim.js) est charge depuis le serveur : c'est
   exactement le fichier qui calculera le resultat officiel. Le client le
   fait tourner en direct au rythme de l'horloge (10 ticks par seconde) et
   envoie ses deploiements horodates au fil de l'eau ; a la fin, le serveur
   rejoue la bataille et c'est SON resultat qui compte.
   ========================================================================== */
(() => {
    "use strict";

    const V = window.Villaggio;
    const { cfg, ui, S, view } = V;
    const { clamp, fmt, fmtDur, fmtClock, fmtAgo, esc, stars, track } = V.util;

    const TICK_MS = 100;
    /** Cadence du deploiement continu (doigt maintenu). */
    const HOLD_EVERY_MS = 110;
    /** Delai avant que l'appui prolonge ne declenche le deploiement continu. */
    const HOLD_DELAY_MS = 230;
    /** Envoi groupe des deploiements. */
    const SEND_EVERY_MS = 280;

    /* ======================================================================
       MOTEUR DE COMBAT
       ====================================================================== */

    let simPromise = null;
    function loadSim() {
        if (!simPromise) {
            simPromise = import(`${cfg.API}/village/battle-sim.js`).catch((error) => {
                simPromise = null;
                throw error;
            });
        }
        return simPromise;
    }

    /* ======================================================================
       ETAT DE LA BATAILLE
       ====================================================================== */

    /** Bataille affichee (null dans le village). */
    let B = null;

    const round2 = (v) => Math.round(v * 100) / 100;
    const isLive = () => B?.kind === "live";

    function troopOrder(types) {
        const order = S.data?.troops?.map((t) => t.type) || [];
        return types.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }

    function createState(kind, data, sim) {
        const battle = sim.createBattle(data.scenario);
        const items = battle.buildings.map((b) => ({
            ref: b, i: b.i, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, level: b.level
        }));
        return {
            kind,
            data,
            sim,
            battle,
            items: view.isoSort(items),
            phase: kind === "live" ? "scout" : "fight",
            selected: troopOrder(Object.keys(battle.remaining)).find((t) => battle.remaining[t] > 0) || null,
            startPerf: 0,
            sent: 0,
            sending: null,
            sendTimer: 0,
            projectiles: [],
            facing: new Map(),
            flashUntil: performance.now() + 1600,
            hold: null,
            info: null,
            lastHudTick: -1,
            lastHudAt: 0,
            hudStars: -1,
            troopLayout: "",
            // Replay
            speed: 1,
            simTime: 0,
            lastPerf: performance.now(),
            next: 0,
            stop: Math.min(data.endTick ?? battle.maxTicks, battle.maxTicks),
            endArmed: 0
        };
    }

    /** Temps "visuel" en ticks (fractionnaire) : les positions sont interpolees un tick en arriere. */
    function visualTime() {
        if (!B) return 0;
        if (B.kind === "replay") return B.simTime;
        if (B.phase !== "fight") return B.battle.tick;
        return (performance.now() - B.startPerf) / TICK_MS;
    }

    /* ======================================================================
       EVENEMENTS DU MOTEUR -> effets
       ====================================================================== */

    function buildingHeight(b) {
        const c = V.cat(b.type);
        return ((c?.height || 20) + (Math.max(1, b.level) - 1) * 3);
    }

    function processEvents() {
        const battle = B.battle;
        for (const e of battle.drainEvents()) {
            switch (e.e) {
                case "deploy": {
                    const u = battle.units[e.u];
                    if (u) view.fx.dust(u.x, u.y);
                    break;
                }
                case "dead": {
                    const u = battle.units[e.u];
                    if (!u) break;
                    if (e.how === "eject") view.fx.emoji(u.x, u.y, "💨", 20, 22, 700);
                    else if (e.how !== "boom") view.fx.emoji(u.x, u.y, "💀", 18, 16, 900);
                    break;
                }
                case "boom": {
                    const color = e.kind === "orb" ? "168,85,247" : e.kind === "shell" ? "255,140,40" : "255,170,70";
                    view.fx.boom(e.x, e.y, e.r, color);
                    break;
                }
                case "destroyed": {
                    const b = battle.buildings[e.b];
                    if (!b) break;
                    if (b.kind === "wall") view.fx.dust(b.cx, b.cy);
                    else {
                        view.fx.smoke(b.cx, b.cy, Math.min(b.w, 3));
                        view.fx.boom(b.cx, b.cy, b.w * 0.7, "255,190,90");
                    }
                    break;
                }
                case "trap": {
                    const b = battle.buildings[e.b];
                    if (b) view.fx.emoji(b.cx, b.cy, "❗", 30, 18, 500);
                    break;
                }
                case "trapFire": {
                    const b = battle.buildings[e.b];
                    if (!b) break;
                    const c = b.combat || {};
                    if (c.eject) {
                        view.fx.boom(e.x, e.y, Math.max(0.8, e.r), "250,204,21");
                        view.fx.emoji(e.x, e.y, "🍌", 20, 24, 800);
                    } else {
                        view.fx.boom(e.x, e.y, Math.max(0.8, e.r), c.targets === "air" ? "244,114,182" : "255,110,40");
                        view.fx.smoke(e.x, e.y, 1);
                    }
                    break;
                }
                case "shot": {
                    const b = battle.buildings[e.b];
                    if (!b) break;
                    const w = view.isoWorld(b.cx, b.cy);
                    B.projectiles.push({
                        fromWx: w.x, fromWy: w.y - buildingHeight(b) - 6,
                        toGx: e.x, toGy: e.y, start: e.tick, end: Math.max(e.impact, e.tick + 1), kind: e.kind
                    });
                    break;
                }
                case "strike": {
                    const u = battle.units[e.u];
                    const b = battle.buildings[e.b];
                    if (u && b) view.fx.hit(clamp(u.x, b.x, b.x + b.w), clamp(u.y, b.y, b.y + b.h));
                    break;
                }
                case "heal":
                    view.fx.ring(e.x, e.y, e.r, "rgba(74,222,128,ALPHA)");
                    break;
                default:
                    break;
            }
        }
    }

    /* ======================================================================
       SCENE : AVANCEE DU TEMPS
       ====================================================================== */

    function stepOnce() {
        B.battle.step();
        processEvents();
    }

    /** Bataille en direct : rattrape l'horloge reelle. */
    function catchUp() {
        if (!B || B.kind !== "live" || B.phase !== "fight") return;
        const battle = B.battle;
        const target = Math.min(battle.maxTicks, Math.floor((performance.now() - B.startPerf) / TICK_MS));
        let guard = 0;
        while (!battle.over && battle.tick < target && guard++ < 3000) stepOnce();
    }

    function update() {
        if (!B) return;
        const now = performance.now();
        if (B.kind === "live") {
            if (B.phase === "scout" && V.serverNow() > B.data.expiresAt) {
                V.toast("⏱️ Temps de repérage écoulé : raid annulé.", "error");
                finish({ silentCancel: true });
                return;
            }
            if (B.phase === "fight") {
                if (B.hold && now >= B.hold.next) {
                    deployAt(B.hold.x, B.hold.y, true);
                    B.hold.next = now + HOLD_EVERY_MS;
                }
                catchUp();
                if (B.battle.over) finish();
            }
        } else if (B.phase === "fight") {
            // Replay : meme boucle que le serveur (runBattle), a la vitesse choisie.
            B.simTime += ((now - B.lastPerf) / TICK_MS) * B.speed;
            B.lastPerf = now;
            const battle = B.battle;
            const deps = B.data.deployments;
            const target = Math.floor(B.simTime);
            let guard = 0;
            while (!battle.over && battle.tick < B.stop && battle.tick < target && guard++ < 3000) {
                while (B.next < deps.length && deps[B.next].t <= battle.tick) {
                    const d = deps[B.next++];
                    if (d.t === battle.tick) battle.deploy(d.type, d.x, d.y);
                }
                stepOnce();
            }
            if (battle.over || battle.tick >= B.stop) {
                B.phase = "done";
                renderHud(true);
            }
        }
        const vt = visualTime() - 1;
        B.projectiles = B.projectiles.filter((p) => vt < p.end);
        // Le HUD (DOM) suit les ticks, pas les images : 10 mises a jour par seconde au plus.
        if (B.battle.tick !== B.lastHudTick || (B.phase === "scout" && now - B.lastHudAt > 250)) renderHud();
    }

    /* ======================================================================
       SCENE : DESSIN
       ====================================================================== */

    function drawUnits(list, alpha) {
        for (const u of list) {
            const t = V.troop(u.type);
            const x = u.px + (u.x - u.px) * alpha;
            const y = u.py + (u.y - u.py) * alpha;
            // Deplacement horizontal a l'ecran. Les emojis d'animaux regardent a
            // gauche : on les retourne quand ils avancent vers la droite.
            const screenDx = (u.x - u.px) - (u.y - u.py);
            if (Math.abs(screenDx) > 0.001) B.facing.set(u.id, screenDx > 0 ? -1 : 1);
            view.drawUnit(t?.emoji || "❔", x, y, u.s.space, u.flying, u.hp / u.maxHp, B.facing.get(u.id) || 1, u.attacking);
        }
    }

    /** Une troupe (point) est-elle derriere le batiment b (meme regle que le tri des batiments) ? */
    const unitBehind = (u, b) => (u.x <= b.x && u.y < b.y + b.h) || (u.y <= b.y && u.x < b.x + b.w);

    function draw() {
        if (!B) return;
        const battle = B.battle;
        const now = performance.now();
        if (isLive() && now < B.flashUntil) {
            view.drawForbidden(battle.isBlockedTile, clamp((B.flashUntil - now) / 600, 0, 1));
        }

        // Batiment touche : portee au sol (sous les batiments), nom par-dessus.
        const info = B.info && now < B.info.until ? battle.buildings[B.info.i] : null;
        if (info?.combat && info.kind === "building") {
            view.drawRange(info.cx, info.cy, info.combat.range, info.combat.minRange || 0,
                info.combat.targets === "air" ? "rgba(56,189,248,ALPHA)" : info.combat.targets === "both" ? "rgba(250,204,21,ALPHA)" : "rgba(251,146,60,ALPHA)");
        }

        let wallsChanged = false;
        for (const it of B.items) {
            const b = it.ref;
            if (it.destroyed !== b.destroyed) {
                it.destroyed = b.destroyed;
                if (b.kind === "wall") wallsChanged = true;
            }
            it.hp = b.hp;
            it.maxHp = b.kind === "building" ? b.maxHp : 0;
            it.trapState = b.trapState;
            it.inactive = b.kind === "building" && b.combat && !b.active;
        }
        // Les murs ne se relient qu'au debut et quand l'un d'eux tombe, pas a chaque image.
        if (wallsChanged) view.linkWalls(B.items);

        // Interpolation entre les deux derniers ticks
        const alpha = B.kind === "live"
            ? (B.phase === "fight" ? clamp((now - B.startPerf) / TICK_MS - battle.tick, 0, 1) : 1)
            : clamp(B.simTime - battle.tick, 0, 1);

        const ground = [];
        const air = [];
        for (const u of battle.units) if (!u.dead) (u.flying ? air : ground).push(u);
        const pending = new Set(ground);
        for (const it of B.items) {
            if (pending.size) {
                const behind = [];
                for (const u of pending) if (unitBehind(u, it.ref)) behind.push(u);
                if (behind.length) {
                    drawUnits(behind, alpha);
                    for (const u of behind) pending.delete(u);
                }
            }
            view.drawBuilding(it, { hideTraps: true, sprites: true });
        }
        drawUnits([...pending], alpha);
        drawUnits(air, alpha);

        const vt = visualTime() - 1;
        for (const p of B.projectiles) {
            p.t = (vt - p.start) / (p.end - p.start);
            view.drawProjectile(p);
        }

        if (info) {
            const c = V.cat(info.type);
            const p = view.iso(info.cx, info.cy);
            view.outlinedText(`${c?.name || info.type} · niv. ${info.level}`, p.x, p.y - (buildingHeight(info) + 58) * view.cam.zoom, 15, "#fff", 800);
        }

        if (B.hold) {
            // Cercle sous le doigt pendant le deploiement continu
            const ctx = view.ctx;
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(B.hold.x, B.hold.y, 22, 11, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    /* ======================================================================
       SCENE : GESTES (toucher ou maintenir pour deployer)
       ====================================================================== */

    function flashForbidden() {
        B.flashUntil = performance.now() + 1000;
        view.requestDraw();
    }

    function selectTroop(type) {
        if (!B || !(B.battle.remaining[type] > 0)) return;
        B.selected = type;
        renderTroopBar();
    }

    function selectNextTroop() {
        const order = troopOrder(Object.keys(B.battle.remaining));
        B.selected = order.find((t) => B.battle.remaining[t] > 0) || null;
        renderTroopBar();
    }

    function startFight() {
        B.phase = "fight";
        B.startPerf = performance.now();
        B.flashUntil = 0;
        ui.btHint.classList.add("hidden");
        track("village_battle_start");
        renderHud(true);
    }

    /** Deploie la troupe choisie sous le point (sx, sy) de l'ecran. */
    function deployAt(sx, sy, fromHold = false) {
        if (!isLive() || (B.phase !== "scout" && B.phase !== "fight")) return false;
        const battle = B.battle;
        const type = B.selected;
        if (!type || !(battle.remaining[type] > 0)) {
            if (!fromHold) {
                selectNextTroop();
                if (!B.selected) V.toast("Toutes tes troupes sont sur le champ de bataille !");
            }
            return false;
        }
        const cell = view.gridAt(sx, sy);
        const x = round2(cell.x);
        const y = round2(cell.y);
        if (!battle.canDeploy(x, y)) {
            if (!fromHold) flashForbidden();
            return false;
        }
        if (B.phase === "scout") startFight();
        catchUp();
        if (battle.over) return false;
        if (!battle.deploy(type, x, y)) return false;
        processEvents();
        if (!(battle.remaining[type] > 0)) selectNextTroop();
        else renderTroopBar();
        scheduleSend();
        return true;
    }

    function hitBuilding(x, y) {
        const it = view.hitItem(B.items, x, y, (item) => !item.destroyed && item.ref.kind !== "trap");
        return it ? it.ref : null;
    }

    const battleScene = {
        mapSize: () => B?.battle.size ?? 24,
        margin: () => B?.battle.margin ?? 2,
        animating: () => "fast",
        update,
        draw,
        tap(x, y) {
            if (!B) return;
            if (!isLive()) return;
            const cell = view.gridAt(x, y);
            if (B.battle.canDeploy(round2(cell.x), round2(cell.y))) {
                deployAt(x, y);
                return;
            }
            const b = hitBuilding(x, y);
            if (b && b.kind !== "deco") {
                B.info = { i: b.i, until: performance.now() + 2200 };
                return;
            }
            flashForbidden();
        },
        longPressDelay(x, y) {
            if (!isLive() || (B.phase !== "scout" && B.phase !== "fight")) return 0;
            const cell = view.gridAt(x, y);
            return B.battle.canDeploy(round2(cell.x), round2(cell.y)) ? HOLD_DELAY_MS : 0;
        },
        longPress(x, y) {
            if (!isLive()) return null;
            if (!deployAt(x, y)) return null;
            B.hold = { x, y, next: performance.now() + HOLD_EVERY_MS };
            return "hold";
        },
        holdMove(x, y) {
            if (B?.hold) {
                B.hold.x = x;
                B.hold.y = y;
            }
        },
        holdEnd() {
            if (B) B.hold = null;
        }
    };

    /* ======================================================================
       ENVOI DES DEPLOIEMENTS
       ====================================================================== */

    function scheduleSend() {
        if (!B || B.sendTimer) return;
        B.sendTimer = setTimeout(() => {
            if (!B) return;
            B.sendTimer = 0;
            flushDeployments();
        }, SEND_EVERY_MS);
    }

    /** Envoie les deploiements pas encore transmis (un envoi a la fois). */
    function flushDeployments() {
        const state = B;
        if (!state || state.kind !== "live" || state.sending) return state?.sending || Promise.resolve();
        const upto = state.battle.deployments.length;
        if (upto <= state.sent) return Promise.resolve();
        const batch = state.battle.deployments.slice(state.sent, upto);
        state.sending = V.api("POST", `/village/battles/${encodeURIComponent(state.data.id)}/deploy`, { deployments: batch })
            .then((res) => {
                if (res?.success) {
                    state.sent = upto;
                    if (res.deploy?.over && state === B && state.phase === "fight") finish();
                }
            })
            .finally(() => {
                state.sending = null;
                if (state === B && state.phase === "fight" && state.battle.deployments.length > state.sent) scheduleSend();
            });
        return state.sending;
    }

    /* ======================================================================
       FIN DE BATAILLE ET RESULTAT
       ====================================================================== */

    /**
     * Termine la bataille en direct : le serveur rejoue le combat jusqu'au
     * meme tick et renvoie le resultat officiel. Sans deploiement, le raid est
     * simplement annule.
     */
    async function finish({ silentCancel = false } = {}) {
        const state = B;
        if (!state || state.kind !== "live" || state.phase === "ending" || state.phase === "done") return;
        const fought = state.phase === "fight";
        state.phase = "ending";
        state.hold = null;
        clearTimeout(state.sendTimer);
        state.sendTimer = 0;
        if (fought && !state.battle.over) state.battle.finish();
        renderHud(true);

        if (state.sending) await state.sending.catch(() => undefined);
        const extra = state.battle.deployments.slice(state.sent);
        const body = { endTick: state.battle.tick, deployments: extra };
        let res = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            res = await V.api("POST", `/village/battles/${encodeURIComponent(state.data.id)}/end`, body);
            if (res?.success || !res?.network) break;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
        if (state !== B) return;
        state.phase = "done";
        renderHud(true);

        if (!res?.success) {
            V.toast(res?.message || "Le serveur n'a pas pu clôturer la bataille. Le résultat apparaîtra dans ton journal.", "error");
            leave();
            return;
        }
        const result = res.result;
        if (result.status === "cancelled") {
            if (!silentCancel) V.toast("Raid annulé : aucune troupe n'a été déployée.");
            leave();
            return;
        }
        track(result.stars > 0 ? "village_battle_win" : "village_battle_loss");
        V.openSheet({ kind: "result", result, local: state.battle.result(), opponent: state.data.opponent, mode: state.data.mode });
    }

    function resultHtml(sheet) {
        const r = sheet.result;
        const rw = r.rewards || {};
        const rows = [];
        rows.push(["Destruction", `${r.destruction} %`]);
        if (r.loot > 0) rows.push(["Butin pillé", `🪙 ${fmt(r.loot)}`]);
        if (rw.bonus) rows.push(["Bonus de victoire", `🪙 ${fmt(rw.bonus)}`]);
        if (rw.campaign) rows.push(["Récompense de campagne", `🪙 ${fmt(rw.campaign.gold)} (+${rw.campaign.newStars} ★)`]);
        if (sheet.mode === "ranked" || sheet.mode === "revenge") {
            rows.push(["Trophées", `${r.trophies >= 0 ? "+" : ""}${r.trophies} 🏆`]);
        }
        if (rw.xp) rows.push(["Passe de combat", `+${rw.xp} XP`]);
        const used = Object.entries(rw.used || {}).map(([type, n]) => `${V.troop(type)?.emoji || ""}×${n}`).join(" ");
        const extras = [];
        if (rw.chest) extras.push(`<div class="v-reward">🎁 Coffre du jour : <b>${esc(rw.chest)}</b></div>`);
        if (rw.campaign?.chest) extras.push(`<div class="v-reward">🎁 Campagne terminée : <b>${esc(rw.campaign.chest)}</b></div>`);
        const note = sheet.mode === "friendly"
            ? "Défi amical : aucun butin, aucun trophée, et tes troupes te sont rendues."
            : sheet.mode === "bot" && r.loot === 0
                ? "Les Briganti n'ont plus d'or pour aujourd'hui : reviens demain pour piller leur butin."
                : "";
        return `<div class="v-result ${r.stars > 0 ? "is-win" : "is-loss"}">
                <div class="v-result-stars">${[0, 1, 2].map((i) => `<span class="${i < r.stars ? "is-on" : ""}" style="animation-delay:${0.15 + i * 0.22}s">★</span>`).join("")}</div>
                <p class="v-result-opponent">contre ${esc(sheet.opponent?.name || r.opponent)}</p>
            </div>
            <div class="v-rows">${rows.map(([l, v]) => `<div class="v-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("")}</div>
            ${extras.join("")}
            ${used ? `<p class="v-dim v-small">Troupes utilisées : ${used}</p>` : ""}
            ${note ? `<div class="v-note">${esc(note)}</div>` : ""}
            <div class="v-cta-row">
                <button class="v-btn" type="button" data-act="replay" data-id="${esc(r.id)}">▶️ Revoir</button>
                <button class="v-btn v-btn-confirm" type="button" data-act="close">🏰 Retour au village</button>
            </div>`;
    }

    V.sheets.result = {
        title: (sheet) => (sheet.result.stars > 0 ? "🏆 Victoire !" : "💥 Défaite…"),
        html: resultHtml,
        onClose(sheet) {
            // "Revoir" enchaine sur le replay : on ne repasse pas par le village.
            if (!sheet.toReplay) leave();
        }
    };

    /* ======================================================================
       ENTREE / SORTIE DE LA SCENE DE BATAILLE
       ====================================================================== */

    function enter(state) {
        B = state;
        S.scene = "battle";
        S.selectedId = null;
        S.mode = "view";
        S.ghost = null;
        V.closeSheet();
        ui.top.classList.add("hidden");
        ui.bottom.classList.add("hidden");
        ui.selbar.classList.add("hidden");
        ui.placebar.classList.add("hidden");
        ui.battle.classList.remove("hidden");
        ui.battle.dataset.kind = state.kind;
        ui.btHint.classList.toggle("hidden", state.kind !== "live");
        view.fx.clear();
        view.setScene(battleScene);
        view.centerCamera();
        renderTroopBar();
        renderHud(true);
    }

    function leave() {
        if (B) {
            clearTimeout(B.sendTimer);
            // Reperage abandonne sans passer par la fin : on libere tout de suite le village cible.
            if (B.kind === "live" && B.phase === "scout") {
                V.api("POST", `/village/battles/${encodeURIComponent(B.data.id)}/end`, {});
            }
            B = null;
        }
        view.fx.clear();
        V.home.enter();
        V.refresh();
    }

    /* ======================================================================
       HUD DE BATAILLE
       ====================================================================== */

    /** N'ecrit dans le DOM que ce qui change : pas de mise en page inutile 10 fois par seconde. */
    function setText(el, text) {
        if (el.textContent !== text) el.textContent = text;
    }

    function renderTroopBar() {
        if (!B) return;
        const battle = B.battle;
        const types = troopOrder(Object.keys(battle.remaining));
        const live = isLive() && (B.phase === "scout" || B.phase === "fight");
        const layout = types.join(",");
        if (B.troopLayout !== layout) {
            B.troopLayout = layout;
            ui.btTroops.innerHTML = types.map((type) => {
                const t = V.troop(type);
                const level = B.data.scenario.troops[type]?.level || 1;
                return `<button class="v-bt-troop" type="button" data-type="${type}">
                    <span class="v-bt-troop-emoji" aria-hidden="true">${t?.emoji || "❔"}</span>
                    <b></b><small>niv. ${level}</small>
                </button>`;
            }).join("");
        }
        // Chaque troupe posee ne touche que son compteur, sans reconstruire la barre.
        for (const btn of ui.btTroops.children) {
            const type = btn.dataset.type;
            const left = battle.remaining[type];
            const off = !live || left <= 0;
            btn.classList.toggle("is-selected", type === B.selected && live);
            btn.classList.toggle("is-empty", left <= 0);
            if (btn.disabled !== off) btn.disabled = off;
            setText(btn.querySelector("b"), `×${left}`);
        }
    }

    function renderHud(full = false) {
        if (!B) return;
        const battle = B.battle;
        const data = B.data;
        B.lastHudTick = battle.tick;
        B.lastHudAt = performance.now();
        const res = battle.result();

        if (full) {
            if (B.kind === "live") {
                const o = data.opponent;
                const icon = o.league?.emoji || { campaign: "🗺️", bot: "👹", friendly: "🤝" }[data.mode] || "";
                ui.btName.textContent = `${icon} ${o.name}`.trim();
                const sub = [`Palazzo ${o.th}`];
                if (o.trophies !== null && o.trophies !== undefined) sub.push(`🏆 ${o.trophies}`);
                ui.btSub.textContent = sub.join(" · ");
                let stakes = "";
                if (data.trophies) stakes = `🏆 +${data.trophies.win} / −${data.trophies.loss}`;
                else if (data.mode === "bot") stakes = data.botLoot ? "Briganti · sans trophées" : "Briganti fatigués : plus de butin aujourd'hui";
                else if (data.mode === "campaign") stakes = `Campagne · ${data.campaign.stars}/3 ★ déjà gagnées`;
                else if (data.mode === "friendly") stakes = "Défi amical · sans enjeu";
                ui.btStakes.textContent = stakes;
            } else {
                ui.btName.textContent = `▶️ ${data.attacker} ⚔️ ${data.defender}`;
                ui.btSub.textContent = data.role === "defense" ? "Replay de ta défense" : "Replay de ton attaque";
                ui.btStakes.textContent = "";
            }
            const scouting = B.kind === "live" && B.phase === "scout";
            ui.btNext.classList.toggle("hidden", !(scouting && data.nextCost !== null && data.nextCost !== undefined));
            if (data.nextCost !== null && data.nextCost !== undefined) ui.btNext.innerHTML = `Suivant <small>🪙 ${fmt(data.nextCost)}</small>`;
            ui.btSpeed.classList.toggle("hidden", B.kind !== "replay");
            ui.btSpeed.textContent = `⏩ x${B.speed}`;
            B.endArmed = 0;
            ui.btEnd.classList.remove("is-armed");
            ui.btEnd.disabled = B.phase === "ending";
            ui.btEnd.textContent = B.kind === "replay"
                ? (B.phase === "done" ? "🏰 Quitter" : "✕ Quitter")
                : scouting ? "✕ Quitter" : B.phase === "ending" ? "Calcul du résultat…" : "🏳️ Terminer";
            ui.battle.classList.toggle("is-over", B.phase === "done" || B.phase === "ending");
            renderTroopBar();
        }

        // Butin : total pille en direct (campagne : recompense d'etoiles).
        const lootLeft = Math.max(0, battle.lootAvailable - res.loot);
        if (B.kind === "live" && data.mode === "campaign") {
            const per = data.campaign.reward / 3;
            setText(ui.btLoot, `⭐ 🪙 ${fmt(per)} par nouvelle étoile`);
        } else if (battle.lootAvailable > 0) {
            setText(ui.btLoot, `🪙 ${fmt(lootLeft)} à piller`);
        } else {
            setText(ui.btLoot, B.kind === "live" && (data.mode === "ranked" || data.mode === "revenge") ? "Mines vides : rien à piller" : "");
        }
        setText(ui.btLooted, res.loot > 0 ? `+🪙 ${fmt(res.loot)}` : "");
        ui.btLooted.classList.toggle("hidden", res.loot <= 0);

        if (B.hudStars !== res.stars) {
            B.hudStars = res.stars;
            ui.btStars.innerHTML = [0, 1, 2].map((i) => `<span class="${i < res.stars ? "is-on" : ""}">★</span>`).join("");
        }
        setText(ui.btPct, `${res.destruction} %`);

        if (B.kind === "live" && B.phase === "scout") {
            setText(ui.btTimerLabel, "Repérage");
            setText(ui.btTimer, fmtClock((data.expiresAt - V.serverNow()) / 1000));
        } else {
            setText(ui.btTimerLabel, B.phase === "done" || B.phase === "ending" ? "Terminé" : "Combat");
            setText(ui.btTimer, fmtClock((battle.maxTicks - battle.tick) / 10));
        }
    }

    ui.btTroops.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-type]");
        if (btn && !btn.disabled) selectTroop(btn.dataset.type);
    });

    ui.btEnd.addEventListener("click", () => {
        if (!B) return;
        if (B.kind === "replay") {
            leave();
            return;
        }
        if (B.phase === "scout") {
            finish({ silentCancel: true });
            return;
        }
        if (B.phase !== "fight") return;
        // Double confirmation : un "Terminer" touche par erreur coute la bataille.
        if (!B.endArmed || performance.now() - B.endArmed > 3000) {
            B.endArmed = performance.now();
            ui.btEnd.textContent = "Confirmer ?";
            ui.btEnd.classList.add("is-armed");
            setTimeout(() => {
                if (B && B.phase === "fight" && B.endArmed && performance.now() - B.endArmed >= 3000) renderHud(true);
            }, 3100);
            return;
        }
        finish();
    });

    ui.btNext.addEventListener("click", () => {
        if (!isLive() || B.phase !== "scout") return;
        launch("/village/war/search", {}, "🔎 Recherche d'un autre adversaire…");
    });

    ui.btSpeed.addEventListener("click", () => {
        if (!B || B.kind !== "replay") return;
        B.speed = B.speed >= 4 ? 1 : B.speed * 2;
        ui.btSpeed.textContent = `⏩ x${B.speed}`;
    });

    /* ======================================================================
       LANCER UNE BATAILLE / UN REPLAY
       ====================================================================== */

    let launching = false;

    function showBusy(text) {
        V.loader.show(text, true);
    }

    function hideBusy() {
        V.loader.hide();
    }

    async function launch(path, body, text) {
        if (launching) return;
        launching = true;
        showBusy(text);
        try {
            let sim;
            try {
                sim = await loadSim();
            } catch {
                V.toast("Impossible de charger le moteur de combat. Vérifie ta connexion.", "error");
                return;
            }
            const res = await V.api("POST", path, body);
            if (res?.village) V.applyState(res.village);
            if (!res?.success) {
                V.toast(res?.message || "Impossible de lancer l'attaque.", "error");
                if (B) leave();
                return;
            }
            enter(createState("live", res.battle, sim));
        } finally {
            launching = false;
            hideBusy();
        }
    }

    async function openReplay(id) {
        if (launching) return;
        launching = true;
        showBusy("🎬 Chargement du replay…");
        try {
            let sim;
            try {
                sim = await loadSim();
            } catch {
                V.toast("Impossible de charger le moteur de combat.", "error");
                return;
            }
            const res = await V.api("GET", `/village/battles/${encodeURIComponent(id)}/replay`);
            if (!res?.success) {
                V.toast(res?.message || "Replay indisponible.", "error");
                return;
            }
            enter(createState("replay", res.replay, sim));
        } finally {
            launching = false;
            hideBusy();
        }
    }

    V.acts.replay = (el, sheet) => {
        if (sheet?.kind === "result") sheet.toReplay = true;
        if (B) {
            clearTimeout(B.sendTimer);
            B = null;
        }
        openReplay(el.dataset.id);
    };
    V.acts.revenge = (el) => launch("/village/war/revenge", { battleId: el.dataset.id }, "😡 Préparation de la vengeance…");

    /* ======================================================================
       MENU DE GUERRE
       ====================================================================== */

    const WAR_TABS = [
        { key: "attack", label: "⚔️ Attaquer" },
        { key: "campaign", label: "🗺️ Campagne" },
        { key: "log", label: "📜 Journal" },
        { key: "ranking", label: "🏆 Classement" },
        { key: "friends", label: "👥 Amis" }
    ];

    function attackTab() {
        const d = S.data;
        const war = d.war;
        const army = d.army;
        const parts = [];
        const next = war.nextLeague;
        const progress = next ? clamp((war.trophies - war.league.min) / (next.min - war.league.min), 0, 1) : 1;
        parts.push(`<div class="v-league-card">
            <span class="v-league-emoji" aria-hidden="true">${war.league.emoji}</span>
            <div class="v-league-info">
                <b>Ligue ${esc(war.league.name)}</b>
                <span>🏆 ${war.trophies} trophées</span>
                <div class="v-meter is-gold"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>
                <small>${next ? `Prochaine : ${next.emoji} ${esc(next.name)} à ${next.min}` : "Ligue la plus haute atteinte !"}</small>
            </div>
        </div>`);

        if (war.shieldUntil && war.shieldUntil > V.serverNow()) {
            parts.push(`<div class="v-note">🛡️ Bouclier actif encore ${fmtDur((war.shieldUntil - V.serverNow()) / 1000)}. Attaquer un joueur le retire (les Briganti et la campagne, non).</div>`);
        }
        if (war.underAttack) parts.push(`<div class="v-warning">🚨 Ton village est attaqué en ce moment !</div>`);

        const ready = d.troops.filter((t) => army.troops[t.type] > 0);
        parts.push(`<div class="v-army-summary">
            <div class="v-army-line"><b>⛺ Armée ${army.used}/${army.capacity}</b>
            ${army.queue.length ? `<small>⏱ +${army.queued} places en entraînement (${fmtDur((army.endsAt - V.serverNow()) / 1000)})</small>` : ""}</div>
            ${ready.length ? `<div class="v-chips">${ready.map((t) => `<span class="v-chip"><span aria-hidden="true">${t.emoji}</span>×${army.troops[t.type]}</span>`).join("")}</div>` : '<p class="v-empty">Aucune troupe prête.</p>'}
            <button class="v-btn v-btn-army" type="button" data-act="open-army">⚔️ Gérer l'armée</button>
        </div>`);

        const leagueChest = war.league.chest;
        parts.push(`<div class="v-daily">
            <div><span>🏅 Victoires du jour</span><b>${war.daily.wins}/${war.daily.winsMax}</b><small>bonus d'or + XP</small></div>
            <div><span>🎁 Coffre du jour</span><b>${war.daily.chest ? "✅" : "🔒"}</b><small>${war.daily.chest ? "déjà gagné" : esc(leagueChest)}</small></div>
            <div><span>👹 Briganti</span><b>${war.daily.botRaids}/${war.daily.botRaidsMax}</b><small>raids avec butin</small></div>
        </div>`);

        const noArmy = army.used <= 0;
        parts.push(`<button class="v-btn v-btn-attack v-sheet-cta" type="button" data-act="search"${noArmy || S.pending > 0 ? " disabled" : ""}>
            🔎 Chercher un adversaire · 🪙 ${fmt(war.searchCost)}</button>`);
        parts.push(`<p class="v-dim v-small">${noArmy
            ? "Entraîne d'abord des troupes à la Caserma."
            : `Tu pilles l'or non récolté des mines adverses (jamais l'or principal) : jusqu'à 🪙 ${fmt(war.lootCap)} par raid. Personne de disponible ? Tu tomberas sur les Briganti.`}</p>`);
        if (!war.attackable) {
            parts.push(`<p class="v-dim v-small">🌱 Ton village est encore protégé : il ne peut pas être attaqué avant le Palazzo niveau ${war.minTh}.</p>`);
        }
        return parts.join("");
    }

    function campaignTab() {
        const d = S.data;
        const noArmy = d.army.used <= 0;
        const list = d.war.campaign.map((lvl) => {
            const left = Math.round((lvl.reward * (3 - lvl.stars)) / 3);
            const reward = lvl.stars >= 3 ? "✅ terminé" : `🪙 ${fmt(left)}${lvl.chest && lvl.stars < 3 ? ` · 📦 ${esc(lvl.chest)}` : ""}`;
            return `<button class="v-camp${lvl.unlocked ? "" : " is-locked"}" type="button" data-act="campaign" data-level="${lvl.id}"${!lvl.unlocked || noArmy ? " disabled" : ""}>
                <span class="v-camp-emoji" aria-hidden="true">${lvl.unlocked ? lvl.emoji : "🔒"}</span>
                <span class="v-camp-info"><b>${lvl.id}. ${esc(lvl.name)}</b><small>Palazzo ${lvl.th} · ${reward}</small></span>
                ${stars(lvl.stars)}
            </button>`;
        }).join("");
        return `<p class="v-shop-meta">Les villages des Briganti, du plus facile au plus coriace. Chaque nouvelle étoile rapporte un tiers de la récompense, une seule fois. Une étoile débloque le niveau suivant.${noArmy ? " Entraîne d'abord des troupes !" : ""}</p>
            <div class="v-camp-list">${list}</div>`;
    }

    function logRow(e) {
        const defense = e.role === "defense";
        const who = e.mode === "campaign" ? `🗺️ ${esc(e.opponent)}` : e.mode === "bot" ? `👹 ${esc(e.opponent)}` : e.mode === "friendly" ? `🤝 ${esc(e.opponent)}` : esc(e.opponent);
        const gold = e.gold > 0 ? `${defense ? "−" : "+"}🪙 ${fmt(e.gold)}` : "";
        const bonus = !defense && e.bonus > 0 ? ` +🪙 ${fmt(e.bonus)}` : "";
        const trophies = e.trophies ? ` ${e.trophies > 0 ? "+" : ""}${e.trophies} 🏆` : "";
        const good = defense ? e.stars === 0 : e.stars > 0;
        return `<div class="v-log-item">
            <div class="v-log-main">
                <b>${who}</b>
                <small>${fmtAgo(e.at)} · ${e.destruction} %</small>
            </div>
            ${stars(e.stars)}
            <div class="v-log-gain ${good ? "is-good" : "is-bad"}">${gold}${bonus}${trophies}</div>
            <div class="v-log-actions">
                <button class="v-btn v-btn-small" type="button" data-act="replay" data-id="${esc(e.id)}" aria-label="Revoir">▶️</button>
                ${e.canRevenge ? `<button class="v-btn v-btn-small v-btn-attack" type="button" data-act="revenge" data-id="${esc(e.id)}">😡 Vengeance</button>` : ""}
            </div>
        </div>`;
    }

    function logTab(sheet) {
        if (!sheet.log) return '<p class="v-empty">Chargement du journal…</p>';
        if (sheet.log.error) return `<p class="v-empty">${esc(sheet.log.error)}</p>`;
        const defenses = sheet.log.items.filter((e) => e.role === "defense");
        const attacks = sheet.log.items.filter((e) => e.role === "attack");
        return `<p class="v-section-title">🛡️ Défenses</p>
            ${defenses.length ? defenses.map(logRow).join("") : '<p class="v-empty">Personne ne t\'a attaqué récemment.</p>'}
            <p class="v-section-title">⚔️ Attaques</p>
            ${attacks.length ? attacks.map(logRow).join("") : '<p class="v-empty">Tu n\'as encore attaqué personne.</p>'}
            <p class="v-dim v-small">Vengeance possible pendant ${S.data.war.revengeHours} h. Historique conservé 14 jours.</p>`;
    }

    function rankingTab(sheet) {
        if (!sheet.ranking) return '<p class="v-empty">Chargement du classement…</p>';
        if (sheet.ranking.error) return `<p class="v-empty">${esc(sheet.ranking.error)}</p>`;
        const { top, me } = sheet.ranking.data;
        const rows = top.map((r) => `<div class="v-rank${r.me ? " is-me" : ""}">
            <span class="v-rank-pos">${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</span>
            <span class="v-rank-name">${r.league.emoji} ${esc(r.pseudo)}<small>Palazzo ${r.th}</small></span>
            <b>🏆 ${r.trophies}</b>
        </div>`).join("");
        return `${rows || '<p class="v-empty">Personne n\'a encore gagné de trophée. À toi de jouer !</p>'}
            ${me ? `<div class="v-rank is-me is-footer"><span class="v-rank-pos">#${me.rank}</span><span class="v-rank-name">${me.league.emoji} Toi</span><b>🏆 ${me.trophies}</b></div>` : ""}`;
    }

    function friendsTab(sheet) {
        if (!sheet.friends) return '<p class="v-empty">Chargement de tes amis…</p>';
        if (sheet.friends.error) return `<p class="v-empty">${esc(sheet.friends.error)}</p>`;
        const list = sheet.friends.items;
        if (!list.length) {
            return `<p class="v-empty">Ajoute des amis depuis ton profil pour pouvoir les défier !</p>`;
        }
        const noArmy = S.data.army.used <= 0;
        return `<p class="v-shop-meta">Défi amical : attaque le village d'un ami pour t'entraîner. Aucun butin, aucun trophée, et tes troupes te sont rendues.</p>
            ${list.map((f) => `<div class="v-rank">
                <span class="v-rank-pos">${f.league?.emoji || "🌱"}</span>
                <span class="v-rank-name">${esc(f.pseudo)}<small>${f.hasVillage ? `Palazzo ${f.th} · 🏆 ${f.trophies}` : "pas encore de Villaggio"}</small></span>
                <button class="v-btn v-btn-small v-btn-army" type="button" data-act="friendly" data-id="${esc(f.id)}"${!f.hasVillage || noArmy ? " disabled" : ""}>🤝 Défier</button>
            </div>`).join("")}`;
    }

    /** Charge (une fois par ouverture) les donnees d'un onglet du menu. */
    async function loadTab(sheet, key, path, pick) {
        if (sheet[key]) return;
        sheet[key] = null;
        const res = await V.api("GET", path);
        if (S.sheet !== sheet) return;
        sheet[key] = res?.success ? pick(res) : { error: res?.message || "Chargement impossible." };
        V.rerenderSheet();
    }

    function warHtml(sheet) {
        const tab = sheet.tab || "attack";
        let body = "";
        if (tab === "attack") body = attackTab();
        else if (tab === "campaign") body = campaignTab();
        else if (tab === "log") {
            loadTab(sheet, "log", "/village/war/log", (res) => ({ items: res.log }));
            body = logTab(sheet);
        } else if (tab === "ranking") {
            loadTab(sheet, "ranking", "/village/war/leaderboard", (res) => ({ data: res.leaderboard }));
            body = rankingTab(sheet);
        } else if (tab === "friends") {
            loadTab(sheet, "friends", "/village/war/friends", (res) => ({ items: res.friends }));
            body = friendsTab(sheet);
        }
        return `<div class="v-tabs is-scroll" role="tablist">${WAR_TABS.map((t) =>
            `<button class="v-tab${t.key === tab ? " is-active" : ""}" type="button" data-act="war-tab" data-tab="${t.key}">${t.label}</button>`
        ).join("")}</div>${body}`;
    }

    V.sheets.war = {
        title: () => "🗡️ Guerre",
        html: warHtml,
        onAct(act, el, sheet) {
            if (act === "war-tab") {
                sheet.tab = el.dataset.tab;
                V.renderSheet();
                ui.sheetBody.scrollTop = 0;
            } else if (act === "search") {
                launch("/village/war/search", {}, "🔎 Recherche d'un adversaire…");
            } else if (act === "campaign") {
                launch("/village/war/campaign", { level: Number(el.dataset.level) }, "🗺️ En route vers les Briganti…");
            } else if (act === "friendly") {
                launch("/village/war/friendly", { friendId: el.dataset.id }, "🤝 Préparation du défi amical…");
            }
        }
    };

    /* ======================================================================
       RAPPORT DE DEFENSE (au retour dans le village)
       ====================================================================== */

    function defensesHtml() {
        const report = S.data.war.defenseReport || [];
        if (!report.length) return null;
        const lost = report.reduce((sum, e) => sum + e.gold, 0);
        const trophies = report.reduce((sum, e) => sum + e.trophies, 0);
        const won = report.filter((e) => e.stars === 0).length;
        return `<div class="v-defense-summary">
                <div><b>${report.length}</b><small>attaque${report.length > 1 ? "s" : ""}</small></div>
                <div><b>${won}</b><small>repoussée${won > 1 ? "s" : ""}</small></div>
                <div><b class="${lost > 0 ? "is-bad" : ""}">🪙 ${fmt(lost)}</b><small>or perdu</small></div>
                <div><b class="${trophies >= 0 ? "is-good" : "is-bad"}">${trophies >= 0 ? "+" : ""}${trophies}</b><small>trophées</small></div>
            </div>
            ${report.map(logRow).join("")}
            <p class="v-dim v-small">Seul l'or non récolté de tes mines peut être pillé. Récolte souvent, construis une Cassaforte et renforce tes défenses !</p>
            <button class="v-btn v-btn-confirm v-sheet-cta" type="button" data-act="close">OK, compris</button>`;
    }

    V.sheets.defenses = {
        title: () => "🛡️ Pendant ton absence…",
        html: defensesHtml,
        onClose() {
            V.api("POST", "/village/war/seen").then(() => V.refresh());
        }
    };

    function maybeShowDefenseReport() {
        if (!S.data?.war?.unseenDefenses) return false;
        V.openSheet({ kind: "defenses" });
        return true;
    }

    ui.attackBtn.addEventListener("click", () => {
        if (S.data?.war?.unseenDefenses) V.openSheet({ kind: "defenses" });
        else V.openSheet({ kind: "war", tab: "attack" });
    });
    V.acts["open-war"] = (el) => V.openSheet({ kind: "war", tab: el.dataset.tab || "attack" });

    V.war = {
        get active() {
            return B !== null;
        },
        maybeShowDefenseReport,
        openReplay,
        /** Onglet cache puis revenu : la bataille en direct rattrape l'horloge toute seule. */
        onVisible() {
            if (B) view.requestDraw();
        }
    };
})();
