/**
 * SCROLL DNA — script.js
 * Updated: bug fixes + 2-min timer + back buttons + improved admin UX
 * - Fixed Navigation inline-style conflicts
 * - Added 2-minute generation countdown timer
 * - Added beforeunload protection during generation
 * - Fixed admin login Enter key (event.key)
 * - Replaced annoying approve prompts with smooth Create Card hand-off
 * - Fixed legendary shimmer CSS selector bug
 */

'use strict';

// ============================================================
// STATE
// ============================================================
const State = {
  page: 'landing',
  sound: true,
  cards: [],
  files: [],
  profilePic: null,
  points: 0,
  streak: 0,
  lastGen: null,
  generating: false,
  adminToken: null,
  notifications: [],
  unreadNotifs: 0,
  sse: null,
  serverUrl: window.location.origin,

  load() {
    try {
      this.cards   = JSON.parse(localStorage.getItem('sdna_cards') || '[]');
      this.points  = parseInt(localStorage.getItem('sdna_points') || '0');
      this.streak  = parseInt(localStorage.getItem('sdna_streak') || '0');
      this.lastGen = localStorage.getItem('sdna_lastgen') || null;
      this.adminToken = localStorage.getItem('sdna_admin') || null;
      this.sound   = localStorage.getItem('sdna_sound') !== 'false';
    } catch(e) {}
  },
  save() {
    localStorage.setItem('sdna_cards', JSON.stringify(this.cards));
    localStorage.setItem('sdna_points', this.points);
    localStorage.setItem('sdna_streak', this.streak);
    localStorage.setItem('sdna_lastgen', this.lastGen || '');
    localStorage.setItem('sdna_admin', this.adminToken || '');
    localStorage.setItem('sdna_sound', this.sound);
  }
};

// ============================================================
// AUDIO
// ============================================================
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, type='sine', dur=0.15, vol=0.06) {
  if (!State.sound) return;
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch(e) {}
}
const SFX = {
  click:   () => playTone(800,'sine',0.08,0.04),
  hover:   () => playTone(600,'sine',0.06,0.02),
  success: () => { playTone(523,'sine',0.2,0.07); setTimeout(()=>playTone(659,'sine',0.2,0.07),100); setTimeout(()=>playTone(784,'sine',0.3,0.07),200); },
  legendary:()=> { [523,659,784,1047,1319].forEach((f,i)=>setTimeout(()=>playTone(f,'square',0.4,0.05),i*110)); },
  error:   () => playTone(200,'sawtooth',0.3,0.06),
  flip:    () => playTone(440,'triangle',0.25,0.05),
  notify:  () => { playTone(880,'sine',0.1,0.08); setTimeout(()=>playTone(1100,'sine',0.2,0.08),100); }
};

function toggleSound() {
  State.sound = !State.sound;
  State.save();
  const btn = document.getElementById('soundBtn');
  if (btn) btn.textContent = State.sound ? '🔊' : '🔇';
  if (State.sound) SFX.click();
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type='info', duration=3500) {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

// ============================================================
// CONFETTI
// ============================================================
function confetti(count=80, colors=['#7c6aff','#ff6b9d','#00d4ff','#f5a623','#22c55e']) {
  for (let i=0; i<count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    const color = colors[Math.floor(Math.random()*colors.length)];
    const size = 6 + Math.random()*8;
    const angle = Math.random()*360;
    const vx = (Math.random()-0.5)*200;
    const vy = -(100+Math.random()*200);
    el.style.cssText = `
      width:${size}px;height:${size}px;background:${color};
      left:${40+Math.random()*20}%;top:50%;
      border-radius:${Math.random()>0.5?'50%':'2px'};
      transform:rotate(${angle}deg);
    `;
    document.body.appendChild(el);
    el.animate([
      { transform:`translate(0,0) rotate(${angle}deg)`, opacity:1 },
      { transform:`translate(${vx}px,${vy}px) rotate(${angle+720}deg)`, opacity:0 }
    ], { duration:900+Math.random()*800, easing:'cubic-bezier(0.25,0.46,0.45,0.94)' }).onfinish = () => el.remove();
  }
}

// ============================================================
// UTILS
// ============================================================
const Util = {
  id: () => 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2,9),
  rand: (min,max) => Math.random()*(max-min)+min,
  randInt: (min,max) => Math.floor(Math.random()*(max-min+1))+min,
  clamp: (v,min,max) => Math.min(Math.max(v,min),max),
  fmtDate: d => new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}),

  getRarityData(rarity) {
    const map = {
      common:    { weight:1,   gradient:'linear-gradient(135deg,#4b5563,#2d3142)', border:'#6b7280', glow:'rgba(107,114,128,0.3)' },
      rare:      { weight:10,  gradient:'linear-gradient(135deg,#1e3a8a,#1e40af)', border:'#3b82f6', glow:'rgba(59,130,246,0.4)'  },
      epic:      { weight:25,  gradient:'linear-gradient(135deg,#4c1d95,#6b21a8)', border:'#a855f7', glow:'rgba(168,85,247,0.4)'  },
      legendary: { weight:100, gradient:'linear-gradient(135deg,#92400e,#b45309)', border:'#f59e0b', glow:'rgba(245,158,11,0.5)'  }
    };
    return map[rarity] || map.common;
  },

  rollRarity() {
    const r = Math.random();
    if (r<0.01)  return 'legendary';
    if (r<0.08)  return 'epic';
    if (r<0.30)  return 'rare';
    return 'common';
  },

  getGrade(score) {
    if (score>=9.8) return 'SS';
    if (score>=9.5) return 'S+';
    if (score>=9.0) return 'S';
    if (score>=8.5) return 'A+';
    if (score>=8.0) return 'A';
    if (score>=7.0) return 'B';
    if (score>=6.0) return 'C';
    return 'D';
  },

  names: [
    'Algorithm Whisperer','Midnight Scroller','Aesthetic Hustler','Meme Lord',
    'Story Architect','Reel Addict','DM Slider','Filter Fanatic',
    'Hashtag Hunter','Influencer In Training','Content Machine','Vibe Curator',
    'Comment Section Hero','Like Collector','Trend Surfer','Grid Strategist',
    'Ghost Liker','Caption Poet','Pixel Perfectionist','Social Butterfly'
  ],
  randName: () => Util.names[Math.floor(Math.random()*Util.names.length)],

  mockCard(overrides={}) {
    const rarity = Util.rollRarity();
    const rd = Util.getRarityData(rarity);
    const bonus = {legendary:0.8,epic:0.5,rare:0.3,common:0}[rarity];
    const score = Util.clamp(Util.rand(5.5,9.0)+bonus, 5.0, 10.0);
    const stats = {
      creativity:  Util.randInt(55,99),
      engagement:  Util.randInt(45,99),
      consistency: Util.randInt(40,99),
      virality:    Util.randInt(45,99),
      aesthetic:   Util.randInt(50,99),
      authenticity:Util.randInt(45,99)
    };
    const name = Util.randName();
    return {
      id: Util.id(),
      name, rarity,
      rarityData: rd,
      score: parseFloat(score.toFixed(1)),
      grade: Util.getGrade(score),
      stats,
      description: `A ${rarity.toUpperCase()} DNA card representing exceptional ${Object.entries(stats).sort((a,b)=>b[1]-a[1])[0][0]} energy.`,
      createdAt: new Date().toISOString(),
      username: document.getElementById('inUsername')?.value || 'Anonymous',
      profileLink: document.getElementById('inLink')?.value || '',
      profilePicUrl: State.profilePic?.data || null,
      source: 'mock',
      ...overrides
    };
  }
};

