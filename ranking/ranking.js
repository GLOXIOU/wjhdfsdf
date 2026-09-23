const rankingBody = document.getElementById("ranking-body");
const sortBy = document.getElementById("sort-by");
const scrollToPublishBtn = document.getElementById("scroll-to-publish");
const publishSection = document.getElementById("publish-score-section");
const userRankElement = document.getElementById("user-rank");
const userCpsElement = document.getElementById("user-cps");
const shareRankingBtn = document.getElementById("share-ranking-btn");
const discordOverlay = document.getElementById("discord-modal-overlay");
const discordClose = document.getElementById("discord-modal-close");
const API_BASE_URL = window.API_BASE_URL + "";
const LEADERBOARD_ROUTE_BASE = "/leaderboard";

let userStats = null;

function fmtInt(value) {
    const num = Number(value || 0);
    if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2).replace(/\.00$/, "")}T`;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
    return `${Math.round(num * 100) / 100}`;
}

function normalizeLeaderboardRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((entry) => ({
        name: String(entry?.pseudo ?? "Inconnu"),
        cps: Number(entry?.goldPerSec ?? 0),
        money: Number(entry?.gold ?? 0),
        rebirth: Number(entry?.hasRebirth ?? 0),
        win: Number(entry?.win ?? 0)
    }));
}

async function fetchUserStats(token) {
    const response = await fetch(`${API_BASE_URL}/user/stats`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
    if (!response.ok) {
        throw new Error(`Stats request failed (${response.status})`);
    }
    const payload = await response.json();
    if (!payload?.success) {
        throw new Error("Stats payload invalid");
    }
    return payload.value;
}

async function fetchLeaderboard(type, token) {
    const response = await fetch(`${API_BASE_URL}${LEADERBOARD_ROUTE_BASE}/${type}`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
    if (!response.ok) {
        throw new Error(`Leaderboard request failed (${response.status})`);
    }
    const payload = await response.json();
    if (!payload?.success) {
        throw new Error("Leaderboard payload invalid");
    }
    return normalizeLeaderboardRows(payload.result);
}

function leaderboardTypeFromSort(mode) {
    if (mode === "money") return "gold";
    if (mode === "rebirth") return "rebirth";
    if (mode === "win") return "win";
    return "coinPerSec";
}

let leaderboard = [];

function sortedLeaderboard(mode) {
    const copy = [...leaderboard];
    if (mode === "name") {
        copy.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    } else if (mode === "cps") {
        copy.sort((a, b) => b.cps - a.cps);
    } else if (mode === "money") {
        copy.sort((a, b) => b.money - a.money);
    } else if (mode === "rebirth") {
        copy.sort((a, b) => b.rebirth - a.rebirth);
    } else if (mode === "win") {
        copy.sort((a, b) => b.win - a.win);
    } else {
        copy.sort((a, b) => b.cps - a.cps || b.money - a.money || a.name.localeCompare(b.name, "fr"));
    }
    return copy.slice(0, 50);
}

function rankClass(rank) {
    if (rank === 1) return "rank-pill rank-top-1";
    if (rank === 2) return "rank-pill rank-top-2";
    if (rank === 3) return "rank-pill rank-top-3";
    return "rank-pill";
}

function render() {
    const rows = sortedLeaderboard(sortBy.value || "rank");
    rankingBody.innerHTML = rows
        .map((player, index) => {
            const rank = index + 1;
            return `
                <tr>
                    <td><span class="${rankClass(rank)}">${rank}</span></td>
                    <td>${player.name}</td>
                    <td class="cps-cell">⚡ ${fmtInt(player.cps)} /s</td>
                    <td class="money-cell">💰 ${fmtInt(player.money)}</td>
                    <td class="rebirth-cell">🔄 ${player.rebirth}</td>
                    <td class="win-cell">🏆 ${fmtInt(player.win)}</td>
                </tr>
            `;
        })
        .join("");
    
    updateUserRank();
}

function updateUserRank() {
    if (!userStats || !userStats.pseudo) return;
    
    const rows = sortedLeaderboard(sortBy.value || "rank");
    const userIndex = rows.findIndex(p => p.name === userStats.pseudo);
    
    if (userIndex >= 0) {
        const rank = userIndex + 1;
        const rankText = rank === 1 ? "1er" : `${rank}ème`;
        userRankElement.textContent = rankText;
    } else {
        userRankElement.textContent = "non classé(e)";
    }
    
    userCpsElement.textContent = fmtInt(Math.floor(userStats.coinPerSec));
}

async function loadLeaderboard() {
    const token = await window.BrainrotAuth.waitUntilReady();
    if (!token) {
        throw new Error("No auth token");
    }
    const mode = sortBy.value || "rank";
    const type = leaderboardTypeFromSort(mode);
    leaderboard = await fetchLeaderboard(type, token);
    render();
}

async function loadUserStats() {
    const token = await window.BrainrotAuth.waitUntilReady();
    if (!token) {
        throw new Error("No auth token");
    }
    userStats = await fetchUserStats(token);
    updateUserRank();
}

function closeDiscordModal() {
    discordOverlay?.classList.add("hidden");
    document.body.style.overflow = "";
}

document.addEventListener("DOMContentLoaded", () => {
    shareRankingBtn?.addEventListener("click", () => {
        discordOverlay?.classList.remove("hidden");
        document.body.style.overflow = "hidden";
    });
    discordClose?.addEventListener("click", closeDiscordModal);
    discordOverlay?.addEventListener("click", (event) => {
        if (event.target === discordOverlay) closeDiscordModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !discordOverlay?.classList.contains("hidden")) {
            closeDiscordModal();
        }
    });

    GlobalLoader.show();
    (async () => {
        try {
            lucide.createIcons();
            await Promise.all([loadUserStats(), loadLeaderboard()]);
            sortBy.addEventListener("change", async () => {
                try {
                    await loadLeaderboard();
                } catch (error) {
                    console.error("Erreur chargement classement:", error);
                }
            });
            if (scrollToPublishBtn && publishSection) {
                scrollToPublishBtn.addEventListener("click", () => {
                    publishSection.scrollIntoView({ behavior: "smooth", block: "start" });
                });
            }
        } catch (error) {
            console.error("Erreur initialisation classement:", error);
            rankingBody.innerHTML = "";
        } finally {
            GlobalLoader.hide(true);
        }
    })();
});