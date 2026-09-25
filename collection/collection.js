const collectionGrid = document.getElementById("collection-grid");
const filterRarity = document.getElementById("filter-rarity");
const filterOwned = document.getElementById("filter-owned");
const sortBy = document.getElementById("sort-by");

const API_BASE_URL = window.API_BASE_URL;
const USER_ROUTE_BASES = ["/user"];
const TOKEN_STORAGE_KEYS = ["brainrot_token", "token", "auth_token", "jwt_token", "jwt"];

const RARITY_ORDER = [
    "commun",
    "peu-commun",
    "rare",
    "tres-rare",
    "legendaire",
    "epique",
    "mythique",
    "ultime",
    "divin",
    "secret",
    "ancestral",
    "eternel",
    "STI"
];

let allBrainrots = [];
let allCardsFromBackend = [];
const ownedFromBackend = {
    loaded: false,
    cardIds: new Set(),
    cardNames: new Set(),
    levelsById: new Map(),
    levelsByName: new Map()
};

function getAuthToken() {
    for (const key of TOKEN_STORAGE_KEYS) {
        const token = localStorage.getItem(key);
        if (token) return token;
    }
    return "";
}

async function fetchOwnedCards() {
    const token = getAuthToken();
    if (!token) return;

    for (const base of USER_ROUTE_BASES) {
        try {
            const response = await apiFetch(`${API_BASE_URL}${base}/cards`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });

            if (!response.ok) continue;
            const payload = await response.json();
            if (!payload?.success) continue;

            const deckCards = Array.isArray(payload?.cards) ? payload.cards : [];
            deckCards.forEach((entry) => {
                if (entry?.cardId) ownedFromBackend.cardIds.add(String(entry.cardId));
                if (entry?.name) ownedFromBackend.cardNames.add(String(entry.name));
                if (entry?.card?.name) ownedFromBackend.cardNames.add(String(entry.card.name));
                const qty = Math.max(1, Number(entry?.quantity || 1));
                if (entry?.cardId) ownedFromBackend.levelsById.set(String(entry.cardId), qty);
                if (entry?.name) ownedFromBackend.levelsByName.set(String(entry.name), qty);
                if (entry?.card?.name) ownedFromBackend.levelsByName.set(String(entry.card.name), qty);
            });
            ownedFromBackend.loaded = true;
            return;
        } catch {
            continue;
        }
    }
}

function isOwnedItem(item) {
    if (item?.id && ownedFromBackend.cardIds.has(String(item.id))) return true;
    if (item?.name && ownedFromBackend.cardNames.has(String(item.name))) return true;
    return false;
}

function getItemLevel(item) {
    if (!isOwnedItem(item)) return 0;
    if (item?.id && ownedFromBackend.levelsById.has(String(item.id))) {
        return Number(ownedFromBackend.levelsById.get(String(item.id)) || 1);
    }
    if (item?.name && ownedFromBackend.levelsByName.has(String(item.name))) {
        return Number(ownedFromBackend.levelsByName.get(String(item.name)) || 1);
    }
    return 1;
}

async function fetchAllCards() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/user/getAllBrainRot`);
        if (!response.ok) {
            throw new Error('Failed to fetch cards');
        }
        const payload = await response.json();
        if (payload?.success && Array.isArray(payload?.result)) {
            allCardsFromBackend = payload.result;
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error fetching all cards:", error);
        return false;
    }
}

function getRarityColor(rarity) {
    if (window.BRAINROT_RARITY_COLORS && window.BRAINROT_RARITY_COLORS[rarity]) {
        return window.BRAINROT_RARITY_COLORS[rarity];
    }
    return "#a3a3a3";
}

function getRarityIndex(rarity) {
    const raw = rarity || "";
    const index = RARITY_ORDER.indexOf(raw);
    if (index !== -1) return index;
    const normalized = raw.toLowerCase().replace(/[àâä]/g, "a").replace(/[éèêë]/g, "e").replace(/\s+/g, "-");
    const indexNorm = RARITY_ORDER.indexOf(normalized);
    return indexNorm === -1 ? RARITY_ORDER.length : indexNorm;
}

function formatCompact(value) {
    const num = Number(value || 0);
    if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2).replace(/\.00$/, "")}T`;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
    return `${Math.round(num * 100) / 100}`;
}

async function loadCollection() {
    GlobalLoader.show();
    try {
        await Promise.all([fetchOwnedCards(), fetchAllCards()]);
        
        populateRarityFilter();
        
        filterRarity.addEventListener("change", applyFiltersAndSort);
        filterOwned.addEventListener("change", applyFiltersAndSort);
        sortBy.addEventListener("change", applyFiltersAndSort);
        
        applyFiltersAndSort();
    } catch (error) {
        console.error("Erreur chargement collection:", error);
        collectionGrid.innerHTML = `<div style="text-align: center; grid-column: 1/-1; padding: 2rem;">
            <p style="color: #ef4444; font-weight: bold; margin-bottom: 1rem;">⚠️ Erreur de chargement</p>
            <p style="color: #a3a3a3; font-size: 0.9rem;">
                Le serveur backend n'est pas démarré.<br>
                Lance <code style="background: #262626; padding: 0.2rem 0.5rem; border-radius: 4px;">npm run dev</code> dans le dossier backend.
            </p>
        </div>`;
    } finally {
        GlobalLoader.hide(true);
    }
}

