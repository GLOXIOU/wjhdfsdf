const API_BASE_URL = window.API_BASE_URL + "";
const USER_ROUTE_BASES = ["/user"];
const GOLD_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const REBIRTH_TIERS = [
    {
        id: 1,
        name: "Éveillé",
        icon: "🌱",
        cost: 500_000_000,
        costLabel: "500M",
        rewards: [
            { type: "cps", value: "+10% CPS global" },
            { type: "gold", value: "+100K 💰", goldReward: 100_000 },
            { type: "chest-epic", value: "5x Caisse Épique" }
        ]
    },
    {
        id: 2,
        name: "Illuminé",
        icon: "✨",
        cost: 1_000_000_000,
        costLabel: "1B",
        rewards: [
            { type: "cps", value: "+10% CPS global" },
            { type: "gold", value: "+120K 💰", goldReward: 120_000 },
            { type: "chest-epic", value: "5x Caisse Épique" }
        ]
    },
    {
        id: 3,
        name: "Transcendé",
        icon: "🌀",
        cost: 10_000_000_000,
        costLabel: "10B",
        rewards: [
            { type: "cps", value: "+10% CPS global" },
            { type: "gold", value: "+150K 💰", goldReward: 150_000 },
            { type: "chest-epic", value: "10x Caisse Épique" }
        ]
    },
    {
        id: 4,
        name: "Ascendant",
        icon: "🔥",
        cost: 100_000_000_000,
        costLabel: "100B",
        rewards: [
            { type: "cps", value: "+10% CPS global" },
            { type: "gold", value: "+170K 💰", goldReward: 170_000 },
            { type: "chest-mythique", value: "1x Caisse Mythique" }
        ]
    },
    {
        id: 5,
        name: "Cosmique",
        icon: "🌌",
        cost: 1_000_000_000_000,
        costLabel: "1T",
        rewards: [
            { type: "cps", value: "+10% CPS global" },
            { type: "gold", value: "+200K 💰", goldReward: 200_000 },
            { type: "chest-mythique", value: "5x Caisse Mythique" }
        ]
    }
];

function getTotalCpsBonus(completedCount) {
    return completedCount * 10;
}

const economyState = {
    gold: 0,
    coinPerSec: 0,
    syncedAtMs: Date.now(),
    syncInFlight: null
};

const state = {
    completedRebirths: 0
};

const ui = {
    walletValue: document.getElementById("wallet-value"),
    rebirthLevelBadge: document.getElementById("rebirth-level-badge"),
    rebirthLevelIcon: document.getElementById("rebirth-level-icon"),
    rebirthLevelName: document.getElementById("rebirth-level-name"),
    rebirthCount: document.getElementById("rebirth-count"),
    rebirthCpsBonus: document.getElementById("rebirth-cps-bonus"),
    rebirthNextCard: document.getElementById("rebirth-next-card"),
    rebirthNextCost: document.getElementById("rebirth-next-cost"),
    rebirthCostValue: document.getElementById("rebirth-cost-value"),
    rebirthRewardsPreview: document.getElementById("rebirth-rewards-preview"),
    rebirthBtn: document.getElementById("rebirth-btn"),
    tiersDoneCount: document.getElementById("tiers-done-count"),
    rebirthTiersList: document.getElementById("rebirth-tiers-list"),
    confirmModal: document.getElementById("rebirth-confirm-modal"),
    modalOverlay: document.getElementById("rebirth-modal-overlay"),
    modalNextLevel: document.getElementById("rebirth-modal-next-level"),
    modalRewardsList: document.getElementById("rebirth-modal-rewards-list"),
    modalCancel: document.getElementById("rebirth-modal-cancel"),
    modalConfirm: document.getElementById("rebirth-modal-confirm"),
    successOverlay: document.getElementById("rebirth-success-overlay"),
    successIcon: document.getElementById("success-icon"),
    successTitle: document.getElementById("success-title"),
    successSub: document.getElementById("success-sub"),
    successRewards: document.getElementById("success-rewards"),
    successClose: document.getElementById("rebirth-success-close")
};

function getAuthToken() {
    return window.BrainrotAuth.getToken();
}

