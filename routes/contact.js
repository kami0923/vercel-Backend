// server/routes/contact.js
const express        = require('express');
const router         = express.Router();
const ContactMessage = require('../models/ContactMessage');

// POST /api/contact — submit contact message
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, subject, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ success: false, message: 'Name and message are required.' });
    }

    const msg = await ContactMessage.create({ name, phone, email, subject, message });

    res.status(201).json({
      success: true,
      message: 'Your message has been received. We will get back to you soon!',
      data: { id: msg._id, name: msg.name, createdAt: msg.createdAt },
    });
  } catch (err) {
    console.error('Contact POST error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

module.exports = router;
