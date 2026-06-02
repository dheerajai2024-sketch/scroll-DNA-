const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIG
// ==========================================
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!GROQ_API_KEY) {
  console.error('\n❌ ERROR: GROQ_API_KEY not set!');
  process.exit(1);
}

const UPLOADS_DIR = process.env.RENDER ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const PROFILES_DIR = path.join(UPLOADS_DIR, 'profiles');
const DATA_DIR = process.env.RENDER ? '/tmp/data' : path.join(__dirname, 'data');

[UPLOADS_DIR, PROFILES_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const UPLOADS_DATA_FILE = path.join(DATA_DIR, 'uploads.json');
const CARDS_DATA_FILE = path.join(DATA_DIR, 'cards.json');
const COUNTER_FILE = path.join(DATA_DIR, 'counter.json');

// ==========================================
// PERSISTENT STORAGE
// ==========================================
let uploadsStore = [];
let cardsStore = [];
let pendingQueue = [];
let uploadCounter = 0;
let adminOnline = false;
const adminClients = [];

function loadData() {
  try {
    if (fs.existsSync(UPLOADS_DATA_FILE)) {
      uploadsStore = JSON.parse(fs.readFileSync(UPLOADS_DATA_FILE, 'utf8'));
      console.log(`📂 Loaded ${uploadsStore.length} uploads from disk`);
    }
    if (fs.existsSync(CARDS_DATA_FILE)) {
      cardsStore = JSON.parse(fs.readFileSync(CARDS_DATA_FILE, 'utf8'));
      console.log(`📂 Loaded ${cardsStore.length} cards from disk`);
    }
    if (fs.existsSync(COUNTER_FILE)) {
      const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
      uploadCounter = data.counter || 0;
    }
  } catch (e) {
    console.error('⚠️ Error loading persisted data:', e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(UPLOADS_DATA_FILE, JSON.stringify(uploadsStore, null, 2));
    fs.writeFileSync(CARDS_DATA_FILE, JSON.stringify(cardsStore, null, 2));
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter: uploadCounter }, null, 2));
  } catch (e) {
    console.error('⚠️ Error saving data:', e.message);
  }
}

loadData();

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'front-end')));

// Serve uploaded files publicly (needed for admin previews)
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'profilePic') cb(null, PROFILES_DIR);
    else cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, GIF, WEBP, MP4 files allowed'));
  }
});

// ==========================================
// GROQ API CONFIG
// ==========================================
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.2-11b-vision-preview';
const MAX_AI_IMAGES = 4;
const MAX_AI_IMAGE_SIZE = 5 * 1024 * 1024;

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-auth'];
  if (auth !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ==========================================
// NOTIFICATION SYSTEM (SSE)
// ==========================================
function notifyAdmins(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  adminClients.forEach(client => {
    try { client.write(message); } catch(e) {}
  });
}

// FIXED: SSE uses query param auth since EventSource can't send headers
app.get('/api/admin/stream', (req, res) => {
  const auth = req.query.token;
  if (auth !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  adminClients.push(res);
  adminOnline = true;
  console.log('🔔 Admin connected to notification stream');

  res.write(`data: ${JSON.stringify({ type: 'connected', pendingCount: pendingQueue.length })}\n\n`);

  req.on('close', () => {
    const idx = adminClients.indexOf(res);
    if (idx > -1) adminClients.splice(idx, 1);
    if (adminClients.length === 0) adminOnline = false;
    console.log('🔕 Admin disconnected from stream');
  });
});

// ==========================================
// PUBLIC ROUTES
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    adminOnline, 
    uploadsCount: uploadsStore.length, 
    cardsCount: cardsStore.length 
  });
});

app.post('/api/instant-card', (req, res) => {
  const card = generateMockCard();
  card.source = 'instant';
  cardsStore.unshift(card);
  saveData();
  console.log(`⚡ Instant card: ${card.name}`);
  res.json({ success: true, card });
});

