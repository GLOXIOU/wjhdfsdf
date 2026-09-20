const lobbyEl = document.getElementById('lobby');
const deckSelectorEl = document.getElementById('deck-selector');
const gameEl = document.getElementById('game');
const invitationModal = document.getElementById('invitation-modal');
const joinBtn = document.getElementById('join');
const roomInput = document.getElementById('room');
let playerPseudo = 'Player';
const handEl = document.getElementById('hand');
const infoEl = document.getElementById('info');
const opponentEl = document.getElementById('opponent');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let localPlayerId = localStorage.getItem('playerId') || null;
let currentRoom = null;
let draggingCardId = null;
let draggingEmoji = null;
let dragPos = null;
let justDragged = false;
let selectedDeck = [];
let currentRoomId = null;
let isInvitationAccepted = false;
let isInvitationWaiting = false;
let isTouchControlMode = true;
let selectedCardForPlacement = null;




/* --------------------------------------------------------------------------
   Effets visuels et sonores de selection de carte.
   Safari iOS limite severement le nombre d'AudioContext : en creer un neuf a
   chaque clic finissait par rendre le son muet, puis par faire ramer l'onglet.
   On en partage donc un seul, cree au premier geste utilisateur et reveille
   si le systeme l'a suspendu.
   -------------------------------------------------------------------------- */

let sharedAudioContext = null;
function getAudioContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!sharedAudioContext) sharedAudioContext = new Ctor();
    if (sharedAudioContext.state === 'suspended') sharedAudioContext.resume();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

function playBeep(fromHz, toHz, gainValue, duration) {
  const audioContext = getAudioContext();
  if (!audioContext) return;
  try {
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(toHz, now + 0.1);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc.start(now);
    osc.stop(now + duration);
    // Sans cette liberation, les noeuds s'accumulaient dans le graphe audio.
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch {} };
  } catch {}
}

// L'element est desormais passe explicitement : l'ancien code lisait la
// variable globale `event`, supprimee des navigateurs modernes.
function playCardSelectEffect(element) {
  createCardParticles(element, 'select');
  playBeep(800, 1200, 0.3, 0.15);
}

function playCardDeselectEffect(element) {
  createCardParticles(element, 'deselect');
  playBeep(600, 400, 0.2, 0.12);
}

function createCardParticles(element, type) {
  if (!element) return;
  
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Create 6-8 particles
  const particleCount = type === 'select' ? 8 : 5;
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.style.cssText = `
      position: fixed;
      left: ${centerX}px;
      top: ${centerY}px;
      pointer-events: none;
      z-index: 1000;
      font-size: 1.2rem;
      font-weight: bold;
    `;
    
    if (type === 'select') {
      particle.textContent = '✨';
      particle.style.animation = `particleFloat${Math.random() > 0.5 ? '1' : '2'} 0.8s ease-out forwards`;
    } else {
      particle.textContent = '💨';
      particle.style.animation = `particleFloat${Math.random() > 0.5 ? '3' : '4'} 0.6s ease-out forwards`;
    }
    
    document.body.appendChild(particle);
    
    // Remove particle after animation
    setTimeout(() => particle.remove(), 800);
  }
}

// Add particle animations to CSS dynamically
function initParticleAnimations() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes particleFloat1 {
      0% {
        transform: translate(0, 0) scale(1) rotate(0deg);
        opacity: 1;
      }
      100% {
        transform: translate(30px, -50px) scale(0.5) rotate(360deg);
        opacity: 0;
      }
    }
    
    @keyframes particleFloat2 {
      0% {
        transform: translate(0, 0) scale(1) rotate(0deg);
        opacity: 1;
      }
      100% {
        transform: translate(-30px, -50px) scale(0.5) rotate(-360deg);
        opacity: 0;
      }
    }
    
    @keyframes particleFloat3 {
      0% {
        transform: translate(0, 0) scale(1);
        opacity: 1;
      }
      100% {
        transform: translate(20px, -40px) scale(0.3);
        opacity: 0;
      }
    }
    
    @keyframes particleFloat4 {
      0% {
        transform: translate(0, 0) scale(1);
        opacity: 1;
      }
      100% {
        transform: translate(-20px, -40px) scale(0.3);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

// Initialize animations on load
initParticleAnimations();

function showGameEndedOverlay(winnerId, winnerName, rewards = null){
  const isWinner = winnerId === localPlayerId;
  const overlay = document.createElement('div');
  overlay.className = 'game-end-overlay';

  const content = document.createElement('div');
  content.className = 'game-end-card ' + (isWinner ? 'game-end-win' : 'game-end-loss');

  let rewardsHTML = '';
  if (isWinner && rewards) {
    rewardsHTML = `
      <div class="game-end-rewards">
        <div class="rewards-title">🎁 Récompenses</div>
        <div class="rewards-grid">
    `;
    
    if (rewards.gold) {
      rewardsHTML += `
        <div class="reward-item gold-reward">
          <div class="reward-icon">💰</div>
          <div class="reward-amount">${rewards.gold}</div>
          <div class="reward-label">Or</div>
        </div>
      `;
    }
    
    if (rewards.chest) {
      rewardsHTML += `
        <div class="reward-item chest-reward">
          <div class="reward-icon">📦</div>
          <div class="reward-amount">1</div>
          <div class="reward-label">Coffre</div>
        </div>
      `;
    }
    
    if (rewards.exp) {
      rewardsHTML += `
        <div class="reward-item exp-reward">
          <div class="reward-icon">⭐</div>
          <div class="reward-amount">+${rewards.exp}</div>
          <div class="reward-label">Exp</div>
        </div>
      `;
    }
    
    rewardsHTML += `
        </div>
      </div>
    `;
  }

  if (isWinner) {
    content.innerHTML = `
      <div class="game-end-emoji">🎉</div>
      <div class="game-end-title emerald">VICTOIRE!</div>
      <div class="game-end-sub">Tu as vaincu <strong>${winnerName}</strong></div>
      ${rewardsHTML}
    `;
  } else {
    content.innerHTML = `<div class="game-end-emoji">😢</div><div class="game-end-title" style="color:#ef4444">DÉFAITE</div><div class="game-end-sub"><strong>${winnerName}</strong> a gagné</div>`;
  }

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  setTimeout(() => {
    window.location.href = `../index/index.html`;
  }, 3000);
}

/* ==========================================================================
   ETAT RESEAU CLIENT
   --------------------------------------------------------------------------
   Le serveur n'envoie plus un snapshot complet 10 fois par seconde : il envoie
   des deltas (spawn / mv / rm). On maintient donc ici une Map d'entites, et
   chaque entite porte sa propre paire (position precedente -> position cible)
   pour l'interpolation. Plus aucun JSON.parse(JSON.stringify(...)) par tick,
   plus aucun filter()/find() dans la boucle de rendu.
   ========================================================================== */

const NET_INTERP_MS = 110;   // un tick serveur de retard : rendu toujours lisse
const FADE_OUT_MS = 220;

/** id -> entite interpolable */
const netEntities = new Map();

function netApplySpawn(list) {
  const now = performance.now();
  for (const raw of list) {
    const existing = netEntities.get(raw.id);
    if (existing) {
      Object.assign(existing, raw);
      continue;
    }
    netEntities.set(raw.id, {
      ...raw,
      px: raw.x, py: raw.y, php: raw.hp,
      t0: now, t1: now,
      anim: 0,
      removedAt: 0
    });
  }
}

function netApplyMove(deltas) {
  const now = performance.now();
  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    const e = netEntities.get(d[0]);
    if (!e) continue;
    e.px = e.x; e.py = e.y; e.php = e.hp;
    e.x = d[1]; e.y = d[2]; e.hp = d[3]; e.anim = d[4];
    e.t0 = e.t1;
    e.t1 = now;
    if (e.t1 - e.t0 > 1000) e.t0 = now; // reprise apres un onglet en veille
  }
}

function netApplyRemove(ids) {
  const now = performance.now();
  for (const id of ids) {
    const e = netEntities.get(id);
    if (e && !e.removedAt) e.removedAt = now; // petit fondu avant disparition
  }
}

function netReset() {
  netEntities.clear();
}

/* ==========================================================================
   ENTREES POINTEUR
   ========================================================================== */

document.addEventListener('pointermove', (ev) => {
  if (!draggingCardId || isTouchControlMode) return;
  dragPos = { x: ev.clientX, y: ev.clientY };
}, { passive: true });

document.addEventListener('pointerup', (ev) => {
  document.body.classList.remove('is-dragging');

  if (!isTouchControlMode && draggingCardId) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_LOGICAL_W / rect.width;
    const scaleY = CANVAS_LOGICAL_H / rect.height;
    const x = (ev.clientX - rect.left) * scaleX;
    const y = (ev.clientY - rect.top) * scaleY;
    const overCanvas =
      ev.clientX >= rect.left && ev.clientX <= rect.right &&
      ev.clientY >= rect.top && ev.clientY <= rect.bottom;
    if (overCanvas) playCard(draggingCardId, { x: Math.round(x), y: Math.round(y) });
    else playCard(draggingCardId);
    draggingCardId = null; draggingEmoji = null; dragPos = null;
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 60);
  }
});

