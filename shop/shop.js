const API_BASE_URL = window.API_BASE_URL + "";
const SHOP_ROUTE_BASE = "/shop";
const USER_ROUTE_BASES = ["/user"];
const GOLD_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const ui = {
    wallet: document.getElementById("wallet-value"),
    caissesGrid: document.getElementById("caisses-grid"),
    boostCaissesGrid: document.getElementById("boost-caisses-grid"),
    countCaisses: document.getElementById("count-caisses"),
    countBoostCaisses: document.getElementById("count-boost-caisses"),
    buyModal: document.getElementById("buy-modal"),
    buyModalClose: document.getElementById("buy-modal-close"),
    buyModalItemName: document.getElementById("buy-modal-item-name"),
    buyModalToInventory: document.getElementById("buy-modal-to-inventory"),
    buyModalOpenNow: document.getElementById("buy-modal-open-now"),
    openInventoryModal: document.getElementById("open-inventory-modal"),
    openInventoryClose: document.getElementById("open-inventory-close"),
    openInventoryItemName: document.getElementById("open-inventory-item-name"),
    openInventoryQty: document.getElementById("open-inventory-qty"),
    openInventoryMax: document.getElementById("open-inventory-max"),
    openInventoryConfirm: document.getElementById("open-inventory-confirm"),
    scrollToInventoryBtn: document.getElementById("scroll-to-inventory"),
    inventorySection: document.getElementById("inventory-section"),
    inventoryGrid: document.getElementById("inventory-grid"),
    countInventory: document.getElementById("count-inventory"),
    openingOverlay: document.getElementById("opening-overlay"),
    crateContainer: document.getElementById("crate-container"),
    rewardContainer: document.getElementById("reward-container"),
    rewardImage: document.getElementById("reward-image"),
    rewardEmoji: document.getElementById("reward-emoji"),
    rewardName: document.getElementById("reward-name"),
    rewardRarity: document.getElementById("reward-rarity"),
    rewardCps: document.getElementById("reward-cps"),
    singleRewardContent: document.getElementById("single-reward-content"),
    multiRewardContent: document.getElementById("multi-reward-content"),
    multiGrid: document.getElementById("multi-grid"),
    multiTotalCps: document.getElementById("multi-total-cps"),
    multiFooter: document.querySelector(".multi-footer"),
    multiContinueBtn: document.getElementById("multi-continue-btn"),
    closeOpeningBtn: document.getElementById("close-opening-btn"),
    skipAnimBtn: document.getElementById("skip-animation-btn"),
    promoCodeInput: document.getElementById("promo-code-input"),
    promoCodeBtn: document.getElementById("promo-code-btn")
};

let currentShop = null;
let modalState = {
    item: null,
    category: null,
    qty: 1
};
let inventoryOpenState = {
    item: null,
    ownedQty: 0,
    cardElement: null
};

let animationState = {
    skipping: false
};

let purchaseBlockedUntil = 0;

const economyState = {
    syncedGold: 0,
    coinPerSec: 0,
    syncedAtMs: Date.now(),
    syncInFlight: null
};

let userInventory = {};

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
    eternel: "#ef4444",
    STI: "#ec4899"
};

const RARITY_WEIGHTS = {
    commun: 60,
    ancestral: 25,
    epique: 10,
    divin: 4,
    eternel: 1
};

function getAuthToken() {
    return window.BrainrotAuth.getToken();
}

function setEconomySnapshot(gold, coinPerSec) {
    economyState.syncedGold = Math.max(0, Number(gold || 0));
    economyState.coinPerSec = Math.max(0, Number(coinPerSec || 0));
    economyState.syncedAtMs = Date.now();
}

function getSimulatedGoldNow() {
    const elapsedSec = Math.max(0, (Date.now() - economyState.syncedAtMs) / 1000);
    return Math.max(0, economyState.syncedGold + elapsedSec * economyState.coinPerSec);
}

function renderWalletFromEconomy() {
    ui.wallet.textContent = `${formatCompactPrice(getSimulatedGoldNow())} 💰`;
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function tryOpenChestApiForQty(itemId, qty) {
    if (!isUuid(itemId)) return { handled: false, opened: 0, chests: [] };
    const token = getAuthToken();
    if (!token) return { handled: false, opened: 0, chests: [] };
    const safeQty = Math.max(0, Math.floor(Number(qty || 0)));
    if (safeQty <= 0) return { handled: true, opened: 0, chests: [] };

    for (const base of USER_ROUTE_BASES) {
        try {
            const response = await fetch(`${API_BASE_URL}${base}/chest/open`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    chestId: itemId,
                    quantity: safeQty
                })
            });
            if (!response.ok){
              const errorData = await response.json().catch(() => ({}));
              return alert(errorData?.message || "Erreur lors de l'ouverture");
            };
            const payload = await response.json();
            if (!payload?.success){
              return alert(payload?.message || "Erreur lors de l'ouverture");
            };
            const chests = Array.isArray(payload?.chests) ? payload.chests : [];
            const opened = chests.length || safeQty;
            return { handled: true, opened: Math.max(0, opened), chests };
        } catch {
            continue;
        }
    }
    return { handled: false, opened: 0, chests: [] };
}

