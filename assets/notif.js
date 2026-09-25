(function() {
    const API_BASE_URL = window.API_BASE_URL;
    let notifInterval = null;

    async function getAuthToken() {
        if (window.BrainrotAuth && typeof window.BrainrotAuth.waitUntilReady === 'function') {
            return await window.BrainrotAuth.waitUntilReady();
        }
        return null;
    }

    async function fetchUserStats(token) {
        try {
            const response = await apiFetch(`${API_BASE_URL}/user/stats`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return null;
            const payload = await response.json();
            return payload?.success ? payload.value : null;
        } catch {
            return null;
        }
    }

    async function fetchBattlepassRewards(token) {
        try {
            const response = await apiFetch(`${API_BASE_URL}/pass`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return [];
            const payload = await response.json();
            return Array.isArray(payload?.result) ? payload.result : [];
        } catch {
            return [];
        }
    }

    async function fetchClaims(token) {
        try {
            const response = await apiFetch(`${API_BASE_URL}/pass/claims`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return [];
            const payload = await response.json();
            return Array.isArray(payload?.result) ? payload.result : [];
        } catch {
            return [];
        }
    }

    function updateFriendBadge(count) {
        const badge = document.querySelector(".friends.nav-link .nav-badge");
        if (!badge) return;
        badge.textContent = count;
        badge.classList.toggle("hidden", count === 0);
    }

    function updateBattlepassBadge(count) {
        const badge = document.getElementById("bp-notif-badge");
        if (!badge) return;
        badge.textContent = count;
        badge.classList.toggle("hidden", count === 0);
    }

    async function refreshNotifications() {
        try {
            const token = await getAuthToken();
            if (!token) return;

            const stats = await fetchUserStats(token);
            if (!stats) return;

            if (typeof stats.friendRequestsCount === 'number') {
                updateFriendBadge(stats.friendRequestsCount);
            }

            if (!stats.hasPass) {
                updateBattlepassBadge(0);
                return;
            }

            const userLevel = Math.floor(Number(stats.level || 1));
            const [rewards, claims] = await Promise.all([
                fetchBattlepassRewards(token),
                fetchClaims(token)
            ]);

            const claimedIds = new Set(claims.map(c => c.battlepassId));
            const available = rewards.filter(r =>
                Number(r.level) <= userLevel && !claimedIds.has(r.id)
            ).length;

            updateBattlepassBadge(available);
        } catch {
        }
    }

    function startPolling() {
        stopPolling();
        notifInterval = setInterval(refreshNotifications, 60000);
    }

    function stopPolling() {
        if (notifInterval) {
            clearInterval(notifInterval);
            notifInterval = null;
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopPolling();
        } else {
            refreshNotifications();
            startPolling();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                refreshNotifications();
                startPolling();
            }, 500);
        });
    } else {
        setTimeout(() => {
            refreshNotifications();
            startPolling();
        }, 500);
    }

    window.Notif = {
        refresh: refreshNotifications,
        start: startPolling,
        stop: stopPolling
    };
})();
