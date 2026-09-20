/**
 * SDK de statistiques PlayWeb — a deposer dans n'importe quel jeu.
 * ---------------------------------------------------------------------------
 * Installation : une balise avant les scripts du jeu.
 *
 *   <script src="playweb-analytics.js"
 *           data-endpoint="https://stats.exemple.com"
 *           data-game="brainrotstar"></script>
 *
 * Le SDK trouve seul le jeton PlayWeb dans le localStorage. S'il n'en trouve
 * pas, il attend : aucune mesure n'est envoyee pour un visiteur anonyme.
 *
 * Coût reseau : UNE requete par INGEST_INTERVAL (60 s par defaut), plus une
 * derniere au moment ou la page disparait. Les mesures s'accumulent
 * localement entre deux envois.
 *
 * API optionnelle pour le jeu :
 *   PlayWebAnalytics.track('match_started')
 *   PlayWebAnalytics.track('gold_earned', { value: 1500 })
 *   PlayWebAnalytics.setStatus('in_game')   // 'online' | 'in_game' | 'away'
 *   PlayWebAnalytics.page('/game')          // pour les apps a navigation interne
 */
(function () {
  'use strict';

  if (window.PlayWebAnalytics) return; // deja charge

  var script = document.currentScript;
  var cfg = {
    endpoint: (script && script.dataset.endpoint) || window.PLAYWEB_STATS_URL || '',
    game: (script && script.dataset.game) || window.PLAYWEB_GAME_SLUG || '',
    intervalMs: Number((script && script.dataset.interval) || 60000),
    // Sans interaction ni changement de page pendant ce delai, on arrete de
    // compter : un onglet ouvert toute la nuit ne doit pas compter 8 h de jeu.
    idleAfterMs: Number((script && script.dataset.idle) || 120000),
    // 'websteam.session.v2' est la cle utilisee par PlayWeb lui-meme : sa
    // valeur est soit le jeton brut, soit un objet JSON { token }.
    tokenKeys: ['websteam.session.v2', 'brainrot_token', 'playweb_token',
                'token', 'auth_token', 'jwt_token', 'jwt']
  };

  if (!cfg.endpoint || !cfg.game) {
    console.warn('[stats] data-endpoint et data-game sont requis, SDK inactif.');
    return;
  }

  cfg.endpoint = cfg.endpoint.replace(/\/+$/, '');

  /* ---------------------------------------------------------------- etat */

  var sessionId = createSessionId();
  var status = 'online';
  var started = false;

  // Mesures en attente d'envoi.
  var pending = {
    activeSeconds: 0,
    pages: Object.create(null),   // path -> { views, activeSeconds }
    events: Object.create(null)   // name -> { count, value }
  };

  var currentPath = normalizePath(location.pathname);
  var lastTickAt = Date.now();
  var lastActivityAt = Date.now();
  var timer = null;
  var tickTimer = null;

  /* ------------------------------------------------------------- helpers */

  function createSessionId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* ignore */ }
    return 'sx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function normalizePath(path) {
    // Le serveur renormalise de toute facon ; on evite surtout d'envoyer
    // une query string, qui contient parfois le jeton d'authentification.
    var clean = String(path || '/').split('?')[0].split('#')[0];
    if (!clean.startsWith('/')) clean = '/' + clean;
    return clean.replace(/\/+/g, '/').replace(/(.+)\/$/, '$1') || '/';
  }

  function getToken() {
    for (var i = 0; i < cfg.tokenKeys.length; i++) {
      try {
        var value = localStorage.getItem(cfg.tokenKeys[i]);
        if (!value) continue;
        // Certaines cles contiennent un objet JSON plutot que le jeton brut.
        if (value.charAt(0) === '{') {
          try {
            var parsed = JSON.parse(value);
            if (parsed && parsed.token) return String(parsed.token);
            continue;
          } catch (e) { /* ce n'etait pas du JSON */ }
        }
        return value;
      } catch (e) { /* stockage indisponible : navigation privee */ }
    }
    // Les jeux qui exposent leur propre accesseur.
    if (window.BrainrotAuth && typeof window.BrainrotAuth.getToken === 'function') {
      try { return window.BrainrotAuth.getToken() || ''; } catch (e) { /* ignore */ }
    }
    return '';
  }

  function isCounting() {
    // On ne compte que si l'onglet est visible ET le joueur pas inactif.
    if (document.visibilityState === 'hidden') return false;
    return (Date.now() - lastActivityAt) < cfg.idleAfterMs;
  }

  function pageBucket(path) {
    if (!pending.pages[path]) pending.pages[path] = { views: 0, activeSeconds: 0 };
    return pending.pages[path];
  }

  /* -------------------------------------------------- comptage du temps */

  /**
   * Accumule le temps ecoule depuis le dernier passage.
   * Appele chaque seconde : c'est un simple compteur local, sans reseau.
   */
  function tick() {
    var now = Date.now();
    var elapsed = Math.round((now - lastTickAt) / 1000);
    lastTickAt = now;

    if (elapsed <= 0) return;

    // Un ecart enorme signifie que l'onglet dormait (iPad en veille, machine
    // suspendue) : ce temps-la n'est pas du temps de jeu.
    if (elapsed > 90) return;

    if (!isCounting()) return;

    pending.activeSeconds += elapsed;
    pageBucket(currentPath).activeSeconds += elapsed;
  }

  /* ------------------------------------------------------------- envoi */

  function buildPayload(closing) {
    var pages = [];
    for (var path in pending.pages) {
      var p = pending.pages[path];
      if (p.views || p.activeSeconds) {
        pages.push({ path: path, views: p.views, activeSeconds: p.activeSeconds });
      }
    }

    var events = [];
    for (var name in pending.events) {
      var e = pending.events[name];
      events.push({ name: name, count: e.count, value: e.value });
    }

    return {
      game: cfg.game,
      sessionId: sessionId,
      activeSeconds: pending.activeSeconds,
      status: status,
      pages: pages,
      events: events,
      referrer: document.referrer ? String(document.referrer).slice(0, 512) : undefined,
      closing: closing || undefined,
      // sendBeacon ne peut pas poser d'en-tete Authorization : le jeton
      // voyage dans le corps. En envoi normal il passe aussi en en-tete.
      token: getToken()
    };
  }

  function resetPending() {
    pending.activeSeconds = 0;
    pending.pages = Object.create(null);
    pending.events = Object.create(null);
    // La page courante reste "en cours" : on la recree sans compteur.
    pageBucket(currentPath);
  }

  function hasSomethingToSend(payload) {
    return payload.activeSeconds > 0 || payload.events.length > 0 ||
           payload.pages.some(function (p) { return p.views > 0 || p.activeSeconds > 0; });
  }

  function send(closing) {
    var token = getToken();
    if (!token) return;                       // visiteur anonyme : rien a dire

    tick();                                   // on solde le temps en cours
    var payload = buildPayload(closing);

    if (!closing && !hasSomethingToSend(payload)) return;

    var body = JSON.stringify(payload);
    var url = cfg.endpoint + '/v1/ingest';

    resetPending();                           // optimiste : voir la note plus bas

    if (closing) {
      // A la fermeture, seul sendBeacon survit a la destruction de la page.
      // text/plain evite une requete CORS preliminaire, que le navigateur
      // n'aurait de toute facon pas le temps de faire.
      try {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return;
      } catch (e) { /* on retombe sur fetch */ }

      try {
        fetch(url, { method: 'POST', body: body, keepalive: true,
                     headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
      } catch (e) { /* la page part, tant pis */ }
      return;
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body,
      keepalive: true
    }).then(function (res) {
      // Le serveur peut changer la cadence sans qu'on redeploie les jeux.
      var advertised = Number(res.headers.get('X-Ingest-Interval'));
      if (advertised > 0 && advertised !== cfg.intervalMs) {
        cfg.intervalMs = advertised;
        restartTimer();
      }
    }).catch(function () {
      // Perte acceptee : reessayer ferait grossir la charge au pire moment
      // (serveur en difficulte). Au plus une fenetre de mesures est perdue.
    });
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () { send(false); }, cfg.intervalMs);
  }

  /* ------------------------------------------------------- evenements */

  function markActivity() { lastActivityAt = Date.now(); }

  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, markActivity, { passive: true, capture: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      // C'est LE moment fiable sur mobile. beforeunload et unload ne sont pas
      // garantis sur iOS : fermer l'onglet, verrouiller l'iPad ou changer
      // d'application ne les declenche pas.
      send(true);
    } else {
      // Retour sur la page : nouvelle session, l'ancienne a pu expirer
      // cote serveur pendant l'absence.
      sessionId = createSessionId();
      lastTickAt = Date.now();
      markActivity();
      pageBucket(currentPath).views += 1;
    }
  });

  // Filet pour les navigateurs de bureau, ou pagehide se declenche bien.
  window.addEventListener('pagehide', function () { send(true); });

  /* ------------------------------------------------- navigation interne */

  function setPage(path) {
    var next = normalizePath(path);
    if (next === currentPath) return;
    tick();                       // solde le temps de la page quittee
    currentPath = next;
    pageBucket(currentPath).views += 1;
  }

  // Applications a navigation interne (history.pushState).
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function () {
      var result = original.apply(this, arguments);
      try { setPage(location.pathname); } catch (e) { /* ignore */ }
      return result;
    };
  });
  window.addEventListener('popstate', function () { setPage(location.pathname); });

  /* ------------------------------------------------------- API publique */

  var api = {
    /** Compte un evenement metier. `value` permet de sommer une quantite. */
    track: function (name, options) {
      if (!name) return;
      var key = String(name).slice(0, 64);
      if (!pending.events[key]) pending.events[key] = { count: 0, value: 0 };
      var opts = options || {};
      pending.events[key].count += Number(opts.count != null ? opts.count : 1) || 0;
      pending.events[key].value += Number(opts.value || 0) || 0;
      markActivity();
    },

    /** 'online' | 'in_game' | 'away' */
    setStatus: function (next) {
      if (next === 'online' || next === 'in_game' || next === 'away') status = next;
    },

    /** Declare un changement de page pour les jeux a navigation interne. */
    page: function (path) { setPage(path); },

    /** Envoi immediat (rare : utile juste avant une redirection volontaire). */
    flush: function () { send(false); },

    /** Fin de session explicite, a appeler lors d'une deconnexion. */
    end: function () { send(true); },

    get sessionId() { return sessionId; },
    get config() { return { endpoint: cfg.endpoint, game: cfg.game, intervalMs: cfg.intervalMs }; }
  };

  function start() {
    if (started) return;
    started = true;
    lastTickAt = Date.now();
    markActivity();
    pageBucket(currentPath).views += 1;

    tickTimer = setInterval(tick, 1000);
    restartTimer();
  }

  window.PlayWebAnalytics = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
