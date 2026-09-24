/* ==========================================================================
   Villaggio : rendu isometrique et gestes.

   Une "scene" (ton village, une bataille, un replay) fournit ce qu'il faut
   dessiner et reagit aux gestes ; ce fichier gere la camera, la boucle de
   rendu (a la demande, pour menager la batterie de l'iPad), le decor et les
   primitives de dessin communes.

   Deux toiles superposees : la mer (#v-sea, basse resolution, animee a
   ~12 i/s) et le village (#v-canvas, transparent, redessine uniquement
   quand quelque chose change).

   Interface d'une scene :
     mapSize(), margin()            taille du terrain et de la plage (cases)
     draw(ts)                       dessine tout ce qui est au-dessus du terrain
     animating()                    "fast" : 60 i/s (bataille) ; true : animation
                                    lente, au rythme de la mer ; false : rien
     update?(ts)                    avance la simulation avant le dessin
     showGrid?()                    quadrillage visible (placement)
     tap(x, y)                      toucher bref
     dragStart?(x, y) -> bool       prend la main des le toucher (fantome)
     dragMove?(x, y), dragEnd?()
     longPressDelay?(x, y) -> ms    0 : pas d'appui long a cet endroit
     longPress?(x, y) -> "drag" | "hold" | null
     holdMove?(x, y), holdEnd?()
   ========================================================================== */