// ============================================================
// NAV STATS
// ============================================================
function updateNavStats() {
  const cc = document.getElementById('statCards');
  const pp = document.getElementById('statPts');
  const ss = document.getElementById('statStreak');
  if (cc) cc.textContent = State.cards.length;
  if (pp) pp.textContent = State.points.toLocaleString();
  if (ss) ss.textContent = State.streak;
}

// ============================================================
// NAVIGATION  (FIXED: no inline styles, pure CSS class toggling)
// ============================================================
const Navigation = {
  go(pageId) {
    if (State.generating && pageId !== 'detail') {
      toast('Generation in progress — please wait', 'info'); return;
    }
    document.querySelectorAll('.page').forEach(p => {
      p.classList.remove('active');
      p.classList.add('hidden');
    });
    const target = document.getElementById('pg-' + pageId);
    if (!target) return;
    target.classList.remove('hidden');
    requestAnimationFrame(() => target.classList.add('active'));
    State.page = pageId;
    window.scrollTo({ top:0, behavior:'smooth' });
    SFX.click();

    if (pageId === 'landing')    Landing.init();
    if (pageId === 'collection') Collection.render();
    if (pageId === 'detail')     Detail.render();
    if (pageId === 'admin')      Admin.init();
  }
};
window.Navigation = Navigation;