let cachedBrainrotCatalog = null;

async function fetchBrainrotItems() {
    try {
        if (cachedBrainrotCatalog) {
            return cachedBrainrotCatalog;
        }

        const response = await fetch(`${API_BASE_URL}/user/getAllBrainRot`);
        if (!response.ok) {
            return null;
        }
        
        const payload = await response.json();
        if (!payload?.success || !Array.isArray(payload?.result)) {
            return null;
        }

        const catalog = {};
        payload.result.forEach(card => {
            const rarity = card.rarity || "commun";
            if (!catalog[rarity]) {
                catalog[rarity] = {
                    color: window.BRAINROT_RARITY_COLORS?.[rarity] || "#a3a3a3",
                    items: []
                };
            }
            catalog[rarity].items.push({
                name: card.name,
                emoji: card.emoji || "🃏",
                image: card.link || card.imageUrl || card.image || "",
                cps: card.goldPerSec || card.cps || 0
            });
        });

        cachedBrainrotCatalog = catalog;
        return catalog;
    } catch (error) {
        console.error("Error fetching brainrot items:", error);
        return null;
    }
}

function pickRandomRarity() {
    const rand = Math.random() * 100;
    let accum = 0;
    for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
        accum += weight;
        if (rand <= accum) return rarity;
    }
    return "commun";
}

function pickRandomItem(data, rarity) {
    const category = data[rarity];
    if (!category || !category.items || !category.items.length) return null;
    const items = category.items;
    return items[Math.floor(Math.random() * items.length)];
}