(() => {
    "use strict";

    const V = window.Villaggio;
    const { cfg, ui } = V;
    const { clamp, shade } = V.util;
    const { TILE_W, TILE_H, MIN_ZOOM, MAX_ZOOM, TAP_SLOP, REDUCED_MOTION, EMOJI_FONT, UI_FONT } = cfg;

    const canvas = ui.canvas;
    /** Contexte de dessin courant (redirige un instant vers une petite toile pour les images de batiments). */
    let ctx = canvas.getContext("2d");
    const sea = ui.sea;
    const sctx = sea.getContext("2d", { alpha: false });
    const cam = { x: 0, y: 0, zoom: 1 };
    let vw = 0;
    let vh = 0;
    let dpr = 1;
    /** Resolution de la mer : jamais plus d'un pixel par point CSS (4x moins de pixels sur iPad). */
    let seaRes = 1;
    let scene = null;
    let camTween = null;
    let navBottom = -1;

    const view = (V.view = { ctx, cam, get vw() { return vw; }, get vh() { return vh; } });

    /* ======================================================================
       CAMERA ET PROJECTION
       ====================================================================== */

    const mapSize = () => scene?.mapSize() ?? 24;
    const margin = () => scene?.margin() ?? 2;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        seaRes = Math.min(dpr, 1);
        vw = ui.app.clientWidth || window.innerWidth;
        vh = ui.app.clientHeight || window.innerHeight;
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
        sea.width = Math.round(vw * seaRes);
        sea.height = Math.round(vh * seaRes);
        seaCam.length = 0;
        syncNav();
        clampCamera();
        requestDraw();
    }

    /** Bas de la barre de navigation : le HUD et les panneaux se calent dessous (CSS --v-nav-bottom). */
    function syncNav() {
        if (!ui.nav) return;
        const bottom = Math.round(ui.nav.getBoundingClientRect().bottom - ui.app.getBoundingClientRect().top);
        if (bottom === navBottom) return;
        navBottom = bottom;
        ui.app.style.setProperty("--v-nav-bottom", `${bottom}px`);
    }
    // La nav change de hauteur quand shared-nav.js la remplit, ou en passant sous 900 px de large.
    if (ui.nav && window.ResizeObserver) new ResizeObserver(syncNav).observe(ui.nav);

    const isShown = (el) => Boolean(el) && el.getClientRects().length > 0;

    /** Place prise par les barres fixes (nav + HUD en haut, boutons en bas) sur la scene actuelle. */
    function hudInsets() {
        const box = ui.app.getBoundingClientRect();
        let top = 0;
        let bottom = 0;
        for (const el of [ui.nav, ui.top, ui.btTop, ui.vsTop]) {
            if (isShown(el)) top = Math.max(top, el.getBoundingClientRect().bottom - box.top);
        }
        for (const el of [ui.bottom, ui.btBottom, ui.vsBottom]) {
            if (isShown(el)) bottom = Math.max(bottom, box.bottom - el.getBoundingClientRect().top);
        }
        return { top, bottom };
    }

    /** Hauteur (ecran) du milieu de la zone de carte laissee libre par les barres. */
    function freeCenterY() {
        const { top, bottom } = hudInsets();
        return (top + vh - bottom) / 2;
    }

    function isoWorld(gx, gy) {
        return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 };
    }

    function toScreen(wx, wy) {
        return { x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 };
    }

    function iso(gx, gy) {
        const w = isoWorld(gx, gy);
        return toScreen(w.x, w.y);
    }

    function screenToWorld(sx, sy) {
        return { x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y };
    }

    /** Case (fractionnaire) sous un point de l'ecran. */
    function gridAt(sx, sy) {
        const w = screenToWorld(sx, sy);
        const a = w.x / (TILE_W / 2);
        const b = w.y / (TILE_H / 2);
        return { x: (a + b) / 2, y: (b - a) / 2 };
    }

    function clampCamera() {
        const n = mapSize() + margin();
        cam.zoom = clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM);
        cam.x = clamp(cam.x, -n * TILE_W / 2, n * TILE_W / 2);
        cam.y = clamp(cam.y, -margin() * TILE_H, n * TILE_H);
    }

    /** Cadre toute l'ile (plage comprise) dans l'espace laisse libre entre les barres du haut et du bas. */
    function centerCamera() {
        const n = mapSize();
        const m = margin();
        const span = n + 2 * m;
        const mapW = span * TILE_W;
        const mapH = span * TILE_H + 40;
        const { top, bottom } = hudInsets();
        const freeH = Math.max(160, vh - top - bottom - 16);
        const fitWidth = (vw - 24) / mapW;
        const fitHeight = freeH / mapH;
        // En portrait, l'ile entiere en largeur laisserait la moitie de l'ecran
        // vide : on zoome un peu plus, les bords restent accessibles.
        const fit = Math.min(fitHeight, fitWidth * (vh > vw ? 1.35 : 1));
        cam.zoom = clamp(fit, MIN_ZOOM, 1.3);
        const center = isoWorld(n / 2, n / 2);
        cam.x = center.x;
        // +12 : les falaises descendent sous le terrain, le centre visuel est un peu plus bas.
        cam.y = center.y + 12 - ((top + vh - bottom) / 2 - vh / 2) / cam.zoom;
        camTween = null;
        clampCamera();
        requestDraw();
    }

    function zoomAt(sx, sy, nextZoom) {
        const before = screenToWorld(sx, sy);
        cam.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
        const after = screenToWorld(sx, sy);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        clampCamera();
        requestDraw();
    }

    /** Glisse doucement la camera pour que le point (case) reste visible entre les barres. */
    function ensureVisible(gx, gy, dockHeight = 220) {
        const center = iso(gx, gy);
        const dockTop = vh - dockHeight - 40;
        const topLimit = hudInsets().top + 10;
        let dy = 0;
        if (center.y > dockTop) dy = center.y - dockTop;
        else if (center.y - 80 < topLimit) dy = center.y - 80 - topLimit;
        if (Math.abs(dy) < 4) return;
        camTween = { fromY: cam.y, toY: cam.y + dy / cam.zoom, start: performance.now(), dur: 260 };
        requestDraw();
    }

    Object.assign(view, { resize, isoWorld, toScreen, iso, screenToWorld, gridAt, clampCamera, centerCamera, zoomAt, ensureVisible, freeCenterY });

    /* ======================================================================
       PRIMITIVES (sprites emoji mis en cache : indispensable pour la fluidite)
       ====================================================================== */

    /*
     * Dessiner un emoji en texte est tres lent sur iPad : chacun est dessine
     * une fois dans une petite toile, puis recopie. Tailles par paliers (4 par
     * octave) et mise a l'echelle au dessin : un zoom ne fabrique que quelques
     * sprites. Les plus anciens sont oublies un par un, jamais tous d'un coup
     * (ce qui provoquait des saccades en zoomant).
     */
    const sprites = new Map(); // emoji -> Map(taille, negative si miroir -> toile)
    const spriteOrder = [];
    const SPRITE_MAX = 400;

    function spriteSize(px) {
        const want = Math.max(8, px);
        const step = Math.max(4, 2 ** Math.floor(Math.log2(want)) / 4);
        return Math.ceil(want / step) * step;
    }

    function emojiSprite(emoji, dev, flip) {
        let bySize = sprites.get(emoji);
        if (!bySize) {
            bySize = new Map();
            sprites.set(emoji, bySize);
        }
        const key = flip ? -dev : dev;
        let sprite = bySize.get(key);
        if (!sprite) {
            sprite = document.createElement("canvas");
            const pad = Math.ceil(dev * 0.28);
            sprite.width = sprite.height = dev + pad * 2;
            const g = sprite.getContext("2d");
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.font = `${dev}px ${EMOJI_FONT}`;
            if (flip) {
                g.translate(sprite.width, 0);
                g.scale(-1, 1);
            }
            g.fillText(emoji, sprite.width / 2, sprite.height / 2 + dev * 0.06);
            bySize.set(key, sprite);
            spriteOrder.push(bySize, key);
            if (spriteOrder.length > SPRITE_MAX * 2) spriteOrder.shift().delete(spriteOrder.shift());
        }
        return sprite;
    }

    function drawEmoji(emoji, cx, cy, size, alpha = 1, flip = false) {
        const want = size * dpr;
        const dev = spriteSize(want);
        const sprite = emojiSprite(emoji, dev, flip);
        const w = (sprite.width / dpr) * (want / dev);
        if (alpha !== 1) ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, cx - w / 2, cy - w / 2, w, w);
        if (alpha !== 1) ctx.globalAlpha = 1;
    }

    function tracePoly(g, points) {
        g.beginPath();
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
        g.closePath();
    }

    function poly(points) {
        tracePoly(ctx, points);
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function footprint(x, y, w, h, inset = 0) {
        return [iso(x + inset, y + inset), iso(x + w - inset, y + inset), iso(x + w - inset, y + h - inset), iso(x + inset, y + h - inset)];
    }

    function outlinedText(text, x, y, size, color, weight = 900) {
        ctx.font = `${weight} ${size}px ${UI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(3, size * 0.22);
        ctx.strokeStyle = "rgba(0,0,0,0.78)";
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    }

    Object.assign(view, { drawEmoji, poly, roundRect, footprint, outlinedText });

    /* ======================================================================
       DECOR : fond, ile, plage
       ====================================================================== */

    // Touffes d'herbe et grains de sable deterministes (meme decor a chaque visite).
    function seeded(count, seed, spread) {
        const out = [];
        let s = seed;
        const rnd = () => {
            s = (s * 16807) % 2147483647;
            return s / 2147483647;
        };
        for (let i = 0; i < count; i++) out.push({ x: rnd() * spread, y: rnd() * spread, s: 0.6 + rnd() * 0.6, r: rnd() });
        return out;
    }
    const tufts = seeded(130, 1337, 1);
    const pebbles = seeded(120, 4242, 1);

    /* --- Mer --------------------------------------------------------------- */

    const SEA_COLOR = "#0c4a6e";
    /** Bandes d'eau de plus en plus claires vers le rivage : [distance a l'ile, couleur]. */
    const SEA_RINGS = [[120, "#0d5779"], [74, "#0f6a8c"], [40, "#138aa6"], [18, "#27b3c6"]];

    /** Motif de vaguelettes (tuile qui se repete sans raccord visible). */
    function waveTile(seed, count, color, width) {
        const W = 256;
        const H = 128;
        const tile = document.createElement("canvas");
        tile.width = W;
        tile.height = H;
        const g = tile.getContext("2d");
        g.strokeStyle = color;
        g.lineWidth = width;
        g.lineCap = "round";
        g.beginPath();
        for (const p of seeded(count, seed, 1)) {
            const w = 7 + p.s * 9;
            const h = w * 0.34;
            // Chaque vaguelette est aussi dessinee de l'autre cote des bords : la tuile se raccorde.
            for (const dx of [-W, 0, W]) {
                for (const dy of [-H, 0, H]) {
                    const x = p.x * W + dx;
                    const y = p.y * H + dy;
                    g.moveTo(x - w, y);
                    g.quadraticCurveTo(x - w / 2, y - h, x, y);
                    g.quadraticCurveTo(x + w / 2, y + h, x + w, y);
                }
            }
        }
        g.stroke();
        return { pattern: sctx.createPattern(tile, "repeat"), w: W, h: H };
    }

    // Deux trains de vagues qui derivent l'un contre l'autre : l'eau "vit" sans rien de couteux.
    const waveLayers = [
        { ...waveTile(90210, 9, "rgba(255,255,255,0.13)", 2.2), scale: 1, vx: 9, vy: 4.5 },
        { ...waveTile(31337, 5, "rgba(125,211,252,0.12)", 2.6), scale: 1.7, vx: -5, vy: 2.5 }
    ];

    /** Contour de l'ile vue de dessus : plage + falaises (hexagone convexe, sens horaire). */
    function islandOutline() {
        const n = mapSize();
        const m = margin();
        const depth = 34 * cam.zoom;
        const sT = iso(-m, -m);
        const sR = iso(n + m, -m);
        const sB = iso(n + m, n + m);
        const sL = iso(-m, n + m);
        return [sT, sR, { x: sR.x, y: sR.y + depth }, { x: sB.x, y: sB.y + depth }, { x: sL.x, y: sL.y + depth }, sL];
    }

    /** Trace le contour decale de r pixels vers l'exterieur, coins arrondis. */
    function offsetPath(g, pts, r) {
        const k = pts.length;
        const normal = (a, b) => Math.atan2(-(b.x - a.x), b.y - a.y);
        g.beginPath();
        for (let i = 0; i < k; i++) {
            const prev = pts[(i + k - 1) % k];
            const p = pts[i];
            const next = pts[(i + 1) % k];
            g.arc(p.x, p.y, r, normal(prev, p), normal(p, next));
        }
        g.closePath();
    }

    function drawSea(now) {
        lastSea = now;
        const t = REDUCED_MOTION ? 0 : now / 1000;
        const z = cam.zoom;
        const g = sctx;
        g.setTransform(seaRes, 0, 0, seaRes, 0, 0);
        g.fillStyle = SEA_COLOR;
        g.fillRect(0, 0, vw, vh);

        // Hauts-fonds autour de l'ile (dessous, l'ile les recouvre).
        const outline = islandOutline();
        for (const [r, color] of SEA_RINGS) {
            offsetPath(g, outline, r * z);
            g.fillStyle = color;
            g.fill();
        }

        // Vaguelettes accrochees au monde : elles suivent la camera.
        const w0 = screenToWorld(0, 0);
        const w1 = screenToWorld(vw, vh);
        for (const layer of waveLayers) {
            const ox = (t * layer.vx) % (layer.w * layer.scale);
            const oy = (t * layer.vy) % (layer.h * layer.scale);
            g.setTransform(seaRes * z, 0, 0, seaRes * z, seaRes * (vw / 2 - cam.x * z), seaRes * (vh / 2 - cam.y * z));
            g.translate(ox, oy);
            g.scale(layer.scale, layer.scale);
            g.fillStyle = layer.pattern;
            g.fillRect((w0.x - ox) / layer.scale, (w0.y - oy) / layer.scale, (w1.x - w0.x) / layer.scale, (w1.y - w0.y) / layer.scale);
        }
        g.setTransform(seaRes, 0, 0, seaRes, 0, 0);

        // Ecume au pied des falaises.
        offsetPath(g, outline, 10 * z);
        g.fillStyle = "rgba(255,255,255,0.72)";
        g.fill();
    }

    /* --- Ile --------------------------------------------------------------- */

    function drawIsland(g) {
        const n = mapSize();
        const m = margin();
        const z = cam.zoom;
        const sT = iso(-m, -m);
        const sR = iso(n + m, -m);
        const sB = iso(n + m, n + m);
        const sL = iso(-m, n + m);
        const depth = 34 * z;
        const down = (p) => ({ x: p.x, y: p.y + depth });

        // Falaises de roche sableuse
        g.fillStyle = "#b8793c";
        tracePoly(g, [sL, sB, down(sB), down(sL)]);
        g.fill();
        g.fillStyle = "#8f5626";
        tracePoly(g, [sB, sR, down(sR), down(sB)]);
        g.fill();
        g.strokeStyle = "rgba(0,0,0,0.12)";
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 1; k <= 2; k++) {
            g.moveTo(sL.x, sL.y + depth * k / 3);
            g.lineTo(sB.x, sB.y + depth * k / 3);
            g.lineTo(sR.x, sR.y + depth * k / 3);
        }
        g.stroke();

        // Plage
        g.fillStyle = "#f6d9a0";
        tracePoly(g, [sT, sR, sB, sL]);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.55)";
        g.lineWidth = Math.max(1.5, 3 * z);
        g.stroke();

        // Petits cailloux et touffes : un seul trace par couleur, pas un par point.
        if (z > 0.5) {
            const span = n + 2 * m;
            g.beginPath();
            for (const p of pebbles) {
                const gx = -m + p.x * span;
                const gy = -m + p.y * span;
                if (gx > 0.2 && gy > 0.2 && gx < n - 0.2 && gy < n - 0.2) continue;
                const q = iso(gx, gy);
                const rx = 2.2 * z * p.s;
                g.moveTo(q.x + rx, q.y);
                g.ellipse(q.x, q.y, rx, 1.1 * z * p.s, 0, 0, Math.PI * 2);
            }
            g.fillStyle = "rgba(160,110,50,0.22)";
            g.fill();
        }

        // Herbe
        const gT = iso(0, 0);
        const gR = iso(n, 0);
        const gB = iso(n, n);
        const gL = iso(0, n);
        g.fillStyle = "#57a847";
        tracePoly(g, [gT, gR, gB, gL]);
        g.fill();

        // Damier discret
        const ex = { x: (TILE_W / 2) * z, y: (TILE_H / 2) * z };
        const ey = { x: -(TILE_W / 2) * z, y: (TILE_H / 2) * z };
        g.fillStyle = "rgba(255,255,255,0.05)";
        g.beginPath();
        for (let gx = 0; gx < n; gx++) {
            for (let gy = gx % 2; gy < n; gy += 2) {
                const x = gT.x + gx * ex.x + gy * ey.x;
                const y = gT.y + gx * ex.y + gy * ey.y;
                g.moveTo(x, y);
                g.lineTo(x + ex.x, y + ex.y);
                g.lineTo(x + ex.x + ey.x, y + ex.y + ey.y);
                g.lineTo(x + ey.x, y + ey.y);
                g.closePath();
            }
        }
        g.fill();

        // Lisiere herbe / sable
        g.strokeStyle = "#3f8a37";
        g.lineWidth = Math.max(2, 4 * z);
        tracePoly(g, [gT, gR, gB, gL]);
        g.stroke();

        if (z > 0.55) {
            g.beginPath();
            for (const t of tufts) {
                const p = iso(t.x * n, t.y * n);
                const rx = 3.2 * z * t.s;
                g.moveTo(p.x + rx, p.y);
                g.ellipse(p.x, p.y, rx, 1.6 * z * t.s, 0, 0, Math.PI * 2);
            }
            g.fillStyle = "rgba(22,90,40,0.5)";
            g.fill();
        }
    }

    /*
     * Le terrain ne change qu'avec la camera. Des qu'elle est immobile (le cas
     * normal pendant une bataille), il est fige dans une toile a part et
     * recopie d'un bloc a chaque image au lieu d'etre retrace.
     */
    const terrain = document.createElement("canvas");
    const tctx = terrain.getContext("2d");
    const terrainCam = [];
    let terrainReady = false;
    let terrainStill = 0;

    function drawTerrain() {
        const same = terrainCam[0] === cam.x && terrainCam[1] === cam.y && terrainCam[2] === cam.zoom &&
            terrainCam[3] === vw && terrainCam[4] === vh && terrainCam[5] === dpr &&
            terrainCam[6] === mapSize() && terrainCam[7] === margin();
        if (!same) {
            terrainCam.splice(0, 8, cam.x, cam.y, cam.zoom, vw, vh, dpr, mapSize(), margin());
            terrainReady = false;
            terrainStill = 0;
        }
        // Camera en mouvement : on trace directement, la mettre en cache ne servirait a rien.
        if (!terrainReady && ++terrainStill < 2) {
            drawIsland(ctx);
            return;
        }
        if (!terrainReady) {
            if (terrain.width !== canvas.width || terrain.height !== canvas.height) {
                terrain.width = canvas.width;
                terrain.height = canvas.height;
            }
            tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            tctx.clearRect(0, 0, vw, vh);
            drawIsland(tctx);
            terrainReady = true;
        }
        ctx.drawImage(terrain, 0, 0, vw, vh);
    }

    function drawGrid() {
        const n = mapSize();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = iso(i, 0);
            const b = iso(i, n);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            const c = iso(0, i);
            const d = iso(n, i);
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(d.x, d.y);
        }
        ctx.stroke();
    }

    function drawFootprintHighlight(x, y, w, h, fill, stroke) {
        poly(footprint(x, y, w, h));
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /** Cercle de portee (au sol) autour du point (cx, cy), en cases. */
    function drawRange(cx, cy, r, minR, color) {
        const ring = (radius) => {
            ctx.beginPath();
            for (let i = 0; i <= 48; i++) {
                const a = (i / 48) * Math.PI * 2;
                const p = iso(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
        };
        ring(r);
        ctx.fillStyle = color.replace("ALPHA", "0.12");
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = color.replace("ALPHA", "0.85");
        ctx.stroke();
        if (minR > 0) {
            ring(minR);
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.fill();
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /** Cases interdites au deploiement, teintees en rouge. */
    function drawForbidden(isBlocked, alpha) {
        const n = mapSize();
        const m = margin();
        ctx.fillStyle = `rgba(220,38,38,${0.32 * alpha})`;
        ctx.beginPath();
        for (let tx = -m; tx < n + m; tx++) {
            for (let ty = -m; ty < n + m; ty++) {
                if (!isBlocked(tx, ty)) continue;
                const a = iso(tx, ty);
                const b = iso(tx + 1, ty);
                const c = iso(tx + 1, ty + 1);
                const d = iso(tx, ty + 1);
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineTo(c.x, c.y);
                ctx.lineTo(d.x, d.y);
                ctx.closePath();
            }
        }
        ctx.fill();
    }

    Object.assign(view, { drawGrid, drawFootprintHighlight, drawRange, drawForbidden });

    /* ======================================================================
       BATIMENTS
       Un "item" a dessiner : { type, x, y, w, h, level, ghost?, selected?,
       constructing?, destroyed?, hp?, maxHp?, alpha?, right?, down?, trapState? }
       Le dessin renseigne it.hitPoly (zone de toucher) et it.anchor (bulles).
       ====================================================================== */

    /** Teinte des murs selon leur niveau : bois, pierre, pierre sombre, ardoise, or, cristal, lave, legende. */
    const WALL_COLORS = ["#b7793f", "#a8a29e", "#78716c", "#64748b", "#ca8a04", "#7c3aed", "#dc2626", "#0ea5e9"];

    /**
     * Tri topologique : A passe derriere B si A est entierement avant B sur un
     * axe et chevauche B sur l'autre. Plus fiable qu'un simple x + y pour des
     * batiments de tailles differentes.
     */
    function isoSort(items) {
        const n = items.length;
        const behind = (a, b) =>
            (a.x + a.w <= b.x && a.y < b.y + b.h) || (a.y + a.h <= b.y && a.x < b.x + b.w);
        const incoming = new Array(n).fill(0);
        const edges = Array.from({ length: n }, () => []);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j && behind(items[i], items[j])) {
                    edges[i].push(j);
                    incoming[j]++;
                }
            }
        }
        const depth = (it) => it.x + it.y + (it.w + it.h) / 2;
        const ready = [];
        for (let i = 0; i < n; i++) if (incoming[i] === 0) ready.push(i);
        const out = [];
        while (ready.length) {
            ready.sort((a, b) => depth(items[b]) - depth(items[a]));
            const i = ready.pop();
            out.push(items[i]);
            for (const j of edges[i]) if (--incoming[j] === 0) ready.push(j);
        }
        if (out.length < n) return items.slice().sort((a, b) => depth(a) - depth(b));
        return out;
    }

    /** Relie chaque mur a ses voisins de droite et du bas (murs continus). */
    function linkWalls(items) {
        const walls = new Map();
        for (const it of items) if (it.type === "mura" && !it.destroyed && !it.ghost) walls.set(`${it.x},${it.y}`, it);
        for (const it of walls.values()) {
            it.right = walls.has(`${it.x + 1},${it.y}`);
            it.down = walls.has(`${it.x},${it.y + 1}`);
        }
    }

    function block(x0, y0, x1, y1, height, color, stroke = "rgba(0,0,0,0.28)") {
        const top = iso(x0, y0);
        const right = iso(x1, y0);
        const bottom = iso(x1, y1);
        const left = iso(x0, y1);
        const up = (p) => ({ x: p.x, y: p.y - height });
        ctx.lineWidth = 1;
        ctx.strokeStyle = stroke;
        ctx.fillStyle = shade(color, -0.25);
        poly([left, bottom, up(bottom), up(left)]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = shade(color, -0.45);
        poly([bottom, right, up(right), up(bottom)]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = shade(color, 0.12);
        poly([up(top), up(right), up(bottom), up(left)]);
        ctx.fill();
        ctx.stroke();
        return { top, right, bottom, left, up };
    }

    function drawHpBar(x, y, ratio, w = 44) {
        const h = 6;
        roundRect(x - w / 2 - 1, y - 1, w + 2, h + 2, 4);
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fill();
        roundRect(x - w / 2, y, Math.max(h, w * clamp(ratio, 0, 1)), h, 3);
        ctx.fillStyle = ratio > 0.5 ? "#4ade80" : ratio > 0.25 ? "#facc15" : "#f87171";
        ctx.fill();
    }

    function drawWall(it, def) {
        const z = cam.zoom;
        const level = Math.max(1, it.level);
        const color = WALL_COLORS[Math.min(WALL_COLORS.length, level) - 1];
        const h = (11 + level * 1.5) * z;
        const i = 0.2;
        const alpha = it.alpha ?? 1;
        if (alpha !== 1) ctx.globalAlpha = alpha;
        // Ombre
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        poly(footprint(it.x + 0.1, it.y + 0.14, 1, 1, i));
        ctx.fill();
        // Troncons vers les voisins, puis le pilier.
        if (it.right) block(it.x + 1 - i, it.y + 0.3, it.x + 1 + i, it.y + 0.7, h * 0.82, color);
        if (it.down) block(it.x + 0.3, it.y + 1 - i, it.x + 0.7, it.y + 1 + i, h * 0.82, color);
        const b = block(it.x + i, it.y + i, it.x + 1 - i, it.y + 1 - i, h, it.selected ? shade(color, 0.25) : color);
        if (level >= 5) {
            // Creneau decoratif pour les murs de haut niveau
            const c = b.up(iso(it.x + 0.5, it.y + 0.5));
            ctx.fillStyle = shade(color, 0.35);
            ctx.beginPath();
            ctx.arc(c.x, c.y, 3.2 * z, 0, Math.PI * 2);
            ctx.fill();
        }
        if (alpha !== 1) ctx.globalAlpha = 1;
        const top = b.up(b.top);
        it.hitPoly = [b.up(b.left), top, b.up(b.right), b.right, b.bottom, b.left];
        it.anchor = { x: top.x, y: top.y - 10 * z };
        void def;
    }

    function drawTrap(it, def, hidden) {
        const z = cam.zoom;
        const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.12);
        const cx = (left.x + right.x) / 2;
        const cy = (top.y + bottom.y) / 2;
        if (it.trapState === 2) {
            // Piege utilise : trace de brulure
            ctx.fillStyle = "rgba(40,20,10,0.45)";
            ctx.beginPath();
            ctx.ellipse(cx, cy, (right.x - left.x) * 0.42, (bottom.y - top.y) * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (hidden && !it.trapState) return;
        ctx.globalAlpha = it.ghost ? 0.8 : 0.9;
        ctx.fillStyle = it.selected ? "rgba(253,186,116,0.55)" : "rgba(30,20,10,0.35)";
        poly([top, right, bottom, left]);
        ctx.fill();
        ctx.strokeStyle = shade(def.color, 0.1);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        const pulse = it.trapState === 1 && !REDUCED_MOTION ? 1 + 0.25 * Math.sin(performance.now() / 60) : 1;
        drawEmoji(def.emoji, cx, cy - 4 * z, TILE_W * 0.42 * z * pulse, 1);
        ctx.globalAlpha = 1;
        it.hitPoly = [{ x: cx, y: cy - 26 * z }, right, bottom, left];
        it.anchor = { x: cx, y: cy - 24 * z };
    }

    function drawDecoration(it, def) {
        const z = cam.zoom;
        const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.1);
        const cx = (left.x + right.x) / 2;
        const cy = (top.y + bottom.y) / 2;
        const size = TILE_W * 0.62 * it.w * z * (it.selected ? 1.1 : 1);
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        ctx.ellipse(cx, cy, (right.x - left.x) * 0.3, (bottom.y - top.y) * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        drawEmoji(def.emoji, cx, cy - size * 0.36, size, it.alpha ?? 1);
        it.hitPoly = [
            { x: cx - size * 0.5, y: cy - size * 0.95 }, { x: cx + size * 0.5, y: cy - size * 0.95 },
            right, bottom, left
        ];
        it.anchor = { x: cx, y: cy - size * 0.9 };
    }

    function drawRubble(it) {
        const z = cam.zoom;
        const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.15);
        ctx.fillStyle = "rgba(60,40,30,0.55)";
        poly([top, right, bottom, left]);
        ctx.fill();
        const cx = (left.x + right.x) / 2;
        const cy = (top.y + bottom.y) / 2;
        const r = Math.min(it.w, it.h);
        ctx.fillStyle = "#6b5444";
        for (let k = 0; k < 3 + r; k++) {
            const a = (k * 2.39996) % (Math.PI * 2);
            const d = (k % 3) * 0.18 * r * TILE_H * z;
            ctx.beginPath();
            ctx.ellipse(cx + Math.cos(a) * d * 1.6, cy + Math.sin(a) * d * 0.8 - 3 * z, (4 + (k % 2) * 3) * z, (3 + (k % 2) * 2) * z, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        it.hitPoly = null;
        it.anchor = { x: cx, y: cy - 12 * z };
    }

    /**
     * Dessine un batiment. `opts.hideTraps` cache les pieges non declenches
     * (vue de l'attaquant), `opts.badges` affiche la pastille de niveau,
     * `opts.sprites` passe par les images en cache (bataille).
     */
    function drawBuilding(it, opts = {}) {
        const def = V.cat(it.type);
        if (!def) return;
        if (it.destroyed) {
            if (def.category === "trap") drawTrap(it, def, true);
            else if (def.category !== "decoration") drawRubble(it);
            return;
        }
        if (def.category === "decoration") return drawDecoration(it, def);
        if (def.category === "trap") return drawTrap(it, def, opts.hideTraps);
        if (opts.sprites && spritesOk && !it.ghost && !it.selected && !it.constructing && (it.alpha ?? 1) === 1) {
            return drawFromSprite(it, def, opts);
        }
        if (def.category === "wall") return drawWall(it, def);
        drawBody(it, def, opts);
    }

    function drawBody(it, def, opts) {
        const z = cam.zoom;
        const constructing = Boolean(it.constructing);
        const alpha = it.alpha ?? (it.ghost ? 0.82 : 1);
        const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.1);
        const level = Math.max(1, it.level);
        const height = (def.height + (level - 1) * 3) * z * (constructing ? 0.45 : 1);
        const up = (p) => ({ x: p.x, y: p.y - height });
        const base = def.color;

        if (alpha !== 1) ctx.globalAlpha = alpha;

        // Ombre
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        poly([{ x: top.x + 4 * z, y: top.y + 3 * z }, { x: right.x + 6 * z, y: right.y + 3 * z },
            { x: bottom.x + 4 * z, y: bottom.y + 4 * z }, { x: left.x, y: left.y + 3 * z }]);
        ctx.fill();

        // Faces
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.fillStyle = constructing ? "#8a6a45" : shade(base, -0.25);
        poly([left, bottom, up(bottom), up(left)]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = constructing ? "#6e5236" : shade(base, -0.45);
        poly([bottom, right, up(right), up(bottom)]);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = constructing ? "#b08a5c" : shade(base, it.selected ? 0.3 : 0.14);
        poly([up(top), up(right), up(bottom), up(left)]);
        ctx.fill();
        ctx.stroke();

        // Toit : losange interieur plus clair
        const cx = (left.x + right.x) / 2;
        const cy = (top.y + bottom.y) / 2 - height;
        const inner = [up(top), up(right), up(bottom), up(left)].map((p) => ({ x: cx + (p.x - cx) * 0.62, y: cy + (p.y - cy) * 0.62 }));
        ctx.fillStyle = constructing ? "rgba(250,204,21,0.35)" : shade(base, 0.32);
        poly(inner);
        ctx.fill();

        // Defense hors service (en chantier) : bache jaune et noire
        if (it.inactive) {
            ctx.strokeStyle = "rgba(250,204,21,0.9)";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            poly(inner);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Emoji du batiment, pose sur le toit
        const size = Math.max(14, Math.min(it.w, it.h) * TILE_W * 0.56 * z) * (it.selected ? 1.08 : 1);
        const ey = cy - size * 0.3;
        drawEmoji(constructing ? "🏗️" : def.emoji, cx, ey, size, 1);

        if (alpha !== 1) ctx.globalAlpha = 1;

        // Pastille de niveau
        if (opts.badges && !it.ghost && it.level >= 1 && def.maxLevel > 1) {
            const r = clamp(9 * z, 8, 13);
            const bx = (left.x + bottom.x) / 2;
            const by = (left.y + bottom.y) / 2 - height * 0.45;
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, Math.PI * 2);
            ctx.fillStyle = "#171717";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = shade(base, 0.2);
            ctx.stroke();
            ctx.fillStyle = "#fff";
            ctx.font = `900 ${Math.round(r * 1.15)}px ${UI_FONT}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(it.level), bx, by + 0.5);
        }

        // Barre de vie (bataille)
        it.hpAt = { x: cx, y: ey - size * 0.75, w: clamp(30 * it.w * z, 30, 70) };
        if (it.maxHp > 0 && it.hp < it.maxHp) drawHpBar(it.hpAt.x, it.hpAt.y, it.hp / it.maxHp, it.hpAt.w);

        it.hitPoly = [
            { x: cx, y: ey - size * 0.55 }, { x: right.x, y: up(right).y - size * 0.2 }, right, bottom, left,
            { x: left.x, y: up(left).y - size * 0.2 }
        ];
        it.anchor = { x: cx, y: ey - size * 0.62 };
    }

    /*
     * Batiments en images (bataille). Chaque type de batiment (et chaque forme
     * de mur) est dessine une seule fois dans une petite toile, puis recopie :
     * une copie d'image au lieu d'une dizaine de polygones par batiment, ce que
     * l'iPad dessine bien plus vite. L'ordre de dessin (troupes derriere ou
     * devant) ne change pas. Ces toiles ne dependent que du zoom : deplacer la
     * camera les garde valables ; pendant un pincement, on dessine directement.
     */
    const SPRITE_ZOOM_MAX = 1.35;
    const buildingSprites = new Map();
    let spritesZoom = 0;
    let spritesDpr = 0;
    let lastDrawZoom = 0;
    let spritesOk = false;

    /** Appele avant chaque image : les toiles ne servent que si le zoom n'a pas bouge. */
    function prepareSprites() {
        spritesOk = cam.zoom === lastDrawZoom && cam.zoom <= SPRITE_ZOOM_MAX;
        lastDrawZoom = cam.zoom;
        if (spritesOk && (cam.zoom !== spritesZoom || dpr !== spritesDpr)) {
            buildingSprites.clear();
            spritesZoom = cam.zoom;
            spritesDpr = dpr;
        }
    }

    function buildingSprite(it, def, at, opts) {
        const z = cam.zoom;
        let x0;
        let x1;
        let y0;
        let y1;
        if (def.category === "wall") {
            const h = (11 + Math.max(1, it.level) * 1.5) * z;
            x0 = iso(it.x, it.y + 1.25).x;
            x1 = iso(it.x + 1.25, it.y).x;
            y0 = at.y - h - 6 * z;
            y1 = iso(it.x + 1.25, it.y + 1.25).y;
        } else {
            const height = (def.height + (Math.max(1, it.level) - 1) * 3) * z;
            const size = Math.max(14, Math.min(it.w, it.h) * TILE_W * 0.56 * z);
            const [top, right, bottom, left] = footprint(it.x, it.y, it.w, it.h, 0.1);
            const cx = (left.x + right.x) / 2;
            const ey = (top.y + bottom.y) / 2 - height - size * 0.3;
            x0 = Math.min(left.x, cx - 0.8 * size);
            x1 = Math.max(right.x + 6 * z, cx + 0.8 * size);
            y0 = Math.min(top.y - height, ey - 0.8 * size);
            y1 = bottom.y + 4 * z;
        }
        const ox = Math.floor((x0 - 3) * dpr) / dpr;
        const oy = Math.floor((y0 - 3) * dpr) / dpr;
        const el = document.createElement("canvas");
        el.width = Math.ceil((x1 + 3 - ox) * dpr);
        el.height = Math.ceil((y1 + 3 - oy) * dpr);
        const g = el.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
        // Meme code de dessin, simplement redirige vers la petite toile (sans barre de vie).
        const copy = { ...it, maxHp: 0, hitPoly: null, anchor: null, hpAt: null };
        const main = ctx;
        ctx = g;
        try {
            if (def.category === "wall") drawWall(copy, def);
            else drawBody(copy, def, { badges: opts.badges });
        } finally {
            ctx = main;
        }
        const rel = (p) => ({ x: p.x - at.x, y: p.y - at.y });
        return {
            canvas: el,
            w: el.width / dpr,
            h: el.height / dpr,
            ax: at.x - ox,
            ay: at.y - oy,
            hit: (copy.hitPoly || []).map(rel),
            anchor: rel(copy.anchor || at),
            hp: copy.hpAt ? { ...rel(copy.hpAt), w: copy.hpAt.w } : null
        };
    }

    function drawFromSprite(it, def, opts) {
        const key = def.category === "wall"
            ? `mura${it.level}${it.right ? "r" : ""}${it.down ? "d" : ""}`
            : `${it.type}${it.level}${it.inactive ? "i" : ""}${opts.badges ? "b" : ""}`;
        const at = iso(it.x, it.y);
        let s = buildingSprites.get(key);
        if (!s) {
            s = buildingSprite(it, def, at, opts);
            buildingSprites.set(key, s);
        }
        ctx.drawImage(s.canvas, Math.round((at.x - s.ax) * dpr) / dpr, Math.round((at.y - s.ay) * dpr) / dpr, s.w, s.h);
        it.hitPoly = s.hit.map((p) => ({ x: at.x + p.x, y: at.y + p.y }));
        it.anchor = { x: at.x + s.anchor.x, y: at.y + s.anchor.y };
        if (s.hp && it.maxHp > 0 && it.hp < it.maxHp) drawHpBar(at.x + s.hp.x, at.y + s.hp.y, it.hp / it.maxHp, s.hp.w);
    }

    Object.assign(view, { isoSort, linkWalls, drawBuilding, drawHpBar });

    /* ======================================================================
       TROUPES ET PROJECTILES
       ====================================================================== */

    /** Hauteur de vol des unites volantes, en pixels monde. */
    const FLY_HEIGHT = 30;

    function unitSize(space) {
        return 28 + Math.min(space, 10) * 2;
    }

    /**
     * Dessine une troupe a la position interpolee (gx, gy). `facing` < 0 :
     * tournee vers la gauche de l'ecran.
     */
    function drawUnit(emoji, gx, gy, space, flying, hpRatio, facing, attacking) {
        const z = cam.zoom;
        const p = iso(gx, gy);
        // Jamais minuscules, meme dezoome : ce sont les heros de la bataille.
        const size = Math.max(20, unitSize(space) * z);
        const lift = flying ? FLY_HEIGHT * z : 0;
        const bob = REDUCED_MOTION ? 0 : attacking ? Math.abs(Math.sin(performance.now() / 90)) * 3 * z : 0;
        ctx.fillStyle = flying ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.28)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, size * 0.34, size * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        drawEmoji(emoji, p.x, p.y - size * 0.42 - lift - bob, size, 1, facing < 0);
        if (hpRatio < 1) drawHpBar(p.x, p.y - size * 1.05 - lift, hpRatio, Math.max(20, size * 0.9));
    }

    const PROJECTILE_STYLE = {
        ball: { color: "#1f2937", r: 4, arc: 0.15 },
        arrow: { color: "#78350f", r: 0, arc: 0.1 },
        shell: { color: "#292524", r: 6.5, arc: 0.9 },
        rocket: { color: "#f97316", r: 3.5, arc: 0.05 },
        orb: { color: "#a855f7", r: 6, arc: 0.3 }
    };

    /** p : { fromX, fromY (ecran, deja projete), toGx, toGy, t (0..1), kind } */
    function drawProjectile(p) {
        const z = cam.zoom;
        const to = iso(p.toGx, p.toGy);
        const from = toScreen(p.fromWx, p.fromWy);
        const style = PROJECTILE_STYLE[p.kind] || PROJECTILE_STYLE.ball;
        const t = clamp(p.t, 0, 1);
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * dist * style.arc;
        if (p.kind === "arrow") {
            const t2 = clamp(t - 0.08, 0, 1);
            const x2 = from.x + (to.x - from.x) * t2;
            const y2 = from.y + (to.y - from.y) * t2 - Math.sin(Math.PI * t2) * dist * style.arc;
            ctx.strokeStyle = style.color;
            ctx.lineWidth = Math.max(1.5, 2.5 * z);
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x, y);
            ctx.stroke();
            return;
        }
        if (p.kind === "rocket" || p.kind === "orb") {
            ctx.fillStyle = p.kind === "rocket" ? "rgba(253,186,116,0.5)" : "rgba(216,180,254,0.45)";
            ctx.beginPath();
            ctx.arc(x, y, style.r * 2 * z, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = style.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, style.r * z), 0, Math.PI * 2);
        ctx.fill();
    }

    Object.assign(view, { drawUnit, drawProjectile, unitSize, FLY_HEIGHT });

    /* ======================================================================
       EFFETS (flottants, pieces, etincelles, explosions, fumee...)
       Positions en coordonnees de grille : ils suivent la camera.
       ====================================================================== */

    const effects = [];

    function spawn(effect) {
        if (REDUCED_MOTION && effect.kind !== "float") return;
        effects.push({ start: performance.now(), dur: 900, ...effect });
        if (effects.length > 260) effects.splice(0, effects.length - 260);
        requestDraw();
    }

    const fx = {
        float: (gx, gy, text, color, lift = 60) => spawn({ kind: "float", gx, gy, text, color, lift, dur: 1500 }),
        spark: (gx, gy) => {
            for (let i = 0; i < 10; i++) {
                const a = (Math.PI * 2 * i) / 10;
                spawn({ kind: "spark", gx, gy, vx: Math.cos(a), vy: Math.sin(a), dur: 900 });
            }
        },
        boom: (gx, gy, r, color = "255,160,60") => spawn({ kind: "boom", gx, gy, r: Math.max(0.5, r), color, dur: 450 }),
        smoke: (gx, gy, big = 1) => {
            for (let i = 0; i < 4 + 2 * big; i++) {
                spawn({ kind: "smoke", gx: gx + (Math.random() - 0.5) * big, gy: gy + (Math.random() - 0.5) * big, s: 0.7 + Math.random() * 0.6 * big, dur: 900 + Math.random() * 500 });
            }
        },
        ring: (gx, gy, r, color) => spawn({ kind: "ring", gx, gy, r, color, dur: 600 }),
        emoji: (gx, gy, emoji, lift = 40, size = 22, dur = 900) => spawn({ kind: "emoji", gx, gy, emoji, lift, size, dur }),
        dust: (gx, gy) => spawn({ kind: "dust", gx, gy, dur: 420 }),
        hit: (gx, gy) => spawn({ kind: "hit", gx, gy, dur: 220 }),
        /** Pieces qui volent d'un point de la carte vers un element de l'interface. */
        coins: (gx, gy, targetEl) => {
            if (!targetEl) return;
            const rect = targetEl.getBoundingClientRect();
            const appRect = ui.app.getBoundingClientRect();
            const to = { x: rect.left - appRect.left + 24, y: rect.top - appRect.top + rect.height / 2 };
            const from = iso(gx, gy);
            const now = performance.now();
            for (let i = 0; i < 7; i++) {
                effects.push({
                    kind: "coin",
                    from: { x: from.x + (Math.random() - 0.5) * 40, y: from.y - 20 + (Math.random() - 0.5) * 20 },
                    to,
                    lift: 60 + Math.random() * 60,
                    start: now + i * 55,
                    dur: 650
                });
            }
            requestDraw();
        },
        clear: () => {
            effects.length = 0;
        },
        get count() {
            return effects.length;
        }
    };
    view.fx = fx;

    function drawEffects() {
        const now = performance.now();
        const z = cam.zoom;
        for (let i = effects.length - 1; i >= 0; i--) {
            const e = effects[i];
            const t = (now - e.start) / e.dur;
            if (t < 0) continue;
            if (t >= 1) {
                effects.splice(i, 1);
                continue;
            }
            switch (e.kind) {
                case "float": {
                    const p = iso(e.gx, e.gy);
                    ctx.globalAlpha = 1 - t * t;
                    outlinedText(e.text, p.x, p.y - e.lift * z - t * 70, 24, e.color);
                    ctx.globalAlpha = 1;
                    break;
                }
                case "coin": {
                    const k = t * t * (3 - 2 * t);
                    const x = e.from.x + (e.to.x - e.from.x) * k;
                    const y = e.from.y + (e.to.y - e.from.y) * k - Math.sin(Math.PI * k) * e.lift;
                    drawEmoji("🪙", x, y, 22 - 8 * k);
                    break;
                }
                case "spark": {
                    const p = iso(e.gx, e.gy);
                    const dist = 30 + t * 70;
                    drawEmoji("✨", p.x + e.vx * dist * z, p.y - 40 * z + e.vy * dist * 0.6 * z, 20, 1 - t);
                    break;
                }
                case "boom": {
                    const p = iso(e.gx, e.gy);
                    const rx = e.r * TILE_W * 0.72 * z * (0.35 + 0.65 * t);
                    ctx.fillStyle = `rgba(${e.color},${0.55 * (1 - t)})`;
                    ctx.beginPath();
                    ctx.ellipse(p.x, p.y, rx, rx * 0.5, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = `rgba(255,245,200,${0.7 * (1 - t) * (1 - t)})`;
                    ctx.beginPath();
                    ctx.ellipse(p.x, p.y - 4 * z, rx * 0.45, rx * 0.25, 0, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                }
                case "smoke": {
                    const p = iso(e.gx, e.gy);
                    ctx.fillStyle = `rgba(70,60,55,${0.45 * (1 - t)})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y - (10 + t * 40) * z, (8 + t * 14) * z * e.s, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                }
                case "ring": {
                    const p = iso(e.gx, e.gy);
                    const rx = e.r * TILE_W * 0.72 * z * (0.6 + 0.4 * t);
                    ctx.strokeStyle = e.color.replace("ALPHA", String(0.8 * (1 - t)));
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.ellipse(p.x, p.y, rx, rx * 0.5, 0, 0, Math.PI * 2);
                    ctx.stroke();
                    break;
                }
                case "emoji": {
                    const p = iso(e.gx, e.gy);
                    drawEmoji(e.emoji, p.x, p.y - e.lift * z - t * 30 * z, e.size * z + 6, 1 - t * t);
                    break;
                }
                case "dust": {
                    const p = iso(e.gx, e.gy);
                    ctx.fillStyle = `rgba(255,240,210,${0.6 * (1 - t)})`;
                    ctx.beginPath();
                    ctx.ellipse(p.x, p.y, (6 + t * 18) * z, (3 + t * 9) * z, 0, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                }
                case "hit": {
                    const p = iso(e.gx, e.gy);
                    ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y - 12 * z, (3 + t * 6) * z, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                }
                default:
                    break;
            }
        }
    }

    /* ======================================================================
       BOUCLE DE RENDU (a la demande)
       ====================================================================== */

    /**
     * Horloge lente (~12 i/s) pour tout ce qui bouge doucement : la mer, et
     * les bulles qui flottent au-dessus du village. Un simple minuteur plutot
     * qu'un requestAnimationFrame a 60-120 i/s : l'iPad reste au repos entre
     * deux images.
     */
    const AMBIENT_MS = 1000 / 12;
    /**
     * Bataille et effets : 30 i/s suffisent (les troupes avancent a 10 ticks/s
     * et sont interpolees). Le doigt qui deplace la camera garde 60 i/s.
     */
    const FAST_MS = 1000 / 30;

    let rafId = 0;
    let dirty = false;
    let lastDraw = -Infinity;
    let inertia = null;
    let ambientTimer = 0;
    let lastSea = -Infinity;
    /** Camera au dernier dessin de la mer : si elle a bouge, la mer suit dans la meme image. */
    const seaCam = [];

    function requestDraw() {
        dirty = true;
        if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame);
        scheduleAmbient();
    }

    function seaTick(now) {
        const moved = seaCam[0] !== cam.x || seaCam[1] !== cam.y || seaCam[2] !== cam.zoom || seaCam[3] !== mapSize() || seaCam[4] !== margin();
        if (!moved && (REDUCED_MOTION || now - lastSea < AMBIENT_MS - 4)) return;
        seaCam.splice(0, 5, cam.x, cam.y, cam.zoom, mapSize(), margin());
        drawSea(now);
    }

    function scheduleAmbient() {
        if (ambientTimer || REDUCED_MOTION || document.hidden || !scene) return;
        ambientTimer = setTimeout(() => {
            ambientTimer = 0;
            if (document.hidden || !scene) return;
            // Boucle rapide en cours (geste, bataille) : elle dessine deja tout, mer comprise.
            if (!rafId) {
                if (scene.animating()) requestDraw();
                else seaTick(performance.now());
            }
            scheduleAmbient();
        }, AMBIENT_MS);
    }

    function frame(ts) {
        rafId = 0;
        if (!scene) return;
        scene.update?.(ts);

        if (camTween) {
            const t = clamp((performance.now() - camTween.start) / camTween.dur, 0, 1);
            const k = 1 - Math.pow(1 - t, 3);
            cam.y = camTween.fromY + (camTween.toY - camTween.fromY) * k;
            clampCamera();
            if (t >= 1) camTween = null;
            dirty = true;
        }
        if (inertia) {
            stepInertia();
            dirty = true;
        }

        // Les animations lentes (bulles qui flottent) passent par l'horloge lente.
        const fast = effects.length > 0 || camTween || inertia || scene.animating() === "fast";
        if (dirty || (fast && ts - lastDraw >= FAST_MS - 2)) {
            draw(ts);
            lastDraw = ts;
            dirty = false;
        }
        seaTick(ts);
        if (fast) rafId = requestAnimationFrame(frame);
    }

    function draw(ts) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vw, vh);
        prepareSprites();
        drawTerrain();
        if (scene.showGrid?.()) drawGrid();
        scene.draw(ts);
        drawEffects();
    }

    function setScene(next) {
        scene = next;
        buildingSprites.clear();
        inertia = null;
        camTween = null;
        requestDraw();
    }

    function stopLoop() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        clearTimeout(ambientTimer);
        ambientTimer = 0;
    }

    Object.assign(view, { requestDraw, setScene, stopLoop, get scene() { return scene; } });

    /* ======================================================================
       GESTES (Pointer Events : doigt, stylet et souris)
       ====================================================================== */

    const pointers = new Map();
    let gesture = null; // { kind: "pan" | "drag" | "hold" | "pinch", ... }
    let longPressTimer = 0;

    function localPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function stepInertia() {
        const now = performance.now();
        const dt = Math.min(40, now - inertia.last);
        inertia.last = now;
        cam.x -= (inertia.vx * dt) / cam.zoom;
        cam.y -= (inertia.vy * dt) / cam.zoom;
        clampCamera();
        const decay = Math.pow(0.9, dt / 16);
        inertia.vx *= decay;
        inertia.vy *= decay;
        if (Math.hypot(inertia.vx, inertia.vy) < 0.02) inertia = null;
    }

    /** Termine proprement un geste en cours (fantome lache, deploiement continu arrete). */
    function releaseGesture() {
        if (gesture?.kind === "drag") scene?.dragEnd?.();
        if (gesture?.kind === "hold") scene?.holdEnd?.();
        canvas.classList.remove("is-dragging");
    }

    function startPinch() {
        releaseGesture();
        const [a, b] = [...pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gesture = {
            kind: "pinch",
            dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
            zoom: cam.zoom,
            world: screenToWorld(mid.x, mid.y)
        };
    }

    function onPointerDown(event) {
        if (!scene) return;
        const p = localPoint(event);
        canvas.setPointerCapture?.(event.pointerId);
        pointers.set(event.pointerId, p);
        inertia = null;
        camTween = null;
        clearTimeout(longPressTimer);

        if (pointers.size === 2) {
            startPinch();
            return;
        }
        if (pointers.size > 2) return;

        const start = { x: p.x, y: p.y, t: performance.now() };
        if (scene.dragStart?.(p.x, p.y)) {
            gesture = { kind: "drag", start, moved: false };
            canvas.classList.add("is-dragging");
            return;
        }

        gesture = { kind: "pan", start, moved: false, last: p, lastT: start.t, vx: 0, vy: 0 };
        const delay = scene.longPressDelay?.(p.x, p.y) || 0;
        if (delay > 0) {
            longPressTimer = setTimeout(() => {
                if (!gesture || gesture.kind !== "pan" || gesture.moved || pointers.size !== 1) return;
                const current = [...pointers.values()][0] || p;
                const kind = scene.longPress?.(current.x, current.y);
                if (kind === "drag" || kind === "hold") {
                    gesture = { kind, start, moved: true };
                    if (kind === "drag") canvas.classList.add("is-dragging");
                }
            }, delay);
        }
    }

    function onPointerMove(event) {
        if (!pointers.has(event.pointerId)) return;
        const p = localPoint(event);
        pointers.set(event.pointerId, p);
        if (!gesture) return;

        if (gesture.kind === "pinch" && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            cam.zoom = clamp(gesture.zoom * (dist / gesture.dist), MIN_ZOOM, MAX_ZOOM);
            cam.x = gesture.world.x - (mid.x - vw / 2) / cam.zoom;
            cam.y = gesture.world.y - (mid.y - vh / 2) / cam.zoom;
            clampCamera();
            requestDraw();
            return;
        }
        if (gesture.kind === "drag") {
            scene.dragMove?.(p.x, p.y);
            return;
        }
        if (gesture.kind === "hold") {
            scene.holdMove?.(p.x, p.y);
            return;
        }

        const dx = p.x - gesture.start.x;
        const dy = p.y - gesture.start.y;
        if (!gesture.moved && Math.hypot(dx, dy) > TAP_SLOP) {
            gesture.moved = true;
            clearTimeout(longPressTimer);
        }
        if (gesture.kind === "pan" && gesture.moved) {
            const now = performance.now();
            const ddx = p.x - gesture.last.x;
            const ddy = p.y - gesture.last.y;
            const dt = Math.max(1, now - gesture.lastT);
            cam.x -= ddx / cam.zoom;
            cam.y -= ddy / cam.zoom;
            clampCamera();
            gesture.vx = 0.8 * (ddx / dt) + 0.2 * gesture.vx;
            gesture.vy = 0.8 * (ddy / dt) + 0.2 * gesture.vy;
            gesture.last = p;
            gesture.lastT = now;
            canvas.classList.add("is-dragging");
            requestDraw();
        }
    }

    function onPointerUp(event) {
        if (!pointers.has(event.pointerId)) return;
        const p = localPoint(event);
        pointers.delete(event.pointerId);
        clearTimeout(longPressTimer);

        if (gesture?.kind === "pinch") {
            if (pointers.size === 1) {
                // Il reste un doigt : on enchaine sur un deplacement sans saut.
                const [rest] = [...pointers.values()];
                gesture = { kind: "pan", start: { x: rest.x, y: rest.y, t: performance.now() }, moved: true, last: rest, lastT: performance.now(), vx: 0, vy: 0 };
            } else if (pointers.size === 0) {
                gesture = null;
            }
            return;
        }
        if (pointers.size > 0) return;

        const g = gesture;
        gesture = null;
        canvas.classList.remove("is-dragging");
        if (!g) return;

        if (g.kind === "drag") {
            scene?.dragEnd?.();
            if (!g.moved && event.type !== "pointercancel") scene?.tap(p.x, p.y);
            return;
        }
        if (g.kind === "hold") {
            scene?.holdEnd?.();
            return;
        }
        if (!g.moved && event.type !== "pointercancel") {
            scene?.tap(p.x, p.y);
            return;
        }
        if (g.kind === "pan" && event.type !== "pointercancel" && performance.now() - g.lastT < 80) {
            const speed = Math.hypot(g.vx, g.vy);
            if (speed > 0.15) {
                inertia = { vx: g.vx, vy: g.vy, last: performance.now() };
                requestDraw();
            }
        }
    }

    function onWheel(event) {
        event.preventDefault();
        const p = localPoint(event);
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
        zoomAt(p.x, p.y, cam.zoom * factor);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    /* ======================================================================
       OUTILS DE TOUCHER
       ====================================================================== */

    function pointInPoly(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i];
            const b = pts[j];
            if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }

    /** Dernier item dessine (donc au premier plan) sous le point. */
    function hitItem(items, x, y, accept) {
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (!it.hitPoly || (accept && !accept(it))) continue;
            if (pointInPoly(x, y, it.hitPoly)) return it;
        }
        return null;
    }

    Object.assign(view, { pointInPoly, hitItem });
})();
