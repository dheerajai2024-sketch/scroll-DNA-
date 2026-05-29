/**
 * ==========================================
 * INSTAMIND CARDS - script.js (Frontend)
 * Admin Dashboard: View uploads + Manual card creation
 * ==========================================
 */

// ==========================================
// APP STATE
// ==========================================
const AppState = {
  currentPage: 'landing',
  soundEnabled: true,
  cards: [],
  uploadedFiles: [],
  streak: parseInt(localStorage.getItem('instamind_streak') || '0'),
  lastGenerated: localStorage.getItem('instamind_last_generated') || null,
  points: parseInt(localStorage.getItem('instamind_points') || '0'),
  generationInProgress: false,
  serverUrl: window.location.origin,
  adminToken: localStorage.getItem('instamind_admin_token') || null
};

// ==========================================
// AUDIO ENGINE
// ==========================================
const AudioEngine = {
  ctx: null,
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playTone(freq, type = 'sine', duration = 0.15, vol = 0.08) {
    if (!AppState.soundEnabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  },
  click() { this.playTone(800, 'sine', 0.08, 0.04); },
  hover() { this.playTone(600, 'sine', 0.06, 0.02); },
  success() {
    this.playTone(523, 'sine', 0.2, 0.08);
    setTimeout(() => this.playTone(659, 'sine', 0.2, 0.08), 100);
    setTimeout(() => this.playTone(784, 'sine', 0.3, 0.08), 200);
  },
  legendary() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      setTimeout(() => this.playTone(f, 'square', 0.4, 0.06), i * 120);
    });
  },
  error() { this.playTone(200, 'sawtooth', 0.3, 0.06); },
  flip() { this.playTone(440, 'triangle', 0.25, 0.05); }
};

// ==========================================
// DOM CACHE
// ==========================================
const DOM = {
  soundToggle: () => document.getElementById('soundToggle'),
  cardCount: () => document.getElementById('cardCount'),
  points: () => document.getElementById('points'),
  streak: () => document.getElementById('streak'),
  processingOverlay: () => document.getElementById('processingOverlay'),
  progressFill: () => document.getElementById('progressFill'),
  progressText: () => document.getElementById('progressText'),
  aiStatus: () => document.getElementById('aiStatus'),
  pages: {
    landing: () => document.getElementById('landingPage'),
    upload: () => document.getElementById('uploadPage'),
    collection: () => document.getElementById('collectionPage'),
    detail: () => document.getElementById('cardDetailPage'),
    admin: () => document.getElementById('adminPage')
  },
  ctaButton: () => document.getElementById('ctaButton'),
  viewCardsBtn: () => document.getElementById('viewCardsBtn'),
  dropZone: () => document.getElementById('dropZone'),
  fileInput: () => document.getElementById('fileInput'),
  fileList: () => document.getElementById('fileList'),
  fileCount: () => document.getElementById('fileCount'),
  uploadedFiles: () => document.getElementById('uploadedFiles'),
  generateBtn: () => document.getElementById('generateBtn'),
  clearBtn: () => document.getElementById('clearBtn'),
  cardsGrid: () => document.getElementById('cardsGrid'),
  totalCards: () => document.getElementById('totalCards'),
  legendaryCount: () => document.getElementById('legendaryCount'),
  totalPoints: () => document.getElementById('totalPoints'),
  filterButtons: () => document.querySelectorAll('.filter-btn'),
  cardDisplay: () => document.getElementById('cardDisplay'),
  cardDetailInfo: () => document.getElementById('cardDetailInfo'),
  shareCardBtn: () => document.getElementById('shareCardBtn'),
  downloadCardBtn: () => document.getElementById('downloadCardBtn'),
  rerollCardBtn: () => document.getElementById('rerollCardBtn'),
  statsDetail: () => document.getElementById('statsDetail'),
  navbarLogo: () => document.querySelector('.navbar-logo'),
  // Admin
  adminLogin: () => document.getElementById('adminLogin'),
  adminContent: () => document.getElementById('adminContent'),
  adminPassword: () => document.getElementById('adminPassword'),
  adminLoginBtn: () => document.getElementById('adminLoginBtn'),
  adminLogoutBtn: () => document.getElementById('adminLogoutBtn'),
  adminTabs: () => document.querySelectorAll('.admin-tab'),
  adminUploadsList: () => document.getElementById('adminUploadsList'),
  adminCardsList: () => document.getElementById('adminCardsList'),
  createCardBtn: () => document.getElementById('createCardBtn')
};

