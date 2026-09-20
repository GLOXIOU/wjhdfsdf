const API_BASE_URL = window.API_BASE_URL + "";
const MYSPACE_ROUTE_BASE = "/myspace";

const ui = {
  wallet: document.getElementById('wallet-value'),
  batimentsGrid: document.getElementById('batiments-grid'),
  myBatimentsList: document.getElementById('my-batiments-list'),
  buildModal: document.getElementById('build-modal'),
  buildModalClose: document.getElementById('build-modal-close'),
  buildModalTitle: document.getElementById('build-modal-title'),
  buildModalDescription: document.getElementById('build-modal-description'),
  buildModalCost: document.getElementById('build-modal-cost'),
  buildModalTime: document.getElementById('build-modal-time'),
  buildModalProduction: document.getElementById('build-modal-production'),
  buildModalX: document.getElementById('build-modal-x'),
  buildModalY: document.getElementById('build-modal-y'),
  buildModalCancel: document.getElementById('build-modal-cancel'),
  buildModalConfirm: document.getElementById('build-modal-confirm'),
  buildModalOverlay: document.querySelector('[data-close-modal="true"]'),
  canvas: document.getElementById('myspace-canvas'),
  notification: document.getElementById('notification')
};

let myspaceState = {
  spaceId: null,
  mySpace: null,
  batiments: [],
  selectedBatiment: null,
  currentGold: 0
};

let canvas = null;
let ctx = null;

function getAuthToken() {
  return window.BrainrotAuth?.getToken?.();
}

async function getCurrentGold() {
  try {
    const token = getAuthToken();
    if (!token) return myspaceState.currentGold;

    const response = await fetch(`${API_BASE_URL}/user/stats`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const gold = data.value?.gold || data.result?.gold || data.gold || myspaceState.currentGold;
      myspaceState.currentGold = Number(gold);
      return myspaceState.currentGold;
    }
  } catch (error) {
    console.error('Erreur récupération or:', error);
  }
  return myspaceState.currentGold;
}

function renderWallet() {
  ui.wallet.textContent = Math.floor(myspaceState.currentGold).toLocaleString('fr-FR');
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}j`;
}

function showNotification(message, type = 'info') {
  ui.notification.textContent = message;
  ui.notification.className = `notification ${type}`;
  
  setTimeout(() => {
    ui.notification.classList.add('hidden');
  }, 3000);
}

async function loadBatiments() {
  try {
    const token = getAuthToken();
    if (!token) return;

    const response = await fetch(`${API_BASE_URL}${MYSPACE_ROUTE_BASE}/batiments`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Erreur lors du chargement');

    const data = await response.json();
    if (data.success) {
      myspaceState.batiments = data.result || [];
      renderBatimentsShop();
    }
  } catch (error) {
    console.error('Erreur:', error);
    showNotification('Erreur lors du chargement des bâtiments', 'error');
  }
}

async function loadMySpace() {
  try {
    const token = getAuthToken();
    
    if (!token) {
      console.warn('⚠️ Token manquant');
      return;
    }

    const response = await fetch(`${API_BASE_URL}${MYSPACE_ROUTE_BASE}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors du chargement');
    }

    const data = await response.json();
    if (data.success && data.result) {
      myspaceState.mySpace = data.result;
      myspaceState.spaceId = data.result.id;
      console.log('✅ Espace chargé, spaceId:', myspaceState.spaceId);
      renderMyBatiments();
      drawMap();
    } else {
      throw new Error(data.error || 'Pas de Space');
    }
  } catch (error) {
    console.error('❌ Erreur loadMySpace:', error);
    showNotification('Erreur lors du chargement de l\'espace: ' + error.message, 'error');
  }
}

