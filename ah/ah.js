const API_BASE_URL = window.API_BASE_URL;
const TOKEN_STORAGE_KEYS = ["brainrot_token", "token", "auth_token", "jwt_token", "jwt"];

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;

const RARITY_ORDER = [
    "commun", "peu commun", "rare", "très rare",
    "légendaire", "épique", "mythique", "ultime",
    "divin", "secret", "ancestral", "éternel"
];

const RARITY_COLORS = window.BRAINROT_RARITY_COLORS || {
    commun: "#a3a3a3",
    "peu-commun": "#22c55e",
    rare: "#3b82f6",
    "tres-rare": "#8b5cf6",
    ancestral: "#3b82f6",
    epique: "#a855f7",
    legendaire: "#f97316",
    mythique: "#ec4899",
    divin: "#eab308",
    ultime: "#ef4444",
    secret: "#a855f7",
    eternel: "#ef4444"
};

// Etat, desormais entierement alimente par l'API.
let allCards = [];
let ownedCards = [];
let myListings = [];
let marketListings = [];
let marketTotal = 0;
let marketPage = 1;
let marketLoading = false;
let walletGold = 0;

let sellModalState = { card: null, busy: false };
let buyModalState = { listing: null, busy: false };

const ui = {
    wallet: document.getElementById("ah-wallet"),
    tabs: document.querySelectorAll(".ah-tab"),
    panels: {
        buy: document.getElementById("tab-buy"),
        sell: document.getElementById("tab-sell"),
        "my-listings": document.getElementById("tab-my-listings")
    },
    myListingsCount: document.getElementById("my-listings-count"),
    buySearch: document.getElementById("buy-search"),
    buyFilterRarity: document.getElementById("buy-filter-rarity"),
    buySort: document.getElementById("buy-sort"),
    buyGrid: document.getElementById("buy-listings-grid"),
    sellSearch: document.getElementById("sell-search"),
    sellFilterRarity: document.getElementById("sell-filter-rarity"),
    sellGrid: document.getElementById("sell-cards-grid"),
    myListingsList: document.getElementById("my-listings-list"),
    buyModal: document.getElementById("buy-modal"),
    buyModalOverlay: document.getElementById("buy-modal-overlay"),
    buyModalClose: document.getElementById("buy-modal-close"),
    buyModalImg: document.getElementById("buy-modal-img"),
    buyModalName: document.getElementById("buy-modal-name"),
    buyModalRarity: document.getElementById("buy-modal-rarity"),
    buyModalCps: document.getElementById("buy-modal-cps"),
    buyModalPrice: document.getElementById("buy-modal-price"),
    buyModalRef: document.getElementById("buy-modal-ref"),
    buyModalSeller: document.getElementById("buy-modal-seller"),
    buyModalConfirm: document.getElementById("buy-modal-confirm"),
    sellModal: document.getElementById("sell-modal"),
    sellModalOverlay: document.getElementById("sell-modal-overlay"),
    sellModalClose: document.getElementById("sell-modal-close"),
    sellModalImg: document.getElementById("sell-modal-img"),
    sellModalName: document.getElementById("sell-modal-name"),
    sellModalRarity: document.getElementById("sell-modal-rarity"),
    sellModalCps: document.getElementById("sell-modal-cps"),
    sellPriceSlider: document.getElementById("sell-price-slider"),
    sellPriceDisplay: document.getElementById("sell-price-display"),
    sellRefPrice: document.getElementById("sell-ref-price"),
    sellPriceMin: document.getElementById("sell-price-min"),
    sellPriceMax: document.getElementById("sell-price-max"),
    sellModalConfirm: document.getElementById("sell-modal-confirm")
};

/* ==========================================================================
   OUTILS
   ========================================================================== */

function getAuthToken() {
    for (const key of TOKEN_STORAGE_KEYS) {
        const t = localStorage.getItem(key);
        if (t) return t;
    }
    return window.BrainrotAuth?.getToken?.() || "";
}