let shake = { intensity: 0, duration: 0, start: 0 };
function triggerScreenShake(intensity = 6, duration = 350) {
  shake.intensity = intensity; shake.duration = duration; shake.start = Date.now();
}

/* ==========================================================================
   CANVAS : resolution adaptee a l'ecran
   --------------------------------------------------------------------------
   Le canvas gardait une taille fixe de 900x400 pixels quelle que soit la
   densite d'ecran : flou sur l'ecran Retina de l'iPad. On dessine desormais
   dans un repere logique 900x400 et on met a l'echelle via le contexte, en
   plafonnant le devicePixelRatio a 2 pour ne pas exploser le nombre de pixels
   a remplir (le vrai cout du rendu canvas sur mobile).
   ========================================================================== */

const CANVAS_LOGICAL_W = 900;
const CANVAS_LOGICAL_H = 400;
let canvasScale = 1;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvasScale === dpr && canvas.width === CANVAS_LOGICAL_W * dpr) return;
  canvasScale = dpr;
  canvas.width = Math.round(CANVAS_LOGICAL_W * dpr);
  canvas.height = Math.round(CANVAS_LOGICAL_H * dpr);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas, { passive: true });

/* ==========================================================================
   IMAGES
   ========================================================================== */

const imageCache = new Map();
function loadImage(url) {
  if (!url) return null;
  const cached = imageCache.get(url);
  if (cached) return cached;

  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.addEventListener('error', () => { img.failed = true; }, { once: true });
  imageCache.set(url, img);
  return img;
}

function drawEmoji(ctx, x, y, size, emoji) {
  ctx.font = (size + 6) + 'px serif';
  ctx.textAlign = 'center';
  ctx.fillText(emoji || '❓', x, y + size / 3);
}

function drawImage(ctx, x, y, size, imageUrl, fallbackEmoji) {
  if (!imageUrl) { drawEmoji(ctx, x, y, size, fallbackEmoji); return; }

  const img = loadImage(imageUrl);
  if (img && !img.failed && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  } else {
    drawEmoji(ctx, x, y, size, fallbackEmoji);
  }
}

/* ==========================================================================
   BOUCLE DE RENDU
   ========================================================================== */

let renderPaused = false;
document.addEventListener('visibilitychange', () => { renderPaused = document.hidden; });

function drawHpBar(ctx, x, y, hp, maxHp) {
  const hpRatio = Math.max(0, Math.min(1, (hp || 0) / (maxHp || 10)));
  const bx = x, by = y, bw = 40, bh = 6, br = 3;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(bx - 1, by - 1, bw + 2, bh + 2, br + 1); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.fill();

  if (hpRatio > 0) {
    const hpColor = hpRatio > 0.55
      ? ['#22c55e', '#16a34a', 'rgba(74,222,128,0.7)']
      : hpRatio > 0.28
        ? ['#facc15', '#ca8a04', 'rgba(250,204,21,0.7)']
        : ['#ef4444', '#b91c1c', 'rgba(239,68,68,0.7)'];
    const gHp = ctx.createLinearGradient(bx, by, bx, by + bh);
    gHp.addColorStop(0, hpColor[0]);
    gHp.addColorStop(1, hpColor[1]);
    ctx.fillStyle = gHp;
    ctx.beginPath(); ctx.roundRect(bx, by, bw * hpRatio, bh, br); ctx.fill();
    ctx.shadowColor = hpColor[2]; ctx.shadowBlur = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.roundRect(bx, by, bw * hpRatio, bh, br); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.roundRect(bx + 1, by + 1, (bw * hpRatio - 2) * 0.7, 2, 1); ctx.fill();
  }

  ctx.font = 'bold 7px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
  ctx.fillText(`${Math.ceil(hp || 0)}/${maxHp || 10}`, bx + bw / 2, by + bh - 0.5);
  ctx.restore();
}

function drawAttackFlash(ctx, cx, cy, p, dmg) {
  const r1 = 20 + p * 14, r2 = r1 + 5;
  ctx.save();
  const gAtk = ctx.createRadialGradient(cx, cy, r1 * 0.4, cx, cy, r2);
  gAtk.addColorStop(0, `rgba(255,220,0,${0.7 * p})`);
  gAtk.addColorStop(0.5, `rgba(255,140,0,${0.4 * p})`);
  gAtk.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = gAtk;
  ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(255,220,50,${0.85 * p})`;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(255,200,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI * 2); ctx.stroke();
  ctx.font = `bold ${10 + p * 4}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.shadowBlur = 6;
  ctx.shadowColor = 'rgba(255,100,0,0.9)';
  ctx.fillStyle = `rgba(255,255,80,${p})`;
  ctx.fillText(dmg ? `-${dmg}` : '!', cx, cy - r1 - 4 - p * 6);
  ctx.restore();
}

