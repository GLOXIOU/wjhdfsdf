(() => {
    const API_BASE_URL = window.API_BASE_URL;
    const USER_ROUTE_BASE = "/user";
    const PRIMARY_TOKEN_KEY = "brainrot_token";
    const TOKEN_STORAGE_KEYS = ["brainrot_token", "token", "auth_token", "jwt_token", "jwt"];

    function getStoredToken() {
        for (const key of TOKEN_STORAGE_KEYS) {
            const token = localStorage.getItem(key);
            if (token) return token;
        }
        return "";
    }

    function saveToken(token) {
        localStorage.setItem(PRIMARY_TOKEN_KEY, token);
    }

    function clearStoredTokens() {
        for (const key of TOKEN_STORAGE_KEYS) {
            localStorage.removeItem(key);
        }
    }

    function getUrlToken() {
        const token = new URLSearchParams(window.location.search).get("token");
        return token ? token.trim() : "";
    }

    function redirectToPlayWeb() {
        window.location.replace("https://llextv.github.io/PlayWeb.front/index/index.html");
    }

    async function isTokenValid(token) {
        const response = await fetch(`${API_BASE_URL}${USER_ROUTE_BASE}/login`, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + token
            }
        });

        if (!response.ok) return false;

        const payload = await response.json();
        return payload?.success === true;
    }

    let authReadyToken = "";
    let authReadyPromise = null;

    function resolveAuth(token) {
        authReadyToken = token || "";
        document.dispatchEvent(new CustomEvent("brainrot:auth-ready", {
            detail: { token: authReadyToken }
        }));
    }

    async function ensureAuthReady() {
        const urlToken = getUrlToken();
        const token = urlToken || getStoredToken();

        if (!token) {
            redirectToPlayWeb();
            resolveAuth("");
            return "";
        }

        if (urlToken) {
            saveToken(urlToken);
        }

        if (await isTokenValid(token)) {
            if (urlToken) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
            resolveAuth(token);
            return token;
        }

        if (token) {
            clearStoredTokens();
        }

        redirectToPlayWeb();
        resolveAuth("");
        return "";
    }

    window.BrainrotAuth = {
        getToken() {
            return authReadyToken || getStoredToken();
        },

        waitUntilReady() {
            if (authReadyPromise) return authReadyPromise;

            authReadyPromise = ensureAuthReady().catch((error) => {
                console.error("Initialisation automatique de l'authentification impossible :", error);
                resolveAuth("");
                return "";
            });

            return authReadyPromise;
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        window.BrainrotAuth.waitUntilReady();
    });
})();
