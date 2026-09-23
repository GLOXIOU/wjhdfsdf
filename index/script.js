const App = {
    apiBaseUrl: window.API_BASE_URL,
    userRouteBases: ["/user"],
    goldSyncIntervalMs: 5 * 60 * 1000,
    state: {
        brainrots: "14 420/69 000",
        coinsPerSec: 0,
        rebirthCount: 0,
        moneyTotal: 0,
        syncedGold: 0,
        syncedAtMs: Date.now(),
        syncInFlight: null,
        achievements: "0 / 0",
        playTime: "42h 15m"
    },

    ui: {
        brainrotVal: document.getElementById('val-brainrots'),
        cpsVal: document.getElementById('val-cps'),
        moneyVal: document.getElementById('val-money'),
        achievementsVal: document.getElementById('val-achievements'),
        timeVal: document.getElementById('val-time'),
        mainBtn: document.querySelector('.btn-main-play'),
        achievementsBtn: document.getElementById('btn-achievements')
    },

    init() {
        GlobalLoader.show();
        lucide.createIcons();
        this.render();
        this.bindEvents();
        this.loadStatsFlow();
        setInterval(() => {
            this.refreshSimulatedMoney();
        }, 100);
        setInterval(() => {
            this.syncEconomyFromServer({ forceGoldSync: true });
        }, this.goldSyncIntervalMs);
    },

    formatCompact(value) {
        const num = Number(value || 0);
        if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2).replace(/\.00$/, "")}T`;
        if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
        if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
        if (num >= 1_000) return `${(num / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
        return `${Math.round(num * 100) / 100}`;
    },

    render() {
        this.ui.brainrotVal.textContent = this.state.brainrots;
        const bonusLabel = this.state.rebirthCount > 0 ? ` (+${this.state.rebirthCount * 10}%)` : "";
        this.ui.cpsVal.textContent = `+${this.formatCompact(this.state.coinsPerSec)} /s${bonusLabel}`;
        if (this.ui.moneyVal) this.ui.moneyVal.textContent = this.formatCompact(this.state.moneyTotal);
        if (this.ui.achievementsVal) this.ui.achievementsVal.textContent = this.state.achievements;
        if (this.ui.timeVal) this.ui.timeVal.textContent = this.state.playTime;
    },

    async loadStatsFlow() {
        try {
            await this.loadAchievements();
            const token = await window.BrainrotAuth.waitUntilReady();
            if (!token) return;
            this.loadVillageBadge(token);
            await this.syncEconomyFromServer({ forceGoldSync: true });
        } finally {
            GlobalLoader.hide(true);
        }
    },

    /**
     * Pastille du Villaggio : chantiers finis, mines a moitie pleines, coffre
     * de forge pret, recherche terminee... et attaques subies pas encore vues.
     */
    async loadVillageBadge(token) {
        const badge = document.getElementById("village-notif-badge");
        if (!badge) return;
        try {
            const response = await fetch(`${this.apiBaseUrl}/village/status`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!response.ok) return;
            const payload = await response.json();
            const status = payload?.status;
            if (!payload?.success || !status) return;
            const defenses = status.exists ? Number(status.defenses || 0) : 0;
            const count = status.exists ? Number(status.ready || 0) + defenses : 0;
            badge.textContent = !status.exists ? "!" : defenses > 0 ? `⚔️${count}` : String(count);
            badge.title = defenses > 0 ? `${defenses} attaque(s) subie(s) pendant ton absence` : "";
            badge.classList.toggle("hidden", status.exists && count === 0);
        } catch {
            // La pastille est un bonus : l'accueil fonctionne sans.
        }
    },

    async loadAchievements() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/achievements`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const achievements = Array.isArray(data?.achievements) ? data.achievements : [];
            const unlockedKeys = [
                "brainrot_unlocked_achievements",
                "brainrot_achievements",
                "achievements_unlocked",
                "unlockedAchievements"
            ];
            let unlocked = new Set();

            for (const key of unlockedKeys) {
                try {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        unlocked = new Set(parsed.map(String));
                        break;
                    }
                } catch {
                    continue;
                }
            }

            const unlockedCount = achievements.filter((achievement) => unlocked.has(String(achievement.id))).length;
            this.state.achievements = `${unlockedCount} / ${achievements.length}`;
            this.render();
        } catch (error) {
            console.error("Erreur chargement compteur de succès:", error);
        }
    },

    setEconomySnapshot(gold, coinPerSec, rebirthCount) {
        this.state.syncedGold = Math.max(0, Number(gold || 0));
        this.state.coinsPerSec = Math.max(0, Number(coinPerSec || 0));
        this.state.rebirthCount = Number(rebirthCount || 0);
        this.state.syncedAtMs = Date.now();
        this.refreshSimulatedMoney();
    },

    getSimulatedMoneyNow() {
        const elapsedSec = Math.max(0, (Date.now() - this.state.syncedAtMs) / 1000);
        return Math.max(0, this.state.syncedGold + elapsedSec * this.state.coinsPerSec);
    },

    refreshSimulatedMoney() {
        this.state.moneyTotal = this.getSimulatedMoneyNow();
        this.render();
    },

    async fetchUserStats(token) {
        for (const base of this.userRouteBases) {
            try {
                const response = await fetch(`${this.apiBaseUrl}${base}/stats`, {
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                });
                if (response.status === 401) return { ok: false, unauthorized: true, payload: null };
                if (!response.ok) continue;
                const payload = await response.json();
                if (payload?.success) return { ok: true, unauthorized: false, payload };
            } catch {
                continue;
            }
        }

        return { ok: false, unauthorized: false, payload: null };
    },

    async fetchUserGold(token) {
        for (const base of this.userRouteBases) {
            try {
                const response = await fetch(`${this.apiBaseUrl}${base}/gold`, {
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                });
                if (response.status === 401) return { ok: false, unauthorized: true, gold: null };
                if (!response.ok) continue;
                const payload = await response.json();
                if (payload?.success && typeof payload?.value !== "undefined") {
                    return { ok: true, unauthorized: false, gold: Number(payload.value || 0) };
                }
                if (payload && typeof payload?.gold !== "undefined") {
                    return { ok: true, unauthorized: false, gold: Number(payload.gold || 0) };
                }
                if (typeof payload === "number") {
                    return { ok: true, unauthorized: false, gold: Number(payload || 0) };
                }
            } catch {
                continue;
            }
        }
        return { ok: false, unauthorized: false, gold: null };
    },

    async syncEconomyFromServer({ forceGoldSync = false } = {}) {
        if (this.state.syncInFlight) return this.state.syncInFlight;
        this.state.syncInFlight = (async () => {
            const token = await window.BrainrotAuth.waitUntilReady();
            if (!token) return { ok: false, unauthorized: false };
            const result = await this.fetchUserStats(token);
            if (!result?.ok || !result?.payload?.success || !result?.payload?.value) {
                return { ok: false, unauthorized: Boolean(result?.unauthorized) };
            }
            const stats = result.payload.value;
            this.state.brainrots = `${stats.card?.decks?.[0]?._count?.cards || 0} / 200`;
            let nextGold = Number(stats.gold || 0);
            const shouldSyncGold = forceGoldSync || Date.now() - this.state.syncedAtMs >= this.goldSyncIntervalMs;
            if (shouldSyncGold) {
                const goldResult = await this.fetchUserGold(token);
                if (goldResult?.ok && goldResult.gold !== null) {
                    nextGold = Number(goldResult.gold || 0);
                }
            }
            this.setEconomySnapshot(nextGold, Number(stats.coinPerSec || 0), Number(stats.hasRebirth || 0));
            return { ok: true, unauthorized: false };
        })().catch((error) => {
            console.error("Erreur chargement stats index:", error);
            return { ok: false, unauthorized: false };
        }).finally(() => {
            this.state.syncInFlight = null;
        });
        return this.state.syncInFlight;
    },

    bindEvents() {
        if (this.ui.mainBtn) {
            this.ui.mainBtn.addEventListener('click', async () => {
                const originalText = this.ui.mainBtn.textContent;
                
                try {
                    this.ui.mainBtn.disabled = true;
                    this.ui.mainBtn.textContent = '🔍 Recherche en cours...';
                    this.ui.mainBtn.style.opacity = '0.6';
                    
                    // Appel au serveur pour chercher un match
                    const token = await window.BrainrotAuth.waitUntilReady();
                    if (!token) {
                        throw new Error('Non authentifié');
                    }

                    const response = await fetch(window.API_BASE_URL + '/game/matchmaking', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ })
                    });

                    if (!response.ok) {
                        throw new Error('Erreur serveur');
                    }

                    const data = await response.json();
                    
                    if (data.success) {
                        // Tu peux aussi afficher une notification
                        console.log('Matchmaking en cours... Code:', data.matchCode);
                    } else {
                        throw new Error(data.message || 'Erreur');
                    }
                } catch (error) {
                    console.error('Erreur matchmaking:', error);
                    alert('❌ Erreur: ' + error.message);
                    this.ui.mainBtn.textContent = originalText;
                    this.ui.mainBtn.disabled = false;
                    this.ui.mainBtn.style.opacity = '1';
                }
            });
        }

        if (this.ui.achievementsBtn) {
            this.ui.achievementsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                alert("Non disponible pour le moment");
            });
        }

        const tokenBtn = document.getElementById('btn-token');
        const tokenOverlay = document.getElementById('token-modal-overlay');
        const tokenValue = document.getElementById('token-modal-value');
        const tokenCopy = document.getElementById('token-modal-copy');
        const tokenClose = document.getElementById('token-modal-close');
        const tokenLogout = document.getElementById('token-modal-logout');
        const tokenFeedback = document.getElementById('token-modal-feedback');
        const logoutBtn = document.getElementById('logout-btn');
        const logout = () => {
            localStorage.clear();
            location.reload();
        };

        logoutBtn?.addEventListener('click', logout);

        if (tokenBtn && tokenOverlay) {
            tokenBtn.addEventListener('click', () => {
                const token = window.BrainrotAuth.getToken() || 'Non disponible';
                tokenValue.textContent = token;
                tokenFeedback.textContent = '';
                tokenOverlay.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            });

            tokenClose.addEventListener('click', () => {
                tokenOverlay.classList.add('hidden');
                document.body.style.overflow = '';
            });

            tokenLogout.addEventListener('click', () => {
                logout();
            });

            tokenOverlay.addEventListener('click', (e) => {
                if (e.target === tokenOverlay) {
                    tokenOverlay.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            });

            tokenCopy.addEventListener('click', async () => {
                const token = tokenValue.textContent;
                try {
                    await navigator.clipboard.writeText(token);
                    tokenFeedback.textContent = '✅ Token copié !';
                    tokenFeedback.style.color = '#86efac';
                } catch {
                    tokenFeedback.textContent = 'Impossible de copier automatiquement.';
                    tokenFeedback.style.color = '#fca5a5';
                }
            });
        }
    }
};

const joinMatch = async (matchCode) => {
  const originalBtnState = {
    text: App.ui.mainBtn?.textContent,
    disabled: App.ui.mainBtn?.disabled
  };

  try {
    const token = await window.BrainrotAuth.waitUntilReady();
    if (!token) {
      throw new Error('Non authentifié');
    }

    if (App.ui.mainBtn) {
      App.ui.mainBtn.disabled = true;
      App.ui.mainBtn.textContent = '⏳ Connexion au match...';
      App.ui.mainBtn.style.opacity = '0.5';
    }

    console.log(`Tentative de connexion au match: ${matchCode}`);

    // Appel à l'API pour joindre la room
    const response = await fetch(window.API_BASE_URL + '/game/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        roomId: matchCode,
        name: localStorage.getItem('playerName') || 'Player',
        playerId: localStorage.getItem('playerId') || null
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Erreur HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }

    // Sauvegarder les infos du match
    const playerId = data.playerId;
    localStorage.setItem('playerId', playerId);
    localStorage.setItem('currentMatchCode', matchCode);

    console.log('✅ Connecté au match avec ID:', playerId);

    setTimeout(() => {
      window.location.href = `../game/game.html?room=${matchCode}`;
    }, 500);

  } catch (error) {
    console.error('❌ Erreur join match:', error);
    
    // Restaurer le bouton
    if (App.ui.mainBtn && originalBtnState) {
      App.ui.mainBtn.textContent = originalBtnState.text;
      App.ui.mainBtn.disabled = originalBtnState.disabled;
      App.ui.mainBtn.style.opacity = '1';
    }

    alert(`❌ Impossible de joindre le match: ${error.message}`);
    return false;
  }
};


document.addEventListener('DOMContentLoaded', () => {
  App.init();
});