/** Requete authentifiee vers l'API du marche. */
async function apiCall(path, { method = "GET", body } = {}) {
    const token = getAuthToken();
    try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            ...(body ? { body: JSON.stringify(body) } : {})
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            return {
                success: false,
                message: payload?.message || `Erreur serveur (${response.status})`
            };
        }
        return payload || { success: false, message: "Réponse invalide" };
    } catch {
        return { success: false, message: "Connexion au serveur impossible" };
    }
}

function formatCompact(value) {
    const num = Number(value || 0);
    if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2).replace(/\.00$/, "")}T`;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
    return `${Math.round(num * 100) / 100}`;
}

function getRarityColor(rarity) {
    if (!rarity) return "#a3a3a3";
    const key = rarity.toLowerCase().replace(/\s+/g, "-").replace(/é/g, "e").replace(/è/g, "e").replace(/ê/g, "e").replace(/à/g, "a").replace(/ù/g, "u");
    return RARITY_COLORS[key] || RARITY_COLORS[rarity] || "#a3a3a3";
}

function getRarityIndex(rarity) {
    const normalized = (rarity || "").toLowerCase().replace(/-/g, " ");
    const idx = RARITY_ORDER.indexOf(normalized);
    return idx === -1 ? RARITY_ORDER.length : idx;
}

/** Message ephemere, non bloquant. */
let toastTimer = null;
function toast(message, kind = "info") {
    let el = document.getElementById("ah-toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "ah-toast";
        el.style.cssText =
            "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;" +
            "padding:11px 20px;border-radius:999px;font-weight:700;font-size:0.9rem;" +
            "box-shadow:0 8px 24px rgba(0,0,0,0.45);pointer-events:none;" +
            "transition:opacity .2s ease;max-width:90vw;text-align:center;";
        document.body.appendChild(el);
    }
    el.style.background = kind === "error" ? "rgba(127,29,29,0.96)"
        : kind === "success" ? "rgba(20,83,45,0.96)"
        : "rgba(15,15,20,0.94)";
    el.style.color = "#fff";
    el.textContent = message;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2800);
}

function setWallet(gold) {
    walletGold = Number(gold || 0);
    if (ui.wallet) ui.wallet.textContent = `${formatCompact(walletGold)} 💰`;
}

/* ==========================================================================
   APPELS API
   ========================================================================== */

async function fetchWallet() {
    const payload = await apiCall("/user/stats");
    if (payload?.success && payload.value) setWallet(payload.value.gold);
}

/** Catalogue complet : sert uniquement a remplir les filtres de rareté. */
async function fetchAllCards() {
    try {
        const response = await fetch(`${API_BASE_URL}/user/getAllBrainRot`);
        if (!response.ok) return [];
        const payload = await response.json();
        return payload?.success && Array.isArray(payload.result) ? payload.result : [];
    } catch {
        return [];
    }
}

/**
 * Annonces du marche.
 * Recherche, filtre, tri et pagination sont faits par le serveur : le client
 * ne telecharge jamais la totalite du marche pour n'en afficher qu'une page.
 */
async function fetchMarketListings({ append = false } = {}) {
    if (marketLoading) return;
    marketLoading = true;

    const params = new URLSearchParams({
        page: String(append ? marketPage + 1 : 1),
        pageSize: String(PAGE_SIZE),
        sort: ui.buySort.value || "price-asc"
    });

    const search = ui.buySearch.value.trim();
    if (search) params.set("search", search);
    if (ui.buyFilterRarity.value && ui.buyFilterRarity.value !== "all") {
        params.set("rarity", ui.buyFilterRarity.value);
    }

    const payload = await apiCall(`/market/listings?${params.toString()}`);
    marketLoading = false;

    if (!payload?.success) {
        if (!append) { marketListings = []; marketTotal = 0; }
        renderBuyGrid(payload?.message || "Impossible de charger le marché.");
        return;
    }

    marketPage = payload.page;
    marketTotal = payload.total;
    marketListings = append ? marketListings.concat(payload.listings) : payload.listings;
    renderBuyGrid();
}

async function fetchInventory() {
    const payload = await apiCall("/market/inventory");
    ownedCards = payload?.success ? payload.cards : [];
}

async function fetchMyListings() {
    const payload = await apiCall("/market/my-listings");
    myListings = payload?.success ? payload.listings : [];
}

/* ==========================================================================
   FILTRES
   ========================================================================== */

function populateRarityFilters() {
    const rarities = [...new Set(allCards.map(c => c.rarity).filter(Boolean))]
        .sort((a, b) => getRarityIndex(a) - getRarityIndex(b));

    [ui.buyFilterRarity, ui.sellFilterRarity].forEach(sel => {
        sel.innerHTML = '<option value="all">Toutes raretés</option>';
        rarities.forEach(r => {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = r.replace(/-/g, " ").toUpperCase();
            sel.appendChild(opt);
        });
    });
}

/** L'onglet "vendre" filtre localement : l'inventaire tient en memoire. */
function getFilteredSellCards() {
    const search = ui.sellSearch.value.trim().toLowerCase();
    const rarity = ui.sellFilterRarity.value;

    let list = [...ownedCards];
    if (search) list = list.filter(c => (c.name || "").toLowerCase().includes(search));
    if (rarity !== "all") list = list.filter(c => c.rarity === rarity);
    return list;
}

/* ==========================================================================
   RENDU
   ========================================================================== */

function renderBuyGrid(errorMessage) {
    ui.buyGrid.innerHTML = "";

    if (errorMessage) {
        ui.buyGrid.innerHTML = `<div class="ah-empty-state"><div class="ah-empty-state-icon">⚠️</div><span>${errorMessage}</span></div>`;
        lucide.createIcons();
        return;
    }

    if (!marketListings.length) {
        ui.buyGrid.innerHTML = `<div class="ah-empty-state"><div class="ah-empty-state-icon">🔍</div><span>Aucune annonce trouvée.</span></div>`;
        lucide.createIcons();
        return;
    }

    marketListings.forEach(listing => {
        const card = listing.card;
        const color = getRarityColor(card.rarity);
        const delta = listing.priceDelta || 0;
        const deltaClass = delta > 1 ? "up" : delta < -1 ? "down" : "neutral";
        const deltaLabel = `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
        const img = card.link || "";

        const el = document.createElement("div");
        el.className = "ah-listing-card";
        el.style.borderColor = `${color}55`;
        el.style.boxShadow = `0 8px 24px ${color}18, var(--card-shadow)`;
        el.innerHTML = `
            <div class="ah-listing-card-img-wrap">
                ${img
                    ? `<img class="ah-listing-card-img" src="${img}" alt="${card.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                    : ""}
                <div class="ah-listing-card-img-fallback" style="${img ? "display:none" : ""}">${card.emoji || "🃏"}</div>
                <div class="ah-listing-rarity-dot" style="background:${color};color:${color}"></div>
            </div>
            <div class="ah-listing-card-name">${card.name}</div>
            <div class="ah-listing-card-rarity" style="color:${color}">${(card.rarity || "").replace(/-/g, " ")}</div>
            <div class="ah-listing-card-cps"><i data-lucide="zap"></i>${formatCompact(card.goldPerSec || 0)}/s</div>
            <div class="ah-listing-card-price">
                <span class="ah-listing-price-value">${formatCompact(listing.price)} 💰</span>
                <span class="ah-listing-price-delta ${deltaClass}">${deltaLabel}</span>
            </div>
            <div class="ah-listing-seller"><i data-lucide="user"></i>${listing.seller || "?"}</div>
        `;

        el.addEventListener("click", () => openBuyModal(listing));
        ui.buyGrid.appendChild(el);
    });

    // Pagination : le reste du marche se charge a la demande.
    if (marketListings.length < marketTotal) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "ah-sell-card-btn";
        more.style.gridColumn = "1 / -1";
        more.innerHTML = `<i data-lucide="chevron-down"></i>Charger plus (${marketListings.length}/${marketTotal})`;
        more.addEventListener("click", () => {
            more.disabled = true;
            fetchMarketListings({ append: true });
        });
        ui.buyGrid.appendChild(more);
    }

    lucide.createIcons();
}

function renderSellGrid() {
    const cards = getFilteredSellCards();
    ui.sellGrid.innerHTML = "";

    if (!cards.length) {
        ui.sellGrid.innerHTML = `<div class="ah-empty-state"><div class="ah-empty-state-icon">📭</div><span>Aucune carte dans votre collection.</span></div>`;
        lucide.createIcons();
        return;
    }

    cards.forEach(card => {
        const color = getRarityColor(card.rarity);
        const img = card.link || "";

        const el = document.createElement("div");
        el.className = "ah-sell-card";
        el.style.borderColor = `${color}44`;
        el.innerHTML = `
            <div class="ah-sell-card-top">
                <div class="ah-sell-card-thumb">
                    ${img
                        ? `<img src="${img}" alt="${card.name}" loading="lazy" onerror="this.style.display='none'">`
                        : `<div class="ah-sell-card-thumb-fallback">${card.emoji || "🃏"}</div>`}
                </div>
                <div class="ah-sell-card-meta">
                    <div class="ah-sell-card-name">${card.name}</div>
                    <div class="ah-sell-card-rarity" style="color:${color}">${(card.rarity || "").replace(/-/g, " ").toUpperCase()}</div>
                    <div class="ah-sell-card-ref">Réf. : ${formatCompact(card.refPrice)} 💰 &middot; x${card.quantity}</div>
                </div>
            </div>
            <button class="ah-sell-card-btn" type="button">
                <i data-lucide="tag"></i>
                Mettre en vente
            </button>
        `;

        el.querySelector(".ah-sell-card-btn").addEventListener("click", () => openSellModal(card));
        ui.sellGrid.appendChild(el);
    });

    lucide.createIcons();
}

function renderMyListings() {
    ui.myListingsList.innerHTML = "";

    if (!myListings.length) {
        ui.myListingsList.innerHTML = `<div class="ah-empty-state"><div class="ah-empty-state-icon">📋</div><span>Vous n'avez aucune annonce active.</span></div>`;
        lucide.createIcons();
        updateMyListingsCount();
        return;
    }

    myListings.forEach(listing => {
        const card = listing.card;
        const color = getRarityColor(card.rarity);
        const img = card.link || "";

        const el = document.createElement("div");
        el.className = "ah-my-listing-row";
        el.style.borderColor = `${color}44`;
        el.innerHTML = `
            <div class="ah-my-listing-thumb">
                ${img
                    ? `<img src="${img}" alt="${card.name}" loading="lazy" onerror="this.style.display='none'">`
                    : (card.emoji || "🃏")}
            </div>
            <div class="ah-my-listing-info">
                <div class="ah-my-listing-name">${card.name}</div>
                <div class="ah-my-listing-meta">
                    <span style="color:${color}">${(card.rarity || "").replace(/-/g, " ")}</span>
                    <span>Réf. : ${formatCompact(listing.refPrice)} 💰</span>
                </div>
            </div>
            <div class="ah-my-listing-price">${formatCompact(listing.price)} 💰</div>
            <button class="ah-my-listing-cancel" type="button">
                <i data-lucide="x"></i>
                Annuler
            </button>
        `;

        const cancelBtn = el.querySelector(".ah-my-listing-cancel");
        cancelBtn.addEventListener("click", async () => {
            cancelBtn.disabled = true;
            const result = await apiCall(`/market/listings/${encodeURIComponent(listing.id)}`, { method: "DELETE" });

            if (!result?.success) {
                cancelBtn.disabled = false;
                toast(result?.message || "Annulation impossible", "error");
                // L'annonce a pu etre vendue entre-temps : on resynchronise.
                await Promise.all([fetchMyListings(), fetchInventory()]);
                renderMyListings();
                renderSellGrid();
                return;
            }

            toast("Annonce annulée, carte récupérée.", "success");
            await Promise.all([fetchMyListings(), fetchInventory(), fetchWallet()]);
            renderMyListings();
            renderSellGrid();
        });

        ui.myListingsList.appendChild(el);
    });

    lucide.createIcons();
    updateMyListingsCount();
}

