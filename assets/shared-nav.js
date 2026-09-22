document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector(".nav-buttons");
    if (!nav) return;

    nav.innerHTML = `
        <a href="../index/index.html" class="btn-nav nav-link">
            <i data-lucide="home"></i>
            <span>Accueil</span>
        </a>
        <a href="../shop/shop.html" class="btn-nav shop nav-link">
            <i data-lucide="store"></i>
            <span>Boutique</span>
        </a>
        <a href="../collection/collection.html" class="btn-nav collection nav-link">
            <i data-lucide="library"></i>
            <span>Collection</span>
        </a>
        <a href="../ranking/ranking.html" class="btn-nav ranking nav-link">
            <i data-lucide="trophy"></i>
            <span>Classement</span>
        </a>
        <button type="button" class="btn-nav profile nav-link">
            <i data-lucide="user"></i>
            <span>Profil</span>
        </button>
    `;

    const getToken = () => {
        if (window.BrainrotAuth && typeof window.BrainrotAuth.getToken === "function") {
            return window.BrainrotAuth.getToken() || "";
        }

        return localStorage.getItem("brainrot_token")
            || localStorage.getItem("token")
            || localStorage.getItem("auth_token")
            || localStorage.getItem("jwt_token")
            || localStorage.getItem("jwt")
            || "";
    };

    const redirectToExternalPage = (path) => {
        const token = getToken();
        window.location.href = `https://llextv.github.io/PlayWeb.front/${path}?token=${encodeURIComponent(token)}`;
    };

    nav.querySelector(".profile")?.addEventListener("click", () => {
        redirectToExternalPage("profil/index.html");
    });

    document.querySelector("#friends-card")?.addEventListener("click", (event) => {
        event.preventDefault();
        redirectToExternalPage("friends/index.html");
    });

    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
    }
});