function renderBatimentsShop() {
  ui.batimentsGrid.innerHTML = '';

  if (myspaceState.batiments.length === 0) {
    ui.batimentsGrid.innerHTML = '<p style="color: rgba(255, 255, 255, 0.6); grid-column: 1/-1;">Aucun bâtiment disponible</p>';
    return;
  }

  myspaceState.batiments.forEach(batiment => {
    const currentGold = myspaceState.currentGold;
    const canAfford = currentGold >= Number(batiment.goldCost);
    
    const card = document.createElement('div');
    card.className = `batiment-card ${canAfford ? 'affordable' : 'locked'}`;
    card.innerHTML = `
      <span class="batiment-card-icon">${batiment.icon || '🏗️'}</span>
      <h3 class="batiment-card-name">${batiment.name}</h3>
      <p class="batiment-card-description">${batiment.description || ''}</p>
      <div class="batiment-card-stats">
        <div class="batiment-stat">
          <span class="batiment-stat-label">Coût</span>
          <span class="batiment-stat-value">${Number(batiment.goldCost)} 💰</span>
        </div>
        <div class="batiment-stat">
          <span class="batiment-stat-label">Temps</span>
          <span class="batiment-stat-value">${formatTime(batiment.buildTimeSec)}</span>
        </div>
        <div class="batiment-stat">
          <span class="batiment-stat-label">Production</span>
          <span class="batiment-stat-value">${Number(batiment.goldPerSec)}/s</span>
        </div>
      </div>
      <button class="batiment-card-btn ${canAfford ? '' : 'disabled'}" ${!canAfford ? 'disabled' : ''}>
        ${canAfford ? '🔨 Construire' : `💰 Manque ${Math.max(0, Math.floor(Number(batiment.goldCost) - currentGold))} 💰`}
      </button>
    `;

    const btn = card.querySelector('.batiment-card-btn');
    btn.addEventListener('click', () => {
      if (canAfford) {
        openBuildModal(batiment);
      } else {
        showNotification(`Tu as besoin de ${Math.floor(Number(batiment.goldCost) - currentGold)} 💰 de plus!`, 'error');
      }
    });

    ui.batimentsGrid.appendChild(card);
  });
}

function renderMyBatiments() {
  ui.myBatimentsList.innerHTML = '';

  if (!myspaceState.mySpace || !myspaceState.mySpace.batiments || myspaceState.mySpace.batiments.length === 0) {
    ui.myBatimentsList.innerHTML = '<p style="color: rgba(255, 255, 255, 0.6); grid-column: 1/-1;">Aucun bâtiment construit</p>';
    return;
  }

  myspaceState.mySpace.batiments.forEach(spaceBatiment => {
    const batiment = myspaceState.batiments.find(b => b.id === spaceBatiment.batimentId);
    if (!batiment) return;

    const finishAt = new Date(spaceBatiment.finishBuildAt);
    const now = new Date();
    const isBuilding = finishAt > now;
    const progress = isBuilding 
      ? ((now - new Date(spaceBatiment.buildAt)) / (finishAt - new Date(spaceBatiment.buildAt))) * 100 
      : 100;

    const item = document.createElement('div');
    item.className = 'my-batiment-item';
    item.innerHTML = `
      <div class="my-batiment-item-name">${batiment.icon || '🏗️'} ${batiment.name}</div>
      <div class="my-batiment-item-pos">Position: (${spaceBatiment.coordX}, ${spaceBatiment.coordY})</div>
      <div class="my-batiment-item-progress">
        <div class="my-batiment-item-progress-bar" style="width: ${Math.min(100, progress)}%"></div>
      </div>
      <div class="my-batiment-item-time">
        ${isBuilding ? `Construction: ${formatTime(Math.max(0, (finishAt - now) / 1000))}` : 'Construit ✓'}
      </div>
    `;

    ui.myBatimentsList.appendChild(item);
  });
}

function openBuildModal(batiment) {
  myspaceState.selectedBatiment = batiment;
  
  ui.buildModalTitle.textContent = batiment.name;
  ui.buildModalDescription.textContent = batiment.description || '';
  ui.buildModalCost.textContent = `${Number(batiment.goldCost)} 💰`;
  ui.buildModalTime.textContent = formatTime(batiment.buildTimeSec);
  ui.buildModalProduction.textContent = `${Number(batiment.goldPerSec)} 💰/s`;
  
  let posX, posY, isValid = false;
  let attempts = 0;
  
  while (!isValid && attempts < 50) {
    posX = Math.floor(Math.random() * 20);
    posY = Math.floor(Math.random() * 20);
    
    const occupied = myspaceState.mySpace?.batiments?.some(
      b => b.coordX === posX && b.coordY === posY
    );
    isValid = !occupied;
    attempts++;
  }
  
  ui.buildModalX.value = posX || 0;
  ui.buildModalY.value = posY || 0;
  
  ui.buildModalX.addEventListener('input', validateBuildPosition);
  ui.buildModalY.addEventListener('input', validateBuildPosition);
  
  ui.buildModal.classList.remove('hidden');
  validateBuildPosition();
}

function validateBuildPosition() {
  const posX = parseInt(ui.buildModalX.value);
  const posY = parseInt(ui.buildModalY.value);
  
  let message = '';
  let isValid = true;

  if (isNaN(posX) || isNaN(posY)) {
    message = '❌ Positions invalides';
    isValid = false;
  } else if (posX < 0 || posX >= 20 || posY < 0 || posY >= 20) {
    message = '❌ Position en dehors de la grille (0-19)';
    isValid = false;
  } else if (myspaceState.mySpace?.batiments?.some(b => b.coordX === posX && b.coordY === posY)) {
    message = '❌ Un bâtiment occupe déjà cette position';
    isValid = false;
  } else {
    message = `✓ Position valide (${posX}, ${posY})`;
  }

  const messageEl = document.querySelector('[data-position-validation]');
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.classList.toggle('error', !isValid);
    messageEl.style.color = isValid ? '#38ef7d' : '#ff6b6b';
  }

  ui.buildModalConfirm.disabled = !isValid;
  return isValid;
}