function updateMyListingsCount() {
    const count = myListings.length;
    ui.myListingsCount.textContent = count;
    ui.myListingsCount.classList.toggle("hidden", count === 0);
}

/* ==========================================================================
   MODALES
   ========================================================================== */

function openBuyModal(listing) {
    buyModalState.listing = listing;
    buyModalState.busy = false;
    const card = listing.card;
    const color = getRarityColor(card.rarity);
    const img = card.link || "";

    ui.buyModalImg.src = img;
    ui.buyModalImg.style.display = img ? "block" : "none";
    ui.buyModalName.textContent = card.name;
    ui.buyModalRarity.textContent = (card.rarity || "").replace(/-/g, " ").toUpperCase();
    ui.buyModalRarity.style.color = color;
    ui.buyModalCps.textContent = `⚡ ${formatCompact(card.goldPerSec || 0)}/s`;
    ui.buyModalPrice.textContent = `${formatCompact(listing.price)} 💰`;
    ui.buyModalRef.textContent = `Prix de référence : ${formatCompact(listing.refPrice)} 💰`;
    ui.buyModalSeller.textContent = listing.seller || "?";

    // Le serveur revalide le solde : ceci n'est qu'un retour immediat.
    const affordable = walletGold >= listing.price;
    ui.buyModalConfirm.disabled = !affordable;
    ui.buyModalConfirm.title = affordable ? "" : "Or insuffisant";

    ui.buyModal.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    lucide.createIcons();
}