function renderTick() {
  requestAnimationFrame(renderTick);
  // Onglet en arriere-plan : on ne peint rien. Sur iPad cela evite de vider
  // la batterie et de garder le GPU occupe pendant que le jeu n'est pas vu.
  if (renderPaused) return;

  const now = Date.now();
  const nowPerf = performance.now();
  const renderTime = nowPerf - NET_INTERP_MS;

  let sx = 0, sy = 0;
  if (shake.duration > 0) {
    const elapsed = now - shake.start;
    if (elapsed < shake.duration) {
      const p = 1 - (elapsed / shake.duration);
      const mag = shake.intensity * p;
      sx = (Math.random() * 2 - 1) * mag;
      sy = (Math.random() * 2 - 1) * mag;
    } else {
      shake.duration = 0;
    }
  }

  ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  ctx.clearRect(0, 0, CANVAS_LOGICAL_W, CANVAS_LOGICAL_H);
  ctx.translate(sx, sy);

  // Zone de pose du joueur local.
  if (currentRoom && currentRoom.players.length > 0) {
    const me = currentRoom.players.find(p => p.id === localPlayerId);
    if (me) {
      const zone = getPlacementZone(me);
      ctx.save();
      ctx.fillStyle = '#22c55e';
      ctx.globalAlpha = 0.15;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
      ctx.restore();
    }
  }

  // Carte en cours de glisser-deposer (mode souris).
  if (draggingCardId && dragPos) {
    const rect = canvas.getBoundingClientRect();
    const gx = (dragPos.x - rect.left) * (CANVAS_LOGICAL_W / rect.width);
    const gy = (dragPos.y - rect.top) * (CANVAS_LOGICAL_H / rect.height);
    if (gx >= 0 && gx <= CANVAS_LOGICAL_W && gy >= 0 && gy <= CANVAS_LOGICAL_H) {
      let cardLink = '';
      if (currentRoom) {
        const me = currentRoom.players.find(p => p.id === localPlayerId);
        const card = me && me.hand ? me.hand.find(c => c && c.id === draggingCardId) : null;
        if (card) { cardLink = card.link || ''; draggingEmoji = card.emoji || '❓'; }
      }
      ctx.save();
      ctx.globalAlpha = 0.85;
      drawImage(ctx, gx, gy, 40, cardLink, draggingEmoji || '❓');
      ctx.restore();
    }
  }

  // Tours.
  ctx.font = '28px serif';
  ctx.textAlign = 'left';
  ctx.fillText('🏰', 8, CANVAS_LOGICAL_H / 2);
  ctx.textAlign = 'right';
  ctx.fillText('🏰', CANVAS_LOGICAL_W - 8, CANVAS_LOGICAL_H / 2);

  // --- Entites : un seul parcours de la Map, dans l'ordre aoe > projectile > unit.
  // L'ancienne version faisait trois filter() plus un find() par entite a
  // chaque frame, soit un cout quadratique a 60 fps.
  for (const e of netEntities.values()) {
    if (e.removedAt) {
      const age = nowPerf - e.removedAt;
      if (age > FADE_OUT_MS) { netEntities.delete(e.id); continue; }
    }
    if (e.type === 'aoe') drawAoe(ctx, e, nowPerf);
  }
  for (const e of netEntities.values()) {
    if (e.type === 'projectile') drawProjectile(ctx, e, renderTime);
  }
  for (const e of netEntities.values()) {
    if (e.type === 'unit') drawUnit(ctx, e, renderTime);
  }
}

/** Interpole la position d'une entite a l'instant de rendu voulu. */
function interpolate(e, renderTime) {
  const span = e.t1 - e.t0;
  if (span <= 0) return { x: e.x, y: e.y, hp: e.hp };
  let t = (renderTime - e.t0) / span;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    x: e.px + (e.x - e.px) * t,
    y: e.py + (e.y - e.py) * t,
    hp: e.php + (e.hp - e.php) * t
  };
}

function fadeAlpha(e, nowPerf) {
  if (!e.removedAt) return 1;
  return Math.max(0, 1 - (nowPerf - e.removedAt) / FADE_OUT_MS);
}

function drawAoe(ctx, e, nowPerf) {
  const alpha = fadeAlpha(e, nowPerf);
  if (alpha <= 0) return;
  const r = e.radius || 40;

  ctx.save();
  ctx.globalAlpha = (e.subtype === 'frost' ? 0.18 : e.subtype === 'heal' ? 0.12 : 0.45) * alpha;
  ctx.fillStyle = e.subtype === 'frost' ? '#59f' : e.subtype === 'heal' ? '#6f6' : 'orange';
  const radius = e.subtype === 'heal' ? r * (0.9 + 0.1 * Math.sin(nowPerf / 180)) : r;
  ctx.beginPath(); ctx.arc(e.x, e.y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  const icon = e.subtype === 'frost' ? '❄️' : e.subtype === 'heal' ? '✨' : (e.emoji || '💥');
  drawImage(ctx, e.x, e.y + 8, e.subtype === 'frost' ? 22 : 24, e.link, icon);
  ctx.restore();
}

function drawProjectile(ctx, e, renderTime) {
  const p = interpolate(e, renderTime);
  ctx.save();
  ctx.globalAlpha = 0.95;
  drawImage(ctx, p.x, p.y, 20, e.link, e.emoji || '➡️');
  ctx.restore();
}

function drawUnit(ctx, e, renderTime) {
  const p = interpolate(e, renderTime);
  const yOffset = e.isFlying ? -12 : 0;
  const cx = p.x + 20;
  const cy = p.y + 28 + yOffset;

  ctx.save();
  if (e.removedAt) ctx.globalAlpha = fadeAlpha(e, performance.now());
  drawImage(ctx, cx, cy, 34, e.link, e.emoji || '❓');
  if (e.anim) drawAttackFlash(ctx, cx, cy, 1, e.dmg);
  drawHpBar(ctx, p.x + 4, p.y + 2 + yOffset, p.hp, e.maxHp);
  ctx.restore();
}

/** Zone de pose autorisee pour un joueur, cote client (le serveur revalide). */
function getPlacementZone(player) {
  const index = currentRoom ? currentRoom.players.findIndex(p => p.id === player.id) : 0;
  if (player.view === 'vertical') {
    return index === 0
      ? { x: 0, y: 0, w: CANVAS_LOGICAL_W, h: CANVAS_LOGICAL_H / 2 }
      : { x: 0, y: CANVAS_LOGICAL_H / 2, w: CANVAS_LOGICAL_W, h: CANVAS_LOGICAL_H / 2 };
  }
  return index === 0
    ? { x: 0, y: 0, w: CANVAS_LOGICAL_W / 2, h: CANVAS_LOGICAL_H }
    : { x: CANVAS_LOGICAL_W / 2, y: 0, w: CANVAS_LOGICAL_W / 2, h: CANVAS_LOGICAL_H };
}

requestAnimationFrame(renderTick);

/* ==========================================================================
   TEMPS REEL : socket.io
   --------------------------------------------------------------------------
   Remplace l'ancien EventSource. Avantages concrets :
     - une seule connexion, reutilisee (l'ancien SSE se reconnectait en boucle
       des que le reseau mobile vacillait) ;
     - le serveur n'envoie que les deltas, pas la room entiere 10 fois/seconde ;
     - jouer une carte passe par la meme connexion : plus de requete HTTP
       (et donc plus de re-authentification) a chaque carte posee.
   ========================================================================== */

let gameSocket = null;
let joinedRoomId = null;

function connectGameSocket(roomId) {
  const token = window.BrainrotAuth?.getToken?.() || '';
  if (!token) { console.error('Pas de token, connexion temps reel impossible'); return; }
  if (typeof io === 'undefined') { console.error('socket.io client non charge'); return; }

  joinedRoomId = roomId;

  if (gameSocket && gameSocket.connected) {
    gameSocket.emit('join', { roomId }, onJoinAck);
    return;
  }

  if (gameSocket) gameSocket.disconnect();

  gameSocket = io(window.WS_URL, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10000
  });

  gameSocket.on('connect', () => {
    // A chaque (re)connexion on rejoint la room : le serveur renvoie alors
    // un etat complet, ce qui resynchronise la partie apres une coupure.
    netReset();
    gameSocket.emit('join', { roomId: joinedRoomId }, onJoinAck);
  });

  gameSocket.on('connect_error', (err) => {
    console.error('Connexion temps reel refusee :', err?.message || err);
  });

  gameSocket.on('init', (data) => {
    if (!data || !data.room) return;
    if (data.playerId) {
      localPlayerId = data.playerId;
      try { localStorage.setItem('playerId', localPlayerId); } catch {}
    }
    currentRoom = data.room;
    netReset();
    netApplySpawn(data.room.entities || []);
    applyRoomState(currentRoom);
  });

  gameSocket.on('players', (data) => {
    if (!data || !Array.isArray(data.players)) return;
    if (!currentRoom) currentRoom = { id: joinedRoomId, players: [], entities: [] };
    currentRoom.players = data.players;
    currentRoom.started = data.started;
    if (data.invitation) currentRoom.invitation = data.invitation;
    applyRoomState(currentRoom);
  });

  gameSocket.on('spawn', netApplySpawn);
  gameSocket.on('mv', netApplyMove);
  gameSocket.on('rm', netApplyRemove);

  gameSocket.on('ended', (payload) => {
    if (!payload) return;
    window.PlayWebAnalytics?.setStatus('online');
    window.PlayWebAnalytics?.track(
      payload.winnerId === localPlayerId ? 'match_won' : 'match_lost'
    );
    showGameEndedOverlay(payload.winnerId, payload.winnerName, payload.rewards);
    triggerScreenShake(15, 600);
  });

  gameSocket.on('effect', (payload) => {
    if (payload && payload.effect === 'screenShake') {
      triggerScreenShake(payload.intensity || 6, payload.duration || 300);
    }
  });
}

