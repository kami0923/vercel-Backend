// server/routes/admissions.js
const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const Admission = require('../models/Admission');
const User      = require('../models/User');
const { protect, optionalAuth } = require('../middleware/auth');

// ── Multer setup ──────────────────────────────────────────────
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const ok = ['image/jpeg','image/png','application/pdf'];
  ok.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, PDF allowed'), false);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// ──────────────────────────────────────────────────────────────
// POST /api/admissions — submit application
// ──────────────────────────────────────────────────────────────
router.post('/', optionalAuth, upload.array('documents', 5), async (req, res) => {
  try {
    const {
      studentName, fatherName, bFormCnic, dateOfBirth,
      gender, classApplying, previousSchool, lastClassPassed,
      contactNumber, email, homeAddress,
    } = req.body;

    const documents = (req.files || []).map(f => ({
      originalName: f.originalname,
      storedName:   f.filename || `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname)}`,
      mimetype:     f.mimetype,
      size:         f.size,
      data:         f.buffer,
    }));

    const admData = {
      studentName, fatherName, bFormCnic,
      dateOfBirth: new Date(dateOfBirth),
      gender, classApplying,
      previousSchool:  previousSchool  || '',
      lastClassPassed: lastClassPassed || '',
      contactNumber, email: email || '',
      homeAddress, documents,
    };

    // Link to logged-in user if available
    if (req.user) {
      admData.userId = req.user._id;
    }

    const admission = await Admission.create(admData);

    // Link admission back to user
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { admissionId: admission._id });
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted! We will contact you within 2–3 working days.',
      data: {
        applicationId: admission.applicationId,
        studentName:   admission.studentName,
        classApplying: admission.classApplying,
        status:        admission.status,
        submittedAt:   admission.createdAt,
      },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msgs = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: msgs.join(', ') });
    }
    console.error('Admission POST error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admissions/my — get current user's application
// ──────────────────────────────────────────────────────────────
router.get('/my', protect, async (req, res) => {
  try {
    const admission = await Admission.findOne({ userId: req.user._id })
      .sort({ createdAt: -1 });

    if (!admission) {
      return res.status(404).json({ success: false, message: 'No application found.' });
    }
    res.json({ success: true, data: admission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admissions/track/:applicationId — track by ID
// ──────────────────────────────────────────────────────────────
router.get('/track/:applicationId', async (req, res) => {
  try {
    const admission = await Admission.findOne({ applicationId: req.params.applicationId })
      .select('applicationId studentName classApplying status replies createdAt');

    if (!admission) {
      return res.status(404).json({ success: false, message: 'Application not found. Check your Application ID.' });
    }
    res.json({ success: true, data: admission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
