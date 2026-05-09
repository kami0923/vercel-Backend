// server/routes/auth.js
const express     = require('express');
const router      = express.Router();
const crypto      = require('crypto');
const passport    = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const rateLimit   = require('express-rate-limit');
const User        = require('../models/User');
const { protect, signUserToken, signAdminToken } = require('../middleware/auth');
const { sendPasswordReset, sendWelcomeEmail }    = require('../utils/emailService');

// ── Rate limiters ─────────────────────────────────────────────
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
});
const resetLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { success: false, message: 'Too many reset requests. Try again in 1 hour.' },
});

// ── Generate random password ──────────────────────────────────
function generatePassword(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Google OAuth Strategy ─────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE') {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email       = profile.emails?.[0]?.value?.toLowerCase();
        const displayName = profile.displayName || 'Student';
        const avatar      = profile.photos?.[0]?.value;

        if (!email) return done(new Error('No email from Google'), null);

        // Find existing user by googleId or email
        let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] }).select('+password');

        if (user) {
          // Link Google if they registered with email before
          if (!user.googleId) {
            user.googleId     = profile.id;
            user.googleAvatar = avatar;
            user.authProvider = 'google';
            user.isVerified   = true;
            await user.save();
          }
        } else {
          // New user via Google
          user = await User.create({
            fullName:     displayName,
            email,
            googleId:     profile.id,
            googleAvatar: avatar,
            authProvider: 'google',
            isVerified:   true,
          });
          // Welcome email (non-blocking)
          sendWelcomeEmail({ to: email, name: displayName, provider: 'google' }).catch(() => {});
        }

        await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  ));
}

passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)); }
  catch (err) { done(err, null); }
});

// ── Google OAuth routes ───────────────────────────────────────
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed', session: false }),
  (req, res) => {
    const token = signUserToken(req.user._id);
    // Redirect to frontend with token in URL fragment (SPA approach)
    res.redirect(`/login?token=${token}&name=${encodeURIComponent(req.user.fullName)}&role=${req.user.role}`);
  }
);

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', authLimit, async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body;
    if (!fullName || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (existing.authProvider === 'google')
        return res.status(409).json({ success: false, message: 'This email is linked to a Google account. Please sign in with Google.' });
      return res.status(409).json({ success: false, message: 'An account with this email already exists. Please log in.' });
    }

    const user  = await User.create({ fullName, email, password, phone: phone || '', isVerified: true });
    const token = signUserToken(user._id);
    sendWelcomeEmail({ to: user.email, name: user.fullName }).catch(() => {});

    res.status(201).json({
      success: true,
      message: `Welcome, ${user.fullName}! Account created successfully.`,
      token,
      user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Email already registered.' });
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', authLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user)
      return res.status(401).json({ success: false, message: 'No account found with this email. Please register first.' });

    if (user.authProvider === 'google' && !user.password)
      return res.status(401).json({ success: false, message: 'This account uses Google Sign-In. Please click "Continue with Google".' });

    if (!user.isActive)
      return res.status(401).json({ success: false, message: 'Your account has been deactivated. Contact the school.' });

    const match = await user.comparePassword(password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Incorrect password. Please try again or use "Forgot Password".' });

    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    const token = signUserToken(user._id);

    res.json({
      success: true,
      message: `Welcome back, ${user.fullName}!`,
      token,
      user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role, googleAvatar: user.googleAvatar },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/admin/login ────────────────────────────────
router.post('/admin/login', authLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required.' });

    const user = await User.findOne({ email: email.toLowerCase(), role: 'admin' }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    if (!user.isActive)
      return res.status(401).json({ success: false, message: 'Admin account deactivated.' });

    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    const token = signAdminToken(user._id);

    res.json({
      success: true, message: `Welcome, ${user.fullName}!`, token,
      user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Admin login failed.' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────
router.post('/forgot-password', resetLimit, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always respond the same way (security: don't reveal if email exists)
    const genericMsg = 'If an account exists with this email, a new password has been sent. Check your inbox (and spam folder).';

    if (!user) return res.json({ success: true, message: genericMsg });

    if (user.authProvider === 'google' && !user.password)
      return res.status(400).json({ success: false, message: 'This account uses Google Sign-In. No password to reset — please use Google.' });

    // Generate new password
    const newPassword = generatePassword(10);
    user.password = newPassword; // will be hashed by pre-save hook
    await user.save();

    // Send email
    const result = await sendPasswordReset({ to: user.email, name: user.fullName, newPassword });

    if (!result.sent) {
      // Email not configured — return password in response (dev mode only)
      console.warn('⚠️  Email not configured. New password:', newPassword);
      return res.json({
        success: true,
        message: '(Dev mode) Email not configured. New password shown below.',
        devPassword: newPassword, // REMOVE this in production
      });
    }

    res.json({ success: true, message: genericMsg });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password. Please try again.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('admissionId', 'applicationId status classApplying createdAt');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch profile.' });
  }
});

// ── PUT /api/auth/me ──────────────────────────────────────────
router.put('/me', protect, async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (phone !== undefined) updates.phone = phone;
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ success: true, message: 'Profile updated.', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed.' });
  }
});

// ── PUT /api/auth/change-password ────────────────────────────
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, message: 'Both passwords are required.' });
    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });

    const user = await User.findById(req.user._id).select('+password');
    if (user.authProvider === 'google' && !user.password)
      return res.status(400).json({ success: false, message: 'Google accounts cannot change password this way.' });

    const ok = await user.comparePassword(currentPassword);
    if (!ok) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Password change failed.' });
  }
});

module.exports = router;