function onJoinAck(res) {
  if (!res || res.ok) return;
  console.error('Impossible de rejoindre la room :', res.error);
}

function disconnectGameSocket() {
  if (!gameSocket) return;
  gameSocket.emit('leave');
  gameSocket.disconnect();
  gameSocket = null;
  joinedRoomId = null;
  netReset();
}

window.addEventListener('pagehide', disconnectGameSocket);

/**
 * Applique l'etat de room recu : gere la phase d'invitation puis le jeu.
 * N'est appele que lorsque l'etat joueurs change reellement, plus a chaque
 * tick : c'est ce qui evitait le plus gros du lag sur iPad, ou la main etait
 * reconstruite en DOM 10 fois par seconde.
 */
function applyRoomState(room) {
  if (!room) return;

  const invModalVisible = invitationModal.style.display === 'flex';
  const gameVisible = gameEl.style.display === 'block';

  if (invModalVisible) {
    if (room.players.length !== 2) return;

    const opponent = room.players.find(p => p.id !== localPlayerId);
    const bothReady = room.players.every(p => p.deckReady === true);
    const title = document.getElementById('invitation-title');
    const message = document.getElementById('invitation-message');

    if (isInvitationWaiting && !isInvitationAccepted && opponent) {
      title.textContent = '🤝 ' + opponent.name + ' a rejoint !';
      message.textContent = opponent.deckReady
        ? '✅ ' + opponent.name + ' a accepté ! Démarrage du combat...'
        : 'En attente que ' + opponent.name + ' accepte son invitation...';
    } else if (isInvitationAccepted && opponent && opponent.deckReady) {
      title.textContent = '✅ Prêt !';
      message.textContent = 'L\'autre joueur est prêt ! Démarrage du combat...';
    }

    if (bothReady) {
      title.textContent = '🚀 Démarrage...';
      message.textContent = 'Tous les joueurs sont prêts !';
      if (room.started && !gameStartScheduled) {
        gameStartScheduled = true;
        // Le statut remonte au panel : "en ligne" et "en partie" sont deux
        // choses differentes.
        window.PlayWebAnalytics?.setStatus('in_game');
        window.PlayWebAnalytics?.track('match_started');
        setTimeout(() => {
          invitationModal.style.display = 'none';
          gameEl.style.display = 'block';
          document.body.classList.add('game-active');
          renderRoom(room);
        }, 600);
      }
    }
    return;
  }

  if (gameVisible) renderRoom(room);
}

let gameStartScheduled = false;

joinBtn.addEventListener('click', async ()=>{
  showDeckSelector();
});

let matchmakingPollInterval = null;
let matchmakingTimerInterval = null;
let matchmakingStartTime = null;
let matchmakingEventSource = null;

document.getElementById('matchmaking-btn')?.addEventListener('click', async () => {
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    if (!token) {
      console.error('❌ Pas de token disponible');
      alert('Erreur: Token non disponible');
      return;
    }
    
    console.log('🎯 Démarrage du matchmaking...');
    window.PlayWebAnalytics?.track('matchmaking_started');
    
    // Afficher l'écran d'attente
    showMatchmakingWaiting();
    matchmakingStartTime = Date.now();
    
    // Appeler l'endpoint de matchmaking
    const res = await fetch(window.API_BASE_URL + '/game/matchmaking', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      console.error('❌ Erreur API matchmaking:', res.status);
      hideMatchmakingWaiting();
      alert('Erreur lors de la recherche. Réessaye !');
      return;
    }
    
    const payload = await res.json();
    console.log('📡 Réponse matchmaking:', payload);
    
    if (payload.success && payload.roomId) {
      // Match trouvé immédiatement
      console.log('✅ Match trouvé immédiatement!');
      clearMatchmakingPoll();
      roomInput.value = payload.roomId;
      hideMatchmakingWaiting();
      showDeckSelector();
    } else if (payload.success) {
      // En attente, commencer le polling SSE
      console.log('⏳ En attente, démarrage SSE...');
      startMatchmakingPoll(token);
    } else {
      hideMatchmakingWaiting();
      alert(payload.message || 'Erreur lors du matchmaking');
    }
  } catch (err) {
    console.error('❌ Matchmaking error:', err);
    hideMatchmakingWaiting();
    alert('Erreur réseau. Réessaye !');
  }
});

