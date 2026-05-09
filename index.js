// server/index.js — AIPMS Full Stack Server v3
require('dotenv').config();

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const helmet   = require('helmet');
const passport = require('passport');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Supports both MONGO_URI and MONGODB_URI env variable names ──
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

// ─────────────────────────────────────────────────────────────────
// MongoDB Connection
// Uses a cached promise so serverless functions reuse the same
// connection instead of opening a new one on every request.
// ─────────────────────────────────────────────────────────────────
let connectionPromise = null;

const connectDB = async () => {
  // Already connected — reuse
  if (mongoose.connection.readyState === 1) return true;

  // Connection in progress — wait for it
  if (connectionPromise) {
    await connectionPromise;
    return mongoose.connection.readyState === 1;
  }

  if (!MONGO_URI) {
    console.error('❌ MONGO_URI / MONGODB_URI environment variable is not set');
    return false;
  }

  try {
    connectionPromise = mongoose.connect(MONGO_URI, {
      useNewUrlParser:    true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // fail fast instead of hanging
    });

    await connectionPromise;
    console.log('✅ MongoDB Atlas Connected');
    await seedAdmin();
    return true;
  } catch (err) {
    connectionPromise = null; // allow retry on next request
    console.error('❌ MongoDB connection failed:', err.message);
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────
// Seed default admin (only if no admin exists)
// ─────────────────────────────────────────────────────────────────
const seedAdmin = async () => {
  try {
    const User = require('./models/User');
    const exists = await User.findOne({ role: 'admin' });
    if (exists) return;

    await User.create({
      fullName:   process.env.ADMIN_NAME     || 'Mr. Muhammad Nawaz',
      email:      process.env.ADMIN_EMAIL    || 'admin@aipms.edu.pk',
      password:   process.env.ADMIN_PASSWORD || 'Admin@AIPMS2024',
      role:       'admin',
      isVerified: true,
    });

    console.log('✅ Admin seeded:', process.env.ADMIN_EMAIL || 'admin@aipms.edu.pk');
  } catch (err) {
    console.error('⚠️  Admin seed failed (may already exist):', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────
// Security & Core Middleware
// ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin:      process.env.CLIENT_URL || '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Passport (JWT-only — no session needed for serverless)
app.use(passport.initialize());

// ─────────────────────────────────────────────────────────────────
// DB Connection Middleware
// Ensures every API request has a live DB connection.
// ─────────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  // Skip DB check for static files and health endpoint
  if (!req.path.startsWith('/api')) return next();

  const connected = await connectDB();
  if (!connected) {
    return res.status(503).json({
      success: false,
      message: 'Database temporarily unavailable. Please try again shortly.',
    });
  }
  next();
});

// ─────────────────────────────────────────────────────────────────
// Static Files (commented out for API-only deployment)
// ─────────────────────────────────────────────────────────────────
// app.use(express.static(path.join(__dirname, '../public')));

// ─────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/admissions', require('./routes/admissions'));
app.use('/api/contact',    require('./routes/contact'));
app.use('/api/admin',      require('./routes/admin'));

app.get('/', (req, res) => {
  res.json({ 
    message: 'AIPMS API is running ✅',
    version: 'v3'
  });
});

// Health check (no DB middleware overhead)
app.get('/api/health', (req, res) => res.json({
  status:    'ok',
  server:    'AIPMS v3',
  mongodb:   mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  timestamp: new Date().toISOString(),
}));

// ─────────────────────────────────────────────────────────────────
// Page Routes (commented out for API-only deployment)
// ─────────────────────────────────────────────────────────────────
// const sendPage = (file) => (req, res) => {
//   const filePath = path.join(__dirname, '../public', file);
//   if (fs.existsSync(filePath)) {
//     res.sendFile(filePath);
//   } else {
//     res.status(404).send('Page not found');
//   }
// };

// app.get('/login',    sendPage('login.html'));
// app.get('/register', sendPage('login.html'));   // same page, different tabs
// app.get('/portal',   sendPage('portal.html'));
// app.get('/admin',    sendPage('admin/index.html'));
// app.get('*',         sendPage('index.html'));   // catch-all for SPA

// ─────────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('🔥 Unhandled error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ─────────────────────────────────────────────────────────────────
// Local Development Server
// On Vercel, app.listen() is never called — module.exports handles it.
// ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log('\n╔══════════════════════════════════════════════════════╗');
      console.log('║   AIPMS School Website — Server v3 Ready             ║');
      console.log('╠══════════════════════════════════════════════════════╣');
      console.log(`║  🌐  Website : http://localhost:${PORT}                ║`);
      console.log(`║  👤  Portal  : http://localhost:${PORT}/portal        ║`);
      console.log(`║  🔐  Login   : http://localhost:${PORT}/login         ║`);
      console.log(`║  🛡️   Admin   : http://localhost:${PORT}/admin        ║`);
      console.log('╚══════════════════════════════════════════════════════╝\n');
    });
  });
}

// Graceful shutdown (local dev only — no-op on Vercel)
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
});

// ✅ Required: Vercel uses this export as the serverless handler
module.exports = app;