// ==========================================
// GENERATE CARD
// ==========================================
app.post('/api/generate-card', upload.fields([
  { name: 'files', maxCount: 11 },
  { name: 'profilePic', maxCount: 1 }
]), async (req, res) => {
  const uploadId = ++uploadCounter;
  const files = req.files?.files || [];
  const profilePic = req.files?.profilePic?.[0];
  const profileLink = req.body?.profileLink || '';
  const username = req.body?.username || 'Anonymous';

  saveData();

  try {
    if (!files.length && !profileLink) {
      return res.status(400).json({ error: 'Upload screenshots or paste a profile link' });
    }

    console.log(`📸 [Upload #${uploadId}] User: ${username} | Files: ${files.length} | Link: ${profileLink}`);

    const uploadRecord = {
      id: uploadId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      username,
      profileLink,
      files: files.map(f => ({
        filename: f.filename,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        path: f.path,
        url: `/uploads/${f.filename}`
      })),
      profilePic: profilePic ? {
        filename: profilePic.filename,
        path: profilePic.path,
        url: `/uploads/profiles/${profilePic.filename}`
      } : null,
      status: 'processing',
      error: null,
      cardId: null
    };
    uploadsStore.unshift(uploadRecord);
    saveData();

    notifyAdmins({
      type: 'new_upload',
      uploadId,
      username,
      profileLink,
      fileCount: files.length,
      hasProfilePic: !!profilePic,
      timestamp: uploadRecord.timestamp,
      message: `${username} uploaded ${files.length} files${profileLink ? ' + link' : ''}`
    });

    if (adminOnline && pendingQueue.length < 50) {
      uploadRecord.status = 'pending_review';
      pendingQueue.push(uploadRecord);
      saveData();
      notifyAdmins({
        type: 'pending_added',
        uploadId,
        pendingCount: pendingQueue.length,
        message: `⏸️ ${username}'s card queued for manual review`
      });
      return res.json({ success: true, queued: true, uploadId, message: 'Admin is online - your card is queued for expert review!' });
    }

    const card = await generateAICard(uploadRecord, files, profileLink, username, profilePic);

    cardsStore.unshift(card);
    uploadRecord.status = 'completed';
    uploadRecord.cardId = card.id;
    saveData();

    notifyAdmins({
      type: 'card_generated',
      uploadId,
      cardName: card.name,
      rarity: card.rarity,
      username,
      message: `✅ AI generated ${card.rarity.toUpperCase()} card for ${username}`
    });

    res.json({ success: true, card });

  } catch (error) {
    console.error(`❌ [Upload #${uploadId}] Error:`, error.message);

    const record = uploadsStore.find(u => u.id === uploadId);
    if (record) { 
      record.status = 'error'; 
      record.error = error.message; 
      saveData();
    }

    let errorType = 'ai_error';
    if (error.response?.status === 400) errorType = 'groq_bad_request';
    if (error.response?.status === 401) errorType = 'groq_auth';
    if (error.response?.status === 429) errorType = 'groq_rate_limit';
    if (error.code === 'ECONNABORTED') errorType = 'groq_timeout';

    const mockCard = generateMockCard();
    mockCard.uploadId = uploadId;
    mockCard.username = username;
    mockCard.profileLink = profileLink;
    mockCard.profilePicUrl = profilePic ? `/uploads/profiles/${profilePic.filename}` : null;
    mockCard.source = 'mock';
    mockCard.errorType = errorType;
    mockCard.errorMessage = error.message;
    cardsStore.unshift(mockCard);
    saveData();

    notifyAdmins({
      type: 'fallback_used',
      uploadId,
      username,
      errorType,
      message: `⚠️ Fallback used for ${username} - ${errorType}: ${error.message}`
    });

    res.json({ success: true, card: mockCard, fallback: true, error: error.message, errorType });
  }
});

