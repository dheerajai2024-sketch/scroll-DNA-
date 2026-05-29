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


// ==========================================
// IN-MEMORY STORAGE (replace with DB later)
// ==========================================
const uploadsStore = [];  // Store uploaded images metadata
const cardsStore = [];    // Store all cards (AI + manual)
let uploadCounter = 0;

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// File upload setup - SAVE files to disk for admin viewing
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'upload-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, GIF, WEBP, MP4 files allowed'));
    }
  }
});

// ==========================================
// GROQ API CONFIG
// ==========================================
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.2-11b-vision-preview';

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-auth'];
  if (auth !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ==========================================
// PUBLIC ROUTES
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uploadsCount: uploadsStore.length,
    cardsCount: cardsStore.length
  });
});

// Generate card from Instagram screenshots (AI)
app.post('/api/generate-card', upload.array('files', 11), async (req, res) => {
  const uploadId = ++uploadCounter;
  const files = req.files;

  try {
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log(`📸 [Upload #${uploadId}] Processing ${files.length} files...`);

    // Store upload metadata for admin
    const uploadRecord = {
      id: uploadId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      files: files.map(f => ({
        filename: f.filename,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        path: f.path
      })),
      status: 'processing'
    };
    uploadsStore.unshift(uploadRecord);

    // Convert images to base64 for Groq
    const imageContents = [];
    for (const file of files) {
      if (file.mimetype.startsWith('image/')) {
        const buffer = fs.readFileSync(file.path);
        const base64 = buffer.toString('base64');
        imageContents.push({
          type: 'image_url',
          image_url: { url: `data:${file.mimetype};base64,${base64}` }
        });
      }
    }

    if (imageContents.length === 0) {
      uploadRecord.status = 'error';
      uploadRecord.error = 'No valid images';
      return res.status(400).json({ error: 'No valid images found' });
    }

    console.log(`🤖 [Upload #${uploadId}] Calling Groq AI...`);

    // Build prompt for Groq
    const messages = [
      {
        role: 'system',
        content: `You are an AI that analyzes Instagram profiles and creates trading card personality profiles.

Analyze the provided Instagram screenshots and generate a JSON response with this exact structure:
{
  "name": "Creative Personality Name (max 2 words, fun & catchy, based on content style)",
  "rarity": "common|rare|epic|legendary",
  "score": "number 5.0-10.0",
  "grade": "D|C|B|A|A+|S|S+|SS",
  "stats": {
    "creativity": "number 40-99",
    "engagement": "number 40-99", 
    "consistency": "number 40-99",
    "virality": "number 40-99",
    "aesthetic": "number 40-99",
    "authenticity": "number 40-99"
  },
  "description": "2-3 sentence fun description roasting but complimenting their Instagram. Mention specific things you noticed."
}

Rules:
- Rarity distribution: common 70%, rare 22%, epic 7%, legendary 1%
- Score reflects overall Instagram quality based on visual analysis
- Grade: D(5-6), C(6-7), B(7-8), A(8-8.5), A+(8.5-9), S(9-9.5), S+(9.5-9.8), SS(9.8-10)
- Stats should be realistic based on what you see in the images
- Name should be funny, relatable, based on content style`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this Instagram profile and generate a trading card personality profile. Return ONLY valid JSON, no markdown formatting.' },
          ...imageContents
        ]
      }
    ];

    // Call Groq API
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.8,
        max_tokens: 1024,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    console.log(`✅ [Upload #${uploadId}] Groq response received`);

    let cardData;
    try {
      cardData = JSON.parse(aiResponse);
    } catch (e) {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cardData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON from AI');
      }
    }

    // Validate and fix
    const validRarities = ['common', 'rare', 'epic', 'legendary'];
    if (!validRarities.includes(cardData.rarity)) {
      cardData.rarity = 'common';
    }

    // Build full card
    const card = {
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      ...cardData,
      createdAt: new Date().toISOString(),
      source: 'ai',
      uploadId: uploadId,
      rarityData: {
        common: { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)' },
        rare: { weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)' },
        epic: { weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)' },
        legendary: { weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)' }
      }[cardData.rarity]
    };

    // Save to store
    cardsStore.unshift(card);
    uploadRecord.status = 'completed';
    uploadRecord.cardId = card.id;

    console.log(`🎴 [Upload #${uploadId}] Card: ${card.name} (${card.rarity}, ${card.grade})`);

    res.json({
      success: true,
      card: card,
      tokensUsed: response.data.usage?.total_tokens || 'unknown'
    });

  } catch (error) {
    console.error(`❌ [Upload #${uploadId}] Error:`, error.message);

    // Update upload record
    const record = uploadsStore.find(u => u.id === uploadId);
    if (record) {
      record.status = 'error';
      record.error = error.message;
    }

    // Specific errors
    if (error.response?.status === 401) {
      return res.status(500).json({ error: 'Server API key invalid. Contact admin.' });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limit hit. Try again in a minute.' });
    }

    // Fallback mock card
    const mockCard = generateMockCard();
    mockCard.uploadId = uploadId;
    cardsStore.unshift(mockCard);

    res.json({
      success: true,
      card: mockCard,
      fallback: true,
      error: error.message
    });
  }
});