function closeBuyModal() {
    ui.buyModal.classList.add("hidden");
    updateBodyScroll();
}

function openSellModal(card) {
    sellModalState.card = card;
    sellModalState.busy = false;
    const color = getRarityColor(card.rarity);
    const img = card.link || "";

    ui.sellModalImg.src = img;
    ui.sellModalImg.style.display = img ? "block" : "none";
    ui.sellModalName.textContent = card.name;
    ui.sellModalRarity.textContent = (card.rarity || "").replace(/-/g, " ").toUpperCase();
    ui.sellModalRarity.style.color = color;
    ui.sellModalCps.textContent = `⚡ ${formatCompact(card.goldPerSec || 0)}/s`;
    // Bornes fournies par le serveur : c'est lui qui fait autorite sur le prix.
    ui.sellRefPrice.textContent = `Prix de référence : ${formatCompact(card.refPrice)} 💰`;
    ui.sellPriceMin.textContent = `${formatCompact(card.min)} 💰`;
    ui.sellPriceMax.textContent = `${formatCompact(card.max)} 💰`;
    ui.sellPriceSlider.value = 50;
    ui.sellModalConfirm.disabled = false;
    updateSellPriceDisplay(card);

    ui.sellModal.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    lucide.createIcons();
}

function closeSellModal() {
    ui.sellModal.classList.add("hidden");
    updateBodyScroll();
}