// ==========================================
// AI CARD GENERATION
// ==========================================
async function generateAICard(uploadRecord, files, profileLink, username, profilePic) {
  const imageFiles = files
    .filter(f => f.mimetype.startsWith('image/'))
    .filter(f => f.size <= MAX_AI_IMAGE_SIZE)
    .slice(0, MAX_AI_IMAGES);

  if (imageFiles.length === 0 && !profileLink) {
    throw new Error('No valid images for AI analysis (need images ≤5MB)');
  }

  const imageContents = [];
  for (const file of imageFiles) {
    const buffer = fs.readFileSync(file.path);
    const base64 = buffer.toString('base64');
    imageContents.push({
      type: 'image_url',
      image_url: { url: `data:${file.mimetype};base64,${base64}` }
    });
  }

  let cardData = null;
  let aiResponse = null;

  if (imageContents.length > 0) {
    const messages = [
      {
        role: 'system',
        content: `You are Scroll DNA AI - an Instagram/TikTok personality analyzer that creates premium trading cards.

Analyze the provided screenshots and generate a JSON object with this exact structure:
{
  "name": "2-word catchy personality name",
  "rarity": "common|rare|epic|legendary",
  "score": "number 5.0-10.0",
  "grade": "D|C|B|A|A+|S|S+|SS",
  "stats": {
    "creativity": "40-99",
    "engagement": "40-99",
    "consistency": "40-99",
    "virality": "40-99",
    "aesthetic": "40-99",
    "authenticity": "40-99"
  },
  "description": "2-3 sentences roasting/complimenting their social media. Mention specific visual details."
}

Rules:
- Rarity: common 70%, rare 22%, epic 7%, legendary 1%
- Grade: D(5-6), C(6-7), B(7-8), A(8-8.5), A+(8.5-9), S(9-9.5), S+(9.5-9.8), SS(9.8-10)
- Name based on content style observed
- Return ONLY the JSON object, no markdown, no explanation.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Analyze this Instagram/TikTok profile${profileLink ? ' from ' + profileLink : ''}. Return ONLY valid JSON.` },
          ...imageContents
        ]
      }
    ];

    const response = await axios.post(GROQ_API_URL, {
      model: GROQ_MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 1024
    }, {
      headers: { 
        'Authorization': `Bearer ${GROQ_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      timeout: 60000
    });

    aiResponse = response.data.choices[0].message.content;

    try {
      cardData = JSON.parse(aiResponse);
    } catch (e) {
      const match = aiResponse.match(/\{[\s\S]*\}/);
      if (match) {
        try { cardData = JSON.parse(match[0]); } catch(e2) {}
      }
    }
  }

  if (!cardData) {
    cardData = {
      name: `${username} Scroller`,
      rarity: 'common',
      score: 6.5,
      grade: 'C',
      stats: {
        creativity: 60, engagement: 60, consistency: 60,
        virality: 60, aesthetic: 60, authenticity: 60
      },
      description: `A social media card for ${username}. AI analysis returned unclear data.`
    };
  }

  const validRarities = ['common', 'rare', 'epic', 'legendary'];
  if (!validRarities.includes(cardData.rarity)) cardData.rarity = 'common';

  const rarityConfigs = {
    common: { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)', border: '#6b7280' },
    rare: { weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)', border: '#3b82f6' },
    epic: { weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)', border: '#8b5cf6' },
    legendary: { weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)', border: '#fbbf24' }
  };

  return {
    id: 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    ...cardData,
    username,
    profileLink,
    profilePicUrl: profilePic ? `/uploads/profiles/${profilePic.filename}` : null,
    createdAt: new Date().toISOString(),
    source: 'ai',
    uploadId: uploadRecord.id,
    rarityData: rarityConfigs[cardData.rarity]
  };
}

// ==========================================
// ADMIN QUEUE MANAGEMENT
// ==========================================

app.get('/api/admin/pending', requireAdmin, (req, res) => {
  res.json({ pending: pendingQueue, count: pendingQueue.length });
});

app.post('/api/admin/pending/:uploadId/approve', requireAdmin, async (req, res) => {
  const idx = pendingQueue.findIndex(u => u.id === parseInt(req.params.uploadId));
  if (idx === -1) return res.status(404).json({ error: 'Upload not found in queue' });

  const uploadRecord = pendingQueue.splice(idx, 1)[0];
  const { cardData } = req.body;

  const rarityConfigs = {
    common: { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)', border: '#6b7280' },
    rare: { weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)', border: '#3b82f6' },
    epic: { weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)', border: '#8b5cf6' },
    legendary: { weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)', border: '#fbbf24' }
  };

  const card = {
    id: 'card_manual_' + Date.now(),
    ...cardData,
    username: uploadRecord.username,
    profileLink: uploadRecord.profileLink,
    profilePicUrl: uploadRecord.profilePic?.url || null,
    createdAt: new Date().toISOString(),
    source: 'manual',
    uploadId: uploadRecord.id,
    rarityData: rarityConfigs[cardData.rarity || 'common']
  };

  cardsStore.unshift(card);
  uploadRecord.status = 'completed';
  uploadRecord.cardId = card.id;
  saveData();

  notifyAdmins({
    type: 'manual_approved',
    uploadId: uploadRecord.id,
    cardName: card.name,
    message: `✍️ Admin manually approved card for ${uploadRecord.username}`
  });

  res.json({ success: true, card });
});

app.post('/api/admin/pending/:uploadId/reject', requireAdmin, (req, res) => {
  const idx = pendingQueue.findIndex(u => u.id === parseInt(req.params.uploadId));
  if (idx === -1) return res.status(404).json({ error: 'Upload not found' });

  const uploadRecord = pendingQueue.splice(idx, 1)[0];
  uploadRecord.status = 'rejected';

  uploadRecord.files.forEach(f => {
    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch(e) {}
  });
  if (uploadRecord.profilePic?.path) {
    try { if (fs.existsSync(uploadRecord.profilePic.path)) fs.unlinkSync(uploadRecord.profilePic.path); } catch(e) {}
  }

  saveData();

  notifyAdmins({
    type: 'rejected',
    uploadId: uploadRecord.id,
    message: `❌ Admin rejected upload #${uploadRecord.id}`
  });

  res.json({ success: true });
});

