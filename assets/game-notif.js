(function() {

  /** URL de la page de jeu, relative a la racine du front. */
  function gameUrl(roomId) {
    const root = window.location.pathname.replace(/\/[^/]*\/[^/]*$/, '');
    return `${window.location.origin}${root}/game/game.html?room=${encodeURIComponent(roomId)}`;
  }

  /** Petit bandeau ephemere : l'invitation a ete refusee. */
  function showRefusalToast(who) {
    const el = document.createElement('div');
    el.textContent = `❌ ${who} a refusé ton invitation`;
    el.style.cssText =
      'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:10000;' +
      'padding:10px 18px;border-radius:999px;font-weight:700;font-size:0.9rem;' +
      'background:rgba(15,15,20,0.92);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.4);' +
      'pointer-events:none;transition:opacity .2s ease;max-width:90vw;text-align:center;';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 3000);
    setTimeout(() => el.remove(), 3400);
  }
  // Gestion complète des notifications de défi (temps réel)
  // S'ajoute à toutes les pages pour afficher les demandes de jeu en temps réel

  let isInitialized = false;

  function injectStyles() {
    if (document.querySelector('style[data-game-notif-style]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-game-notif-style', 'true');
    style.textContent = `
      @keyframes gn-slideIn {
        from { transform: translateX(420px) scale(0.94); opacity: 0; }
        to   { transform: translateX(0) scale(1); opacity: 1; }
      }
      @keyframes gn-slideOut {
        from { transform: translateX(0) scale(1); opacity: 1; }
        to   { transform: translateX(420px) scale(0.94); opacity: 0; }
      }
      @keyframes gn-bar {
        from { width: 100%; }
        to   { width: 0%; }
      }
      @keyframes gn-pulse-border {
        0%, 100% { border-color: rgba(249,115,22,0.35); box-shadow: 0 20px 50px rgba(0,0,0,0.55); }
        50%       { border-color: rgba(249,115,22,0.65); box-shadow: 0 20px 60px rgba(249,115,22,0.18); }
      }

      .gn-wrap {
        position: fixed;
        top: 22px;
        right: 22px;
        width: 340px;
        max-width: calc(100vw - 44px);
        font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
        z-index: 10000;
        border-radius: 20px;
        overflow: hidden;
        background: linear-gradient(180deg, rgba(23,23,23,0.97) 0%, rgba(12,12,12,0.97) 100%);
        border: 1px solid rgba(249,115,22,0.35);
        box-shadow: 0 20px 50px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.04);
        animation: gn-slideIn 380ms cubic-bezier(.2,1,.22,1) both,
                   gn-pulse-border 3s ease-in-out 0.4s infinite;
      }

      .gn-top {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 16px 12px 16px;
      }

      .gn-icon {
        flex-shrink: 0;
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: linear-gradient(135deg, #f97316, #dc2626);
        border-bottom: 3px solid #991b1b;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        box-shadow: 0 8px 24px rgba(249,115,22,0.3);
      }

      .gn-text {
        flex: 1;
        min-width: 0;
      }

      .gn-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #f97316;
        margin-bottom: 3px;
      }

      .gn-desc {
        font-size: 15px;
        font-weight: 800;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
      }

      .gn-desc span {
        background: linear-gradient(135deg, #f97316, #fb923c);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .gn-sub {
        font-size: 12px;
        font-weight: 600;
        color: #a3a3a3;
        margin-top: 2px;
      }

      .gn-close {
        flex-shrink: 0;
        align-self: flex-start;
        background: transparent;
        border: none;
        outline: none;
        color: rgba(255,255,255,0.25);
        font-size: 15px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 8px;
        line-height: 1;
        transition: color .15s ease, background .15s ease;
      }
      .gn-close:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.06); }

      .gn-divider {
        height: 1px;
        background: rgba(255,255,255,0.05);
        margin: 0 16px;
      }

      .gn-actions {
        display: flex;
        gap: 8px;
        padding: 12px 16px 14px 16px;
      }

      .gn-btn {
        flex: 1;
        padding: 10px 12px;
        border-radius: 12px;
        cursor: pointer;
        font-family: inherit;
        font-weight: 800;
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: transform .12s ease, filter .12s ease;
        user-select: none;
        outline: none;
      }
      .gn-btn:focus { outline: none; }
      .gn-btn:focus-visible { outline: none; box-shadow: none; }
      .gn-btn:active { transform: translateY(1px) scale(0.98) !important; }
      .gn-btn:disabled { opacity: 0.6; cursor: not-allowed; }

      .gn-btn-accept {
        background: linear-gradient(135deg, #f97316, #dc2626);
        border: none;
        border-bottom: 3px solid #991b1b;
        color: #fff;
        box-shadow: 0 8px 24px rgba(249,115,22,0.25);
      }
      .gn-btn-accept:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }

      .gn-btn-reject {
        background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025));
        border: 1px solid rgba(255,255,255,0.09);
        color: #a3a3a3;
      }
      .gn-btn-reject:hover:not(:disabled) { color: #fff; border-color: rgba(255,255,255,0.2); filter: brightness(1.1); }

      .gn-progress {
        height: 3px;
        background: rgba(255,255,255,0.04);
      }
      .gn-progress i {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #f97316, #dc2626);
        animation: gn-bar 30s linear forwards;
      }

      @media (max-width: 420px) {
        .gn-wrap { right: 12px; left: 12px; width: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function showGameNotification(from, code) {
    injectStyles();

    const notif = document.createElement('div');
    notif.className = 'gn-wrap';
    notif.setAttribute('role', 'dialog');
    notif.setAttribute('aria-live', 'polite');
    notif.innerHTML = `
      <div class="gn-top">
        <div class="gn-icon" aria-hidden="true">⚔️</div>
        <div class="gn-text">
          <div class="gn-label">Défi reçu</div>
          <div class="gn-desc"><span>${from}</span> te défie !</div>
          <div class="gn-sub">Réponds avant que le défi expire</div>
        </div>
        <button class="gn-close" aria-label="Fermer">✕</button>
      </div>
      <div class="gn-divider"></div>
      <div class="gn-actions">
        <button class="gn-btn gn-btn-accept">⚔️ Accepter</button>
        <button class="gn-btn gn-btn-reject">Refuser</button>
      </div>
      <div class="gn-progress" aria-hidden="true"><i></i></div>
    `;

    document.body.appendChild(notif);

    const closeBtn    = notif.querySelector('.gn-close');
    const acceptBtn   = notif.querySelector('.gn-btn-accept');
    const rejectBtn   = notif.querySelector('.gn-btn-reject');
    const progressBar = notif.querySelector('.gn-progress i');

    const cleanup = () => {
      try {
        notif.style.animation = 'gn-slideOut 280ms cubic-bezier(.2,1,.22,1) forwards';
        setTimeout(() => {
          if (document.body.contains(notif)) document.body.removeChild(notif);
        }, 300);
      } catch (e) {
        if (document.body.contains(notif)) document.body.removeChild(notif);
      }
    };

    closeBtn.addEventListener('click', cleanup);

    acceptBtn.addEventListener('click', () => {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Connexion…';
      localStorage.removeItem('playerId');
      window.location.href = gameUrl(code);
      cleanup();
    });

    rejectBtn.addEventListener('click', async () => {
      rejectBtn.disabled = true;
      rejectBtn.textContent = 'Refus…';
      try {
        const token = await window.BrainrotAuth.waitUntilReady().catch(() => null);
        if (token) {
          await apiFetch(window.API_BASE_URL + '/game/refuse-match', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ code })
          }).catch(() => {});
        }
      } finally {
        cleanup();
      }
    });

    const autoTimer = setTimeout(() => {
      if (document.body.contains(notif)) cleanup();
    }, 30000);

    notif.addEventListener('mouseenter', () => {
      progressBar.style.animationPlayState = 'paused';
      clearTimeout(autoTimer);
    });
    notif.addEventListener('mouseleave', () => {
      progressBar.style.animationPlayState = 'running';
      setTimeout(() => {
        if (document.body.contains(notif)) cleanup();
      }, 8000);
    });

    // Pas de .focus() pour éviter l'outline au pop
  }

  function onNotify(data) {
    if (!data) return;
    switch (data.event) {
      case 'asking_match': {
        if (!data.status || !data.from) {
          console.warn('[GameNotif] Données incomplètes pour asking_match');
          return;
        }
        showGameNotification(data.from, data.status);
        break;
      }
      case 'match_started': {
        if (data.roomId) {
          setTimeout(() => {
            // Chemin relatif : le domaine d'hebergement n'est plus code en dur.
            window.location.href = gameUrl(data.roomId);
          }, 1000);
        }
        break;
      }
      case 'match_refused': {
        // Emis par le serveur quand l'invite refuse depuis sa notification.
        showRefusalToast(data.status || 'Ton adversaire');
        break;
      }
      default:
        break;
    }
  }

  // Les notifications arrivent par la socket commune de la page (assets/realtime.js) :
  // plus de flux SSE dedie, ni de reconnexion a gerer ici.
  async function initNotifications() {
    if (isInitialized) return;
    isInitialized = true;

    const token = await window.BrainrotAuth.waitUntilReady().catch(() => null);
    if (!token) return;
    if (!window.BrainrotRealtime?.on('notify', onNotify)) {
      console.warn('[GameNotif] Connexion temps réel indisponible, notifications désactivées');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotifications);
  } else {
    initNotifications();
  }

  // API globale
  window.GameNotif = {
    show: showGameNotification,
    init: initNotifications
  };
})();