// ==========================================
// UTILITIES
// ==========================================
const Utils = {
  generateId() {
    return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  },
  randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  },
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },
  clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  },
  saveState() {
    localStorage.setItem('instamind_cards', JSON.stringify(AppState.cards));
    localStorage.setItem('instamind_points', AppState.points.toString());
    localStorage.setItem('instamind_streak', AppState.streak.toString());
    localStorage.setItem('instamind_last_generated', AppState.lastGenerated || '');
    localStorage.setItem('instamind_admin_token', AppState.adminToken || '');
  },
  loadState() {
    try {
      AppState.cards = JSON.parse(localStorage.getItem('instamind_cards') || '[]');
      AppState.adminToken = localStorage.getItem('instamind_admin_token') || null;
    } catch (e) {
      console.warn('State load failed', e);
    }
  },
  getRarity() {
    const roll = Math.random();
    if (roll < 0.01) return { type: 'legendary', weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)' };
    if (roll < 0.08) return { type: 'epic', weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)' };
    if (roll < 0.30) return { type: 'rare', weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)' };
    return { type: 'common', weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)' };
  },
  getGrade(score) {
    if (score >= 9.5) return 'SS';
    if (score >= 9.0) return 'S+';
    if (score >= 8.5) return 'S';
    if (score >= 8.0) return 'A+';
    if (score >= 7.0) return 'A';
    if (score >= 6.0) return 'B';
    if (score >= 5.0) return 'C';
    return 'D';
  },
  personalityNames: [
    'Algorithm Whisperer', 'Midnight Scroller', 'Aesthetic Hustler', 'Meme Lord',
    'Story Architect', 'Reel Addict', 'DM Slider', 'Filter Fanatic',
    'Hashtag Hunter', 'Influencer in Training', 'Content Machine', 'Vibe Curator',
    'Comment Section Hero', 'Like Collector', 'Trend Surfer', 'Pixel Perfectionist',
    'Social Butterfly', 'Ghost Liker', 'Caption Poet', 'Grid Strategist'
  ],
  getPersonalityName() {
    return this.personalityNames[Math.floor(Math.random() * this.personalityNames.length)];
  }
};

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
const Toast = {
  container: null,
  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px;
    `;
    document.body.appendChild(this.container);
  },
  show(message, type = 'info', duration = 3000) {
    if (!this.container) this.init();
    const el = document.createElement('div');
    const colors = {
      info: 'linear-gradient(135deg, #6366f1, #4f46e5)',
      success: 'linear-gradient(135deg, #10b981, #059669)',
      error: 'linear-gradient(135deg, #ef4444, #dc2626)',
      legendary: 'linear-gradient(135deg, #d97706, #f59e0b)'
    };
    el.style.cssText = `
      background: ${colors[type] || colors.info};
      color: white; padding: 1rem 1.5rem; border-radius: 12px;
      font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      max-width: 320px; word-break: break-word;
    `;
    el.textContent = message;
    this.container.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translateX(0)';
      AudioEngine.click();
    });
    setTimeout(() => {
      el.style.transform = 'translateX(120%)';
      setTimeout(() => el.remove(), 400);
    }, duration);
  }
};

// ==========================================
// CONFETTI ENGINE
// ==========================================
const Confetti = {
  fire(options = {}) {
    const {
      particleCount = 100,
      spread = 70,
      origin = { y: 0.6 },
      colors = ['#6366f1', '#ec4899', '#06b6d4', '#fbbf24', '#8b5cf6']
    } = options;

    for (let i = 0; i < particleCount; i++) {
      const p = document.createElement('div');
      const color = colors[Math.floor(Math.random() * colors.length)];
      const angle = Math.random() * spread - spread / 2;
      const velocity = 2 + Math.random() * 4;
      const x = Math.sin(angle * Math.PI / 180) * velocity * 50;
      const y = -Math.cos(angle * Math.PI / 180) * velocity * 50;
      const size = 6 + Math.random() * 8;
      const rotation = Math.random() * 360;

      p.style.cssText = `
        position: fixed; left: ${origin.x ? origin.x * 100 : 50}%; top: ${origin.y * 100}vh;
        width: ${size}px; height: ${size}px; background: ${color};
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        pointer-events: none; z-index: 10000;
        transform: rotate(${rotation}deg);
      `;
      document.body.appendChild(p);

      const duration = 1000 + Math.random() * 1500;
      p.animate([
        { transform: `translate(0,0) rotate(${rotation}deg)`, opacity: 1 },
        { transform: `translate(${x}px, ${y + 200}px) rotate(${rotation + 720}deg)`, opacity: 0 }
      ], { duration, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }).onfinish = () => p.remove();
    }
  }
};

// ==========================================
// NAVIGATION (SPA)
// ==========================================
const Navigation = {
  history: [],
  navigateTo(pageId, push = true) {
    if (AppState.generationInProgress && pageId !== 'detail') {
      Toast.show('Generation in progress... please wait!', 'info');
      return;
    }

    Object.values(DOM.pages).forEach(pageFn => {
      const page = pageFn();
      if (page) {
        page.classList.remove('active');
        page.style.display = 'none';
      }
    });

    const target = DOM.pages[pageId] ? DOM.pages[pageId]() : null;
    if (target) {
      target.style.display = 'block';
      requestAnimationFrame(() => target.classList.add('active'));
      AppState.currentPage = pageId;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (push) this.history.push(pageId);
      if (pageId === 'collection') Collection.render();
      if (pageId === 'landing') Landing.init();
      if (pageId === 'detail') CardDetail.render();
      if (pageId === 'admin') Admin.init();
      AudioEngine.click();
    }
  },
  back() {
    if (this.history.length > 1) {
      this.history.pop();
      this.navigateTo(this.history[this.history.length - 1], false);
    } else {
      this.navigateTo('landing');
    }
  }
};

// ==========================================
// LANDING PAGE
// ==========================================
const Landing = {
  init() {
    this.animateCounters();
  },
  animateCounters() {
    const stats = [
      { el: document.querySelector('.stats-section .stat-item:nth-child(1) h3'), target: 2400000 },
      { el: document.querySelector('.stats-section .stat-item:nth-child(2) h3'), target: 847000 },
      { el: document.querySelector('.stats-section .stat-item:nth-child(3) h3'), target: 156 },
      { el: document.querySelector('.stats-section .stat-item:nth-child(4) h3'), target: 2 }
    ];

    stats.forEach(({ el, target }) => {
      if (!el) return;
      let current = 0;
      const increment = target / 60;
      const format = (n) => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
        return n.toString();
      };
      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        el.textContent = format(Math.floor(current));
      }, 30);
    });
  }
};

// ==========================================
// FILE UPLOAD
// ==========================================
const Upload = {
  init() {
    const dz = DOM.dropZone();
    const fi = DOM.fileInput();
    if (!dz || !fi) return;

    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', (e) => this.handleFiles(e.target.files));

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      dz.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dz.addEventListener(evt, () => dz.classList.add('drag-over'));
    });
    ['dragleave', 'drop'].forEach(evt => {
      dz.addEventListener(evt, () => dz.classList.remove('drag-over'));
    });
    dz.addEventListener('drop', (e) => this.handleFiles(e.dataTransfer.files));

    const genBtn = DOM.generateBtn();
    if (genBtn) genBtn.addEventListener('click', () => this.startGeneration());

    const clearBtn = DOM.clearBtn();
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearFiles());

    this.updateGenerateButton();
  },

  handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => {
      const valid = f.type.startsWith('image/') || f.type.startsWith('video/');
      if (!valid) Toast.show(`Skipped ${f.name} - invalid type`, 'error');
      return valid;
    });

    if (AppState.uploadedFiles.length + files.length > 11) {
      Toast.show('Max 11 files allowed (1 homepage + 10 reels)', 'error');
      return;
    }

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        AppState.uploadedFiles.push({
          id: Utils.generateId(),
          name: file.name,
          size: file.size,
          type: file.type,
          data: e.target.result,
          rawFile: file
        });
        this.renderFileList();
        this.updateGenerateButton();
      };
      reader.readAsDataURL(file);
    });

    if (files.length > 0) {
      Toast.show(`${files.length} file(s) added`, 'success');
      AudioEngine.success();
    }
  },

  renderFileList() {
    const container = DOM.uploadedFiles();
    const list = DOM.fileList();
    const count = DOM.fileCount();
    if (!container || !list || !count) return;

    if (AppState.uploadedFiles.length === 0) {
      list.classList.add('hidden');
      return;
    }

    list.classList.remove('hidden');
    count.textContent = AppState.uploadedFiles.length;
    container.innerHTML = '';

    AppState.uploadedFiles.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      if (file.type.startsWith('image/')) {
        item.innerHTML = `<img src="${file.data}" class="file-item-preview" alt="">`;
      } else {
        item.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:2rem">🎬</div>`;
      }
      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-item-remove';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFile(idx);
      });
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  },

  removeFile(index) {
    AppState.uploadedFiles.splice(index, 1);
    this.renderFileList();
    this.updateGenerateButton();
    AudioEngine.click();
  },

  clearFiles() {
    AppState.uploadedFiles = [];
    const fi = DOM.fileInput();
    if (fi) fi.value = '';
    this.renderFileList();
    this.updateGenerateButton();
    Toast.show('All files cleared', 'info');
  },

  updateGenerateButton() {
    const btn = DOM.generateBtn();
    if (!btn) return;
    btn.disabled = AppState.uploadedFiles.length === 0;
  },

  async startGeneration() {
    if (AppState.uploadedFiles.length === 0) return;
    if (AppState.generationInProgress) return;

    const today = new Date().toDateString();
    const last = AppState.lastGenerated ? new Date(AppState.lastGenerated).toDateString() : null;
    if (last !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (last === yesterday) {
        AppState.streak++;
      } else {
        AppState.streak = 1;
      }
      AppState.lastGenerated = new Date().toISOString();
    }

    AppState.generationInProgress = true;
    const overlay = DOM.processingOverlay();
    if (overlay) overlay.classList.remove('hidden');

    AudioEngine.init();
    AudioEngine.flip();

    const steps = [
      { pct: 10, text: 'Uploading screenshots...', status: '📤 Uploading to AI server' },
      { pct: 25, text: 'Analyzing visual patterns...', status: '🔍 AI scanning feed aesthetics' },
      { pct: 40, text: 'Detecting personality traits...', status: '🧠 Groq LLM processing content' },
      { pct: 55, text: 'Calculating engagement scores...', status: '📊 Computing virality metrics' },
      { pct: 70, text: 'Determining card rarity...', status: '✨ Rolling for rarity...' },
      { pct: 85, text: 'Generating card artwork...', status: '🎨 Rendering trading card' },
      { pct: 100, text: 'Card ready!', status: '🎴 Your card is ready!' }
    ];

    let stepIndex = 0;
    const progressInterval = setInterval(() => {
      if (stepIndex < steps.length) {
        const step = steps[stepIndex];
        this.updateProgress(step.pct, step.text, step.status);
        if (step.pct === 70) AudioEngine.flip();
        stepIndex++;
      }
    }, 1200);

    let card = null;
    let usedFallback = false;

    try {
      const formData = new FormData();
      AppState.uploadedFiles.forEach(file => {
        if (file.rawFile) {
          formData.append('files', file.rawFile, file.name);
        }
      });

      const response = await fetch(`${AppState.serverUrl}/api/generate-card`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.card) {
        card = result.card;
        if (!card.id) card.id = Utils.generateId();
        if (!card.createdAt) card.createdAt = new Date().toISOString();
        if (!card.rarityData) {
          card.rarityData = {
            common: { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)' },
            rare: { weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)' },
            epic: { weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)' },
            legendary: { weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)' }
          }[card.rarity] || { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)' };
        }
      } else {
        throw new Error('Invalid response from server');
      }

    } catch (error) {
      console.error('API call failed:', error);
      Toast.show(`Server error: ${error.message}. Using fallback...`, 'error', 4000);
      usedFallback = true;
      await this.delay(1500);
      card = this.generateMockCard();
    }

    clearInterval(progressInterval);

    if (!card) {
      card = this.generateMockCard();
      usedFallback = true;
    }

    this.updateProgress(100, 'Card ready!', '🎴 Your card is ready!');
    await this.delay(500);

    AppState.cards.unshift(card);
    AppState.points += Math.floor(card.score * (card.rarityData?.weight || 1));

    Utils.saveState();
    this.updateNavStats();

    if (overlay) overlay.classList.add('hidden');
    AppState.generationInProgress = false;

    this.clearFiles();

    if (card.rarity === 'legendary') {
      AudioEngine.legendary();
      Confetti.fire({ particleCount: 150, origin: { y: 0.5 } });
      Toast.show(`🎉 LEGENDARY PULL! ${card.name} - ${card.grade}!`, 'legendary', 5000);
    } else if (card.rarity === 'epic') {
      AudioEngine.success();
      Confetti.fire({ particleCount: 60, colors: ['#8b5cf6', '#6366f1'] });
      Toast.show(`✨ EPIC! ${card.name} - ${card.grade}!`, 'success', 4000);
    } else {
      AudioEngine.success();
      Toast.show(`${usedFallback ? '🎲' : '🎴'} ${card.name} generated!`, 'success');
    }

    CardDetail.currentCard = card;
    Navigation.navigateTo('detail');
  },

  updateProgress(pct, text, status) {
    const fill = DOM.progressFill();
    const txt = DOM.progressText();
    const ai = DOM.aiStatus();
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = text;
    if (ai) ai.textContent = status;
  },

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  generateMockCard() {
    const rarityData = Utils.getRarity();
    const baseScore = Utils.randomBetween(5.0, 9.9);
    const rarityBonus = rarityData.type === 'legendary' ? 0.8 : rarityData.type === 'epic' ? 0.5 : rarityData.type === 'rare' ? 0.3 : 0;
    const score = Utils.clamp(baseScore + rarityBonus + (AppState.streak * 0.05), 5.0, 10.0);

    const stats = {
      creativity: Utils.randomInt(60, 99),
      engagement: Utils.randomInt(50, 99),
      consistency: Utils.randomInt(40, 99),
      virality: Utils.randomInt(45, 99),
      aesthetic: Utils.randomInt(55, 99),
      authenticity: Utils.randomInt(50, 99)
    };

    const name = Utils.getPersonalityName();
    const grade = Utils.getGrade(score);

    return {
      id: Utils.generateId(),
      name,
      rarity: rarityData.type,
      rarityData,
      score: parseFloat(score.toFixed(1)),
      grade,
      stats,
      description: this.generateDescription(name, rarityData.type, stats),
      createdAt: new Date().toISOString()
    };
  },

  generateDescription(name, rarity, stats) {
    const topStat = Object.entries(stats).sort((a, b) => b[1] - a[1])[0];
    const statNames = {
      creativity: 'creative vision',
      engagement: 'audience magnetism',
      consistency: 'posting discipline',
      virality: 'trend-setting power',
      aesthetic: 'visual curation',
      authenticity: 'genuine connection'
    };
    return `A ${rarity.toUpperCase()} card representing a user with exceptional ${statNames[topStat[0]]}. Their Instagram presence radiates ${name.toLowerCase()} energy, scoring highest in ${topStat[0]} at ${topStat[1]}%.`;
  },

  updateNavStats() {
    const cc = DOM.cardCount();
    const pts = DOM.points();
    const str = DOM.streak();
    if (cc) cc.textContent = AppState.cards.length;
    if (pts) pts.textContent = AppState.points.toLocaleString();
    if (str) str.textContent = AppState.streak;
  }
};