app.post('/api/admin/status', requireAdmin, (req, res) => {
  adminOnline = req.body.online ?? true;
  notifyAdmins({ type: 'status_change', adminOnline, message: adminOnline ? 'Admin is now online' : 'Admin went offline' });
  res.json({ adminOnline });
});

// ==========================================
// ADMIN UPLOAD MANAGEMENT
// ==========================================

app.get('/api/admin/uploads', requireAdmin, (req, res) => {
  res.json({ uploads: uploadsStore });
});

app.get('/api/admin/uploads/:id', requireAdmin, (req, res) => {
  const upload = uploadsStore.find(u => u.id === parseInt(req.params.id));
  if (!upload) return res.status(404).json({ error: 'Upload not found' });
  res.json(upload);
});

app.post('/api/admin/uploads/:id/generate', requireAdmin, async (req, res) => {
  const uploadRecord = uploadsStore.find(u => u.id === parseInt(req.params.id));
  if (!uploadRecord) return res.status(404).json({ error: 'Upload not found' });

  try {
    const files = uploadRecord.files.map(f => ({
      ...f,
      path: path.join(UPLOADS_DIR, f.filename)
    })).filter(f => fs.existsSync(f.path));

    const profilePic = uploadRecord.profilePic;
    const profilePicFile = profilePic && fs.existsSync(profilePic.path) ? {
      ...profilePic,
      path: profilePic.path
    } : null;

    const card = await generateAICard(uploadRecord, files, uploadRecord.profileLink, uploadRecord.username, profilePicFile);

    cardsStore.unshift(card);
    uploadRecord.status = 'completed';
    uploadRecord.cardId = card.id;
    uploadRecord.error = null;
    saveData();

    notifyAdmins({
      type: 'card_generated',
      uploadId: uploadRecord.id,
      cardName: card.name,
      rarity: card.rarity,
      username: uploadRecord.username,
      message: `✅ Admin manually generated ${card.rarity.toUpperCase()} card for ${uploadRecord.username}`
    });

    res.json({ success: true, card });
  } catch (error) {
    console.error(`❌ Manual generation failed for upload #${req.params.id}:`, error.message);
    uploadRecord.status = 'error';
    uploadRecord.error = error.message;
    saveData();
    res.status(500).json({ error: error.message, errorType: 'manual_generation_failed' });
  }
});