function updateBodyScroll() {
    const buyOpen = !ui.buyModal.classList.contains("hidden");
    const sellOpen = !ui.sellModal.classList.contains("hidden");
    if (buyOpen || sellOpen) {
        document.body.classList.add("no-scroll");
    } else {
        document.body.classList.remove("no-scroll");
    }
}

/** Le curseur interpole entre les bornes min/max renvoyees par le serveur. */
function getSellPrice(card) {
    if (!card) return 0;
    const ratio = Number(ui.sellPriceSlider.value) / 100;
    return Math.round(card.min + (card.max - card.min) * ratio);
}

function updateSellPriceDisplay(card) {
    const target = card || sellModalState.card;
    if (!target) return;
    ui.sellPriceDisplay.textContent = `${formatCompact(getSellPrice(target))} 💰`;
}

/* ==========================================================================
   TRANSACTIONS
   ========================================================================== */

async function confirmBuy() {
    const listing = buyModalState.listing;
    if (!listing || buyModalState.busy) return;

    buyModalState.busy = true;
    ui.buyModalConfirm.disabled = true;

    const result = await apiCall(`/market/listings/${encodeURIComponent(listing.id)}/buy`, { method: "POST" });

    buyModalState.busy = false;

    if (!result?.success) {
        ui.buyModalConfirm.disabled = false;
        toast(result?.message || "Achat impossible", "error");
        // Annonce disparue ou deja vendue : on rafraichit la page courante.
        await fetchMarketListings();
        closeBuyModal();
        return;
    }

    setWallet(result.goldLeft);
    window.PlayWebAnalytics?.track("market_buy", { value: result.price });
    toast(`${listing.card.name} acheté pour ${formatCompact(result.price)} 💰`, "success");
    closeBuyModal();

    await Promise.all([fetchMarketListings(), fetchInventory()]);
    renderSellGrid();
}

