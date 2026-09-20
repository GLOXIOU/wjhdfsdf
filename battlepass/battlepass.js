const BP_PRICE = 100_000;
const API_BASE_URL = window.API_BASE_URL;
const PASS_ROUTE_BASE = "/pass";
const USER_ROUTE_BASES = ["/user"];
const DEFAULT_BATTLEPASS_REWARDS = [
    { id: null, level: 1, type: "Chest", amount: 1, cardName: null, reward: "📦 Coffre x1" },
    { id: null, level: 2, type: "Chest", amount: 1, cardName: null, reward: "📦 Coffre x1" },
    { id: null, level: 3, type: "Chest", amount: 2, cardName: null, reward: "📦 Coffre x2" },
    { id: null, level: 4, type: "Chest", amount: 2, cardName: null, reward: "📦 Coffre x2" },
    { id: null, level: 5, type: "Chest", amount: 3, cardName: null, reward: "📦 Coffre x3" },
    { id: null, level: 6, type: "Chest", amount: 3, cardName: null, reward: "📦 Coffre x3" }
];

const battlePassState = {
    level: 1,
    xp: 0,
    xpMax: 1000,
    rewards: [...DEFAULT_BATTLEPASS_REWARDS]
};

const claimedRewards = new Set();

const ui = {
    lockCard: document.getElementById("bp-lock-card"),
    buyBtn: document.getElementById("bp-buy-btn"),
    lockFeedback: document.getElementById("bp-lock-feedback"),
    stats: document.getElementById("bp-stats"),
    trackCard: document.getElementById("bp-track-card"),
    successOverlay: document.getElementById("bp-success-overlay"),
    successClose: document.getElementById("bp-success-close")
};

function getAuthToken() {
    return window.BrainrotAuth.getToken();
}

async function getUserStats() {
    const token = getAuthToken();
    if (!token) return null;

    for (const base of USER_ROUTE_BASES) {
        try {
            const response = await fetch(`${API_BASE_URL}${base}/stats`, {
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

async function getBattlePassRewards() {
    const token = getAuthToken();
    if (!token) return [];

    try {
        const response = await fetch(`${API_BASE_URL}${PASS_ROUTE_BASE}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) return [];
        const payload = await response.json();
        const list = Array.isArray(payload?.result) ? payload.result : [];
        return list
            .map((entry) => {
                const type = entry?.type || null;
                const amount = Number(entry?.amount || 1);
                const cardName = entry?.card?.name || null;

                let reward;
                if (type === "Chest") {
                    reward = `📦 Coffre x${amount}`;
                } else if (type === "Gold") {
                    reward = `💰 ${amount.toLocaleString()} pièces`;
                } else if (type === "Card") {
                    reward = `🃏 ${cardName || "Carte"} (niveau ${amount})`;
                } else {
                    reward = `${type || "Récompense"} x${amount}`;
                }

                return { id: entry?.id || null, level: Number(entry?.level || 0), type, amount, cardName, reward };
            })
            .filter((entry) => entry.level > 0)
            .sort((a, b) => a.level - b.level);
    } catch {
        return [];
    }
}

async function getClaimedRewards() {
    const token = getAuthToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}${PASS_ROUTE_BASE}/claims`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) return;
        const payload = await response.json();
        const list = Array.isArray(payload?.result) ? payload.result : [];
        list.forEach((claim) => {
            if (claim?.battlepassId) claimedRewards.add(claim.battlepassId);
        });
    } catch {}
}

function setUnlockedUi(unlocked) {
    if (ui.lockCard) ui.lockCard.classList.toggle("hidden", unlocked);
    if (ui.stats) ui.stats.classList.toggle("bp-locked", !unlocked);
    if (ui.trackCard) ui.trackCard.classList.toggle("bp-locked", !unlocked);
}

function showSuccessOverlay() {
    if (!ui.successOverlay) return;
    ui.successOverlay.classList.remove("hidden");
    document.body.classList.add("no-scroll");
}

function closeSuccessOverlay() {
    if (!ui.successOverlay) return;
    ui.successOverlay.classList.add("hidden");
    document.body.classList.remove("no-scroll");
}

async function purchaseBattlePass() {
    const stats = await getUserStats();
    const money = Number(stats?.gold || 0);
    if (money < BP_PRICE) {
        if (ui.lockFeedback) ui.lockFeedback.textContent = "Pas assez d'argent pour acheter le passe (100 000 💰 requis).";
        return;
    }

    const token = getAuthToken();
    if (!token) {
        if (ui.lockFeedback) ui.lockFeedback.textContent = "Erreur d'authentification.";
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}${PASS_ROUTE_BASE}/buy`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            const payload = await response.json();
            if (ui.lockFeedback) ui.lockFeedback.textContent = payload?.message || "Erreur lors de l'achat du passe.";
            return;
        }

        const payload = await response.json();
        if (!payload?.success) {
            if (ui.lockFeedback) ui.lockFeedback.textContent = payload?.message || "Erreur lors de l'achat du passe.";
            return;
        }

        setUnlockedUi(true);
        if (ui.lockFeedback) ui.lockFeedback.textContent = "";
        showSuccessOverlay();
    } catch (error) {
        console.error("Erreur achat pass:", error);
        if (ui.lockFeedback) ui.lockFeedback.textContent = "Erreur de connexion au serveur.";
    }
}

async function claimReward(battlepassId, entry) {
    if (claimedRewards.has(battlepassId)) return;

    const token = getAuthToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}${PASS_ROUTE_BASE}/claim`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ battlepassId })
        });

        const payload = await response.json();

        if (!payload?.success) {
            alert(`❌ Impossible de récupérer la récompense.\n${payload?.message || ""}`);
            return;
        }

        claimedRewards.add(battlepassId);

        const r = payload.reward;
        const type = r?.type || entry?.type;
        const amount = r?.amount ?? entry?.amount ?? 1;
        const cardName = r?.cardName || entry?.cardName;

        let msg;
        if (type === "Card") {
            msg = `🃏 La carte "${cardName || "?"}" a été ajoutée à ta collection au niveau ${amount} !`;
        } else if (type === "Gold") {
            msg = `💰 Tu as reçu ${Number(amount).toLocaleString()} pièces !`;
        } else if (type === "Chest") {
            msg = `📦 ${amount > 1 ? `${amount} coffres ont été ajoutés` : "Un coffre a été ajouté"} à ton inventaire !`;
        } else {
            msg = entry?.reward || "Récompense récupérée.";
        }

        alert(`🎉 Récompense récupérée !\n\n${msg}`);
        renderBattlePass();
    } catch (error) {
        console.error("Erreur claim:", error);
        alert("❌ Erreur de connexion au serveur.");
    }
}