app.delete('/api/admin/uploads/:id', requireAdmin, (req, res) => {
  const idx = uploadsStore.findIndex(u => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Upload not found' });

  const uploadRecord = uploadsStore[idx];

  uploadRecord.files.forEach(f => {
    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch(e) {}
  });
  if (uploadRecord.profilePic?.path) {
    try { if (fs.existsSync(uploadRecord.profilePic.path)) fs.unlinkSync(uploadRecord.profilePic.path); } catch(e) {}
  }

  const pendingIdx = pendingQueue.findIndex(u => u.id === uploadRecord.id);
  if (pendingIdx > -1) pendingQueue.splice(pendingIdx, 1);

  uploadsStore.splice(idx, 1);
  saveData();

  notifyAdmins({
    type: 'upload_deleted',
    uploadId: uploadRecord.id,
    message: `🗑️ Upload #${uploadRecord.id} deleted permanently`
  });

  res.json({ success: true, deleted: uploadRecord });
});

// ==========================================
// MOCK CARD GENERATOR
// ==========================================
function generateMockCard() {
  const rarities = [
    { type: 'common', weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)', border: '#6b7280', chance: 0.7 },
    { type: 'rare', weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)', border: '#3b82f6', chance: 0.22 },
    { type: 'epic', weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)', border: '#8b5cf6', chance: 0.07 },
    { type: 'legendary', weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)', border: '#fbbf24', chance: 0.01 }
  ];

  const roll = Math.random();
  let rarity = rarities[0];
  let cumulative = 0;
  for (const r of rarities) {
    cumulative += r.chance;
    if (roll <= cumulative) { rarity = r; break; }
  }

  const names = ['Algorithm Whisperer', 'Midnight Scroller', 'Aesthetic Hustler', 'Meme Lord',
    'Story Architect', 'Reel Addict', 'DM Slider', 'Filter Fanatic', 'Hashtag Hunter',
    'Ghost Liker', 'Caption Poet', 'Grid Strategist', 'Vibe Curator', 'Content Machine'];

  const baseScore = 5 + Math.random() * 4.9;
  const bonus = rarity.type === 'legendary' ? 0.8 : rarity.type === 'epic' ? 0.5 : rarity.type === 'rare' ? 0.3 : 0;
  const score = Math.min(10, baseScore + bonus);

  const grade = score >= 9.8 ? 'SS' : score >= 9.5 ? 'S+' : score >= 9 ? 'S' : 
                score >= 8.5 ? 'A+' : score >= 8 ? 'A' : score >= 7 ? 'B' : score >= 6 ? 'C' : 'D';

  return {
    id: 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    name: names[Math.floor(Math.random() * names.length)],
    rarity: rarity.type,
    rarityData: { weight: rarity.weight, color: rarity.color, border: rarity.border },
    score: parseFloat(score.toFixed(1)),
    grade,
    stats: {
      creativity: Math.floor(60 + Math.random() * 39),
      engagement: Math.floor(50 + Math.random() * 49),
      consistency: Math.floor(40 + Math.random() * 59),
      virality: Math.floor(45 + Math.random() * 54),
      aesthetic: Math.floor(55 + Math.random() * 44),
      authenticity: Math.floor(50 + Math.random() * 49)
    },
    description: `A ${rarity.type} card with exceptional social media presence.`,
    createdAt: new Date().toISOString(),
    source: 'mock'
  };
}

// ==========================================
// ADMIN ROUTES
// ==========================================
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/admin/cards', requireAdmin, (req, res) => {
  res.json({ cards: cardsStore });
});