// ==========================================
// COLLECTION
// ==========================================
const Collection = {
  currentFilter: 'all',

  init() {
    DOM.filterButtons().forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.filterButtons().forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.render();
        AudioEngine.click();
      });
    });
  },

  render() {
    const grid = DOM.cardsGrid();
    const total = DOM.totalCards();
    const legend = DOM.legendaryCount();
    const points = DOM.totalPoints();
    if (!grid) return;

    if (total) total.textContent = AppState.cards.length;
    if (legend) legend.textContent = AppState.cards.filter(c => c.rarity === 'legendary').length;
    if (points) points.textContent = AppState.points.toLocaleString();

    let cards = AppState.cards;
    if (this.currentFilter !== 'all') {
      cards = cards.filter(c => c.rarity === this.currentFilter);
    }

    if (cards.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <p style="font-size:3rem;margin-bottom:1rem">📭</p>
          <p>No ${this.currentFilter !== 'all' ? this.currentFilter : ''} cards yet.</p>
          <button class="cta-button primary" style="margin-top:1.5rem" onclick="Navigation.navigateTo('upload')">
            🎴 Generate Your First Card
          </button>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    cards.forEach((card, idx) => {
      const el = document.createElement('div');
      el.className = 'card-item';
      el.style.animationDelay = `${idx * 0.05}s`;
      el.innerHTML = `
        <div class="card-face card-${card.rarity}" style="background: ${card.rarityData?.color || card.color || 'linear-gradient(135deg, #4b5563, #2d3142)'}">
          <div class="card-face-content">
            <div class="card-rarity-badge">${card.rarity.toUpperCase()}</div>
            <div class="card-title">${card.name}</div>
            <div class="card-score">⭐ ${card.score} | ${card.grade}</div>
          </div>
        </div>
      `;
      el.addEventListener('click', () => {
        CardDetail.currentCard = card;
        Navigation.navigateTo('detail');
      });
      el.addEventListener('mouseenter', () => AudioEngine.hover());
      grid.appendChild(el);
    });
  }
};

