/* ==========================================================================
   Villaggio : demarrage.

   Charge le village, lance les horloges (or qui monte, comptes a rebours,
   resynchronisation) et branche les evenements globaux de la page.
   ========================================================================== */
(() => {
    "use strict";

    const V = window.Villaggio;
    const { cfg, ui, S, view } = V;

    /* ======================================================================
       HORLOGES
       ====================================================================== */

    let goldTimer = 0;
    let tickTimer = 0;
    let resyncTimer = 0;

    function startTimers() {
        stopTimers();
        goldTimer = setInterval(() => {
            if (S.scene === "home") V.home.updateGoldText();
        }, 250);
        tickTimer = setInterval(() => V.home.tick(), 1000);
        resyncTimer = setInterval(() => {
            // Jamais pendant une bataille : elle a sa propre horloge.
            if (S.pending === 0 && S.scene === "home") V.refresh();
        }, cfg.RESYNC_MS);
    }

    function stopTimers() {
        clearInterval(goldTimer);
        clearInterval(tickTimer);
        clearInterval(resyncTimer);
    }

    /* ======================================================================
       DEMARRAGE
       ====================================================================== */

    function showError(message) {
        V.loader.hide();
        ui.errorText.textContent = message;
        ui.error.classList.remove("hidden");
    }

    async function boot() {
        ui.error.classList.add("hidden");
        V.loader.show("Chargement du Villaggio…");
        const token = await V.getToken();
        if (!token) {
            // auth-gate redirige vers PlayWeb.
            showError("Connexion requise… redirection en cours.");
            return;
        }
        const res = await V.api("GET", "/village");
        if (!res?.success || !res.village) {
            showError(res?.message || "Impossible de charger ton Villaggio.");
            return;
        }
        view.setScene(V.home.scene);
        V.applyState(res.village);
        startTimers();
        await V.loader.hide();
        // Au retour : d'abord le rapport des attaques subies, sinon l'accueil des nouveaux.
        if (!V.war.maybeShowDefenseReport()) V.home.maybeShowWelcome();
    }

    /* ======================================================================
       EVENEMENTS GLOBAUX
       ====================================================================== */

    // Safari iPad : empeche le zoom de la page entiere pendant un pincement.
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
    document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

    window.addEventListener("resize", view.resize);
    window.addEventListener("orientationchange", () => setTimeout(view.resize, 250));
    window.visualViewport?.addEventListener("resize", view.resize);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopTimers();
            view.stopLoop();
        } else if (S.data) {
            startTimers();
            if (S.scene === "home") V.refresh();
            else V.war.onVisible();
            view.requestDraw();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (S.sheet) V.closeSheet();
        else if (S.scene === "home") V.home.escape();
        else if (S.scene === "visit") V.visit.leave();
    });

    ui.errorRetry.addEventListener("click", boot);

    view.resize();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
