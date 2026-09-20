(() => {
  const PROD_API_BASE_URL = "https://bsstar.dino.icu/";

  const LOCAL_API_BASE_URL = "https://bsstar.dino.icu/";
  const PROD_STATS_URL = "";
  const LOCAL_STATS_URL = "http://localhost:4000";

  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(location.hostname);

  const apiBase = (isLocal
    ? LOCAL_API_BASE_URL
    : (PROD_API_BASE_URL || location.origin)
  ).replace(/\/+$/, "");

  const wsUrl = apiBase;

  window.BRAINROT_CONFIG = Object.freeze({
    API_BASE_URL: apiBase,
    WS_URL: wsUrl,
    IS_LOCAL: isLocal
  });

  window.API_BASE_URL = apiBase;
  window.WS_URL = wsUrl;

  window.PLAYWEB_STATS_URL = (isLocal ? LOCAL_STATS_URL : PROD_STATS_URL).replace(/\/+$/, "");
  window.PLAYWEB_GAME_SLUG = "brainrotstar";

  window.api = (path) => apiBase + (path.startsWith("/") ? path : "/" + path);
})();