function renderBattlePass() {
    const levelEl = document.getElementById("bp-level");
    const xpEl = document.getElementById("bp-xp");
    const trackEl = document.getElementById("bp-track-list");

    const currentLevel = Math.floor(Number(battlePassState.level || 1));

    if (levelEl) levelEl.textContent = `${currentLevel}`;
    if (xpEl) xpEl.textContent = `${battlePassState.xp} / ${battlePassState.xpMax}`;
    if (!trackEl) return;

    trackEl.innerHTML = battlePassState.rewards
        .map((entry, index) => {
            const reached = entry.level <= currentLevel;
            const claimed = entry.id ? claimedRewards.has(entry.id) : false;

            let btnClass, btnText, btnDisabled;
            if (claimed) {
                btnClass = "claim-done";
                btnText = "✓ Récupérée";
                btnDisabled = true;
            } else if (reached) {
                btnClass = "claim-ready";
                btnText = "Récupérer la récompense";
                btnDisabled = false;
            } else {
                btnClass = "claim-locked";
                btnText = "🔒 Récupérer la récompense";
                btnDisabled = true;
            }

            return `
                <article class="track-item ${reached ? "track-item-done" : "track-item-locked"}">
                    <div class="lvl">Niveau ${entry.level}</div>
                    <div class="reward">${entry.reward}</div>
                    <button
                        class="track-claim-btn ${btnClass}"
                        data-id="${entry.id || ""}"
                        data-index="${index}"
                        ${btnDisabled ? "disabled" : ""}
                        type="button"
                    >${btnText}</button>
                </article>
            `;
        })
        .join("");

    trackEl.querySelectorAll(".track-claim-btn.claim-ready").forEach((btn) => {
        btn.addEventListener("click", () => {
            const battlepassId = btn.dataset.id;
            const index = Number(btn.dataset.index);
            const entry = battlePassState.rewards[index];
            if (battlepassId) claimReward(battlepassId, entry);
        });
    });
}

async function loadBattlePassData() {
    const token = await window.BrainrotAuth.waitUntilReady();
    if (!token) return;

    const [stats, rewards] = await Promise.all([getUserStats(), getBattlePassRewards()]);
    battlePassState.level = Number(stats?.level || 1);
    battlePassState.xp = Math.round((battlePassState.level - Math.floor(battlePassState.level)) * battlePassState.xpMax);
    battlePassState.rewards = rewards.length ? rewards : [...DEFAULT_BATTLEPASS_REWARDS];

    const hasPremium = Boolean(stats?.hasPass);
    setUnlockedUi(hasPremium);

    if (hasPremium) {
        await getClaimedRewards();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    GlobalLoader.show();
    (async () => {
        try {
            lucide.createIcons();
            ui.buyBtn?.addEventListener("click", purchaseBattlePass);
            ui.successClose?.addEventListener("click", closeSuccessOverlay);
            ui.successOverlay?.addEventListener("click", (event) => {
                if (event.target === ui.successOverlay) closeSuccessOverlay();
            });
            await loadBattlePassData();
            renderBattlePass();
        } finally {
            GlobalLoader.hide(true);
        }
    })();
});