/* ==========================================================================
   Villaggio : visiter l'ile des autres joueurs.

   Un panneau de recherche (tes amis epingles en haut, puis tous les joueurs)
   et une scene en lecture seule : on se promene sur l'ile, on touche un
   batiment pour voir son nom et son niveau, et on peut defier un ami qui
   n'est pas sous bouclier. Les pieges ne sont jamais envoyes par le serveur.

   Leger pour le serveur : la recherche attend une pause dans la frappe, et
   chaque resultat (amis compris) est garde une minute.
   ========================================================================== */
(() => {
    "use strict";

    const V = window.Villaggio;
    const { ui, S, view } = V;
    const { fmtDur, esc } = V.util;

    const SEARCH_DELAY_MS = 300;
    const CACHE_MS = 60_000;
    const MIN_QUERY = 2;

    /* ======================================================================
       PANNEAU : RECHERCHE DE JOUEURS
       ====================================================================== */

    const cache = new Map(); // "friends" ou "q:<texte>" -> { at, items }
    let searchTimer = 0;

    /** Pour comparer les pseudos sans se soucier des majuscules ni des accents. */
    const fold = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    async function load(key, path, pick, maxAge = CACHE_MS) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < maxAge) return hit.items;
        const res = await V.api("GET", path);
        if (!res?.success) throw new Error(res?.message || "Chargement impossible.");
        const items = pick(res);
        cache.set(key, { at: Date.now(), items });
        return items;
    }

    function playerRow(p, friend) {
        const now = V.serverNow();
        const shielded = p.shieldUntil && p.shieldUntil > now;
        if (friend && !p.hasVillage) {
            return `<div class="v-rank v-player is-off">
                <span class="v-rank-pos">🌱</span>
                <span class="v-rank-name">${esc(p.pseudo)}<small>pas encore d'île</small></span>
            </div>`;
        }
        return `<button class="v-rank v-player" type="button" data-act="visit" data-id="${esc(p.id)}">
            <span class="v-rank-pos">${p.league?.emoji || "🌱"}</span>
            <span class="v-rank-name">${esc(p.pseudo)}<small>Palazzo ${p.th} · 🏆 ${p.trophies}${shielded ? ` · 🛡️ ${fmtDur((p.shieldUntil - now) / 1000)}` : ""}</small></span>
            <span class="v-player-go" aria-hidden="true">Visiter ›</span>
        </button>`;
    }

    function listHtml(sheet) {
        const q = fold(sheet.q.trim());
        const parts = [];

        // Amis : toujours en haut, filtres sur place (aucune requete de plus).
        if (sheet.friendsError) {
            parts.push(`<p class="v-empty">${esc(sheet.friendsError)}</p>`);
        } else if (!sheet.friends) {
            parts.push('<p class="v-empty">Chargement de tes amis…</p>');
        } else {
            const friends = sheet.friends.filter((f) => !q || fold(f.pseudo).includes(q));
            if (friends.length) {
                parts.push(`<p class="v-section-title">⭐ Tes amis</p>${friends.map((f) => playerRow(f, true)).join("")}`);
            }
        }

        const friendIds = new Set((sheet.friends || []).map((f) => f.id));
        parts.push(`<p class="v-section-title">${q ? "🔍 Résultats" : "🌍 Tous les joueurs"}</p>`);
        if (q && q.length < MIN_QUERY) {
            parts.push(`<p class="v-empty">Tape au moins ${MIN_QUERY} lettres.</p>`);
        } else if (sheet.playersError) {
            parts.push(`<p class="v-empty">${esc(sheet.playersError)}</p>`);
        } else if (!sheet.players) {
            parts.push('<p class="v-empty">Recherche…</p>');
        } else {
            const others = sheet.players.filter((p) => !friendIds.has(p.id));
            parts.push(others.length
                ? others.map((p) => playerRow(p, false)).join("")
                : `<p class="v-empty">${q ? "Aucun joueur trouvé." : "Personne d'autre n'a encore d'île."}</p>`);
        }
        return parts.join("");
    }

    /** Met a jour la liste seule : le champ de recherche garde le focus et le clavier reste ouvert. */
    function renderList(sheet) {
        if (S.sheet !== sheet) return;
        const list = document.getElementById("v-visit-list");
        if (list) list.innerHTML = listHtml(sheet);
    }

    async function searchPlayers(sheet) {
        const q = sheet.q.trim();
        if (q && q.length < MIN_QUERY) {
            renderList(sheet);
            return;
        }
        sheet.players = null;
        sheet.playersError = "";
        renderList(sheet);
        try {
            const items = await load(`q:${fold(q)}`, `/village/players${q ? `?q=${encodeURIComponent(q)}` : ""}`, (res) => res.players);
            // Une reponse arrivee apres une nouvelle frappe est ignoree.
            if (sheet.q.trim() !== q) return;
            sheet.players = items;
        } catch (error) {
            if (sheet.q.trim() !== q) return;
            sheet.playersError = error.message;
        }
        renderList(sheet);
    }

    async function loadFriends(sheet) {
        try {
            sheet.friends = await load("friends", "/village/war/friends", (res) => res.friends);
        } catch (error) {
            sheet.friendsError = error.message;
        }
        renderList(sheet);
    }

    function openList() {
        const sheet = { kind: "visit", q: "", friends: null, friendsError: "", players: null, playersError: "" };
        V.openSheet(sheet);
        loadFriends(sheet);
        searchPlayers(sheet);
    }

    V.sheets.visit = {
        title: () => "🏝️ Visiter une île",
        // Le contenu ne depend pas de l'etat du village : pas de reconstruction
        // a chaque synchronisation (elle fermerait le clavier en pleine frappe).
        keepOnState: true,
        html: (sheet) => `<label class="v-search">
                <span aria-hidden="true">🔍</span>
                <input id="v-visit-q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="32" placeholder="Rechercher un joueur…" value="${esc(sheet.q)}">
            </label>
            <div id="v-visit-list">${listHtml(sheet)}</div>`,
        onClose() {
            clearTimeout(searchTimer);
        }
    };

    ui.sheetBody.addEventListener("input", (event) => {
        if (event.target.id !== "v-visit-q" || S.sheet?.kind !== "visit") return;
        const sheet = S.sheet;
        sheet.q = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchPlayers(sheet), SEARCH_DELAY_MS);
    });

    ui.sheetBody.addEventListener("keydown", (event) => {
        // "Rechercher" sur le clavier de l'iPad : on range le clavier, la liste est deja a jour.
        if (event.key === "Enter" && event.target.id === "v-visit-q") event.target.blur();
    });

    /* ======================================================================
       SCENE : L'ILE D'UN AUTRE JOUEUR
       ====================================================================== */

    /** Ile visitee (null ailleurs) : { data, items, info }. */
    let T = null;
    let opening = false;
    let infoTimer = 0;

    const visitScene = {
        mapSize: () => T?.data.mapSize ?? 24,
        margin: () => S.data?.deployMargin ?? 2,
        animating: () => false,
        draw() {
            if (!T) return;
            for (const it of T.items) view.drawBuilding(it, { badges: true, sprites: true });
            const info = T.info && performance.now() < T.info.until ? T.info.it : null;
            if (info?.anchor) {
                const c = V.cat(info.type);
                view.outlinedText(`${c?.name || info.type} · niv. ${info.level}`, info.anchor.x, info.anchor.y - 14, 15, "#fff", 800);
            }
        },
        tap(x, y) {
            if (!T) return;
            const it = view.hitItem(T.items, x, y);
            T.info = it ? { it, until: performance.now() + 2200 } : null;
            view.requestDraw();
            clearTimeout(infoTimer);
            if (it) infoTimer = setTimeout(view.requestDraw, 2300);
        }
    };

    function enter(data) {
        const items = data.buildings.map((b) => ({ type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, level: b.level, constructing: b.level === 0 }));
        view.linkWalls(items);
        T = { data, items: view.isoSort(items), info: null };

        S.scene = "visit";
        S.selectedId = null;
        S.mode = "view";
        S.ghost = null;
        for (const el of [ui.top, ui.bottom, ui.selbar, ui.placebar]) el.classList.add("hidden");
        ui.visit.classList.remove("hidden");

        const now = V.serverNow();
        ui.vsName.textContent = `${data.league?.emoji || "🌱"} Île de ${data.pseudo}`;
        const sub = [`Palazzo ${data.th}`, `🏆 ${data.trophies}`];
        if (data.shieldUntil && data.shieldUntil > now) sub.push(`🛡️ ${fmtDur((data.shieldUntil - now) / 1000)}`);
        ui.vsSub.textContent = sub.join(" · ");

        view.fx.clear();
        view.setScene(visitScene);
        view.centerCamera();
        V.util.track("village_visit");
        showChallenge(data);
    }

    /**
     * Bouton "Defier" : seulement sur l'ile d'un ami. La liste d'amis vient du
     * cache du panneau (une amitie change rarement : un cache ancien suffit) ;
     * sinon, une seule requete legere.
     */
    async function showChallenge(data) {
        const btn = ui.vsFight;
        btn.classList.add("hidden");
        let friends;
        try {
            friends = await load("friends", "/village/war/friends", (res) => res.friends, 10 * 60_000);
        } catch {
            return;
        }
        if (T?.data !== data || !friends.some((f) => f.id === data.id)) return;
        const shielded = data.shieldUntil && data.shieldUntil > V.serverNow();
        const noArmy = !(S.data?.army?.used > 0);
        btn.textContent = shielded ? "🛡️ Protégé" : "🤝 Défier";
        btn.disabled = Boolean(shielded) || noArmy;
        btn.title = shielded ? "Un ami sous bouclier ne peut pas être défié." : noArmy ? "Ton armée est vide : entraîne des troupes à la Caserma." : "";
        btn.classList.remove("hidden");
    }

    async function challenge() {
        if (!T) return;
        await V.war.challenge(T.data.id);
        // La bataille a demarre : on quitte l'ile (en cas de refus, on y reste).
        if (S.scene === "battle") {
            T = null;
            clearTimeout(infoTimer);
            ui.visit.classList.add("hidden");
        }
    }

    function leave() {
        if (!T) return;
        T = null;
        clearTimeout(infoTimer);
        ui.visit.classList.add("hidden");
        V.home.enter();
    }

    async function open(userId) {
        if (opening || !userId) return;
        opening = true;
        V.closeSheet();
        V.loader.show("🏝️ En route vers son île…", true);
        try {
            const res = await V.api("GET", `/village/visit/${encodeURIComponent(userId)}`);
            if (!res?.success || !res.visit) {
                V.toast(res?.message || "Impossible de visiter cette île.", "error");
                return;
            }
            enter(res.visit);
        } finally {
            opening = false;
            V.loader.hide();
        }
    }

    V.acts.visit = (el) => open(el.dataset.id);
    ui.visitBtn.addEventListener("click", openList);
    ui.vsList.addEventListener("click", openList);
    ui.vsHome.addEventListener("click", leave);
    ui.vsFight.addEventListener("click", challenge);

    V.visit = { open, openList, leave };
})();