// ==========================================
// CARD DETAIL
// ==========================================
const CardDetail = {
  currentCard: null,

  init() {
    const shareBtn = DOM.shareCardBtn();
    const downloadBtn = DOM.downloadCardBtn();
    const rerollBtn = DOM.rerollCardBtn();

    if (shareBtn) shareBtn.addEventListener('click', () => this.share());
    if (downloadBtn) downloadBtn.addEventListener('click', () => this.download());
    if (rerollBtn) rerollBtn.addEventListener('click', () => this.reroll());
  },

  render() {
    const card = this.currentCard;
    if (!card) return;

    const display = DOM.cardDisplay();
    const info = DOM.cardDetailInfo();
    const stats = DOM.statsDetail();

    const bg = card.rarityData?.color || card.color || 'linear-gradient(135deg, #4b5563, #2d3142)';

    if (display) {
      display.innerHTML = `
        <div class="large-card" style="background: ${bg}; animation: cardEnter 0.6s ease-out">
          <div style="position:relative;z-index:2;height:100%;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="font-size:0.85rem;letter-spacing:2px;opacity:0.9">${card.rarity.toUpperCase()}</div>
              <div style="font-size:2rem;margin:1rem 0;font-weight:800">${card.name}</div>
            </div>
            <div>
              <div style="font-size:1.5rem;font-weight:700">⭐ ${card.score}</div>
              <div style="font-size:1.2rem;opacity:0.9">Grade: ${card.grade}</div>
              <div style="font-size:0.85rem;margin-top:0.5rem;opacity:0.7">${Utils.formatDate(card.createdAt)}</div>
            </div>
          </div>
        </div>
      `;
    }

    if (info) {
      info.innerHTML = `
        <h2>${card.name}</h2>
        <p>${card.description}</p>
        <div style="margin-top:1.5rem;display:flex;gap:1rem;flex-wrap:wrap">
          <span style="padding:0.5rem 1rem;background:rgba(255,255,255,0.1);border-radius:20px;font-size:0.9rem">🔥 Streak: ${AppState.streak}</span>
          <span style="padding:0.5rem 1rem;background:rgba(255,255,255,0.1);border-radius:20px;font-size:0.9rem">💎 ${card.rarityData?.weight || 1}x Multiplier</span>
        </div>
      `;
    }

    if (stats) {
      stats.innerHTML = Object.entries(card.stats || {}).map(([key, val]) => `
        <div class="stat-detail-item">
          <span>${key.charAt(0).toUpperCase() + key.slice(1)}</span>
          <span class="stat-detail-value">${val}%</span>
          <div style="width:100%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:0.5rem">
            <div style="width:${val}%;height:100%;background:var(--primary);border-radius:2px;transition:width 1s ease"></div>
          </div>
        </div>
      `).join('');
    }

    if (!document.getElementById('cardEnterStyle')) {
      const style = document.createElement('style');
      style.id = 'cardEnterStyle';
      style.textContent = `
        @keyframes cardEnter {
          from { transform: rotateY(-90deg) scale(0.8); opacity: 0; }
          to { transform: rotateY(0) scale(1); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  },

  share() {
    const card = this.currentCard;
    if (!card) return;
    const text = `I just pulled a ${card.rarity.toUpperCase()} "${card.name}" card on InstaMind! Score: ${card.score} | Grade: ${card.grade} 🎴✨`;

    if (navigator.share) {
      navigator.share({ title: 'InstaMind Card', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        Toast.show('Card details copied to clipboard!', 'success');
      });
    }
    AudioEngine.success();
  },

  download() {
    Toast.show('Download started... (Canvas export coming in v2)', 'info');
    AudioEngine.click();
  },

  reroll() {
    if (AppState.points < 50) {
      Toast.show('Need 50 points to re-roll!', 'error');
      AudioEngine.error();
      return;
    }
    AppState.points -= 50;
    Utils.saveState();
    Upload.updateNavStats();

    const newCard = Upload.generateMockCard();
    newCard.id = this.currentCard.id;
    const idx = AppState.cards.findIndex(c => c.id === newCard.id);
    if (idx !== -1) AppState.cards[idx] = newCard;
    this.currentCard = newCard;
    Utils.saveState();
    this.render();
    Toast.show('Card re-rolled!', 'success');
    AudioEngine.flip();
  }
};

// ==========================================
// ADMIN DASHBOARD
// ==========================================
const Admin = {
  currentTab: 'uploads',

  init() {
    const loginBtn = DOM.adminLoginBtn();
    const logoutBtn = DOM.adminLogoutBtn();
    const password = DOM.adminPassword();

    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.login());
    }
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout());
    }
    if (password) {
      password.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.login();
      });
    }

    // Tabs
    DOM.adminTabs().forEach(tab => {
      tab.addEventListener('click', () => {
        DOM.adminTabs().forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentTab = tab.dataset.tab;
        this.renderTab();
        AudioEngine.click();
      });
    });

    // Create card button
    const createBtn = DOM.createCardBtn();
    if (createBtn) {
      createBtn.addEventListener('click', () => this.createManualCard());
    }

    // Check if already logged in
    if (AppState.adminToken) {
      this.showContent();
      this.loadData();
    } else {
      this.showLogin();
    }
  },

  async login() {
    const pw = DOM.adminPassword();
    if (!pw) return;

    try {
      const response = await fetch(`${AppState.serverUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw.value })
      });

      const result = await response.json();

      if (result.success) {
        AppState.adminToken = result.token;
        Utils.saveState();
        this.showContent();
        this.loadData();
        Toast.show('Admin access granted', 'success');
        AudioEngine.success();
        pw.value = '';
      } else {
        Toast.show('Invalid password', 'error');
        AudioEngine.error();
      }
    } catch (e) {
      Toast.show('Server error', 'error');
      AudioEngine.error();
    }
  },

  logout() {
    AppState.adminToken = null;
    Utils.saveState();
    this.showLogin();
    Toast.show('Logged out', 'info');
  },

  showLogin() {
    const login = DOM.adminLogin();
    const content = DOM.adminContent();
    if (login) login.classList.remove('hidden');
    if (content) content.classList.add('hidden');
  },

  showContent() {
    const login = DOM.adminLogin();
    const content = DOM.adminContent();
    if (login) login.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  },

  async loadData() {
    await this.loadStats();
    this.renderTab();
  },

  async loadStats() {
    try {
      const response = await fetch(`${AppState.serverUrl}/api/admin/stats`, {
        headers: { 'x-admin-auth': AppState.adminToken }
      });
      const stats = await response.json();

      const elTotalUploads = document.getElementById('statTotalUploads');
      const elTotalCards = document.getElementById('statTotalCards');
      const elAICards = document.getElementById('statAICards');
      const elManualCards = document.getElementById('statManualCards');

      if (elTotalUploads) elTotalUploads.textContent = stats.totalUploads || 0;
      if (elTotalCards) elTotalCards.textContent = stats.totalCards || 0;
      if (elAICards) elAICards.textContent = stats.aiCards || 0;
      if (elManualCards) elManualCards.textContent = stats.manualCards || 0;
    } catch (e) {
      console.error('Stats load error:', e);
    }
  },

  renderTab() {
    // Hide all sections
    ['uploads', 'cards', 'create'].forEach(tab => {
      const el = document.getElementById(tab + 'Tab');
      if (el) {
        el.classList.toggle('active', tab === this.currentTab);
        el.classList.toggle('hidden', tab !== this.currentTab);
      }
    });

    if (this.currentTab === 'uploads') this.loadUploads();
    if (this.currentTab === 'cards') this.loadCards();
  },

  async loadUploads() {
    const container = DOM.adminUploadsList();
    if (!container) return;

    container.innerHTML = '<p style="color:var(--text-tertiary)">Loading uploads...</p>';

    try {
      const response = await fetch(`${AppState.serverUrl}/api/admin/uploads`, {
        headers: { 'x-admin-auth': AppState.adminToken }
      });
      const data = await response.json();

      if (!data.uploads || data.uploads.length === 0) {
        container.innerHTML = '<p style="color:var(--text-tertiary)">No uploads yet</p>';
        return;
      }

      container.innerHTML = '';
      data.uploads.forEach(upload => {
        const el = document.createElement('div');
        el.className = 'admin-upload-item';

        const imagesHtml = upload.files.map(f => 
          `<img src="${AppState.serverUrl}${f.url}" class="admin-upload-img" alt="" onclick="Admin.viewImage('${AppState.serverUrl}${f.url}')">`
        ).join('');

        const statusClass = upload.status === 'completed' ? 'status-completed' : 
                           upload.status === 'error' ? 'status-error' : 'status-processing';

        el.innerHTML = `
          <div class="admin-upload-images">${imagesHtml}</div>
          <div class="admin-upload-info">
            <h4>Upload #${upload.id}</h4>
            <div class="admin-upload-meta">
              <div>📅 ${Utils.formatDate(upload.timestamp)}</div>
              <div>📁 ${upload.files.length} files</div>
              ${upload.cardId ? `<div>🎴 Card: ${upload.cardId}</div>` : ''}
              ${upload.error ? `<div style="color:#ef4444">❌ ${upload.error}</div>` : ''}
            </div>
          </div>
          <div class="admin-upload-status ${statusClass}">${upload.status}</div>
        `;
        container.appendChild(el);
      });
    } catch (e) {
      container.innerHTML = '<p style="color:#ef4444">Error loading uploads</p>';
    }
  },

  async loadCards() {
    const container = DOM.adminCardsList();
    if (!container) return;

    container.innerHTML = '<p style="color:var(--text-tertiary)">Loading cards...</p>';

    try {
      const response = await fetch(`${AppState.serverUrl}/api/admin/cards`, {
        headers: { 'x-admin-auth': AppState.adminToken }
      });
      const data = await response.json();

      if (!data.cards || data.cards.length === 0) {
        container.innerHTML = '<p style="color:var(--text-tertiary)">No cards yet</p>';
        return;
      }

      container.innerHTML = '';
      data.cards.forEach(card => {
        const el = document.createElement('div');
        el.className = 'admin-card-item';

        const sourceClass = card.source === 'ai' ? 'source-ai' : 
                           card.source === 'manual' ? 'source-manual' : 'source-mock';

        el.innerHTML = `
          <div class="admin-card-preview" style="background: ${card.rarityData?.color || card.color || '#4b5563'}">
            ${card.name}
          </div>
          <div class="admin-card-info">
            <h4>${card.name}</h4>
            <div class="admin-card-meta">
              ${card.rarity.toUpperCase()} | ⭐ ${card.score} | ${card.grade}
            </div>
            <span class="admin-card-source ${sourceClass}">${card.source || 'unknown'}</span>
          </div>
          <div class="admin-card-actions">
            <button class="admin-btn admin-btn-delete" onclick="Admin.deleteCard('${card.id}')">Delete</button>
          </div>
        `;
        container.appendChild(el);
      });
    } catch (e) {
      container.innerHTML = '<p style="color:#ef4444">Error loading cards</p>';
    }
  },

  async createManualCard() {
    const name = document.getElementById('manualName').value.trim();
    const rarity = document.getElementById('manualRarity').value;
    const score = parseFloat(document.getElementById('manualScore').value);
    const grade = document.getElementById('manualGrade').value;
    const description = document.getElementById('manualDescription').value.trim();

    if (!name) {
      Toast.show('Card name required!', 'error');
      return;
    }

    const stats = {
      creativity: parseInt(document.getElementById('statCreativity').value) || 70,
      engagement: parseInt(document.getElementById('statEngagement').value) || 70,
      consistency: parseInt(document.getElementById('statConsistency').value) || 70,
      virality: parseInt(document.getElementById('statVirality').value) || 70,
      aesthetic: parseInt(document.getElementById('statAesthetic').value) || 70,
      authenticity: parseInt(document.getElementById('statAuthenticity').value) || 70
    };

    try {
      const response = await fetch(`${AppState.serverUrl}/api/admin/cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth': AppState.adminToken
        },
        body: JSON.stringify({ name, rarity, score, grade, stats, description })
      });

      const result = await response.json();

      if (result.success) {
        Toast.show(`Card "${name}" created!`, 'success');
        AudioEngine.success();

        // Clear form
        document.getElementById('manualName').value = '';
        document.getElementById('manualDescription').value = '';

        // Refresh
        this.loadStats();
        if (this.currentTab === 'cards') this.loadCards();
      } else {
        Toast.show(result.error || 'Failed to create card', 'error');
        AudioEngine.error();
      }
    } catch (e) {
      Toast.show('Server error', 'error');
      AudioEngine.error();
    }
  },

  async deleteCard(id) {
    if (!confirm('Delete this card?')) return;

    try {
      const response = await fetch(`${AppState.serverUrl}/api/admin/cards/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-auth': AppState.adminToken }
      });

      const result = await response.json();
      if (result.success) {
        Toast.show('Card deleted', 'success');
        this.loadCards();
        this.loadStats();
      }
    } catch (e) {
      Toast.show('Delete failed', 'error');
    }
  },

  viewImage(url) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
      <img src="${url}" alt="">
      <button class="image-modal-close">&times;</button>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('image-modal-close')) {
        modal.remove();
      }
    });
    document.body.appendChild(modal);
  }
};