function showMatchmakingWaiting() {
  const lobbyEl = document.getElementById('lobby');
  const waitingEl = document.getElementById('matchmaking-waiting');
  if (lobbyEl) lobbyEl.style.display = 'none';
  if (waitingEl) waitingEl.style.display = 'flex';
  lucide.createIcons();
}

function hideMatchmakingWaiting() {
  const lobbyEl = document.getElementById('lobby');
  const waitingEl = document.getElementById('matchmaking-waiting');
  if (lobbyEl) lobbyEl.style.display = 'block';
  if (waitingEl) waitingEl.style.display = 'none';
  clearMatchmakingPoll();
}

function updateMatchmakingTimer() {
  if (!matchmakingStartTime) return;
  const elapsed = Math.floor((Date.now() - matchmakingStartTime) / 1000);
  const timerEl = document.getElementById('matchmaking-timer');
  if (timerEl) {
    timerEl.textContent = elapsed + 's';
  }
}

function startMatchmakingPoll(token) {
  // Mettre à jour le timer toutes les secondes
  if (matchmakingTimerInterval) clearInterval(matchmakingTimerInterval);
  matchmakingTimerInterval = setInterval(updateMatchmakingTimer, 1000);
  
  console.log('🔌 Connexion SSE pour matchmaking...');
  
  // Connecter à SSE pour les mises à jour du matchmaking
  // Note: EventSource ne peut pas envoyer de headers, on utilise un query param
  matchmakingEventSource = new EventSource(`${window.API_BASE_URL}/game/matchmaking/watch?token=${encodeURIComponent(token)}`);

  matchmakingEventSource.addEventListener('message', (event) => {
    try {
      console.log('📨 Message SSE reçu:', event.data);
      const data = JSON.parse(event.data);

      if (data.type === 'stats' && data.stats) {
        // Mettre à jour les stats
        const queueEl = document.getElementById('queue-count');
        const matchesEl = document.getElementById('active-matches');
        if (queueEl) queueEl.textContent = data.stats.playersInQueue || 0;
        if (matchesEl) matchesEl.textContent = data.stats.activeMatches || 0;
      }

      if (data.type === 'matchFound' && data.roomId && data.roomId.trim() !== '') {
        // Match trouvé!
        console.log('✅ Match trouvé! Room:', data.roomId);
        clearMatchmakingPoll();
        roomInput.value = data.roomId;
        
        // Animation de transition
        const titleEl = document.getElementById('matchmaking-title');
        const msgEl = document.getElementById('matchmaking-message');
        if (titleEl) titleEl.textContent = '🎉 Match trouvé!';
        if (msgEl) msgEl.textContent = 'Prépare-toi pour le combat...';
        
        setTimeout(() => {
          hideMatchmakingWaiting();
          showDeckSelector();
        }, 1500);
      }
    } catch (err) {
      console.error('❌ SSE parse error:', err, event.data);
    }
  });

  matchmakingEventSource.onerror = () => {
    console.error('❌ SSE connection error');
    clearMatchmakingPoll();
  };
}

function clearMatchmakingPoll() {
  if (matchmakingEventSource) {
    matchmakingEventSource.close();
    matchmakingEventSource = null;
  }
  if (matchmakingPollInterval) {
    clearInterval(matchmakingPollInterval);
    matchmakingPollInterval = null;
  }
  if (matchmakingTimerInterval) {
    clearInterval(matchmakingTimerInterval);
    matchmakingTimerInterval = null;
  }
  matchmakingStartTime = null;
}

document.getElementById('cancel-matchmaking-btn')?.addEventListener('click', async () => {
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    if (!token) return;
    
    await fetch(window.API_BASE_URL + '/game/matchmaking', {
      method: 'DELETE',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    hideMatchmakingWaiting();
  } catch (err) {
    console.error('Cancel matchmaking error:', err);
    hideMatchmakingWaiting();
  }
});

// Nettoyer le matchmaking quand l'utilisateur quitte la page
const cleanupMatchmakingOnExit = async () => {
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    if (!token || !matchmakingEventSource) return;
    
    // Fermer la connexion SSE
    if (matchmakingEventSource) {
      matchmakingEventSource.close();
    }
    
    // Envoyer une requête DELETE pour supprimer de la queue
    await fetch(window.API_BASE_URL + '/game/matchmaking', {
      method: 'DELETE',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      // Keep-alive pour s'assurer que la requête est envoyée même si la page se ferme
      keepalive: true
    }).catch(() => {});
  } catch (err) {
    // Ignorer les erreurs lors du cleanup
  }
};

// Nettoyer quand l'utilisateur quitte la page
window.addEventListener('beforeunload', cleanupMatchmakingOnExit);
window.addEventListener('unload', cleanupMatchmakingOnExit);
window.addEventListener('pagehide', cleanupMatchmakingOnExit);

// Volontairement : on ne quitte PLUS la file d'attente quand l'onglet passe en
// arriere-plan. Sur iPad, repondre a un message suffisait a annuler la
// recherche de partie. Le serveur dispose deja d'un timeout de heartbeat pour
// nettoyer les joueurs reellement partis.