async function playOpeningAnimation(qty, itemName, crateEmoji = "📦", realChests = []) {
    animationState.skipping = false;

    ui.openingOverlay.classList.remove("hidden");
    void ui.openingOverlay.offsetWidth;
    ui.openingOverlay.classList.add("active");
    document.body.classList.add("no-scroll");
    
    ui.crateContainer.classList.remove("hidden");
    ui.rewardContainer.classList.add("hidden");
    ui.singleRewardContent.classList.add("hidden");
    ui.multiRewardContent.classList.add("hidden");
    ui.skipAnimBtn.classList.remove("hidden");
    
    ui.closeOpeningBtn.classList.add("hidden");
    ui.closeOpeningBtn.style.display = "none";
    
    const crate = ui.crateContainer.querySelector(".crate-shake");
    crate.textContent = crateEmoji;
    crate.classList.remove("shaking");
    crate.style.transform = "scale(1)";

    const delay = (ms) => new Promise(resolve => {
        if (animationState.skipping) return resolve();
        const timeout = setTimeout(resolve, ms);
        const checkSkip = setInterval(() => {
            if (animationState.skipping) {
                clearTimeout(timeout);
                clearInterval(checkSkip);
                resolve();
            }
        }, 50);
        setTimeout(() => clearInterval(checkSkip), ms);
    });

    if (!animationState.skipping) {
        await delay(100);
        crate.classList.add("shaking");
        
        await delay(1500);
        
        crate.classList.remove("shaking");
        crate.classList.add("crate-explode");
        
        await delay(300);
    }

    const items = [];

    if (realChests && realChests.length > 0) {
        for (const chest of realChests) {
            if (chest.rewards && Array.isArray(chest.rewards)) {
                for (const reward of chest.rewards) {
                    if (reward.type === "Card") {
                        const item = {
                            name: reward.cardName || "Mystère",
                            emoji: "🃏",
                            cps: reward.cardGoldPerSec || 0,
                            image: reward.cardLink || "",
                            rarity: reward.cardRarity || "commun"
                        };
                        items.push(item);
                    }
                }
            }
        }
    }

    if (items.length === 0) {
        alert(`Erreur`);
        return;
    }

    ui.crateContainer.classList.add("hidden");
    crate.classList.remove("crate-explode");
    ui.rewardContainer.classList.remove("hidden");

    if (qty === 1) {
        const item = items[0];
        ui.singleRewardContent.classList.remove("hidden");
        
        if (item.image) {
            ui.rewardImage.src = item.image;
            ui.rewardImage.classList.remove("hidden");
            ui.rewardEmoji.classList.add("hidden");
        } else {
            ui.rewardImage.classList.add("hidden");
            ui.rewardEmoji.textContent = item.emoji;
            ui.rewardEmoji.classList.remove("hidden");
        }
        
        ui.rewardName.textContent = item.name;
        ui.rewardCps.textContent = formatCompactPrice(item.cps || 0);
        ui.rewardRarity.textContent = item.rarity.toUpperCase();
        
        const color = RARITY_COLORS[item.rarity] || "#fff";
        ui.rewardRarity.style.color = color;
        ui.rewardRarity.style.borderColor = color;
        ui.rewardRarity.style.boxShadow = `0 0 15px ${color}40`;
        ui.rewardRarity.className = `reward-rarity rarity-${item.rarity}`;
        ui.skipAnimBtn.classList.add("hidden");
        ui.closeOpeningBtn.classList.remove("hidden");
        ui.closeOpeningBtn.style.display = "inline-flex";
        
    } else {
        ui.multiRewardContent.classList.remove("hidden");
        ui.multiGrid.innerHTML = "";
        
        if (qty <= 10 && !animationState.skipping) {
            if (ui.multiFooter) ui.multiFooter.classList.add("hidden");
        } else {
            if (ui.multiFooter) ui.multiFooter.classList.remove("hidden");
        }
        
        let totalCps = 0;
        
        items.sort((a, b) => (b.cps || 0) - (a.cps || 0));

        const cards = [];
        items.forEach(item => {
            totalCps += (item.cps || 0);
            const card = document.createElement("div");
            card.className = `multi-item-card multi-card-${item.rarity}`;
            
            if (qty <= 10) {
                card.style.opacity = "0";
                card.style.transform = "scale(0.5)";
            }

            const imgHtml = item.image 
                ? `<img src="${item.image}" class="multi-item-img" alt="${item.name}">`
                : `<div style="font-size: 3rem;">${item.emoji}</div>`;

            card.innerHTML = `
                ${imgHtml}
                <div class="multi-item-name" title="${item.name}">${item.name}</div>
                <div class="multi-item-cps">⚡ ${formatCompactPrice(item.cps)}/s</div>
            `;
            ui.multiGrid.appendChild(card);
            cards.push(card);
        });
        
        ui.multiTotalCps.textContent = formatCompactPrice(totalCps);

        if (qty <= 10) {
            for (let i = 0; i < cards.length; i++) {
                await delay(400);
                const card = cards[i];
                card.style.transition = "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
                card.style.opacity = "1";
                card.style.transform = "scale(1)";
            }
            await delay(300);
            
            if (ui.multiFooter) {
                ui.multiFooter.classList.remove("hidden");
                ui.multiFooter.animate([
                    { opacity: 0, transform: 'translateY(20px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ], { duration: 500, fill: 'forwards' });
            }
        }
        
        ui.skipAnimBtn.classList.add("hidden");
    }
}

function closeOpeningOverlay() {
    ui.openingOverlay.classList.remove("active");
    document.body.classList.remove("no-scroll");
    setTimeout(() => {
        ui.openingOverlay.classList.add("hidden");
    }, 300);
}


function formatCompactPrice(value) {
    const num = Number(value || 0);
    if (num >= 1_000_000_000_000) {
        return `${(num / 1_000_000_000_000).toFixed(2).replace(/\.00$/, "")}T`;
    }
    if (num >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
    }
    if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
    }
    if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
    }
    return `${(Math.round(num * 100) / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}`;
}

async function fetchUserInventory() {
    const token = getAuthToken();
    if (!token) return;
    try {
        const response = await fetch(`${API_BASE_URL}/user/inv`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.success) return;
        const inventoryList = Array.isArray(data?.result)
            ? data.result
            : Array.isArray(data?.result?.result)
                ? data.result.result
                : Array.isArray(data?.inv)
                    ? data.inv
                    : Array.isArray(data?.value)
                        ? data.value
                        : [];
        userInventory = {};
        inventoryList.forEach((item) => {
            const chestId = item?.chest?.id || item?.chestId;
            if (!chestId) return;
            const rawQty = Number(item?.quantity ?? item?.qty ?? 1);
            const qty = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
            userInventory[chestId] = (userInventory[chestId] || 0) + qty;
        });
    } catch (error) {
    }
}

function getItemCount(itemId) {
    return Number(userInventory[itemId] || 0);
}

function getRandomDisplayMoney() {
    const min = 10_000_000;
    const max = 99_000_000_000;
    return Math.floor(Math.random() * (max - min + 1) + min);
}

async function fetchUserStats() {
    const token = getAuthToken();
    if (!token) return null;
    for (const base of USER_ROUTE_BASES) {
        try {
            const response = await fetch(`${API_BASE_URL}${base}/stats`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            if (!response.ok) continue;
            const payload = await response.json();
            if (!payload?.success || !payload?.value) continue;
            return payload.value;
        } catch {
            continue;
        }
    }
    return null;
}

async function fetchUserGold(token) {
    for (const base of USER_ROUTE_BASES) {
        try {
            const response = await fetch(`${API_BASE_URL}${base}/gold`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            if (!response.ok) continue;
            const payload = await response.json();
            if (payload?.success && typeof payload?.value !== "undefined") {
                return Number(payload.value || 0);
            }
            if (payload && typeof payload?.gold !== "undefined") {
                return Number(payload.gold || 0);
            }
            if (typeof payload === "number") {
                return Number(payload || 0);
            }
        } catch {
            continue;
        }
    }
    return null;
}

async function syncEconomyFromServer({ forceGoldSync = false } = {}) {
    if (economyState.syncInFlight) return economyState.syncInFlight;
    economyState.syncInFlight = (async () => {
        const token = getAuthToken();
        if (!token) return false;
        const stats = await fetchUserStats();
        if (!stats) return false;
        const nextCoinPerSec = Number(stats.coinPerSec || 0);
        let nextGold = Number(stats.gold || 0);
        const shouldSyncGold = forceGoldSync || Date.now() - economyState.syncedAtMs >= GOLD_SYNC_INTERVAL_MS;
        if (shouldSyncGold) {
            const apiGold = await fetchUserGold(token);
            if (apiGold !== null) nextGold = apiGold;
        }
        setEconomySnapshot(nextGold, nextCoinPerSec);
        renderWalletFromEconomy();
        return true;
    })().finally(() => {
        economyState.syncInFlight = null;
    });
    return economyState.syncInFlight;
}

async function buyShopItemByApi(itemId, qty) {
    if (!isUuid(itemId)) return { bought: 0, outOfMoney: false };
    const token = getAuthToken();
    if (!token) return { bought: 0, outOfMoney: false };
    const safeQty = Math.max(1, Math.floor(Number(qty || 1)));
    let outOfMoney = false;
    let bought = 0;
    
    // Un seul appel API pour acheter toutes les caisses
    try {
        const response = await fetch(`${API_BASE_URL}${SHOP_ROUTE_BASE}/buy/${encodeURIComponent(itemId)}/${safeQty}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        if (!response.ok) {
            try {
                const payload = await response.json();
                const message = String(payload?.message || payload?.error || "");
                if (message.toLowerCase().includes("no money")) outOfMoney = true;
            } catch {}
            return { bought: 0, outOfMoney };
        }
        const payload = await response.json();
        if (!payload?.success) {
            const message = String(payload?.message || payload?.error || "");
            if (message.toLowerCase().includes("no money")) outOfMoney = true;
            return { bought: 0, outOfMoney };
        }
        bought = safeQty;
    } catch {
        return { bought: 0, outOfMoney: false };
    }
    
    return { bought, outOfMoney };
}

function normalizeShopData(payload) {
    const chestList = Array.isArray(payload?.result?.result) ? payload.result.result : [];
    const items = chestList.map((chest) => {
        // Grouper les loots par rarity
        const lootsByRarity = {};
        if (Array.isArray(chest?.loot)) {
            chest.loot.forEach(loot => {
                const rarity = loot?.rarity || "unknown";
                const dropRate = Number(loot?.dropRate || 0);
                if (!lootsByRarity[rarity]) {
                    lootsByRarity[rarity] = 0;
                }
                lootsByRarity[rarity] += dropRate * 100;
            });
        }
        
        return {
            id: chest?.id,
            nom: chest?.name || "Caisse inconnue",
            emoji: chest?.icon || "📦",
            prix: Number(chest?.baseCoins || 0),
            probabilites: lootsByRarity,
            description: chest?.description || "",
            loot: chest?.loot || []
        };
    });
    return {
        categories: {
            caisses: items,
            boosts: { caisses_boost: [] }
        }
    };
}

function getSelectedQtyButtons() {
    return Array.from(document.querySelectorAll(".buy-qty-btn"));
}


function getTotalPrice(item, qty) {
    const unit = Number(item?.prix || 0);
    return unit * qty;
}

function updateModalActionTexts() {
    if (!modalState.item) return;
    const total = getTotalPrice(modalState.item, modalState.qty);
    const totalText = `${formatCompactPrice(total)} 💰`;
    const currentGold = getSimulatedGoldNow();
    const canAfford = currentGold >= total;
    
    ui.buyModalToInventory.textContent = `Mettre en inv • ${totalText}`;
    ui.buyModalOpenNow.textContent = `Ouvrir tout de suite • ${totalText}`;
    
    ui.buyModalToInventory.disabled = !canAfford;
    ui.buyModalOpenNow.disabled = !canAfford;
    ui.buyModalToInventory.classList.toggle("disabled", !canAfford);
    ui.buyModalOpenNow.classList.toggle("disabled", !canAfford);
    
    if (!canAfford) {
        const needed = total - currentGold;
        const tooltip = `Tu as besoin de ${formatCompactPrice(needed)} 💰 de plus`;
        ui.buyModalToInventory.title = tooltip;
        ui.buyModalOpenNow.title = tooltip;
    } else {
        ui.buyModalToInventory.title = "";
        ui.buyModalOpenNow.title = "";
    }
}


function syncQtySelectionUI() {
    getSelectedQtyButtons().forEach((btn) => {
        const btnQty = Number(btn.dataset.qty);
        btn.classList.toggle("active", btnQty === modalState.qty);
    });
}

function openBuyModal(item, category) {
    modalState = { item, category, qty: 1 };
    ui.buyModalItemName.textContent = `${item.emoji || "📦"} ${item.nom}`;
    syncQtySelectionUI();
    ui.buyModal.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    lucide.createIcons();
    syncEconomyFromServer({ forceGoldSync: true });
    
    // Mettre à jour l'état des boutons tous les 500ms
    const updateButtonsInterval = setInterval(() => {
        if (ui.buyModal.classList.contains("hidden")) {
            clearInterval(updateButtonsInterval);
            return;
        }
        if (Date.now() < purchaseBlockedUntil) return;
        updateModalActionTexts();
    }, 500);
}

function closeBuyModal() {
    ui.buyModal.classList.add("hidden");
    if (ui.openInventoryModal.classList.contains("hidden")) {
        document.body.classList.remove("no-scroll");
    }
}

function onSelectQuantity(qty) {
    modalState.qty = qty;
    syncQtySelectionUI();
    updateModalActionTexts();
}

function canPurchaseCurrentSelection() {
    if (!modalState.item) return false;
    return true;
}


function purchaseToInventory() {
    if (!canPurchaseCurrentSelection()) return;
    if (Date.now() < purchaseBlockedUntil) return;
    
    const total = getTotalPrice(modalState.item, modalState.qty);
    const currentGold = getSimulatedGoldNow();
    if (currentGold < total) {
        const needed = total - currentGold;
        alert(`Tu as besoin de ${formatCompactPrice(needed)} 💰 de plus pour effectuer cet achat.`);
        return;
    }

    purchaseBlockedUntil = Date.now() + 2000;
    ui.buyModalToInventory.disabled = true;
    ui.buyModalOpenNow.disabled = true;
    setTimeout(() => {
        ui.buyModalToInventory.disabled = false;
        ui.buyModalOpenNow.disabled = false;
        updateModalActionTexts();
    }, 2000);
    
    syncEconomyFromServer({ forceGoldSync: true })
        .then(() => buyShopItemByApi(modalState.item.id, modalState.qty))
        .then(async ({ bought, outOfMoney }) => {
            if (bought <= 0) {
                alert(outOfMoney ? "Vous n'avez pas assez d'argent pour ouvrir ce coffre." : "Achat impossible pour le moment.");
                return;
            }
            await fetchUserInventory();
            closeBuyModal();
            renderShop(currentShop);
            syncEconomyFromServer({ forceGoldSync: true });
        });
}

async function purchaseOpenNow() {
    if (!canPurchaseCurrentSelection()) return;
    if (Date.now() < purchaseBlockedUntil) return;
    const qty = modalState.qty;
    const item = modalState.item;

    await syncEconomyFromServer({ forceGoldSync: true });
    
    const total = getTotalPrice(item, qty);
    const currentGold = getSimulatedGoldNow();
    if (currentGold < total) {
        const needed = total - currentGold;
        alert(`Tu as besoin de ${formatCompactPrice(needed)} 💰 de plus pour effectuer cet achat.`);
        return;
    }

    purchaseBlockedUntil = Date.now() + 2000;
    ui.buyModalToInventory.disabled = true;
    ui.buyModalOpenNow.disabled = true;
    setTimeout(() => {
        ui.buyModalToInventory.disabled = false;
        ui.buyModalOpenNow.disabled = false;
        updateModalActionTexts();
    }, 2000);
    
    const { bought, outOfMoney } = await buyShopItemByApi(item.id, qty);
    if (bought <= 0) {
        alert(outOfMoney ? "Vous n'avez pas assez d'argent pour ouvrir ce coffre." : "Achat impossible pour le moment.");
        return;
    }

    closeBuyModal();
    const apiOpen = await tryOpenChestApiForQty(item.id, bought);
    const openedQty = apiOpen.handled ? apiOpen.opened : bought;
    if (openedQty <= 0) {
        await fetchUserInventory();
        renderShop(currentShop);
        alert("Achat effectué, mais ouverture indisponible pour le moment.");
        return;
    }

    playOpeningAnimation(openedQty, item.nom, item.emoji, apiOpen.chests);
    
    await fetchUserInventory();
    renderShop(currentShop);
    await syncEconomyFromServer({ forceGoldSync: true });
}

function openInventoryOpenModal(item, ownedQty, cardElement) {
    const maxQty = Math.min(ownedQty, 50);

    inventoryOpenState = { item, ownedQty, cardElement };
    ui.openInventoryItemName.textContent = `${item.emoji || "📦"} ${item.nom}`;
    ui.openInventoryQty.value = "1";
    ui.openInventoryQty.max = `${maxQty}`;
    ui.openInventoryMax.textContent = `Tu possèdes ${formatCompactPrice(ownedQty)} exemplaire(s). (max 50 utilisables)`;
    ui.openInventoryModal.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    lucide.createIcons();
}

function closeInventoryOpenModal() {
    ui.openInventoryModal.classList.add("hidden");
    if (ui.buyModal.classList.contains("hidden")) {
        document.body.classList.remove("no-scroll");
    }
}

function getOpenQtyValue() {
    const raw = Number(ui.openInventoryQty.value || 1);
    if (!Number.isFinite(raw)) return 1;
    return Math.floor(raw);
}

function triggerOpenAnimation(cardElement) {
    if (!cardElement) return;
    cardElement.classList.remove("open-flash");
    requestAnimationFrame(() => {
        cardElement.classList.add("open-flash");
        setTimeout(() => cardElement.classList.remove("open-flash"), 950);
    });
}

async function confirmOpenInventoryQuantity() {
    if (!inventoryOpenState.item) return;
    const requested = getOpenQtyValue();
    const qty = Math.min(Math.max(requested, 1), inventoryOpenState.ownedQty);
    if (qty <= 0) return;
    
    const item = inventoryOpenState.item;
    closeInventoryOpenModal();

    const apiOpen = await tryOpenChestApiForQty(item.id, qty);
    const openedQty = apiOpen.handled ? apiOpen.opened : qty;
    if (openedQty <= 0) return;

    playOpeningAnimation(openedQty, item.nom, item.emoji, apiOpen.chests);
    
    await fetchUserInventory();
    renderShop(currentShop);
}

function createLootDisplay(lootsByRarity) {
    const rarityOrder = ["commun", "peu-commun", "rare", "tres-rare", "epique", "legendaire", "mythique", "divin", "ultime", "secret", "ancestral", "eternel", "STI"];
    
    const sortedRarities = Object.entries(lootsByRarity)
        .sort((a, b) => {
            const indexA = rarityOrder.indexOf(a[0]);
            const indexB = rarityOrder.indexOf(b[0]);
            return indexA - indexB;
        });
    
    if (sortedRarities.length === 0) {
        return '<div class="loot-list">Aucun loot disponible</div>';
    }
    
    const lootHTML = sortedRarities.map(([rarity, percentage]) => {
        const color = RARITY_COLORS[rarity] || "#a3a3a3";
        const displayPercentage = percentage.toFixed(1);
        return `<div class="loot-item" style="border-left: 3px solid ${color}">
            <span class="loot-rarity" style="color: ${color}">${rarity.toUpperCase()}</span>
            <span class="loot-percentage">${displayPercentage}%</span>
        </div>`;
    }).join('');
    
    return `<div class="loot-list">${lootHTML}</div>`;
}

function createBuyCard(item, category) {
    const card = document.createElement("article");
    card.className = "shop-card";

    const count = getItemCount(item.id);
    const lootDisplay = createLootDisplay(item.probabilites);

    card.innerHTML = `
        <div class="shop-card-head">
            <div class="shop-card-name">${item.emoji || "📦"} ${item.nom}</div>
            <div class="shop-card-price">${formatCompactPrice(item.prix)} 💰</div>
        </div>
        <div class="shop-card-details">Possédé: <strong>${count}</strong></div>
        ${lootDisplay}
        <button class="buy-btn">Acheter</button>
    `;

    const buyBtn = card.querySelector(".buy-btn");
    
    const updateButtonState = () => {
        const currentGold = getSimulatedGoldNow();
        const canAfford = currentGold >= item.prix;
        buyBtn.disabled = !canAfford;
        buyBtn.classList.toggle("disabled", !canAfford);
        if (!canAfford) {
            buyBtn.title = `Tu as besoin de ${formatCompactPrice(item.prix - currentGold)} 💰 de plus`;
        } else {
            buyBtn.title = "";
        }
    };
    
    updateButtonState();
    
    buyBtn.addEventListener("click", () => {
        updateButtonState();
        if (!buyBtn.disabled) {
            openBuyModal(item, category);
        }
    });
    
    // Mettre à jour l'état du bouton tous les 500ms quand le gold change
    const updateInterval = setInterval(updateButtonState, 500);
    
    // Nettoyer l'intervalle quand la carte est retirée du DOM
    const observer = new MutationObserver((mutations) => {
        if (!document.contains(card)) {
            clearInterval(updateInterval);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return card;
}

function buildShopItemMap(data) {
    const map = new Map();
    const caisses = Array.isArray(data?.categories?.caisses) ? data.categories.caisses : [];
    const boostCaisses = Array.isArray(data?.categories?.boosts?.caisses_boost)
        ? data.categories.boosts.caisses_boost
        : [];
    [...caisses, ...boostCaisses].forEach((item) => {
        if (item?.id) map.set(item.id, item);
    });
    return map;
}

function renderInventory(data) {
    const itemMap = buildShopItemMap(data);
    const ownedEntries = Object.entries(userInventory)
        .map(([itemId, qty]) => ({ itemId, qty: Number(qty || 0) }))
        .filter((entry) => entry.qty > 0 && itemMap.has(entry.itemId))
        .sort((a, b) => b.qty - a.qty);

    ui.countInventory.textContent = `${ownedEntries.length}`;
    ui.inventoryGrid.innerHTML = "";

    if (!ownedEntries.length) {
        ui.inventoryGrid.innerHTML = `<p class="empty-state inventory-empty">Ton inventaire est vide pour le moment.</p>`;
        return;
    }

    ownedEntries.forEach(({ itemId, qty }) => {
        const item = itemMap.get(itemId);
        const card = document.createElement("article");
        card.className = "shop-card inventory-card";
        card.innerHTML = `
            <div class="shop-card-head">
                <div class="shop-card-name">${item.emoji || "📦"} ${item.nom}</div>
                <div class="shop-card-price">x${formatCompactPrice(qty)}</div>
            </div>
            <div class="shop-card-details">Prix unitaire: ${formatCompactPrice(item.prix)} 💰</div>
            <button class="inventory-open-btn" type="button">Ouvrir une quantité personnalisée</button>
        `;
        const openBtn = card.querySelector(".inventory-open-btn");
        openBtn.addEventListener("click", () => {
            openInventoryOpenModal(item, qty, card);
        });
        ui.inventoryGrid.appendChild(card);
    });
}

function renderShop(data) {
    currentShop = data;

    const caisses = Array.isArray(data?.categories?.caisses) ? [...data.categories.caisses] : [];
    const boostCaisses = Array.isArray(data?.categories?.boosts?.caisses_boost)
        ? [...data.categories.boosts.caisses_boost]
        : [];
    caisses.sort((a, b) => Number(a?.prix || 0) - Number(b?.prix || 0));
    boostCaisses.sort((a, b) => Number(a?.prix || 0) - Number(b?.prix || 0));

    ui.countCaisses.textContent = `${caisses.length}`;
    ui.countBoostCaisses.textContent = `${boostCaisses.length}`;

    ui.caissesGrid.innerHTML = "";
    ui.boostCaissesGrid.innerHTML = "";

    if (!caisses.length) {
        ui.caissesGrid.innerHTML = `<p class="empty-state">Aucune caisse disponible.</p>`;
    } else {
        caisses.forEach((item) => ui.caissesGrid.appendChild(createBuyCard(item, "caisses")));
    }

    if (!boostCaisses.length) {
        const comingSoonCard = document.createElement("article");
        comingSoonCard.className = "shop-card coming-soon-card";
        comingSoonCard.innerHTML = `
            <div class="coming-soon-overlay">
                <div class="coming-soon-content">
                    <i data-lucide="lock" class="coming-soon-icon"></i>
                    <p class="coming-soon-label">Boost bientôt disponible</p>
                </div>
            </div>
            <div class="shop-card-head">
                <div class="shop-card-name">📦 Caisse Boost</div>
                <div class="shop-card-price">??? 💰</div>
            </div>
            <div class="shop-card-details">Bientôt disponible</div>
            <div class="shop-card-details">Restez connectés !</div>
            <button class="buy-btn" disabled>Bientôt disponible</button>
        `;
        ui.boostCaissesGrid.appendChild(comingSoonCard);
    } else {
        boostCaisses.forEach((item) => ui.boostCaissesGrid.appendChild(createBuyCard(item, "boosts")));
    }

    renderInventory(data);
    lucide.createIcons();
}

async function loadShop() {
    GlobalLoader.show();
    try {
        const token = await window.BrainrotAuth.waitUntilReady();
        if (!token) throw new Error("No auth token");
        const response = await fetch(`${API_BASE_URL}${SHOP_ROUTE_BASE}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const normalized = normalizeShopData(data);
        await fetchUserInventory();
        renderShop(normalized);
        await syncEconomyFromServer({ forceGoldSync: true });
    } catch (error) {
        console.error("Erreur chargement boutique:", error);
        ui.caissesGrid.innerHTML = `
            <p class="empty-state">
                Le backend n'est pas disponible. Lance <code>npm run dev</code> dans le dossier backend.
            </p>
        `;
    } finally {
        GlobalLoader.hide(true);

    }
}

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
    ui.wallet.textContent = `${formatCompactPrice(getRandomDisplayMoney())} 💰`;
    setInterval(() => {
        renderWalletFromEconomy();
    }, 100);
    setInterval(() => {
        syncEconomyFromServer({ forceGoldSync: true });
    }, GOLD_SYNC_INTERVAL_MS);
    ui.buyModalClose.addEventListener("click", closeBuyModal);
    ui.buyModal.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeModal === "true") {
            closeBuyModal();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (!ui.openInventoryModal.classList.contains("hidden")) {
            closeInventoryOpenModal();
            return;
        }
        if (!ui.buyModal.classList.contains("hidden")) {
            closeBuyModal();
        }
    });
    ui.openInventoryClose.addEventListener("click", closeInventoryOpenModal);
    ui.openInventoryModal.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeOpenModal === "true") {
            closeInventoryOpenModal();
        }
    });
    ui.openInventoryConfirm.addEventListener("click", confirmOpenInventoryQuantity);
    ui.openInventoryQty.addEventListener("input", () => {
        const max = Number(ui.openInventoryQty.max || inventoryOpenState.ownedQty || 1);
        const value = getOpenQtyValue();
        if (value < 1) {
            ui.openInventoryQty.value = "1";
            return;
        }
        if (value > max) {
            ui.openInventoryQty.value = `${max}`;
        }
    });
    
    ui.closeOpeningBtn.addEventListener("click", closeOpeningOverlay);
    ui.multiContinueBtn?.addEventListener("click", closeOpeningOverlay);
    ui.skipAnimBtn?.addEventListener("click", () => {
        animationState.skipping = true;
    });
    
    getSelectedQtyButtons().forEach((btn) => {
        btn.addEventListener("click", () => {
            const qty = Number(btn.dataset.qty);
            onSelectQuantity(qty);
        });
    });
    ui.buyModalToInventory.addEventListener("click", purchaseToInventory);
    ui.buyModalOpenNow.addEventListener("click", purchaseOpenNow);
    if (ui.scrollToInventoryBtn && ui.inventorySection) {
        ui.scrollToInventoryBtn.addEventListener("click", () => {
            ui.inventorySection.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }
    ui.promoCodeBtn?.addEventListener("click", async () => {
        const code = ui.promoCodeInput?.value?.trim();
        if (!code) {
            alert("Entre un code valide");
            return;
        }
        
        const token = getAuthToken();
        if (!token) {
            alert("Erreur d'authentification");
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/code/${encodeURIComponent(code)}`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                alert(data.message || "Code invalide ou déjà utilisé");
                return;
            }

            const result = data.result?.result;
            let message = "Code validé avec succès ! ";

            if (result?.type === "Gold") {
                message += `Tu as reçu ${formatCompactPrice(result.amount)} pièces 💰`;
            } else if (result?.type === "Card") {
                message += `Tu as reçu une carte 🃏`;
            } else if (result?.type === "Chest") {
                message += `Tu as reçu une caisse 📦`;
            }

            alert(message);
            
            if (ui.promoCodeInput) ui.promoCodeInput.value = "";
            
            await syncEconomyFromServer({ forceGoldSync: true });
            loadShop();
        } catch (error) {
            console.error("Erreur validation code:", error);
            alert("Impossible de valider le code pour le moment");
        }
    });

    ui.promoCodeInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            ui.promoCodeBtn?.click();
        }
    });

    loadShop();
});