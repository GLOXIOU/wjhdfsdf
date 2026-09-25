document.addEventListener("DOMContentLoaded", () => {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;
    const sourceNav = navbar.querySelector(".nav-buttons");
    if (!sourceNav) return;

    const oldToggle = navbar.querySelector(".nav-toggle");
    if (oldToggle) oldToggle.remove();

    const oldOverlay = document.querySelector(".mobile-menu-overlay");
    if (oldOverlay) oldOverlay.remove();
    const oldBtn = document.querySelector(".mobile-menu-btn");
    if (oldBtn) oldBtn.remove();

    const mobileBtn = document.createElement("button");
    mobileBtn.className = "mobile-menu-btn";
    mobileBtn.setAttribute("aria-label", "Ouvrir le menu");
    mobileBtn.setAttribute("aria-expanded", "false");
    mobileBtn.innerHTML = `
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
    `;

    const overlay = document.createElement("div");
    overlay.className = "mobile-menu-overlay";
    const content = document.createElement("div");
    content.className = "mobile-menu-content";

    const links = Array.from(sourceNav.querySelectorAll(".btn-nav")).map((link) => {
        const clone = link.cloneNode(true);
        clone.classList.remove("btn-nav", "has-badge", "ranking", "friends", "rebirth", "shop", "collection", "profile");
        clone.classList.add("mobile-menu-item");
        const badge = clone.querySelector(".nav-badge");
        if (badge) badge.remove();
        // cloneNode ne copie pas les ecouteurs : un bouton (Profil) relaie son
        // clic a l'original, sinon il ne faisait rien dans le menu mobile.
        if (link.tagName === "BUTTON") clone.addEventListener("click", () => link.click());
        return clone;
    });

    links.forEach((link) => content.appendChild(link));
    overlay.appendChild(content);
    navbar.appendChild(mobileBtn);
    document.body.appendChild(overlay);

    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
    }

    const setOpen = (open) => {
        overlay.classList.toggle("active", open);
        mobileBtn.classList.toggle("active", open);
        document.body.classList.toggle("nav-menu-open", open);
        mobileBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };

    mobileBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(!overlay.classList.contains("active"));
    });

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) setOpen(false);
    });

    links.forEach((link) => {
        link.addEventListener("click", () => setOpen(false));
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setOpen(false);
    });
});