function closeBuildModal() {
  ui.buildModal.classList.add('hidden');
  myspaceState.selectedBatiment = null;
}

async function handleCreateBatiment() {
  if (!myspaceState.selectedBatiment) {
    showNotification('❌ Bâtiment non sélectionné', 'error');
    return;
  }
  
  if (!myspaceState.spaceId) {
    showNotification('❌ Space ID manquant - rechargez la page', 'error');
    console.error('❌ Erreur: spaceId =', myspaceState.spaceId);
    return;
  }

  if (!validateBuildPosition()) {
    showNotification('Position invalide', 'error');
    return;
  }

  const posX = parseInt(ui.buildModalX.value);
  const posY = parseInt(ui.buildModalY.value);
  const batiment = myspaceState.selectedBatiment;
  const currentGold = myspaceState.currentGold;

  if (currentGold < Number(batiment.goldCost)) {
    showNotification(`Pas assez d'or! Manque ${Math.floor(Number(batiment.goldCost) - currentGold)} 💰`, 'error');
    return;
  }

  try {
    ui.buildModalConfirm.disabled = true;
    ui.buildModalConfirm.textContent = 'Construction en cours...';

    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}${MYSPACE_ROUTE_BASE}/create-batiment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        spaceId: myspaceState.spaceId,
        batimentId: myspaceState.selectedBatiment.id,
        posx: posX,
        posy: posY
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Erreur serveur: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      showNotification(`✓ ${batiment.name} en construction! (${formatTime(batiment.buildTimeSec)})`, 'success');
      
      if (data.result?.newGold !== undefined) {
        myspaceState.currentGold = Number(data.result.newGold);
      } else {
        myspaceState.currentGold = currentGold - Number(batiment.goldCost);
      }
      
      renderWallet();
      closeBuildModal();
      
      setTimeout(async () => {
        await loadMySpace();
        renderBatimentsShop();
      }, 500);
    } else {
      throw new Error(data.error || 'Erreur inconnue lors de la création');
    }
  } catch (error) {
    console.error('Erreur création batiment:', error);
    showNotification(`Erreur: ${error.message}`, 'error');
  } finally {
    ui.buildModalConfirm.disabled = false;
    ui.buildModalConfirm.textContent = 'Confirmer';
  }
}

function drawMap() {
  if (!canvas || !ctx) return;

  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  const cellSize = canvas.width / 20;

  ctx.fillStyle = 'rgba(102, 126, 234, 0.1)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(102, 126, 234, 0.2)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 20; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellSize, 0);
    ctx.lineTo(i * cellSize, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * cellSize);
    ctx.lineTo(canvas.width, i * cellSize);
    ctx.stroke();
  }

  if (myspaceState.mySpace && myspaceState.mySpace.batiments) {
    myspaceState.mySpace.batiments.forEach(spaceBatiment => {
      const batiment = myspaceState.batiments.find(b => b.id === spaceBatiment.batimentId);
      if (!batiment) return;

      const x = spaceBatiment.coordX * cellSize;
      const y = spaceBatiment.coordY * cellSize;
      const width = (batiment.width || 1) * cellSize;
      const height = (batiment.height || 1) * cellSize;

      ctx.fillStyle = 'rgba(102, 126, 234, 0.6)';
      ctx.fillRect(x, y, width, height);

      ctx.strokeStyle = '#667eea';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(batiment.icon || '🏗️', x + width / 2, y + height / 2);
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const token = await window.BrainrotAuth?.waitUntilReady?.();
  if (!token) {
    window.location.href = '../index/index.html';
    return;
  }

  canvas = ui.canvas;
  if (canvas) {
    ctx = canvas.getContext('2d');
  }

  await loadBatiments();
  await getCurrentGold();
  await loadMySpace();

  ui.buildModalCancel.addEventListener('click', closeBuildModal);
  ui.buildModalClose.addEventListener('click', closeBuildModal);
  ui.buildModalOverlay.addEventListener('click', closeBuildModal);
  ui.buildModalConfirm.addEventListener('click', handleCreateBatiment);

  setInterval(async () => {
    await getCurrentGold();
    renderWallet();
    renderBatimentsShop();
  }, 5000);

  setInterval(async () => {
    await loadMySpace();
    drawMap();
  }, 5000);

  window.addEventListener('resize', drawMap);

  drawMap();
  renderWallet();
});