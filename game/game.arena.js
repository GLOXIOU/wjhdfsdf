/* ==========================================================================
   Arene de combat (rendu + saisie), facon Clash Royale.

   Le serveur fait autorite : il envoie les entites (unites, tours, zones) en
   deltas et de simples evenements visuels (tirs, lancers, explosions). Ce
   fichier ne fait que les dessiner, avec 110 ms de retard pour interpoler.

   - Chaque joueur se voit toujours de SON cote, en bleu (vue en miroir pour
     le joueur de droite) : a gauche en paysage, en bas en portrait (l'arene
     pivote comme dans Clash Royale). Les coordonnees serveur ne changent pas.
   - Decor (herbe, chemins, riviere, ponts, accessoires) pre-rendu une fois.
   - 30 images/s maximum, rien quand l'onglet est cache : l'iPad dit merci.
   ========================================================================== */
(() => {
  'use strict';

  const W = 900;
  const H = 400;
  const RIVER_L = 428;
  const RIVER_R = 472;
  const BRIDGES = [95, 305];
  const BRIDGE_HALF = 24;
  const LANE_SPLIT = 200;
  const POCKET = 150;
  const INTERP_MS = 110;
  const FADE_MS = 260;
  const FRAME_MS = 1000 / 30;
  const TEAM = {
    me: { main: '#3b82f6', light: '#bfdbfe', dark: '#1e3a8a', ring: 'rgba(59,130,246,0.55)' },
    foe: { main: '#ef4444', light: '#fecaca', dark: '#7f1d1d', ring: 'rgba(239,68,68,0.55)' }
  };
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let bg = null;
  let myId = null;
  let mirror = false;

  /** id -> entite interpolable */
  const ents = new Map();
  const fxList = [];
  let placement = null;
  let hover = null;
  let shake = { mag: 0, until: 0 };

  const vx = (x) => (mirror ? W - x : x);
  /** Portrait : l'arene pivote d'un quart de tour, le joueur en bas. */
  let portrait = false;
  let CW = W;
  let CH = H;
  /** Vue locale paysage (moi a gauche) -> ecran. */
  const L = (lx, ly) => (portrait ? { x: ly, y: W - lx } : { x: lx, y: ly });
  /** Monde (serveur) -> ecran. */
  const P = (x, y) => L(vx(x), y);
  /** Rectangle en vue locale paysage -> rectangle ecran. */
  const R = (lx, ly, w, h) => (portrait ? { x: ly, y: W - lx - w, w: h, h: w } : { x: lx, y: ly, w, h });
  /** Ecran -> monde. */
  const toWorldPoint = (sx, sy) => ({ x: vx(portrait ? W - sy : sx), y: portrait ? sx : sy });
  const teamOf = (ownerId) => (ownerId === myId ? TEAM.me : TEAM.foe);

  /* ------------------------------------------------------------------------
     Sprites (emoji et images de cartes mis en cache)
     ---------------------------------------------------------------------- */

  const sprites = new Map();
  function emojiSprite(emoji, size) {
    const px = Math.max(8, Math.round(size * dpr / 4) * 4);
    const key = emoji + '|' + px;
    let s = sprites.get(key);
    if (!s) {
      s = document.createElement('canvas');
      s.width = s.height = Math.ceil(px * 1.3);
      const g = s.getContext('2d');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${px}px ${EMOJI_FONT}`;
      g.fillText(emoji, s.width / 2, s.height / 2 + px * 0.06);
      if (sprites.size > 300) sprites.delete(sprites.keys().next().value);
      sprites.set(key, s);
    }
    return s;
  }

  function drawEmoji(emoji, x, y, size, alpha = 1) {
    const s = emojiSprite(emoji || '❓', size);
    const w = s.width / dpr;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(s, x - w / 2, y - w / 2, w, w);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  const images = new Map();
  function loadImage(url) {
    let img = images.get(url);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      img.addEventListener('error', () => { img.failed = true; }, { once: true });
      img.src = url;
      images.set(url, img);
    }
    return img;
  }

  /** Portrait d'une unite : image de la carte (ronde) ou emoji. */
  function drawPortrait(e, x, y, size) {
    if (e.link) {
      const img = loadImage(e.link);
      if (img.complete && !img.failed && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
        ctx.restore();
        return;
      }
    }
    drawEmoji(e.emoji, x, y, size);
  }

  /* ------------------------------------------------------------------------
     Decor pre-rendu
     ---------------------------------------------------------------------- */

  // Accessoires de la moitie gauche (la droite est en miroir : decor symetrique).
  const PROPS = [
    ['🌳', 18, 22, 30], ['🌲', 58, 16, 26], ['🪨', 96, 30, 18], ['🌳', 238, 20, 28], ['🌿', 292, 34, 18],
    ['🌼', 340, 18, 14], ['🍄', 372, 38, 15], ['🌳', 18, 378, 30], ['🌲', 62, 386, 26], ['🌸', 104, 368, 14],
    ['🌳', 250, 382, 28], ['🪨', 300, 366, 18], ['🌿', 356, 384, 18], ['🗿', 300, 200, 24], ['🌼', 262, 176, 12],
    ['🌸', 336, 228, 12], ['🪵', 386, 150, 18], ['🥥', 382, 252, 15], ['🌿', 16, 140, 16], ['🌿', 18, 262, 16]
  ];

  function buildBackground() {
    const land = document.createElement('canvas');
    land.width = Math.round(W * dpr);
    land.height = Math.round(H * dpr);
    const g = land.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Herbe en damier doux
    g.fillStyle = '#5aa84a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.045)';
    for (let x = 0; x < W; x += 30) {
      for (let y = (x / 30) % 2 ? 0 : 30; y < H; y += 60) g.fillRect(x, y, 30, 30);
    }

    // Chemins de terre : roi -> princesses -> ponts -> princesses adverses -> roi adverse
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const path = (w, color) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      for (const ly of BRIDGES) {
        g.beginPath();
        g.moveTo(52, 200);
        g.lineTo(150, ly);
        g.lineTo(W - 150, ly);
        g.lineTo(W - 52, 200);
        g.stroke();
      }
    };
    path(38, '#b88a55');
    path(30, '#d4ab74');

    // Riviere, berges et reflets
    const river = g.createLinearGradient(RIVER_L, 0, RIVER_R, 0);
    river.addColorStop(0, '#1b7fc0');
    river.addColorStop(0.5, '#2fa3de');
    river.addColorStop(1, '#1b7fc0');
    g.fillStyle = '#e7d39a';
    g.fillRect(RIVER_L - 5, 0, RIVER_R - RIVER_L + 10, H);
    g.fillStyle = river;
    g.fillRect(RIVER_L, 0, RIVER_R - RIVER_L, H);

    // Ponts en bois
    for (const by of BRIDGES) {
      const x0 = RIVER_L - 12;
      const w = RIVER_R - RIVER_L + 24;
      const y0 = by - BRIDGE_HALF;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x0 + 3, y0 + 5, w, BRIDGE_HALF * 2);
      g.fillStyle = '#a0683a';
      g.fillRect(x0, y0, w, BRIDGE_HALF * 2);
      g.strokeStyle = 'rgba(60,30,10,0.45)';
      g.lineWidth = 1.5;
      for (let x = x0 + 8; x < x0 + w; x += 9) {
        g.beginPath(); g.moveTo(x, y0 + 2); g.lineTo(x, y0 + BRIDGE_HALF * 2 - 2); g.stroke();
      }
      g.fillStyle = '#6b3f1d';
      g.fillRect(x0, y0 - 3, w, 5);
      g.fillRect(x0, y0 + BRIDGE_HALF * 2 - 2, w, 5);
    }

    // Portrait : on fait pivoter le terrain, les accessoires restent debout.
    let c = land;
    let out = g;
    if (portrait) {
      c = document.createElement('canvas');
      c.width = Math.round(H * dpr);
      c.height = Math.round(W * dpr);
      out = c.getContext('2d');
      out.setTransform(0, -1, 1, 0, 0, c.height);
      out.drawImage(land, 0, 0);
      out.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Accessoires (ombres puis sprites), symetriques
    for (const [emoji, x, y, size] of PROPS) {
      for (const lx of [x, W - x]) {
        const at = L(lx, y);
        out.fillStyle = 'rgba(0,0,0,0.18)';
        out.beginPath();
        out.ellipse(at.x, at.y + size * 0.38, size * 0.42, size * 0.16, 0, 0, Math.PI * 2);
        out.fill();
        const sp = emojiSprite(emoji, size);
        const w = sp.width / dpr;
        out.drawImage(sp, at.x - w / 2, at.y - w / 2, w, w);
      }
    }

    // Cadre
    out.strokeStyle = 'rgba(0,0,0,0.35)';
    out.lineWidth = 6;
    out.strokeRect(0, 0, CW, CH);
    return c;
  }

  function resize() {
    const next = Math.min(window.devicePixelRatio || 1, 2);
    const tall = window.innerHeight > window.innerWidth * 1.05;
    if (next === dpr && tall === portrait && bg) return;
    dpr = next;
    portrait = tall;
    CW = portrait ? H : W;
    CH = portrait ? W : H;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    canvas.parentElement?.classList.toggle('is-portrait', portrait);
    sprites.clear();
    bg = buildBackground();
  }

  /* ------------------------------------------------------------------------
     Etat reseau
     ---------------------------------------------------------------------- */

  function spawn(list) {
    const now = performance.now();
    for (const raw of list) {
      const e = ents.get(raw.id);
      if (e) { Object.assign(e, raw); continue; }
      ents.set(raw.id, { ...raw, px: raw.x, py: raw.y, php: raw.hp, t0: now, t1: now, removedAt: 0, bornAt: now });
    }
  }

  function move(deltas) {
    const now = performance.now();
    for (const d of deltas) {
      const e = ents.get(d[0]);
      if (!e) continue;
      e.px = e.x; e.py = e.y; e.php = e.hp;
      e.x = d[1]; e.y = d[2]; e.hp = d[3]; e.st = d[4];
      e.t0 = e.t1;
      e.t1 = now;
      if (e.t1 - e.t0 > 1000) e.t0 = now;
    }
  }

  function remove(ids) {
    const now = performance.now();
    for (const id of ids) {
      const e = ents.get(id);
      if (e && !e.removedAt) e.removedAt = now;
    }
  }

  function reset() {
    ents.clear();
    fxList.length = 0;
  }

  function lerp(e, t) {
    const span = e.t1 - e.t0;
    if (span <= 0) return { x: e.x, y: e.y, hp: e.hp };
    let k = (t - e.t0) / span;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    return { x: e.px + (e.x - e.px) * k, y: e.py + (e.y - e.py) * k, hp: e.php + (e.hp - e.php) * k };
  }

  /* ------------------------------------------------------------------------
     Effets visuels
     ---------------------------------------------------------------------- */

  const BOOM_COLORS = { bomb: '255,150,40', molotov: '255,90,30', freeze: '120,220,255', banana: '250,220,60' };

  function fx(list) {
    // Les entites sont dessinees avec INTERP_MS de retard : les effets aussi.
    const start = performance.now() + INTERP_MS;
    for (const f of list) {
      if (f.k === 'tower') {
        const e = ents.get(f.id);
        fxList.push({ k: 'boom', x: e ? e.x : W / 2, y: e ? e.y : H / 2, r: 70, s: 'bomb', start, d: 700 });
        const mine = f.owner === myId;
        fxList.push({ k: 'banner', text: mine ? (f.kind === 'king' ? '💥 Ta tour du roi est tombée !' : '💥 Tour perdue !') : (f.kind === 'king' ? '👑👑👑 Tour du roi détruite !' : '👑 Couronne !'), mine, start, d: 1600 });
        shakeScreen(f.kind === 'king' ? 14 : 8, 500);
        continue;
      }
      if (f.k === 'boom') {
        fxList.push({ ...f, start, d: f.s === 'molotov' ? 500 : 650 });
        if (f.s === 'bomb') shakeScreen(5, 250);
        continue;
      }
      fxList.push({ ...f, start });
    }
    if (fxList.length > 160) fxList.splice(0, fxList.length - 160);
  }

  function shakeScreen(mag, ms) {
    shake = { mag: Math.max(mag, shake.mag), until: performance.now() + ms };
  }

  function drawFx(now) {
    for (let i = fxList.length - 1; i >= 0; i--) {
      const f = fxList[i];
      const t = (now - f.start) / f.d;
      if (t < 0) continue;
      if (t >= 1) { fxList.splice(i, 1); continue; }
      if (f.k === 'shot') {
        const at = (k) => P(f.f[0] + (f.t[0] - f.f[0]) * k, f.f[1] + (f.t[1] - f.f[1]) * k);
        const head = at(t);
        const arc = f.s === 'tower' || f.s === 'king' ? Math.sin(Math.PI * t) * 14 : 0;
        if (f.s === 'arrow') {
          const tail = at(Math.max(0, t - 0.12));
          ctx.strokeStyle = '#fef3c7';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y); ctx.stroke();
        } else {
          ctx.fillStyle = f.s === 'orb' ? '#c084fc' : f.s === 'king' ? '#fbbf24' : '#374151';
          ctx.beginPath(); ctx.arc(head.x, head.y - arc, f.s === 'king' ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.k === 'throw') {
        const pos = P(f.f[0] + (f.t[0] - f.f[0]) * t, f.f[1] + (f.t[1] - f.f[1]) * t);
        const land = P(f.t[0], f.t[1]);
        const height = (60 + Math.abs(f.t[0] - f.f[0]) * 0.12) * Math.sin(Math.PI * t);
        // Ombre au sol qui grossit a l'approche
        ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.18 * t})`;
        ctx.beginPath(); ctx.ellipse(land.x, land.y, 8 + 14 * t, 4 + 7 * t, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(pos.x, pos.y - height);
        ctx.rotate(t * Math.PI * 3 * (mirror ? -1 : 1));
        drawEmoji(f.e, 0, 0, 26);
        ctx.restore();
      } else if (f.k === 'boom') {
        const color = BOOM_COLORS[f.s] || BOOM_COLORS.bomb;
        const c = P(f.x, f.y);
        const r = f.r * (0.4 + 0.8 * t);
        ctx.fillStyle = `rgba(${color},${0.45 * (1 - t)})`;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - t)})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
        const icon = f.s === 'freeze' ? '❄️' : f.s === 'banana' ? '🍌' : f.s === 'molotov' ? '🔥' : '💥';
        drawEmoji(icon, c.x, c.y - 10 * t, 30 + 16 * t, 1 - t);
      } else if (f.k === 'banner') {
        // Dessinee en dernier, par-dessus tout (voir render).
      }
    }
  }

  function drawBanners(now) {
    for (const f of fxList) {
      if (f.k !== 'banner') continue;
      const t = (now - f.start) / f.d;
      if (t < 0 || t >= 1) continue;
      const a = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
      const y = 70 - 10 * (1 - Math.min(1, t * 5));
      ctx.globalAlpha = a;
      ctx.font = `900 ${portrait ? 18 : 24}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.text, CW / 2, y);
      ctx.fillStyle = f.mine ? '#fecaca' : '#fde68a';
      ctx.fillText(f.text, CW / 2, y);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------------------
     Entites
     ---------------------------------------------------------------------- */

  function hpBar(x, y, w, ratio, team) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = team.main;
    ctx.fillRect(x - w / 2, y, Math.max(0, w * ratio), 4);
  }

  function drawTower(e, t, now) {
    const team = teamOf(e.ownerId);
    const { x, y } = P(e.x, e.y);
    const r = e.radius || 22;
    const king = e.kind === 'king';
    const st = e.st || 0;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + r * 0.85, r * 1.1, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();

    if (st & 16) {
      // Ruines
      ctx.fillStyle = '#6b7280';
      for (let k = 0; k < 6; k++) {
        const a = k * 1.9;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.35 + 4, r * 0.32, r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawEmoji('💨', x, y - 6 + Math.sin(now / 400) * 2, 16, 0.6);
      return;
    }

    // Base en pierre
    const bw = r * 1.9;
    const bh = r * 1.55;
    const top = y - bh * 0.62;
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(x - bw / 2, top, bw, bh);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(x - bw / 2, top + bh * 0.72, bw, bh * 0.28);
    // Creneaux
    ctx.fillStyle = '#d1d5db';
    const n = king ? 5 : 4;
    const cw = bw / (n * 2 - 1);
    for (let k = 0; k < n; k++) ctx.fillRect(x - bw / 2 + k * cw * 2, top - cw * 0.9, cw, cw * 0.9);
    // Toit / banniere aux couleurs de l'equipe
    ctx.fillStyle = team.main;
    ctx.fillRect(x - bw / 2 + 3, top + 3, bw - 6, bh * 0.26);
    ctx.strokeStyle = team.dark;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - bw / 2, top, bw, bh);

    const icon = king ? '👑' : '🏹';
    const bob = st & 1 ? Math.sin(now / 50) * 1.5 : 0;
    drawEmoji(icon, x, top - (king ? 12 : 8) + bob, king ? 24 : 16);
    if (king && !(st & 8)) drawEmoji('💤', x + r, top - 16 + Math.sin(now / 500) * 2, 14, 0.85);
    if (st & 4) {
      ctx.fillStyle = 'rgba(147,197,253,0.45)';
      ctx.fillRect(x - bw / 2, top, bw, bh);
    }

    const p = lerp(e, t);
    const ratio = Math.max(0, p.hp) / (e.maxHp || 1);
    const barW = king ? 64 : 50;
    hpBar(x, top - (king ? 30 : 24), barW, ratio, team);
    ctx.font = '800 9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(Math.max(0, Math.round(p.hp))), x, top - (king ? 38 : 32));
  }

  function drawUnit(e, t, now) {
    const p = lerp(e, t);
    const team = teamOf(e.ownerId);
    const ground = P(p.x, p.y);
    const x = ground.x;
    const lift = e.flying ? 16 : 0;
    const y = ground.y - lift;
    const size = Math.max(22, (e.radius || 11) * 2.7);
    const st = e.st || 0;
    let alpha = e.removedAt ? Math.max(0, 1 - (now - e.removedAt) / FADE_MS) : 1;
    if (st & 2) alpha *= 0.55;
    ctx.globalAlpha = alpha;

    // Ombre et anneau d'equipe au sol
    ctx.fillStyle = e.flying ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, ground.y + size * 0.36, size * 0.42, size * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = team.ring;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, ground.y + size * 0.34, size * 0.4, size * 0.16, 0, 0, Math.PI * 2); ctx.stroke();

    const pulse = st & 1 ? 1 + 0.1 * Math.abs(Math.sin(now / 90)) : 1;
    drawPortrait(e, x, y, size * pulse);

    if (st & 2) {
      // Pose en cours : cercle qui se referme
      const k = Math.min(1, (now - e.bornAt) / 1000);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, size * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
    }
    if (st & 4) {
      ctx.fillStyle = 'rgba(147,197,253,0.5)';
      ctx.beginPath(); ctx.arc(x, y, size * 0.5, 0, Math.PI * 2); ctx.fill();
      drawEmoji('❄️', x + size * 0.35, y - size * 0.4, 12);
    }
    ctx.globalAlpha = 1;
    if (p.hp < e.maxHp && !e.removedAt) hpBar(x, y - size * 0.62, Math.max(22, size * 0.9), Math.max(0, p.hp) / e.maxHp, team);
  }

  function drawZone(e, now) {
    const { x, y: zy } = P(e.x, zy);
    const r = e.radius || 50;
    const fade = e.removedAt ? Math.max(0, 1 - (now - e.removedAt) / FADE_MS) : 1;
    if (e.subtype === 'fire') {
      const g = ctx.createRadialGradient(x, zy, 4, x, zy, r);
      g.addColorStop(0, `rgba(255,170,40,${0.55 * fade})`);
      g.addColorStop(1, 'rgba(220,38,38,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, zy, r, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 4; k++) {
        const a = k * 1.57 + now / 900;
        drawEmoji('🔥', x + Math.cos(a) * r * 0.45, zy + Math.sin(a) * r * 0.3, 16 + 4 * Math.sin(now / 120 + k), fade);
      }
    } else if (e.subtype === 'frost') {
      ctx.fillStyle = `rgba(165,215,255,${0.28 * fade})`;
      ctx.beginPath(); ctx.arc(x, zy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * fade})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------------
     Zone de pose
     ---------------------------------------------------------------------- */

  function enemyPrincessDown(lane) {
    for (const e of ents.values()) {
      if (e.type === 'tower' && e.kind === 'princess' && e.ownerId !== myId && e.lane === lane && (e.st & 16)) return true;
    }
    return false;
  }

  /** Meme regle que le serveur, vue du joueur local (toujours a gauche). */
  function canPlace(card, pos) {
    if (!card || !pos) return false;
    if (pos.x < 0 || pos.x > W || pos.y < 0 || pos.y > H) return false;
    if (card.type === 'spell') return true;
    if (pos.y < 8 || pos.y > H - 8) return false;
    const lx = vx(pos.x);
    if (lx >= 8 && lx <= RIVER_L - 6) return true;
    if (lx < RIVER_R + 6 || lx > RIVER_R + POCKET) return false;
    return enemyPrincessDown(pos.y < LANE_SPLIT ? 0 : 1);
  }

  function drawPlacement() {
    if (!placement) return;
    const fill = (r) => ctx.fillRect(r.x, r.y, r.w, r.h);
    if (placement.type !== 'spell') {
      // Vue locale : sa moitie. On assombrit tout ce qui est interdit.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      const pockets = [enemyPrincessDown(0), enemyPrincessDown(1)];
      fill(R(RIVER_L - 6, 0, W - RIVER_L + 6, H));
      ctx.fillStyle = 'rgba(59,130,246,0.14)';
      const mine = R(8, 8, RIVER_L - 14, H - 16);
      fill(mine);
      for (let lane = 0; lane < 2; lane++) {
        if (!pockets[lane]) continue;
        const pk = R(RIVER_R + 6, lane === 0 ? 0 : LANE_SPLIT, POCKET - 6, LANE_SPLIT);
        ctx.clearRect(pk.x, pk.y, pk.w, pk.h);
        ctx.drawImage(bg, pk.x * dpr, pk.y * dpr, pk.w * dpr, pk.h * dpr, pk.x, pk.y, pk.w, pk.h);
        ctx.fillStyle = 'rgba(59,130,246,0.2)';
        fill(pk);
      }
      ctx.strokeStyle = 'rgba(191,219,254,0.8)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(mine.x, mine.y, mine.w, mine.h);
      ctx.setLineDash([]);
    }
    if (hover) {
      const ok = canPlace(placement, toWorldPoint(hover.x, hover.y));
      const r = placement.type === 'spell' ? (placement.radius || 55) : 16;
      ctx.fillStyle = ok ? 'rgba(255,255,255,0.22)' : 'rgba(239,68,68,0.3)';
      ctx.strokeStyle = ok ? '#fff' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drawEmoji(placement.emoji || '❓', hover.x, hover.y - (placement.type === 'spell' ? 0 : 6), 28, 0.9);
    }
  }

  /* ------------------------------------------------------------------------
     Boucle de rendu
     ---------------------------------------------------------------------- */

  let lastFrame = 0;
  let running = false;

  function frame(ts) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden || ts - lastFrame < FRAME_MS - 2) return;
    lastFrame = ts;

    const now = performance.now();
    const t = now - INTERP_MS;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake.until > now) {
      const k = (shake.until - now) / 500;
      ctx.translate((Math.random() * 2 - 1) * shake.mag * k, (Math.random() * 2 - 1) * shake.mag * k);
    } else {
      shake.mag = 0;
    }
    if (bg) ctx.drawImage(bg, 0, 0, CW, CH);

    // Reflets de la riviere
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const seg = (x0, y0, x1, y1) => {
      const a = L(x0, y0);
      const b = L(x1, y1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    };
    for (let k = 0; k < 6; k++) {
      const y = ((now / 40 + k * 70) % (H + 40)) - 20;
      if (BRIDGES.some((b) => Math.abs(y - b) < BRIDGE_HALF + 8)) continue;
      seg(RIVER_L + 8, y, RIVER_L + 18, y + 6);
      seg(RIVER_R - 20, y + 30, RIVER_R - 10, y + 36);
    }
    ctx.stroke();

    drawPlacement();

    // Tri par profondeur (y) : zones au sol, puis tours et unites au sol, puis volants.
    const ground = [];
    const air = [];
    for (const e of ents.values()) {
      if (e.removedAt && now - e.removedAt > FADE_MS) { ents.delete(e.id); continue; }
      if (e.type === 'aoe') drawZone(e, now);
      else if (e.type === 'unit' && e.flying) air.push(e);
      else ground.push(e);
    }
    ground.sort((a, b) => a.y - b.y);
    air.sort((a, b) => a.y - b.y);
    for (const e of ground) (e.type === 'tower' ? drawTower : drawUnit)(e, t, now);
    for (const e of air) drawUnit(e, t, now);
    drawFx(now);
    drawBanners(now);
  }

  function start() {
    resize();
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
     Saisie
     ---------------------------------------------------------------------- */

  /** Point de l'ecran -> coordonnees de VUE (x deja en vue locale). */
  function toView(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return { x: ((clientX - rect.left) / rect.width) * CW, y: ((clientY - rect.top) / rect.height) * CH };
  }

  /** Point de l'ecran -> coordonnees SERVEUR (miroir retire). */
  function toWorld(clientX, clientY) {
    const v = toView(clientX, clientY);
    if (!v) return null;
    const w = toWorldPoint(v.x, v.y);
    return { x: Math.round(w.x), y: Math.round(w.y) };
  }

  function setPerspective(localId, players) {
    myId = localId;
    mirror = Array.isArray(players) && players.findIndex((p) => p.id === localId) === 1;
  }

  /* ------------------------------------------------------------------------
     Role d'une carte (meme regle que le serveur, pour l'affichage)
     ---------------------------------------------------------------------- */

  const FLY_NAME = /(bombardiro|avion|aereo|dragon|drago|flaming|volant|ptero|bat\b|pipistrell|uccell|bird|eagle|aquila|angel|ange|mosquit|mosqueira|ape\b|abeille|bee\b|papill|farfall|jet\b|rocket|astro|nuvol|cloud|ventoso)/i;
  const FLY_EMOJI = new Set(['🦅', '🐉', '🐲', '🦇', '🐦', '🕊️', '🦋', '🐝', '✈️', '🛩️', '🚀', '🦜', '🦩', '🪽', '👼', '🛸', '🦟', '☁️']);
  function nameHash(name) {
    let h = 7;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
    return h;
  }

  function roleOf(card) {
    if (!card || card.type === 'spell') return { key: 'spell', label: '🧨 Objet à lancer' };
    const atk = Math.max(0, Number(card.attack) || 0);
    const def = Math.max(0, Number(card.defense) || 0);
    const ratio = atk + def > 0 ? def / (atk + def) : 0.5;
    const role = ratio >= 0.7 ? 'tank' : ratio <= 0.42 ? 'ranged' : 'melee';
    const name = card.name || '';
    const flying = role !== 'tank' && (FLY_NAME.test(name) || FLY_EMOJI.has(card.emoji) || nameHash(name) % 5 === 0);
    const label = role === 'tank' ? '🛡️ Tank · vise les tours' : role === 'ranged' ? '🏹 Tireur' : '⚔️ Mêlée';
    return { key: role, flying, label: flying ? label + ' · 🪽 Volant' : label };
  }

  window.addEventListener('resize', resize, { passive: true });

  window.Arena = { start, reset, spawn, move, remove, fx, setPerspective, canPlace, toWorld, toView, roleOf,
    setPlacement(card) { placement = card || null; if (!card) hover = null; },
    setHover(pos) { hover = pos; },
    shake: shakeScreen };
})();