window.Admin = Admin;

// ==========================================
// SCROLL ANIMATIONS
// ==========================================
const ScrollAnimations = {
  observer: null,
  init() {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.viral-card, .feature-item, .stat-item, .mini-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      this.observer.observe(el);
    });
  }
};

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
const Keyboard = {
  init() {
    document.addEventListener('keydown', (e) => {
      // Admin shortcut: Shift+A
      if (e.shiftKey && e.key === 'A') {
        e.preventDefault();
        Navigation.navigateTo('admin');
        return;
      }

      if (e.key === 'Escape') {
        if (!DOM.processingOverlay().classList.contains('hidden')) return;
        if (AppState.currentPage === 'detail') Navigation.back();
        else if (AppState.currentPage === 'upload') Navigation.navigateTo('landing');
        else if (AppState.currentPage === 'collection') Navigation.navigateTo('landing');
        else if (AppState.currentPage === 'admin') Navigation.navigateTo('landing');
      }
      if (e.key === ' ' && AppState.currentPage === 'upload') {
        e.preventDefault();
        const btn = DOM.generateBtn();
        if (btn && !btn.disabled) Upload.startGeneration();
      }
      if (e.key === '1' && AppState.currentPage !== 'landing') Navigation.navigateTo('landing');
      if (e.key === '2' && AppState.currentPage !== 'upload') Navigation.navigateTo('upload');
      if (e.key === '3' && AppState.currentPage !== 'collection') Navigation.navigateTo('collection');
    });
  }
};