async function confirmSell() {
    const card = sellModalState.card;
    if (!card || sellModalState.busy) return;

    const price = getSellPrice(card);
    sellModalState.busy = true;
    ui.sellModalConfirm.disabled = true;

    const result = await apiCall("/market/listings", {
        method: "POST",
        body: { cardId: card.id, price }
    });

    sellModalState.busy = false;
    ui.sellModalConfirm.disabled = false;

    if (!result?.success) {
        toast(result?.message || "Mise en vente impossible", "error");
        return;
    }

    window.PlayWebAnalytics?.track("market_sell", { value: price });
    toast(`${card.name} mis en vente à ${formatCompact(price)} 💰`, "success");
    closeSellModal();

    await Promise.all([fetchMyListings(), fetchInventory()]);
    renderMyListings();
    renderSellGrid();
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */

function switchTab(tabName) {
    ui.tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
    Object.entries(ui.panels).forEach(([name, panel]) => {
        panel.classList.toggle("hidden", name !== tabName);
    });
}

/** Evite une requete par frappe dans le champ de recherche. */
function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

async function init() {
    GlobalLoader.show();

    try {
        const token = await window.BrainrotAuth.waitUntilReady();
        if (!token) {
            renderBuyGrid("Connecte-toi pour accéder au marché.");
            return;
        }

        allCards = await fetchAllCards();
        populateRarityFilters();

        await Promise.all([
            fetchWallet(),
            fetchMarketListings(),
            fetchInventory(),
            fetchMyListings()
        ]);

        renderSellGrid();
        renderMyListings();
    } catch (err) {
        console.error("Erreur init marché:", err);
        renderBuyGrid("Impossible de charger le marché.");
    } finally {
        GlobalLoader.hide(true);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();

    ui.tabs.forEach(tab => {
        tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    // Achat : recherche, filtre et tri sont resolus par le serveur.
    const refreshMarket = debounce(() => fetchMarketListings(), SEARCH_DEBOUNCE_MS);
    ui.buySearch.addEventListener("input", refreshMarket);
    ui.buyFilterRarity.addEventListener("change", () => fetchMarketListings());
    ui.buySort.addEventListener("change", () => fetchMarketListings());

    // Vente : l'inventaire est deja en memoire, filtrage local.
    ui.sellSearch.addEventListener("input", renderSellGrid);
    ui.sellFilterRarity.addEventListener("change", renderSellGrid);

    ui.buyModalClose.addEventListener("click", closeBuyModal);
    ui.buyModalOverlay.addEventListener("click", closeBuyModal);
    ui.buyModalConfirm.addEventListener("click", confirmBuy);

    ui.sellModalClose.addEventListener("click", closeSellModal);
    ui.sellModalOverlay.addEventListener("click", closeSellModal);
    ui.sellModalConfirm.addEventListener("click", confirmSell);

    ui.sellPriceSlider.addEventListener("input", () => updateSellPriceDisplay(sellModalState.card));

    document.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (!ui.sellModal.classList.contains("hidden")) { closeSellModal(); return; }
        if (!ui.buyModal.classList.contains("hidden")) closeBuyModal();
    });

    init();
});