function populateRarityFilter() {
    filterRarity.innerHTML = '<option value="all">Toutes les raretés</option>';
    const rarities = new Set();
    allCardsFromBackend.forEach(card => {
        if (card.rarity) {
            rarities.add(card.rarity);
        }
    });
    
    const sortedRarities = Array.from(rarities).sort((a, b) => getRarityIndex(a) - getRarityIndex(b));
    for (const rarity of sortedRarities) {
        const option = document.createElement("option");
        option.value = rarity;
        option.textContent = rarity.replace(/-/g, " ").toUpperCase();
        filterRarity.appendChild(option);
    }
}

function applyFiltersAndSort() {
    if (!allCardsFromBackend || allCardsFromBackend.length === 0) return;
    
    allBrainrots = [];
    
    allCardsFromBackend.forEach(card => {
        const isOwned = isOwnedItem(card);
        const level = getItemLevel(card);
        const baseCps = card.goldPerSec || card.cps || 1;
        const actualCps = baseCps + baseCps * (level - 1) * 0.8;
        const rarityColor = getRarityColor(card.rarity);
        
        allBrainrots.push({
            ...card,
            color: rarityColor,
            isOwned,
            level,
            cps: actualCps
        });
    });
    
    const rarityFilter = filterRarity.value;
    const ownedFilter = filterOwned.value;
    
    allBrainrots = allBrainrots.filter(brainrot => {
        if (rarityFilter !== "all" && brainrot.rarity !== rarityFilter) return false;
        if (ownedFilter === "owned" && !brainrot.isOwned) return false;
        if (ownedFilter === "locked" && brainrot.isOwned) return false;
        return true;
    });
    
    const sortValue = sortBy.value;
    if (sortValue === "cps") {
        allBrainrots.sort((a, b) => b.cps - a.cps);
    } else if (sortValue === "level") {
        allBrainrots.sort((a, b) => b.level - a.level);
    } else if (sortValue === "rarity-asc") {
        allBrainrots.sort((a, b) => getRarityIndex(a.rarity) - getRarityIndex(b.rarity));
    } else if (sortValue === "rarity-desc") {
        allBrainrots.sort((a, b) => getRarityIndex(b.rarity) - getRarityIndex(a.rarity));
    }
    
    renderCollection();
}

function renderCollection() {
    collectionGrid.innerHTML = "";
    
    allBrainrots.forEach(brainrot => {
        const card = document.createElement("div");
        card.className = `card ${brainrot.isOwned ? "" : "locked"}`;
        card.style.borderColor = brainrot.color;
        card.dataset.rarity = brainrot.rarity;
        card.dataset.owned = brainrot.isOwned;
        
        if (brainrot.isOwned) {
            card.style.boxShadow = `0 0 15px ${brainrot.color}40`;
        }

        const levelBadge = document.createElement("div");
        levelBadge.className = "card-level-badge";
        levelBadge.textContent = brainrot.level;

        const img = document.createElement("img");
        img.src = brainrot.link || brainrot.imageUrl || brainrot.image || ""; 
        img.alt = brainrot.name;
        img.className = "card-image";

        const name = document.createElement("div");
        name.className = "card-name";
        const emoji = brainrot.emoji || "";
        name.textContent = emoji ? `${emoji} ${brainrot.name}` : brainrot.name;

        const rarityTag = document.createElement("div");
        rarityTag.className = "card-rarity";
        rarityTag.textContent = brainrot.rarity.replace(/-/g, " ");
        rarityTag.style.color = brainrot.color;

        const cpsTag = document.createElement("div");
        cpsTag.className = "card-cps";
        
        const isSeasonal = brainrot.rarity && brainrot.rarity.toLowerCase() === 'seasonial';
        
        if (!isSeasonal) {
            cpsTag.innerHTML = `<i data-lucide="coins" style="width: 14px; height: 14px;"></i> ${formatCompact(brainrot.cps)}/s`;
        } else {
            cpsTag.style.display = 'none';
        }

        card.appendChild(levelBadge);
        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(rarityTag);
        if (!isSeasonal) {
            card.appendChild(cpsTag);
        }

        if (!brainrot.isOwned) {
            const lockIcon = document.createElement("div");
            lockIcon.className = "locked-overlay";
            lockIcon.innerHTML = `<i data-lucide="lock" size="48"></i>`;
            card.appendChild(lockIcon);
        }

        collectionGrid.appendChild(card);
    });
    
    lucide.createIcons();
}

document.addEventListener("DOMContentLoaded", loadCollection);