document.getElementById('invite-btn')?.addEventListener('click', async () => {
  let room = roomInput.value.trim();
  
  // Si pas de room spécifiée, générer un UUID aléatoire
  if (!room) {
    // Générer un UUID v4 simplifié
    room = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0,
            v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    roomInput.value = room;
  }
  
  // Créer l'URL d'invitation
  const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}`;
  
  // Copier/partager le lien
  if (navigator.share) {
    navigator.share({ 
      title: 'BrainrotStars — Combat', 
      text: 'Rejoins mon arène !', 
      url 
    }).then(() => {
      window.location.href = url;
    }).catch(() => {
      window.location.href = url;
    });
  } else {
    navigator.clipboard.writeText(url).then(() => {
      alert('🔗 Lien copié !\n\nArène: ' + room + '\n\nPartage-le à ton ami !');
      window.location.href = url;
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('🔗 Lien copié !\n\nArène: ' + room + '\n\nPartage-le à ton ami !');
      window.location.href = url;
    });
  }
});

(async () => {
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    if (!token) return;
    const res = await fetch(window.API_BASE_URL + '/user/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const payload = await res.json();
    if (payload?.success && payload?.value?.pseudo) {
      playerPseudo = payload.value.pseudo;
    }
  } catch {}

  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) {
    roomInput.value = params.get('room');
    joinBtn.click();
  }
})();

/* ==========================================================================
   INTERFACE DE PARTIE
   --------------------------------------------------------------------------
   renderRoom reconstruisait tout le HUD et toute la main a chaque message du
   serveur. Sur iPad cela signifiait des dizaines de creations de noeuds et de
   rechargements d'<img> par seconde : c'etait la cause principale des
   saccades. Ici, on ne touche au DOM que sur un changement reel.
   ========================================================================== */

const handCardElements = new Map(); // cardId -> element
let lastHudSignature = '';

function renderRoom(room) {
  if (!room) return;

  const me = room.players.find(p => p.id === localPlayerId);
  if (me) localPlayerId = me.id;
  const opponent = room.players.find(p => p.id !== localPlayerId) || { name: 'Waiting...', hp: '-' };

  const mana = me ? (me.mana || 0) : 0;
  const maxMana = me ? (me.maxMana || 10) : 10;

  // Le HUD n'est reecrit que si une de ses valeurs a change.
  const hudSignature = `${opponent.name}|${opponent.hp}|${me ? me.name : ''}|${me ? me.hp : '-'}|${mana}|${maxMana}`;
  if (hudSignature !== lastHudSignature) {
    lastHudSignature = hudSignature;

    opponentEl.innerHTML =
      `<span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Adversaire</span><br>` +
      `<span style="font-weight:900;font-size:1.1rem;">${opponent.name}</span> ` +
      `<span class="emerald" style="font-size:0.9rem;">❤️ ${opponent.hp}</span>`;

    let manaPips = '';
    for (let i = 0; i < maxMana; i++) manaPips += `<div class="mana-pip ${i < mana ? 'filled' : ''}"></div>`;
    infoEl.innerHTML =
      `<span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Toi</span><br>` +
      `<span style="font-weight:900;font-size:1.1rem;">${me ? me.name : ''}</span> ` +
      `<span style="color:#ef4444;font-size:0.9rem;">❤️ ${me ? me.hp : '-'}</span>` +
      `<div class="mana-bar" style="justify-content:center;margin-top:6px;">${manaPips}</div>`;
  }

  renderHand(me);
}

function renderHand(me) {
  const hand = me && Array.isArray(me.hand) ? me.hand.filter(Boolean) : [];
  const handIds = new Set(hand.map(c => c.id));

  if (selectedCardForPlacement && !handIds.has(selectedCardForPlacement)) {
    selectedCardForPlacement = null;
    canvas.classList.remove('touch-mode-active');
  }

  // Retrait des cartes qui ont quitte la main.
  for (const [cardId, el] of handCardElements) {
    if (!handIds.has(cardId)) {
      el.remove();
      handCardElements.delete(cardId);
    }
  }

  const mana = me ? (me.mana || 0) : 0;

  hand.forEach((card, index) => {
    let el = handCardElements.get(card.id);

    if (!el) {
      el = buildHandCard(card);
      handCardElements.set(card.id, el);
      handEl.appendChild(el);
    }

    // Seules les classes d'etat sont mises a jour : pas de reconstruction,
    // donc pas de rechargement d'image ni de perte de l'animation en cours.
    const affordable = mana >= card.cost;
    el._affordable = affordable;
    el.classList.toggle('card-unaffordable', !affordable);
    el.classList.toggle('card-selected', selectedCardForPlacement === card.id);

    // Respect de l'ordre de la main sans toucher aux noeuds inchanges.
    const current = handEl.children[index];
    if (current !== el) handEl.insertBefore(el, current || null);
  });

  if (selectedCardForPlacement) canvas.classList.add('touch-mode-active');
}

function buildHandCard(card) {
  const el = document.createElement('div');
  el.className = 'btn-card hand-card';
  el.dataset.cardId = card.id;
  el._affordable = true;

  const cardImage = card.link
    ? `<img src="${card.link}" loading="lazy" decoding="async" style="width:72px; height:72px; object-fit:cover; border-radius:6px; display:block; flex-shrink:0;">`
    : `<div class="card-emoji">${card.emoji || '❓'}</div>`;
  const cardName = card.name || (card.card && card.card.name) || '';
  const cardCost = card.cost ?? (card.card && card.card.cost) ?? 0;
  el.innerHTML = `<div class="card-cost">${cardCost}</div>${cardImage}<div class="card-name">${cardName}</div>`;

  el.addEventListener('pointerdown', (ev) => {
    if (!el._affordable) return;
    if (ev.pointerType === 'touch') ev.preventDefault();

    if (isTouchControlMode) {
      if (selectedCardForPlacement === card.id) {
        selectedCardForPlacement = null;
        el.classList.remove('card-selected');
        canvas.classList.remove('touch-mode-active');
        playCardDeselectEffect(el);
      } else {
        for (const other of handCardElements.values()) other.classList.remove('card-selected');
        selectedCardForPlacement = card.id;
        el.classList.add('card-selected');
        canvas.classList.add('touch-mode-active');
        playCardSelectEffect(el);
      }
    } else {
      document.body.classList.add('is-dragging');
      draggingCardId = card.id;
      draggingEmoji = card.emoji || '❓';
      dragPos = { x: ev.clientX, y: ev.clientY };
    }
  }, { passive: false });

  el.addEventListener('dragstart', (ev) => ev.preventDefault());

  el.addEventListener('click', () => {
    if (el._affordable && !justDragged && !isTouchControlMode) playCard(card.id);
  });

  return el;
}

/* ==========================================================================
   JOUER UNE CARTE
   --------------------------------------------------------------------------
   Passe par la socket deja authentifiee. Le serveur revalide le mana, la zone
   et la possession de la carte : la verification ci-dessous n'est la que pour
   un retour immediat, elle n'est pas une source de verite.
   ========================================================================== */

function playCard(cardId, targetPos) {
  if (!currentRoom || !localPlayerId) return;

  const me = currentRoom.players.find(p => p.id === localPlayerId);
  if (!me || !Array.isArray(me.hand)) return;

  const card = me.hand.find(c => c && c.id === cardId);
  if (!card) return;

  if ((me.mana || 0) < card.cost) {
    showGameToast('Pas assez de mana pour cette carte !');
    return;
  }

  if (card.type === 'unit' && targetPos && !isValidPlacement(me, targetPos)) {
    showGameToast('Tu ne peux placer des cartes que sur ta zone de jeu !');
    return;
  }

  if (!gameSocket || !gameSocket.connected) {
    showGameToast('Connexion perdue, reconnexion en cours...');
    return;
  }

  const payload = { cardId };
  if (targetPos) payload.targetPos = targetPos;

  window.PlayWebAnalytics?.track('card_played');

  gameSocket.emit('play', payload, (res) => {
    if (res && res.ok === false) {
      console.warn('Carte refusee :', res.error);
      showGameToast(res.error || 'Action refusée');
    }
  });
}

/**
 * Petit retour visuel non bloquant.
 * alert() gelait tout l'onglet et, sur iPad, coupait la boucle de rendu.
 */
let toastTimer = null;
function showGameToast(text) {
  let toast = document.getElementById('game-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'game-toast';
    toast.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;' +
      'padding:10px 18px;border-radius:999px;font-weight:700;font-size:0.9rem;' +
      'background:rgba(15,15,20,0.92);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.4);' +
      'pointer-events:none;opacity:0;transition:opacity .18s ease;max-width:90vw;text-align:center;';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

function isValidPlacement(player, targetPos) {
  if (!player || !targetPos) return true;
  const zone = getPlacementZone(player);
  return targetPos.x >= zone.x && targetPos.x < zone.x + zone.w &&
         targetPos.y >= zone.y && targetPos.y < zone.y + zone.h;
}

async function fetchAvailableCards() {
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    const res = await fetch(window.API_BASE_URL + '/game/available-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.cards || [];
  } catch (e) {
    console.error('Erreur fetch cards:', e);
    return [];
  }
}

function loadSavedDeck() {
  try {
    return JSON.parse(localStorage.getItem('brainrot_saved_deck') || '[]');
  } catch { return []; }
}

function saveDeckToStorage(keys) {
  localStorage.setItem('brainrot_saved_deck', JSON.stringify(keys));
}

function renderDeckSelector(availableCards) {
  const deckList = document.getElementById('deck-list');
  deckList.innerHTML = '';

  if (!availableCards || availableCards.length === 0) {
    deckList.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:var(--text-muted);">Pas de cartes disponibles. Utilise un deck aléatoire.</p>';
    return;
  }

  const grouped = {};
  availableCards.forEach(entry => {
    const card = entry.card || {};
    const key = `${card.name}_${card.type || 'unit'}`;
    if (!grouped[key]) grouped[key] = { ...entry, card };
  });

  const savedKeys = loadSavedDeck();

  updateSavedDeckCount(savedKeys.length);

  Object.entries(grouped).forEach(([key, entry]) => {
    const card = entry.card;
    const cardEl = document.createElement('div');
    cardEl.className = 'deck-card btn-card';
    cardEl.dataset.key = key;

    const typeLabel = card.type === 'spell' ? '🔮 Sort' : '⚔️ Unité';
    const inSaved = savedKeys.includes(key);

    // Afficher image si disponible, sinon emoji
    const cardImage = card.link ? `<img src="${card.link}" style="width:64px; height:64px; object-fit:cover; border-radius:6px; display:block; margin:0 auto; flex-shrink:0;">` : `<div class="card-emoji">${card.emoji || '🃏'}</div>`;

    cardEl.innerHTML = `
      <div class="deck-star" style="display:${inSaved ? 'flex' : 'none'}">⭐</div>
      ${cardImage}
      <div class="card-name">${card.name}</div>
      <div class="card-cost-label">Coût: <span class="card-cost">${card.cost || 1}</span></div>
      <div class="card-type">${typeLabel}</div>
      <button class="deck-add-btn ${inSaved ? 'deck-add-btn--remove' : ''}" type="button">${inSaved ? '★ Retirer du deck' : '☆ Ajouter au deck'}</button>
    `;
    
    if (!card.link) {
      console.warn('Carte sans lien:', entry);
    }

    const refreshCard = () => {
      const inDeckNow = savedKeys.includes(key);
      const selectedNow = selectedDeck.some(c => `${c.card.name}_${c.card.type || 'unit'}` === key);
      cardEl.classList.toggle('selected', selectedNow);
      const star = cardEl.querySelector('.deck-star');
      const btn = cardEl.querySelector('.deck-add-btn');
      if (star) star.style.display = inDeckNow ? 'flex' : 'none';
      if (btn) {
        btn.textContent = inDeckNow ? '★ Retirer du deck' : '☆ Ajouter au deck';
        btn.classList.toggle('deck-add-btn--remove', inDeckNow);
      }
    };

    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('.deck-add-btn')) return;
      const inSelected = selectedDeck.some(c => `${c.card.name}_${c.card.type || 'unit'}` === key);
      if (inSelected) {
        const idx = selectedDeck.findIndex(c => `${c.card.name}_${c.card.type || 'unit'}` === key);
        if (idx !== -1) selectedDeck.splice(idx, 1);
      } else {
        if (selectedDeck.length < 10) selectedDeck.push(entry);
      }
      refreshCard();
      updateDeckCounter();
    });

    const btn = cardEl.querySelector('.deck-add-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = savedKeys.indexOf(key);
      if (idx !== -1) {
        savedKeys.splice(idx, 1);
      } else {
        if (savedKeys.length < 10) savedKeys.push(key);
      }
      saveDeckToStorage(savedKeys);
      updateSavedDeckCount(savedKeys.length);
      refreshCard();
    });

    deckList.appendChild(cardEl);
  });

  const useSavedBtn = document.getElementById('use-saved-deck');
  if (useSavedBtn) {
    useSavedBtn.onclick = () => {
      const keys = loadSavedDeck();
      if (keys.length === 0) {
        alert('Aucun deck sauvegardé. Ajoute des cartes avec ☆ sur chaque carte !');
        return;
      }
      selectedDeck = [];
      keys.forEach(k => {
        if (grouped[k]) selectedDeck.push(grouped[k]);
      });
      document.querySelectorAll('.deck-card').forEach(el => {
        const k = el.dataset.key;
        el.classList.toggle('selected', selectedDeck.some(c => `${c.card.name}_${c.card.type || 'unit'}` === k));
      });
      updateDeckCounter();
    };
  }

  const resetBtn = document.getElementById('reset-saved-deck');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (confirm('⚠️ Êtes-vous sûr de vouloir réinitialiser votre deck sauvegardé ?\n\nCette action est irréversible !')) {
        saveDeckToStorage([]);
        updateSavedDeckCount(0);
        alert('✅ Deck réinitialisé avec succès !');
        
        // Décocher toutes les cartes
        document.querySelectorAll('.deck-card').forEach(el => {
          const star = el.querySelector('.deck-star');
          const btn = el.querySelector('.deck-add-btn');
          if (star) star.style.display = 'none';
          if (btn) {
            btn.textContent = '☆ Ajouter au deck';
            btn.classList.remove('deck-add-btn--remove');
          }
        });
      }
    };
  }

  updateDeckCounter();
}

function updateSavedDeckCount(count) {
  const el = document.getElementById('saved-deck-count');
  if (el) el.textContent = count > 0 ? `(${count}/10 cartes)` : '(aucun deck sauvegardé)';
}

function updateDeckCounter() {
  const confirmBtn = document.getElementById('confirm-deck');
  const isComplete = selectedDeck.length === 10;
  confirmBtn.disabled = !isComplete;
  confirmBtn.innerHTML = `⚔️ Commencer le combat (${selectedDeck.length}/10)<div class="shine"></div>`;
  confirmBtn.classList.toggle('btn-disabled', !isComplete);
}

async function showDeckSelector() {
  let fetchedCards = [];
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    const url = window.API_BASE_URL + '/game/getCard';
    const res = await fetch(url, { method: 'GET' , headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${token}`},});
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.result)) {
        fetchedCards = data.result;
      } else if (Array.isArray(data)) {
        fetchedCards = data;
      } else {
        console.warn('Unexpected /game/getCard shape', data);
      }
    } else {
      console.warn('getCard responded with', res.status);
    }
  } catch (e) {
    console.error('Erreur fetch /game/getCard:', e);
  }

  // Vérifier si l'utilisateur a assez de cartes
  if (!fetchedCards || fetchedCards.length === 0) {
    // Pas de cartes du tout
    alert('❌ Tu n\'as pas de cartes disponibles!\n\nTu dois débloquer au moins 10 cartes avant de jouer.\nRetour à l\'accueil...');
    window.location.href = '../index/index.html';
    return;
  }
  
  if (fetchedCards.length < 10) {
    // Moins de 10 cartes
    const missing = 10 - fetchedCards.length;
    alert(`⚠️ Tu n'as que ${fetchedCards.length}/10 cartes!\n\nIl te manque ${missing} carte(s) pour former un deck complet.\n\nDéverrouille plus de cartes et réessaye!`);
    window.location.href = '../index/index.html';
    return;
  }

  const normalized = fetchedCards.map((entry, idx) => {
    const cardData = entry.card || entry;
    return {
      cardId: entry.cardId || (cardData.name ? cardData.name.replace(/\s+/g, '_') : ('card_' + idx)) + '_' + idx,
      deckId: entry.deckId,
      quantity: entry.quantity || 1,
      card: cardData
    };
  });

  selectedDeck = [];
  renderDeckSelector(normalized);
  lobbyEl.style.display = 'none';
  deckSelectorEl.style.display = 'block';
}