function formatCompact(value) {
    const num = Number(value || 0);
    if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2).replace(/\.00$/, "")}T`;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
    return `${Math.round(num * 100) / 100}`;
}

function getSimulatedGold() {
    const elapsed = Math.max(0, (Date.now() - economyState.syncedAtMs) / 1000);
    return Math.max(0, economyState.gold + elapsed * economyState.coinPerSec);
}

function setEconomySnapshot(gold, coinPerSec) {
    economyState.gold = Math.max(0, Number(gold || 0));
    economyState.coinPerSec = Math.max(0, Number(coinPerSec || 0));
    economyState.syncedAtMs = Date.now();
}

async function fetchUserStats() {
    const token = getAuthToken();
    if (!token) return null;
    for (const base of USER_ROUTE_BASES) {
        try {
            const response = await apiFetch(`${API_BASE_URL}${base}/stats`, {
                headers: { "Authorization": `Bearer ${token}` }
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
            const response = await apiFetch(`${API_BASE_URL}${base}/gold`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!response.ok) continue;
            const payload = await response.json();
            if (payload?.success && typeof payload?.value !== "undefined") return Number(payload.value || 0);
            if (payload && typeof payload?.gold !== "undefined") return Number(payload.gold || 0);
            if (typeof payload === "number") return Number(payload || 0);
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
        let nextGold = Number(stats.gold || 0);
        const nextCps = Number(stats.coinPerSec || 0);
        const shouldSyncGold = forceGoldSync || Date.now() - economyState.syncedAtMs >= GOLD_SYNC_INTERVAL_MS;
        if (shouldSyncGold) {
            const apiGold = await fetchUserGold(token);
            if (apiGold !== null) nextGold = apiGold;
        }
        setEconomySnapshot(nextGold, nextCps);
        state.completedRebirths = Number(stats.hasRebirth || 0);
        return true;
    })().finally(() => {
        economyState.syncInFlight = null;
    });
    return economyState.syncInFlight;
}

function buildRewardChips(rewards) {
    return rewards.map(r => `<span class="reward-chip ${r.type}">${r.value}</span>`).join("");
}

function renderWallet() {
    ui.walletValue.textContent = `${formatCompact(getSimulatedGold())} 💰`;
}

function renderStatus() {
    const done = state.completedRebirths;
    const currentTier = REBIRTH_TIERS[done - 1] || null;
    const totalBonus = getTotalCpsBonus(done);

    if (currentTier) {
        ui.rebirthLevelIcon.textContent = currentTier.icon;
        ui.rebirthLevelName.textContent = currentTier.name;
    } else {
        ui.rebirthLevelIcon.textContent = "🌱";
        ui.rebirthLevelName.textContent = "Aucun";
    }

    ui.rebirthCount.textContent = done;
    ui.rebirthCpsBonus.textContent = `+${totalBonus}%`;
}

function renderNextRebirthCard() {
    const nextIndex = state.completedRebirths;
    const gold = getSimulatedGold();

    if (nextIndex >= REBIRTH_TIERS.length) {
        ui.rebirthNextCard.classList.add("locked");
        ui.rebirthCostValue.textContent = "Tous les rebirths complétés !";
        ui.rebirthBtn.disabled = true;
        ui.rebirthRewardsPreview.innerHTML = `<span class="reward-chip cps">🏆 Tu as tout accompli !</span>`;
        return;
    }

    const tier = REBIRTH_TIERS[nextIndex];
    const canAfford = gold >= tier.cost;

    ui.rebirthNextCard.classList.remove("locked");
    ui.rebirthCostValue.textContent = `${tier.costLabel} 💰`;

    if (canAfford) {
        ui.rebirthNextCost.classList.remove("cannot-afford");
    } else {
        ui.rebirthNextCost.classList.add("cannot-afford");
    }

    ui.rebirthRewardsPreview.innerHTML = buildRewardChips(tier.rewards);
    ui.rebirthBtn.disabled = !canAfford;
}

function renderTiersList() {
    const done = state.completedRebirths;
    ui.tiersDoneCount.textContent = `${done} / ${REBIRTH_TIERS.length} complétés`;
    ui.rebirthTiersList.innerHTML = "";

    REBIRTH_TIERS.forEach((tier, index) => {
        const isDone = index < done;
        const isNext = index === done;

        const card = document.createElement("div");
        let stateClass = isDone ? "tier-done" : isNext ? "tier-current" : "tier-locked";
        card.className = `rebirth-tier-card ${stateClass}`;

        let badgeHTML = "";
        if (isDone) badgeHTML = `<span class="tier-label-done">✓ Complété</span>`;
        else if (isNext) badgeHTML = `<span class="tier-label-current">Prochain</span>`;

        const rightHTML = isDone
            ? `<div class="tier-done-check">✓</div>`
            : `<div class="tier-cost"><span class="tier-cost-label">Coût</span><span>${tier.costLabel} 💰</span></div>`;

        card.innerHTML = `
            <div class="tier-icon">${tier.icon}</div>
            <div class="tier-body">
                <div class="tier-header">
                    <span class="tier-name">Rebirth ${tier.id} — ${tier.name}</span>
                    ${badgeHTML}
                </div>
                <div class="tier-rewards-chips">${buildRewardChips(tier.rewards)}</div>
            </div>
            ${rightHTML}
        `;

        ui.rebirthTiersList.appendChild(card);
    });
}

function render() {
    renderWallet();
    renderStatus();
    renderNextRebirthCard();
    renderTiersList();
}

function openConfirmModal() {
    const nextIndex = state.completedRebirths;
    if (nextIndex >= REBIRTH_TIERS.length) return;
    const tier = REBIRTH_TIERS[nextIndex];

    ui.modalNextLevel.textContent = `${tier.icon} ${tier.name} (Rebirth ${tier.id})`;
    ui.modalRewardsList.innerHTML = buildRewardChips(tier.rewards);
    ui.confirmModal.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    if (window.lucide) lucide.createIcons();
}

function closeConfirmModal() {
    ui.confirmModal.classList.add("hidden");
    document.body.classList.remove("no-scroll");
}

function showSuccessOverlay(tier) {
    ui.successIcon.textContent = tier.icon;
    ui.successTitle.textContent = "Rebirth accompli !";
    ui.successSub.innerHTML = `Tu es maintenant <strong>${tier.icon} ${tier.name}</strong>`;
    ui.successRewards.innerHTML = buildRewardChips(tier.rewards);
    ui.successOverlay.classList.remove("hidden");
    document.body.classList.add("no-scroll");
}

function closeSuccessOverlay() {
    ui.successOverlay.classList.add("hidden");
    document.body.classList.remove("no-scroll");
    // Resync depuis le serveur : les cartes ont été supprimées, CPS doit être recalculé
    syncEconomyFromServer({ forceGoldSync: true }).then(() => render());
}

function bindEvents() {
    ui.rebirthBtn?.addEventListener("click", () => {
        const gold = getSimulatedGold();
        const nextIndex = state.completedRebirths;
        if (nextIndex >= REBIRTH_TIERS.length) return;
        const tier = REBIRTH_TIERS[nextIndex];
        if (gold < tier.cost) return;
        openConfirmModal();
    });

    ui.modalCancel?.addEventListener("click", closeConfirmModal);
    ui.modalOverlay?.addEventListener("click", closeConfirmModal);

    ui.modalConfirm?.addEventListener("click", async () => {
        const nextIndex = state.completedRebirths;
        if (nextIndex >= REBIRTH_TIERS.length) return;
        const tier = REBIRTH_TIERS[nextIndex];

        ui.modalConfirm.disabled = true;

        const token = getAuthToken();
        if (!token) {
            ui.modalConfirm.disabled = false;
            return;
        }

        let payload = null;
        try {
            const response = await apiFetch(`${API_BASE_URL}/user/rebirth`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
            payload = await response.json();
        } catch {
            alert("Erreur de connexion au serveur.");
            ui.modalConfirm.disabled = false;
            return;
        }

        if (!payload?.success) {
            alert(payload?.message || "Erreur lors du rebirth.");
            ui.modalConfirm.disabled = false;
            return;
        }

        const goldReward = typeof payload.goldReward === "number"
            ? payload.goldReward
            : (tier.rewards.find(r => r.goldReward)?.goldReward || 0);

        state.completedRebirths += 1;
        // Reset economy : gold = reward, CPS = 0 (cartes supprimées côté serveur)
        setEconomySnapshot(goldReward, 0);

        closeConfirmModal();
        showSuccessOverlay(tier);
        render();
        ui.modalConfirm.disabled = false;
    });

    ui.successClose?.addEventListener("click", closeSuccessOverlay);

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!ui.successOverlay.classList.contains("hidden")) {
            closeSuccessOverlay();
            return;
        }
        if (!ui.confirmModal.classList.contains("hidden")) {
            closeConfirmModal();
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    GlobalLoader.show();
    if (window.lucide) lucide.createIcons();

    try {
        const token = await window.BrainrotAuth.waitUntilReady();
        if (!token) return;
        await syncEconomyFromServer({ forceGoldSync: true });
        render();
    } finally {
        GlobalLoader.hide(true);
    }

    setInterval(() => {
        renderWallet();
        renderNextRebirthCard();
    }, 500);

    setInterval(() => {
        syncEconomyFromServer({ forceGoldSync: true });
    }, GOLD_SYNC_INTERVAL_MS);

    bindEvents();
});