// ==========================================
// GLOBAL INIT
// ==========================================
function init() {
  Utils.loadState();
  AudioEngine.init();

  // Sound toggle
  const st = DOM.soundToggle();
  if (st) {
    st.addEventListener('click', () => {
      AppState.soundEnabled = !AppState.soundEnabled;
      st.textContent = AppState.soundEnabled ? '🔊' : '🔇';
      AudioEngine.click();
    });
    st.textContent = AppState.soundEnabled ? '🔊' : '🔇';
  }

  // Navbar logo click -> home
  const logo = DOM.navbarLogo();
  if (logo) {
    logo.addEventListener('click', () => Navigation.navigateTo('landing'));
    logo.addEventListener('mouseenter', () => AudioEngine.hover());
  }

  // Landing buttons
  const cta = DOM.ctaButton();
  if (cta) cta.addEventListener('click', () => Navigation.navigateTo('upload'));
  const view = DOM.viewCardsBtn();
  if (view) view.addEventListener('click', () => Navigation.navigateTo('collection'));

  // Init modules
  Upload.init();
  Collection.init();
  CardDetail.init();
  ScrollAnimations.init();
  Keyboard.init();

  // Initial render
  Upload.updateNavStats();

  // Start on landing
  Object.values(DOM.pages).forEach(p => {
    const el = p();
    if (el && el.id !== 'landingPage') {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  });

  // Parallax effect for hero
  document.addEventListener('mousemove', (e) => {
    const spheres = document.querySelectorAll('.glow-sphere');
    const x = (e.clientX / window.innerWidth - 0.5) * 20;
    const y = (e.clientY / window.innerHeight - 0.5) * 20;
    spheres.forEach((s, i) => {
      const factor = (i + 1) * 0.5;
      s.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
    });
  });
}

// ==========================================
// BOOT
// ==========================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.Navigation = Navigation;