document.getElementById('confirm-deck').addEventListener('click', async () => {
  if (selectedDeck.length === 0) {
    alert('Sélectionne au moins une carte!');
    return;
  }

  const name = playerPseudo;
  const room = roomInput.value || 'room1';
  currentRoomId = room;

  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    const res = await fetch(window.API_BASE_URL + '/game/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        roomId: room,
        name,
        playerId: localPlayerId,
        selectedCards: selectedDeck,
        view: 'horizontal'
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'join failed' }));
      alert('Join failed: ' + (err && err.error ? err.error : res.status));
      return;
    }

    const data = await res.json();
    localPlayerId = data.playerId;
    try { localStorage.setItem('playerId', localPlayerId); } catch {}
    currentRoom = data.room;

    deckSelectorEl.style.display = 'none';
    showInvitationModal(data);

    // La socket est ouverte avant toute chose : on ne peut pas rater
    // l'evenement de demarrage de la partie.
    connectGameSocket(room);

    // Le createur de l'arene est pret des qu'il a valide son deck. Le second
    // joueur, lui, ne l'est qu'apres avoir accepte l'invitation : auparavant
    // il etait marque pret d'office, avant meme de voir le modal.
    if (data.waitingForOpponent) markReady();
  } catch (e) {
    console.error('Join error:', e);
    alert('Erreur de connexion');
  }
});