// ============================================================
// LANDING
// ============================================================
const Landing = {
  countersRan: false,
  init() {
    if (!this.countersRan) { this.animateCounters(); this.countersRan = true; }
  },
  animateCounters() {
    document.querySelectorAll('.sb-num').forEach(el => {
      const target = parseInt(el.dataset.target || '0');
      const duration = 1800;
      const start = performance.now();
      const fmt = n => n>=1000000 ? (n/1000000).toFixed(1)+'M' : n>=1000 ? Math.round(n/1000)+'K' : n.toString();
      const tick = (now) => {
        const t = Math.min(1, (now-start)/duration);
        const ease = 1-Math.pow(1-t,3);
        el.textContent = fmt(Math.floor(ease*target));
        if (t<1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
};

// ============================================================
// PROFILE PIC
// ============================================================
const PicUpload = {
  init() {
    const input = document.getElementById('picInput');
    if (!input) return;
    input.addEventListener('change', e => this.handle(e.target.files[0]));
  },
  handle(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Please upload an image','error'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      State.profilePic = { data: e.target.result, file };
      const preview = document.getElementById('picPreview');
      if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      toast('Profile picture added!','success');
      SFX.success();
    };
    reader.readAsDataURL(file);
  }
};

// ============================================================
// FILE UPLOAD
// ============================================================
const Upload = {
  genTimer: null,
  genTimeLeft: 120,

  init() {
    const dz = document.getElementById('dropZone');
    const fi = document.getElementById('fileInput');
    if (!dz || !fi) return;

    fi.addEventListener('change', e => this.handleFiles(e.target.files));

    ['dragenter','dragover','dragleave','drop'].forEach(ev => {
      dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, () => dz.classList.add('drag-over')));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag-over')));
    dz.addEventListener('drop', e => this.handleFiles(e.dataTransfer.files));
  },

  startTimer() {
    this.genTimeLeft = 120;
    const el = document.getElementById('timerDisplay');
    if (el) el.classList.remove('hidden');
    const tick = () => {
      const m = Math.floor(this.genTimeLeft / 60);
      const s = this.genTimeLeft % 60;
      const text = this.genTimeLeft < 0 ? '⏱ Finalizing...' : `⏱ ${m}:${s.toString().padStart(2,'0')} remaining`;
      if (el) el.textContent = text;
      this.genTimeLeft--;
    };
    tick();
    this.genTimer = setInterval(tick, 1000);
  },

  stopTimer() {
    if (this.genTimer) { clearInterval(this.genTimer); this.genTimer = null; }
    const el = document.getElementById('timerDisplay');
    if (el) { el.classList.add('hidden'); el.textContent = '⏱ 2:00 remaining'; }
  },

  handleFiles(fileList) {
    const valid = Array.from(fileList).filter(f => {
      const ok = f.type.startsWith('image/') || f.type.startsWith('video/');
      if (!ok) toast(`Skipped ${f.name} — unsupported type`, 'error');
      return ok;
    });
    if (State.files.length + valid.length > 11) {
      toast('Max 11 files allowed','error'); return;
    }
    let loaded = 0;
    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        State.files.push({ id: Util.id(), name: file.name, type: file.type, data: e.target.result, file });
        loaded++;
        if (loaded === valid.length) { this.renderList(); this.updateBtn(); }
      };
      reader.readAsDataURL(file);
    });
    if (valid.length) { toast(`${valid.length} file(s) added`, 'success'); SFX.success(); }
  },

  renderList() {
    const wrap = document.getElementById('fileListWrap');
    const grid = document.getElementById('fileGrid');
    const count = document.getElementById('fileCount');
    if (!wrap || !grid) return;

    if (State.files.length === 0) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    if (count) count.textContent = State.files.length;

    grid.innerHTML = '';
    State.files.forEach((f, idx) => {
      const div = document.createElement('div');
      div.className = 'file-thumb';
      if (f.type.startsWith('image/')) {
        div.innerHTML = `<img src="${f.data}" alt="">`;
      } else {
        div.innerHTML = `<div class="video-thumb">🎬</div>`;
      }
      const rm = document.createElement('button');
      rm.className = 'remove-btn';
      rm.textContent = '×';
      rm.onclick = e => { e.stopPropagation(); State.files.splice(idx,1); this.renderList(); this.updateBtn(); SFX.click(); };
      div.appendChild(rm);
      grid.appendChild(div);
    });
  },

  updateBtn() {
    const btn = document.getElementById('generateBtn');
    if (btn) btn.disabled = State.files.length === 0;
  },

  clear() {
    State.files = [];
    State.profilePic = null;
    const fi = document.getElementById('fileInput');
    const pi = document.getElementById('picInput');
    if (fi) fi.value = '';
    if (pi) pi.value = '';
    const prev = document.getElementById('picPreview');
    if (prev) prev.innerHTML = '<span class="pic-placeholder-icon">📷</span><span class="pic-placeholder-txt">Click to upload</span>';
    this.renderList();
    this.updateBtn();
    this.stopTimer();
    toast('Cleared','info');
  },

  async instant() {
    try {
      getAudio(); // unlock audio context
      const res = await fetch(`${State.serverUrl}/api/instant-card`, { method:'POST' });
      const data = await res.json();
      if (data.success && data.card) {
        this._receiveCard(data.card);
        return;
      }
    } catch(e) {}
    // Fallback
    const card = Util.mockCard({ source:'instant' });
    this._receiveCard(card);
  },

  _receiveCard(card) {
    if (!card.rarityData) card.rarityData = Util.getRarityData(card.rarity);
    State.cards.unshift(card);
    State.points += Math.floor(card.score * (card.rarityData.weight||1));
    State.save();
    updateNavStats();
    Detail.currentCard = card;
    if (card.rarity==='legendary') {
      SFX.legendary();
      confetti(150);
      toast(`👑 LEGENDARY! ${card.name} — ${card.grade}!`, 'legendary', 5000);
    } else if (card.rarity==='epic') {
      SFX.success();
      confetti(60,['#a855f7','#7c6aff','#ff6b9d']);
      toast(`✨ EPIC! ${card.name} — ${card.grade}!`, 'success', 4000);
    } else {
      SFX.success();
      toast(`🧬 ${card.name} — ${card.grade}!`, 'success');
    }
    Navigation.go('detail');
  },

  async start() {
    if (State.generating || State.files.length === 0) return;
    getAudio();

    // Streak logic
    const today = new Date().toDateString();
    const last = State.lastGen ? new Date(State.lastGen).toDateString() : null;
    if (last !== today) {
      const yest = new Date(Date.now()-86400000).toDateString();
      State.streak = (last === yest) ? State.streak+1 : 1;
      State.lastGen = new Date().toISOString();
    }

    State.generating = true;
    window.onbeforeunload = () => 'Your DNA card is still generating. Are you sure you want to leave?';

    const overlay = document.getElementById('overlay');
    const queueMsg = document.getElementById('queueMsg');
    if (overlay) overlay.classList.remove('hidden');
    if (queueMsg) queueMsg.classList.add('hidden');
    SFX.flip();
    this.startTimer();

    const steps = [
      [10,  'Uploading screenshots…',      '📤 Sending to DNA Lab'],
      [25,  'Analyzing visual patterns…',  '🔍 AI scanning your feed'],
      [40,  'Detecting personality…',      '🧬 Sequencing social genome'],
      [55,  'Scoring engagement…',         '📊 Computing virality metrics'],
      [70,  'Rolling for rarity…',         '✨ Determining card rarity'],
      [85,  'Rendering trading card…',     '🎨 Generating premium card'],
      [100, 'Card ready!',                 '🧬 Your DNA card is ready!'],
    ];
    let si = 0;
    const prog = setInterval(() => {
      if (si < steps.length) {
        const [pct, label, status] = steps[si++];
        this._setProgress(pct, label, status);
        if (pct === 70) SFX.flip();
      }
    }, 1100);

    let card = null;
    try {
      const fd = new FormData();
      State.files.forEach(f => { if (f.file) fd.append('files', f.file, f.name); });
      if (State.profilePic?.file) fd.append('profilePic', State.profilePic.file, 'profile.jpg');
      fd.append('username', document.getElementById('inUsername')?.value?.trim() || 'Anonymous');
      fd.append('profileLink', document.getElementById('inLink')?.value?.trim() || '');

      const res = await fetch(`${State.serverUrl}/api/generate-card`, { method:'POST', body:fd });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();

      if (data.queued) {
        clearInterval(prog);
        this._setProgress(50,'In review queue…','👨‍🔬 Admin is crafting your card');
        if (queueMsg) queueMsg.classList.remove('hidden');
        await delay(3000);
        if (overlay) overlay.classList.add('hidden');
        State.generating = false;
        window.onbeforeunload = null;
        this.stopTimer();
        toast('⏳ Your card is in the expert queue! Check back soon.','info',5000);
        this.clear();
        return;
      }

      if (data.success && data.card) {
        card = data.card;
        if (!card.rarityData) card.rarityData = Util.getRarityData(card.rarity);
      } else {
        throw new Error('Invalid response');
      }
    } catch(err) {
      toast(`AI error — using fallback card`, 'error', 3000);
      card = Util.mockCard();
    }

    clearInterval(prog);
    this._setProgress(100, 'Card ready!', '🧬 Your DNA card is ready!');
    await delay(600);
    if (overlay) overlay.classList.add('hidden');
    State.generating = false;
    window.onbeforeunload = null;
    this.stopTimer();
    this.clear();
    this._receiveCard(card);
  },

  _setProgress(pct, label, status) {
    const bar = document.getElementById('progBar');
    const lbl = document.getElementById('progLabel');
    const ai  = document.getElementById('aiLabel');
    if (bar) bar.style.width = pct+'%';
    if (lbl) lbl.textContent = label;
    if (ai)  ai.textContent  = status;
  }
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// COLLECTION
// ============================================================
const Collection = {
  activeFilter: 'all',

  filter(btn, f) {
    document.querySelectorAll('.fb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.activeFilter = f;
    this.render();
    SFX.click();
  },

  render() {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return;

    // update header stats
    const t = document.getElementById('colTotal');
    const l = document.getElementById('colLegend');
    const p = document.getElementById('colPts');
    if (t) t.textContent = State.cards.length;
    if (l) l.textContent = State.cards.filter(c=>c.rarity==='legendary').length;
    if (p) p.textContent = State.points.toLocaleString();

    let cards = State.cards;
    if (this.activeFilter !== 'all') cards = cards.filter(c => c.rarity === this.activeFilter);

    if (cards.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <p style="font-size:3rem;margin-bottom:0.75rem">📭</p>
          <p>No ${this.activeFilter !== 'all' ? this.activeFilter+' ' : ''}DNA cards yet.</p>
          <button class="btn-primary" style="margin-top:1.5rem" onclick="Navigation.go('upload')">🧬 Generate Your First Card</button>
        </div>`;
      return;
    }

    grid.innerHTML = '';
    cards.forEach((card, i) => {
      const rd = card.rarityData || Util.getRarityData(card.rarity);
      const el = document.createElement('div');
      el.className = `col-card ${card.rarity}`;
      el.style.animationDelay = `${i*0.04}s`;

      const picHtml = card.profilePicUrl
        ? `<div class="card-avatar"><img src="${card.profilePicUrl}" alt=""></div>`
        : `<div class="card-avatar"><div class="avatar-placeholder">👤</div></div>`;

      el.innerHTML = `
        <div class="card-bg" style="background:${rd.gradient}">
          <div class="card-rarity-strip">${card.rarity.toUpperCase()}</div>
          ${picHtml}
        </div>
        <div class="card-body">
          <div class="card-name-txt">${card.name}</div>
          <div class="card-user-txt">@${card.username||'anonymous'}</div>
          <div class="card-score-txt">
            <span>⭐ ${card.score}</span>
            <span class="card-grade-badge">${card.grade}</span>
          </div>
        </div>`;

      el.addEventListener('click', () => { Detail.currentCard = card; Navigation.go('detail'); SFX.flip(); });
      el.addEventListener('mouseenter', () => SFX.hover());
      grid.appendChild(el);
    });
  }
};
window.Collection = Collection;

// ============================================================
// CARD DETAIL
// ============================================================
const Detail = {
  currentCard: null,

  render() {
    const card = this.currentCard;
    if (!card) return;
    const rd = card.rarityData || Util.getRarityData(card.rarity);

    // HORIZONTAL TRADING CARD - Sports card style
    const canvas = document.getElementById('cardCanvas');
    const r = 2 * Math.PI * 32;
    const offset = r * (1 - card.score / 10);

    const avatarHtml = card.profilePicUrl
      ? `<div class="tc-left-avatar"><img src="${card.profilePicUrl}" alt=""></div>`
      : `<div class="tc-left-avatar"><div class="tc-left-avatar-placeholder">👤</div></div>`;

    // Build all 6 stats as horizontal bars
    const statsEntries = Object.entries(card.stats || {});
    const statsTableHtml = statsEntries.map(([key, val]) => `
      <div class="tc-stat-row">
        <span class="tc-stat-label">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
        <div class="tc-stat-track">
          <div class="tc-stat-fill" style="width:${val}%"></div>
        </div>
        <span class="tc-stat-num">${val}</span>
      </div>
    `).join('');

    const serial = card.id ? card.id.slice(-8).toUpperCase() : '00000000';
    const dateStr = new Date(card.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (canvas) {
      canvas.innerHTML = `
        <div class="trading-card" id="tradingCard" style="background:${rd.gradient};border-color:${rd.border};box-shadow:0 0 0 5px rgba(255,255,255,0.1),0 0 0 10px rgba(255,255,255,0.05),0 25px 80px ${rd.glow || 'rgba(0,0,0,0.8)'},0 0 50px ${rd.glow || 'rgba(124,106,255,0.2)'}">
          <div class="tc-corner tl"></div>
          <div class="tc-corner tr"></div>
          <div class="tc-corner bl"></div>
          <div class="tc-corner br"></div>

          <!-- LEFT SIDE -->
          <div class="tc-left">
            ${avatarHtml}
            <div class="tc-left-score-ring">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="6"/>
                <circle cx="50" cy="50" r="32" fill="none" stroke="white" stroke-width="6"
                  stroke-dasharray="${r}" stroke-dashoffset="${r}"
                  stroke-linecap="round" id="scoreRing"/>
              </svg>
              <div class="tc-left-score-val">${card.score}</div>
            </div>
            <div class="tc-left-rarity">${card.rarity.toUpperCase()}</div>
            <div class="tc-left-grade">${card.grade}</div>
          </div>

          <!-- RIGHT SIDE -->
          <div class="tc-right">
            <div class="tc-right-header">
              <div class="tc-right-name">${card.name}</div>
              <div class="tc-right-user">@${card.username || 'anonymous'}</div>
            </div>

            <div class="tc-right-desc">${card.description || `A ${card.rarity} DNA card with exceptional social media presence.`}</div>

            <div class="tc-stats-table">
              ${statsTableHtml}
            </div>

            <div class="tc-right-footer">
              <span class="tc-footer-badge">🔥 STREAK ${State.streak}</span>
              <span class="tc-footer-badge">💎 ${rd.weight}× MULTIPLIER</span>
              <span class="tc-footer-badge">📅 ${dateStr}</span>
              <span class="tc-footer-badge">🤖 ${(card.source || 'mock').toUpperCase()}</span>
            </div>
          </div>

          <div class="tc-watermark">⬡ SCROLL DNA</div>
          <div class="tc-serial">#${serial}</div>
        </div>`;

      // Animate ring
      setTimeout(() => {
        const ring = document.getElementById('scoreRing');
        if (ring) ring.style.strokeDashoffset = offset;
      }, 100);
    }

    // Detail info panel (below card on page)
    const info = document.getElementById('detailInfo');
    if (info) {
      info.innerHTML = `
        <h2>${card.name}</h2>
        <p>${card.description || ''}</p>
        ${card.profileLink ? `<a href="${card.profileLink}" target="_blank" class="profile-link">🔗 ${card.profileLink}</a>` : ''}
        <div class="detail-badges">
          <span class="detail-badge">🔥 Streak: ${State.streak}</span>
          <span class="detail-badge">💎 ${rd.weight}× Multiplier</span>
          <span class="detail-badge">📅 ${Util.fmtDate(card.createdAt)}</span>
          ${card.source ? `<span class="detail-badge">🤖 ${card.source}</span>` : ''}
        </div>`;
    }

    // Stats breakdown panel (full bars below card)
    const sg = document.getElementById('statsGrid');
    if (sg) {
      sg.innerHTML = statsEntries.map(([key,val]) => `
        <div class="stat-row">
          <div class="stat-row-top">
            <span class="stat-row-name">${key.charAt(0).toUpperCase()+key.slice(1)}</span>
            <span class="stat-row-val">${val}%</span>
          </div>
          <div class="stat-bar-track">
            <div class="stat-bar-fill" data-val="${val}" style="width:0%"></div>
          </div>
        </div>`).join('');

      setTimeout(() => {
        sg.querySelectorAll('.stat-bar-fill').forEach(b => {
          b.style.width = b.dataset.val + '%';
        });
      }, 200);
    }
  },

  share() {
    const card = this.currentCard;
    if (!card) return;
    const text = `I just got a ${card.rarity.toUpperCase()} "${card.name}" DNA card on Scroll DNA! Score: ${card.score} | Grade: ${card.grade} 🧬`;
    if (navigator.share) {
      navigator.share({ title:'Scroll DNA Card', text }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(text)
        .then(() => toast('Copied to clipboard! 📋','success'))
        .catch(() => toast('Share text: '+text,'info',6000));
    }
    SFX.success();
  },

  async download() {
    const card = this.currentCard;
    if (!card) return;
    try {
      const tc = document.getElementById('tradingCard');
      if (!tc) throw new Error('no card');

      // Load html2canvas dynamically
      if (!window.html2canvas) {
        await new Promise((res,rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      toast('Capturing card…','info',2000);

      // Create a wrapper with light background for visibility
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        position: fixed; top: -9999px; left: -9999px;
        width: 700px; height: 450px;
        background: linear-gradient(135deg, #f0f0f5 0%, #e8e8f0 50%, #dddde8 100%);
        display: flex; align-items: center; justify-content: center;
        padding: 50px;
        border-radius: 24px;
      `;

      // Clone the card into the wrapper
      const clone = tc.cloneNode(true);
      clone.style.transform = 'none';
      clone.style.boxShadow = '0 0 0 5px rgba(255,255,255,0.9), 0 0 0 10px rgba(0,0,0,0.1), 0 30px 100px rgba(0,0,0,0.4)';
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      const canvas = await window.html2canvas(wrapper, { 
        backgroundColor: null, 
        scale: 3, 
        useCORS: true,
        logging: false,
        width: 700,
        height: 450
      });

      document.body.removeChild(wrapper);

      const link = document.createElement('a');
      link.download = `scroll-dna-${card.name.replace(/\s+/g,'-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('Card downloaded! 📥','success');
      SFX.success();
    } catch(e) {
      // Fallback: download as JSON data
      const data = JSON.stringify(card, null, 2);
      const blob = new Blob([data],{type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `scroll-dna-card-${card.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Card data downloaded 📥','success');
    }
  },

  reroll() {
    if (State.points < 50) { toast('Need 50 points to re-roll!','error'); SFX.error(); return; }
    State.points -= 50;
    const newCard = Util.mockCard({
      id: this.currentCard?.id,
      username: this.currentCard?.username,
      profileLink: this.currentCard?.profileLink,
      profilePicUrl: this.currentCard?.profilePicUrl
    });
    const idx = State.cards.findIndex(c => c.id === this.currentCard?.id);
    if (idx !== -1) State.cards[idx] = newCard;
    this.currentCard = newCard;
    State.save();
    updateNavStats();
    this.render();
    toast('Card re-rolled! 🔄','success');
    SFX.flip();
  }
};
window.Detail = Detail;

// ============================================================
// ADMIN  (IMPROVED: no prompt spam, smooth Create Card hand-off)
// ============================================================
const Admin = {
  activeTab: 'pending',
  sse: null,
  pendingUploadId: null,

  init() {
    if (State.adminToken) { this.showContent(); this.loadAll(); this.connectSSE(); }
    else this.showLogin();
  },

  async login() {
    const pw = document.getElementById('adminPw');
    if (!pw) return;
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/login`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({password:pw.value})
      });
      const data = await res.json();
      if (data.success) {
        State.adminToken = data.token;
        State.save();
        pw.value = '';
        this.showContent();
        this.loadAll();
        this.connectSSE();
        toast('Admin access granted','success');
        SFX.success();
      } else {
        toast('Invalid password','error'); SFX.error();
      }
    } catch(e) { toast('Server error','error'); SFX.error(); }
  },

  logout() {
    State.adminToken = null;
    State.save();
    if (this.sse) { this.sse.close(); this.sse = null; }
    this.showLogin();
    toast('Logged out','info');
  },

  showLogin() {
    const l = document.getElementById('adminLogin');
    const c = document.getElementById('adminContent');
    if (l) l.style.display = 'block';
    if (c) c.classList.add('hidden');
  },

  showContent() {
    const l = document.getElementById('adminLogin');
    const c = document.getElementById('adminContent');
    if (l) l.style.display = 'none';
    if (c) c.classList.remove('hidden');
  },

  connectSSE() {
    if (this.sse) this.sse.close();
    try {
      this.sse = new EventSource(`${State.serverUrl}/api/admin/stream`);
      this.sse.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === 'connected') return;
          State.notifications.unshift(d);
          State.unreadNotifs++;
          this.updateBell();
          if (Notification.permission === 'granted') new Notification('Scroll DNA',{body:d.message});
          SFX.notify();
          toast(d.message,'notify',4000);
          if (['new_upload','pending_added'].includes(d.type)) { this.loadStats(); this.loadPending(); }
          if (['card_generated','manual_approved'].includes(d.type)) { this.loadStats(); this.loadCards(); }
        } catch(err){}
      };
      this.sse.onerror = () => setTimeout(()=>this.connectSSE(), 5000);
    } catch(e){}
  },

  updateBell() {
    const badge = document.getElementById('bellCount');
    if (!badge) return;
    badge.textContent = State.unreadNotifs;
    badge.classList.toggle('hidden', State.unreadNotifs === 0);
  },

  clearNotifs() { State.unreadNotifs = 0; this.updateBell(); toast('Notifications cleared','info'); },

  async toggleOnline() {
    const btn = document.getElementById('onlineToggle');
    const isOnline = btn?.classList.contains('online');
    try {
      await fetch(`${State.serverUrl}/api/admin/status`,{
        method:'POST', headers:{'Content-Type':'application/json','x-admin-auth':State.adminToken},
        body: JSON.stringify({online:!isOnline})
      });
      if (btn) {
        btn.classList.toggle('online',!isOnline);
        btn.classList.toggle('offline',isOnline);
        btn.textContent = isOnline ? '⚪ Offline' : '🟢 Online';
      }
      toast(isOnline ? 'Admin offline — AI auto-generates' : 'Admin online — manual review enabled','info');
    } catch(e){}
  },

  async loadAll() {
    await this.loadStats();
    this.renderTab();
    if (Notification.permission === 'default') Notification.requestPermission();
  },

  async loadStats() {
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/stats`,{headers:{'x-admin-auth':State.adminToken}});
      const d = await res.json();
      const row = document.getElementById('adminStatRow');
      if (row) row.innerHTML = [
        ['Total Uploads', d.totalUploads||0],
        ['Total Cards', d.totalCards||0],
        ['Pending Review', d.pendingCount||0],
        ['AI Cards', d.aiCards||0],
      ].map(([lbl,val])=>`
        <div class="admin-stat-card">
          <span class="admin-stat-val">${val}</span>
          <span class="admin-stat-lbl">${lbl}</span>
        </div>`).join('');
    } catch(e){}
  },

  tab(btn, name) {
    document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.activeTab = name;
    this.renderTab();
    SFX.click();
  },

  renderTab() {
    ['pending','uploads','cards','create'].forEach(name => {
      const el = document.getElementById('tab-'+name);
      if (el) {
        el.classList.toggle('hidden', name !== this.activeTab);
        el.classList.toggle('active', name === this.activeTab);
      }
    });
    if (this.activeTab === 'pending') this.loadPending();
    if (this.activeTab === 'uploads') this.loadUploads();
    if (this.activeTab === 'cards')   this.loadCards();
  },

  async loadPending() {
    const wrap = document.getElementById('tab-pending');
    if (!wrap) return;
    wrap.innerHTML = '<p style="color:var(--text3);padding:1rem">Loading queue…</p>';
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/pending`,{headers:{'x-admin-auth':State.adminToken}});
      const d = await res.json();
      if (!d.pending?.length) {
        wrap.innerHTML = '<p style="color:var(--text3);padding:1rem">✅ No pending uploads — all caught up!</p>';
        return;
      }
      wrap.innerHTML = `<h3 style="margin-bottom:1rem;font-weight:600">Pending Review Queue (${d.pending.length})</h3><div class="pending-list"></div>`;
      const list = wrap.querySelector('.pending-list');
      d.pending.forEach(u => {
        const el = document.createElement('div');
        el.className = 'pending-item';
        const imgs = u.files.map(f=>`<img class="pending-img" src="${State.serverUrl}/uploads/${f.filename}" alt="">`).join('');
        const profileImg = u.profilePic ? `<img class="pending-profile-img" src="${State.serverUrl}${u.profilePic.url}" alt="">` : '';
        el.innerHTML = `
          <div class="pending-imgs">${profileImg}${imgs}</div>
          <div class="pending-info">
            <h4>${u.username||'Anonymous'} <span style="font-size:0.75rem;color:var(--text3)">#${u.id}</span></h4>
            <div class="pending-meta">
              📅 ${Util.fmtDate(u.timestamp)}<br>
              📁 ${u.files.length} file(s)
              ${u.profileLink ? `<br>🔗 <a href="${u.profileLink}" target="_blank">${u.profileLink}</a>` : ''}
            </div>
          </div>
          <div class="pending-acts">
            <button class="btn-approve" onclick="Admin.approve(${u.id})">✨ Create Card</button>
            <button class="btn-reject" onclick="Admin.reject(${u.id})">❌ Reject</button>
          </div>`;
        list.appendChild(el);
      });
    } catch(e) { wrap.innerHTML = '<p style="color:#ef4444;padding:1rem">Error loading queue</p>'; }
  },

  // IMPROVED: Instead of 7 prompts, hand off to Create Card tab with pre-filled data
  async approve(uploadId) {
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/pending`,{headers:{'x-admin-auth':State.adminToken}});
      const d = await res.json();
      const upload = d.pending.find(u => u.id == uploadId);
      if (!upload) { toast('Upload not found','error'); return; }

      this.pendingUploadId = uploadId;
      // Switch to Create tab (index 3)
      const createTabBtn = document.querySelectorAll('.atab')[3];
      this.tab(createTabBtn, 'create');

      document.getElementById('c-name').value = upload.username ? `${upload.username}'s Card` : 'Custom Card';
      document.getElementById('c-user').value = upload.username || '';
      document.getElementById('c-link').value = upload.profileLink || '';
      toast('Pre-filled from upload. Adjust stats and click Create Card to approve.', 'info', 5000);
    } catch(e) { toast('Error loading upload details','error'); }
  },

  async reject(uploadId) {
    if (!confirm('Reject this upload?')) return;
    try {
      await fetch(`${State.serverUrl}/api/admin/pending/${uploadId}/reject`,{
        method:'POST', headers:{'x-admin-auth':State.adminToken}
      });
      toast('Upload rejected','info');
      this.loadPending(); this.loadStats();
    } catch(e) { toast('Reject failed','error'); }
  },

  async loadUploads() {
    const wrap = document.getElementById('tab-uploads');
    if (!wrap) return;
    wrap.innerHTML = '<p style="color:var(--text3);padding:1rem">Loading…</p>';
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/uploads`,{headers:{'x-admin-auth':State.adminToken}});
      const d = await res.json();
      if (!d.uploads?.length) { wrap.innerHTML = '<p style="color:var(--text3);padding:1rem">No uploads yet</p>'; return; }
      wrap.innerHTML = `<h3 style="margin-bottom:1rem;font-weight:600">Recent Uploads</h3><div class="admin-list"></div>`;
      const list = wrap.querySelector('.admin-list');
      d.uploads.forEach(u => {
        const el = document.createElement('div');
        el.className = 'admin-list-item';
        const stClass = u.status==='completed'?'st-completed':u.status==='error'?'st-error':'st-processing';
        el.innerHTML = `
          <div style="flex:1">
            <div style="font-weight:600;font-size:0.9rem">#${u.id} — ${u.username||'Anonymous'}</div>
            <div style="font-size:0.78rem;color:var(--text2);margin-top:0.2rem">📅 ${Util.fmtDate(u.timestamp)} · 📁 ${u.files.length} files${u.profileLink?` · 🔗 ${u.profileLink}`:''}</div>
            ${u.error ? `<div style="font-size:0.75rem;color:#ef4444;margin-top:0.2rem">❌ ${u.error}</div>` : ''}
          </div>
          <span class="status-badge ${stClass}">${u.status}</span>`;
        list.appendChild(el);
      });
    } catch(e) { wrap.innerHTML = '<p style="color:#ef4444;padding:1rem">Error loading uploads</p>'; }
  },

  async loadCards() {
    const wrap = document.getElementById('tab-cards');
    if (!wrap) return;
    wrap.innerHTML = '<p style="color:var(--text3);padding:1rem">Loading…</p>';
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/cards`,{headers:{'x-admin-auth':State.adminToken}});
      const d = await res.json();
      if (!d.cards?.length) { wrap.innerHTML = '<p style="color:var(--text3);padding:1rem">No cards yet</p>'; return; }
      wrap.innerHTML = `<h3 style="margin-bottom:1rem;font-weight:600">All Cards (${d.cards.length})</h3><div class="admin-list"></div>`;
      const list = wrap.querySelector('.admin-list');
      d.cards.forEach(card => {
        const rd = card.rarityData || Util.getRarityData(card.rarity);
        const srcClass = card.source==='ai'?'src-ai':card.source==='manual'?'src-manual':'src-mock';
        const el = document.createElement('div');
        el.className = 'admin-list-item';
        el.innerHTML = `
          <div class="admin-card-swatch" style="background:${rd.gradient}">${card.name.charAt(0)}</div>
          <div class="admin-list-info">
            <h4>${card.name} <span style="font-size:0.75rem;color:var(--text3)">@${card.username||'?'}</span></h4>
            <p>${card.rarity.toUpperCase()} · ⭐${card.score} · ${card.grade} · <span class="source-badge ${srcClass}">${card.source||'?'}</span></p>
          </div>
          <button class="btn-reject" style="font-size:0.78rem;padding:0.3rem 0.7rem" onclick="Admin.deleteCard('${card.id}')">Delete</button>`;
        list.appendChild(el);
      });
    } catch(e) { wrap.innerHTML = '<p style="color:#ef4444;padding:1rem">Error loading cards</p>'; }
  },

  async createCard() {
    const name = document.getElementById('c-name')?.value?.trim();
    if (!name) { toast('Card name required','error'); return; }
    const card = {
      name,
      rarity:       document.getElementById('c-rarity')?.value || 'common',
      score:        parseFloat(document.getElementById('c-score')?.value || '7.5'),
      grade:        document.getElementById('c-grade')?.value || 'A',
      description:  document.getElementById('c-desc')?.value?.trim() || '',
      username:     document.getElementById('c-user')?.value?.trim() || 'Admin',
      profileLink:  document.getElementById('c-link')?.value?.trim() || '',
      stats: {
        creativity:   parseInt(document.getElementById('s-creativity')?.value||70),
        engagement:   parseInt(document.getElementById('s-engagement')?.value||70),
        consistency:  parseInt(document.getElementById('s-consistency')?.value||70),
        virality:     parseInt(document.getElementById('s-virality')?.value||70),
        aesthetic:    parseInt(document.getElementById('s-aesthetic')?.value||70),
        authenticity: parseInt(document.getElementById('s-authenticity')?.value||70),
      }
    };

    // If approving a pending upload, use the approve endpoint instead
    if (this.pendingUploadId) {
      try {
        const res = await fetch(`${State.serverUrl}/api/admin/pending/${this.pendingUploadId}/approve`,{
          method:'POST',
          headers:{'Content-Type':'application/json','x-admin-auth':State.adminToken},
          body: JSON.stringify({cardData: card})
        });
        const d = await res.json();
        if (d.success) {
          toast(`Card approved and created!`,'success'); SFX.success();
          this.pendingUploadId = null;
          document.getElementById('c-name').value = '';
          document.getElementById('c-desc').value = '';
          document.getElementById('c-user').value = '';
          document.getElementById('c-link').value = '';
          this.loadPending(); this.loadStats(); this.loadCards();
        } else { toast(d.error||'Approval failed','error'); }
      } catch(e) { toast('Server error during approval','error'); }
      return;
    }

    // Normal create
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/cards`,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-admin-auth':State.adminToken},
        body: JSON.stringify(card)
      });
      const d = await res.json();
      if (d.success) {
        toast(`Card "${name}" created!`,'success'); SFX.success();
        document.getElementById('c-name').value = '';
        document.getElementById('c-desc').value = '';
        this.loadStats();
      } else { toast(d.error||'Failed','error'); }
    } catch(e) { toast('Server error','error'); }
  },

  async deleteCard(id) {
    if (!confirm('Delete this card?')) return;
    try {
      const res = await fetch(`${State.serverUrl}/api/admin/cards/${id}`,{
        method:'DELETE', headers:{'x-admin-auth':State.adminToken}
      });
      const d = await res.json();
      if (d.success) { toast('Deleted','success'); this.loadCards(); this.loadStats(); }
    } catch(e) { toast('Delete failed','error'); }
  }
};
window.Admin = Admin;

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  if (e.shiftKey && e.key === 'A') { e.preventDefault(); Navigation.go('admin'); }
  if (e.key === 'Escape') {
    if (!document.getElementById('overlay')?.classList.contains('hidden')) return;
    if (State.page === 'detail')     Navigation.go('collection');
    else if (State.page !== 'landing') Navigation.go('landing');
  }
});

// ============================================================
// SCROLL ANIMATIONS
// ============================================================
function initScrollAnimations() {
  const els = document.querySelectorAll('.how-step,.rarity-item,.feat,.float-card,.sb-item');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, {threshold:0.1});
  els.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    obs.observe(el);
  });
}

// ============================================================
// PARALLAX ORBS
// ============================================================
function initParallax() {
  document.addEventListener('mousemove', e => {
    const orbs = document.querySelectorAll('.orb');
    const cx = e.clientX/window.innerWidth - 0.5;
    const cy = e.clientY/window.innerHeight - 0.5;
    orbs.forEach((o, i) => {
      const f = (i+1)*8;
      o.style.transform = `translate(${cx*f}px,${cy*f}px)`;
    });
  });
}

// ============================================================
// BOOTSTRAP  (FIXED: no inline styles, pure class toggling)
// ============================================================
function boot() {
  State.load();
  updateNavStats();

  // Show landing page via CSS classes only
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const landing = document.getElementById('pg-landing');
  if (landing) {
    landing.classList.remove('hidden');
    landing.classList.add('active');
  }

  // Init modules
  Upload.init();
  PicUpload.init();
  initScrollAnimations();
  initParallax();
  Landing.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}