app.post('/api/admin/cards', requireAdmin, (req, res) => {
  const { name, rarity, score, grade, stats, description, username, profileLink, profilePicUrl } = req.body;
  if (!name || !rarity) return res.status(400).json({ error: 'Name and rarity required' });

  const validRarities = ['common', 'rare', 'epic', 'legendary'];
  if (!validRarities.includes(rarity)) return res.status(400).json({ error: 'Invalid rarity' });

  const rarityConfigs = {
    common: { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)', border: '#6b7280' },
    rare: { weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)', border: '#3b82f6' },
    epic: { weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)', border: '#8b5cf6' },
    legendary: { weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)', border: '#fbbf24' }
  };

  const card = {
    id: 'card_manual_' + Date.now(),
    name, rarity, username: username || 'Admin', profileLink: profileLink || '',
    profilePicUrl: profilePicUrl || null,
    rarityData: rarityConfigs[rarity],
    score: score || 7.0,
    grade: grade || 'B',
    stats: stats || { creativity: 70, engagement: 70, consistency: 70, virality: 70, aesthetic: 70, authenticity: 70 },
    description: description || `A ${rarity} card: ${name}`,
    createdAt: new Date().toISOString(),
    source: 'manual'
  };

  cardsStore.unshift(card);
  saveData();
  console.log(`✍️ Manual card: ${name}`);
  res.json({ success: true, card });
});

app.delete('/api/admin/cards/:id', requireAdmin, (req, res) => {
  const idx = cardsStore.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Card not found' });
  const card = cardsStore.splice(idx, 1)[0];
  saveData();
  res.json({ success: true, deleted: card });
});

app.put('/api/admin/cards/:id', requireAdmin, (req, res) => {
  const idx = cardsStore.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Card not found' });
  cardsStore[idx] = { ...cardsStore[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveData();
  res.json({ success: true, card: cardsStore[idx] });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({
    totalUploads: uploadsStore.length,
    totalCards: cardsStore.length,
    aiCards: cardsStore.filter(c => c.source === 'ai').length,
    manualCards: cardsStore.filter(c => c.source === 'manual').length,
    instantCards: cardsStore.filter(c => c.source === 'instant').length,
    mockCards: cardsStore.filter(c => c.source === 'mock').length,
    pendingCount: pendingQueue.length,
    byRarity: {
      common: cardsStore.filter(c => c.rarity === 'common').length,
      rare: cardsStore.filter(c => c.rarity === 'rare').length,
      epic: cardsStore.filter(c => c.rarity === 'epic').length,
      legendary: cardsStore.filter(c => c.rarity === 'legendary').length
    },
    recentUploads: uploadsStore.slice(0, 10),
    recentCards: cardsStore.slice(0, 10)
  });
});

// ==========================================
// PUBLIC CARDS FEED (for users)
// ==========================================
app.get('/api/cards', (req, res) => {
  res.json({ cards: cardsStore });
});
// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`\n🧬 Scroll DNA Server`);
  console.log(`📡 Running on http://localhost:${PORT}`);
  console.log(`💾 Data dir: ${DATA_DIR}`);
  console.log(`📂 Uploads dir: ${UPLOADS_DIR}`);
  console.log(`🤖 Groq AI: Connected (max ${MAX_AI_IMAGES} images per request)`);
  console.log(`⚡ Instant Card: POST /api/instant-card`);
  console.log(`🔔 Admin SSE: GET /api/admin/stream?token=PASSWORD`);
  console.log(`⏸️  Pending Queue: Enabled when admin online`);
  console.log(`🔐 Admin password: ${ADMIN_PASSWORD}`);
  console.log(`\n✅ Data persists to JSON files automatically`);
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});