function showInvitationModal(joinData) {
  isInvitationAccepted = false;
  isInvitationWaiting = false;
  
  const invModal = document.getElementById('invitation-modal');
  const title = document.getElementById('invitation-title');
  const message = document.getElementById('invitation-message');
  const buttons = document.getElementById('invitation-buttons');
  const acceptBtn = document.getElementById('accept-invitation-btn');
  const rejectBtn = document.getElementById('reject-invitation-btn');
  const waitingBtn = document.getElementById('waiting-btn');
  
  // Si on est le premier joueur (on invite)
  if (joinData.waitingForOpponent) {
    isInvitationWaiting = true;
    title.textContent = '🎮 Partie créée';
    message.textContent = `Tu as créé une arène. En attente qu'un ami accepte ton invitation...`;
    acceptBtn.style.display = 'none';
    rejectBtn.style.display = 'none';
    waitingBtn.style.display = 'flex';
  } else {
    // Si on est le deuxième joueur (on accepte)
    title.textContent = '📨 Nouvelle invitation';
    message.textContent = `${joinData.invitation?.fromName || 'Un joueur'} t'invite à une partie. Acceptes-tu ?`;
    acceptBtn.style.display = 'block';
    rejectBtn.style.display = 'block';
    waitingBtn.style.display = 'none';
    
    acceptBtn.onclick = async () => {
      await handleAcceptInvitation(joinData);
    };
    
    rejectBtn.onclick = async () => {
      await handleRejectInvitation(joinData);
    };
  }
  
  invModal.style.display = 'flex';
}

/** Declare le joueur pret aupres du serveur temps reel. */
function markReady() {
  if (!gameSocket) return;
  const send = () => gameSocket.emit('ready', {}, (res) => {
    if (res && res.ok === false) console.warn('ready refuse :', res.error);
  });
  if (gameSocket.connected) send();
  else gameSocket.once('connect', () => setTimeout(send, 50));
}

function handleAcceptInvitation(joinData) {
  isInvitationAccepted = true;
  const acceptBtn = document.getElementById('accept-invitation-btn');
  const rejectBtn = document.getElementById('reject-invitation-btn');
  const title = document.getElementById('invitation-title');
  const message = document.getElementById('invitation-message');
  const waitingBtn = document.getElementById('waiting-btn');

  acceptBtn.disabled = true;
  rejectBtn.disabled = true;

  markReady();

  title.textContent = '✅ Invitation acceptée';
  message.textContent = 'Connecté avec ' + (joinData.invitation?.fromName || "l'autre joueur") + '. En attente de démarrage...';
  acceptBtn.style.display = 'none';
  rejectBtn.style.display = 'none';
  waitingBtn.style.display = 'flex';
}

async function handleRejectInvitation(joinData) {
  try {
    const token = window.BrainrotAuth?.getToken?.() || '';
    await fetch(window.API_BASE_URL + '/game/reject-invitation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        roomId: currentRoomId,
        playerId: localPlayerId
      })
    });

    // Retourner au lobby
    invitationModal.style.display = 'none';
    lobbyEl.style.display = 'block';
  } catch (e) {
    console.error('Reject error:', e);
  }
}

// Touch mode: canvas click/touch handler for card placement
function handleCanvasPlacement(ev) {
  if (!isTouchControlMode || !selectedCardForPlacement || !currentRoom) return;
  
  // Prevent default for touchend to avoid double-clicks
  if (ev.type === 'touchend') {
    ev.preventDefault();
  }
  
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  // Get position from either mouse or touch event
  let clientX, clientY;
  if (ev.touches && ev.touches.length > 0) {
    clientX = ev.touches[0].clientX;
    clientY = ev.touches[0].clientY;
  } else if (ev.changedTouches && ev.changedTouches.length > 0) {
    // For touchend, use changedTouches
    clientX = ev.changedTouches[0].clientX;
    clientY = ev.changedTouches[0].clientY;
  } else {
    clientX = ev.clientX;
    clientY = ev.clientY;
  }
  
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  
  const cardId = selectedCardForPlacement;
  
  // Clear selection immediately for UX
  selectedCardForPlacement = null;
  canvas.classList.remove('touch-mode-active');
  handEl.querySelectorAll('.hand-card').forEach(card => {
    card.classList.remove('card-selected');
  });
  
  // Play card at clicked position (async, but don't wait for response)
  playCard(cardId, { x: Math.round(x), y: Math.round(y) }).catch(err => console.error('Play card error:', err));
}

canvas.addEventListener('click', handleCanvasPlacement);
canvas.addEventListener('touchend', handleCanvasPlacement, { passive: false });