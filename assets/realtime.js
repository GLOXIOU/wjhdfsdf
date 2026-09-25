/**
 * Connexion temps reel unique du joueur.
 * ---------------------------------------------------------------------------
 * Chaque page ouvre UNE socket (socket.io) des l'entree dans le jeu, et tout
 * passe dedans : appels d'API, notifications, matchmaking, combat. Seule la
 * poignee de main traverse le proxy comme une requete ; ensuite ce ne sont
 * plus que des trames sur une connexion deja ouverte.
 *
 *   apiFetch(url, init)           meme usage et meme retour (Response) que
 *                                 fetch. Les URL de l'API partent par la
 *                                 socket, les autres par fetch.
 *   BrainrotRealtime.on(evt, fn)  evenement pousse par le serveur.
 *   BrainrotRealtime.socket()     la socket elle-meme (combat).
 *
 * Si la socket reste injoignable quelques secondes, les requetes repartent en
 * HTTP classique : le jeu continue de fonctionner, simplement plus cher.
 */
(() => {
    "use strict";

    const API = String(window.API_BASE_URL || "").replace(/\/+$/, "");
    const WS_URL = window.WS_URL || API;
    /** Attente maximale d'une connexion avant de repasser en HTTP. */
    const CONNECT_WAIT_MS = 8000;
    const REQUEST_TIMEOUT_MS = 25000;
    const TOKEN_KEYS = ["brainrot_token", "token", "auth_token", "jwt_token", "jwt"];
    const NULL_BODY_STATUS = new Set([204, 205, 304]);

    const nativeFetch = window.fetch.bind(window);

    let socket = null;
    /** Debut de la coupure en cours (null : connecte). */
    let downSince = Date.now();
    const waiters = new Set();

    function currentToken() {
        try {
            const token = window.BrainrotAuth?.getToken?.();
            if (token) return token;
        } catch { /* auth-gate pas encore charge */ }
        try {
            const urlToken = new URLSearchParams(location.search).get("token");
            if (urlToken) return urlToken.trim();
            for (const key of TOKEN_KEYS) {
                const value = localStorage.getItem(key);
                if (value) return value;
            }
        } catch { /* stockage indisponible */ }
        return "";
    }

    function ensureSocket() {
        if (socket) return socket;
        if (typeof window.io !== "function" || !API || !currentToken()) return null;

        downSince = Date.now();
        socket = window.io(WS_URL, {
            path: "/socket.io",
            // Relu a chaque reconnexion : le jeton a pu etre remplace.
            auth: (cb) => cb({ token: currentToken() }),
            transports: ["websocket", "polling"],
            // WebSocket d'abord ; le polling (une requete par message) n'est
            // qu'un repli pour les reseaux qui coupent les WebSockets.
            tryAllTransports: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 500,
            reconnectionDelayMax: 5000,
            timeout: 10000
        });

        socket.on("connect", () => {
            downSince = null;
            for (const done of waiters) done(true);
            waiters.clear();
        });
        socket.on("disconnect", () => {
            if (downSince === null) downSince = Date.now();
        });
        socket.on("connect_error", (err) => {
            console.warn("[realtime] connexion impossible :", err?.message || err);
        });
        return socket;
    }

    /** true des que la socket est connectee, false si la coupure dure trop. */
    function waitConnected(s) {
        if (s.connected) return Promise.resolve(true);
        const left = (downSince ?? Date.now()) + CONNECT_WAIT_MS - Date.now();
        if (left <= 0) return Promise.resolve(false);
        return new Promise((resolve) => {
            const done = (ok) => {
                clearTimeout(timer);
                waiters.delete(done);
                resolve(ok);
            };
            const timer = setTimeout(() => done(false), left);
            waiters.add(done);
        });
    }

    function abortError() {
        return new DOMException("The operation was aborted.", "AbortError");
    }

    function toResponse(res) {
        const status = Number(res?.s);
        if (!Number.isInteger(status) || status < 200 || status > 599) {
            return new Response(JSON.stringify({ success: false, message: "Reponse invalide" }), {
                status: 502,
                headers: { "content-type": "application/json" }
            });
        }
        return new Response(NULL_BODY_STATUS.has(status) ? null : String(res.b ?? ""), {
            status,
            headers: res.t ? { "content-type": res.t } : {}
        });
    }

    /** fetch, mais par la socket pour les URL de l'API. */
    async function apiFetch(input, init = {}) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : "";
        const body = init.body;
        if (!url || !url.startsWith(API + "/") || (body != null && typeof body !== "string")) {
            return nativeFetch(input, init);
        }

        const signal = init.signal;
        if (signal?.aborted) throw abortError();

        const s = ensureSocket();
        if (!s || !(await waitConnected(s))) return nativeFetch(input, init);
        if (signal?.aborted) throw abortError();

        const headers = new Headers(init.headers || {});
        const h = {};
        if (headers.has("authorization")) h.authorization = headers.get("authorization");
        if (headers.has("content-type")) h["content-type"] = headers.get("content-type");

        const request = {
            m: String(init.method || "GET").toUpperCase(),
            p: url.slice(API.length),
            b: body == null ? undefined : body,
            h
        };

        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
                if (settled) return;
                settled = true;
                reject(abortError());
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            // Une requete partie n'est jamais rejouee en HTTP : un achat ou
            // une attaque pourrait etre execute deux fois.
            s.timeout(REQUEST_TIMEOUT_MS).emit("rq", request, (err, res) => {
                signal?.removeEventListener("abort", onAbort);
                if (settled) return;
                settled = true;
                if (err) reject(new TypeError("Failed to fetch"));
                else resolve(toResponse(res));
            });
        });
    }

    window.apiFetch = apiFetch;
    window.BrainrotRealtime = {
        fetch: apiFetch,
        socket: ensureSocket,
        on(event, handler) {
            const s = ensureSocket();
            if (s) s.on(event, handler);
            return s;
        },
        off(event, handler) {
            socket?.off(event, handler);
        }
    };
})();