// Mock card generator (fallback)
function generateMockCard() {
  const rarities = [
    { type: 'common', weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)', chance: 0.7 },
    { type: 'rare', weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)', chance: 0.22 },
    { type: 'epic', weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)', chance: 0.07 },
    { type: 'legendary', weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)', chance: 0.01 }
  ];

  const roll = Math.random();
  let rarity = rarities[0];
  let cumulative = 0;
  for (const r of rarities) {
    cumulative += r.chance;
    if (roll <= cumulative) {
      rarity = r;
      break;
    }
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
    rarityData: { weight: rarity.weight, color: rarity.color },
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
// ADMIN ROUTES (Protected)
// ==========================================

// Admin login check
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Get all uploads with images
app.get('/api/admin/uploads', requireAdmin, (req, res) => {
  res.json({
    uploads: uploadsStore.map(u => ({
      ...u,
      files: u.files.map(f => ({
        ...f,
        url: `/uploads/${f.filename}`  // Serve images
      }))
    }))
  });
});

// Get single upload image
app.get('/uploads/:filename', requireAdmin, (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Get all cards
app.get('/api/admin/cards', requireAdmin, (req, res) => {
  res.json({ cards: cardsStore });
});

// MANUAL CARD CREATION (Admin)
app.post('/api/admin/cards', requireAdmin, (req, res) => {
  const { name, rarity, score, grade, stats, description } = req.body;

  if (!name || !rarity) {
    return res.status(400).json({ error: 'Name and rarity required' });
  }

  const validRarities = ['common', 'rare', 'epic', 'legendary'];
  if (!validRarities.includes(rarity)) {
    return res.status(400).json({ error: 'Invalid rarity' });
  }

  const card = {
    id: 'card_manual_' + Date.now(),
    name,
    rarity,
    rarityData: {
      common: { weight: 1, color: 'linear-gradient(135deg, #4b5563, #2d3142)' },
      rare: { weight: 10, color: 'linear-gradient(135deg, #1e3a8a, #1e40af)' },
      epic: { weight: 25, color: 'linear-gradient(135deg, #5b21b6, #6b21a8)' },
      legendary: { weight: 100, color: 'linear-gradient(135deg, #d97706, #f59e0b)' }
    }[rarity],
    score: score || 7.0,
    grade: grade || 'B',
    stats: stats || {
      creativity: 70,
      engagement: 70,
      consistency: 70,
      virality: 70,
      aesthetic: 70,
      authenticity: 70
    },
    description: description || `A ${rarity} card: ${name}`,
    createdAt: new Date().toISOString(),
    source: 'manual'
  };

  cardsStore.unshift(card);
  console.log(`✍️ Manual card created: ${name} (${rarity})`);

  res.json({ success: true, card });
});

// Delete a card
app.delete('/api/admin/cards/:id', requireAdmin, (req, res) => {
  const idx = cardsStore.findIndex(c => c.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Card not found' });
  }
  const card = cardsStore.splice(idx, 1)[0];
  res.json({ success: true, deleted: card });
});

// Update a card
app.put('/api/admin/cards/:id', requireAdmin, (req, res) => {
  const idx = cardsStore.findIndex(c => c.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Card not found' });
  }

  const updates = req.body;
  cardsStore[idx] = { ...cardsStore[idx], ...updates, updatedAt: new Date().toISOString() };
  res.json({ success: true, card: cardsStore[idx] });
});

// Get stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const stats = {
    totalUploads: uploadsStore.length,
    totalCards: cardsStore.length,
    aiCards: cardsStore.filter(c => c.source === 'ai').length,
    manualCards: cardsStore.filter(c => c.source === 'manual').length,
    mockCards: cardsStore.filter(c => c.source === 'mock').length,
    byRarity: {
      common: cardsStore.filter(c => c.rarity === 'common').length,
      rare: cardsStore.filter(c => c.rarity === 'rare').length,
      epic: cardsStore.filter(c => c.rarity === 'epic').length,
      legendary: cardsStore.filter(c => c.rarity === 'legendary').length
    },
    recentUploads: uploadsStore.slice(0, 10),
    recentCards: cardsStore.slice(0, 10)
  };
  res.json(stats);
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`\n🎴 InstaMind Cards Server`);
  console.log(`📡 Running on http://localhost:${PORT}`);
  console.log(`🤖 Groq AI: Connected`);
  console.log(`🔐 Admin password: ${ADMIN_PASSWORD}`);
  console.log(`\n📁 Uploads saved to: ${UPLOADS_DIR}`);
  console.log(`🎴 Cards stored in memory (add DB for persistence)`);
  console.log(`\n✅ Users: Just upload images & click Generate`);
  console.log(`✅ Admin: View uploads, create manual cards`);
  console.log(`   Admin API: Use x-admin-auth header = "${ADMIN_PASSWORD}"\n`);
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});