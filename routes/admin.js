// server/routes/admin.js
const express        = require('express');
const router         = express.Router();
const path           = require('path');
const fs             = require('fs');
const Admission      = require('../models/Admission');
const ContactMessage = require('../models/ContactMessage');
const User           = require('../models/User');
const { protectAdmin }                         = require('../middleware/auth');
const { sendAdmissionReply, sendContactReply } = require('../utils/emailService');

// All admin routes require admin auth
router.use(protectAdmin);

// ──────────────────────────────────────────────────────────────
// GET /api/admin/dashboard — stats overview
// ──────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalAdmissions, pendingAdmissions, acceptedAdmissions,
      rejectedAdmissions, unreadAdmissions,
      totalMessages, unreadMessages,
      totalUsers,
      recentAdmissions,
      statusBreakdown,
      classBreakdown,
    ] = await Promise.all([
      Admission.countDocuments(),
      Admission.countDocuments({ status: 'Pending' }),
      Admission.countDocuments({ status: 'Accepted' }),
      Admission.countDocuments({ status: 'Rejected' }),
      Admission.countDocuments({ isRead: false }),
      ContactMessage.countDocuments(),
      ContactMessage.countDocuments({ isRead: false }),
      User.countDocuments({ role: 'user' }),
      Admission.find().sort({ createdAt: -1 }).limit(5)
        .select('applicationId studentName classApplying status isRead createdAt'),
      Admission.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Admission.aggregate([
        { $group: { _id: '$classApplying', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        admissions: {
          total: totalAdmissions, pending: pendingAdmissions,
          accepted: acceptedAdmissions, rejected: rejectedAdmissions,
          unread: unreadAdmissions,
        },
        messages:  { total: totalMessages, unread: unreadMessages },
        users:     { total: totalUsers },
        recent:    recentAdmissions,
        statusBreakdown,
        classBreakdown: classBreakdown.map(c => ({ class: c._id, count: c.count })),
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: 'Dashboard data failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admin/admissions — list all applications
// ──────────────────────────────────────────────────────────────
router.get('/admissions', async (req, res) => {
  try {
    const { status, classApplying, isRead, search, page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const filter = {};
    if (status)       filter.status       = status;
    if (classApplying)filter.classApplying = classApplying;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    if (search) {
      filter.$or = [
        { studentName:   { $regex: search, $options: 'i' } },
        { fatherName:    { $regex: search, $options: 'i' } },
        { applicationId: { $regex: search, $options: 'i' } },
        { contactNumber: { $regex: search, $options: 'i' } },
        { email:         { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await Admission.countDocuments(filter);
    const data  = await Admission.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'fullName email')
      .lean();

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), data });
  } catch (err) {
    console.error('Admin admissions list error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch admissions.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admin/admissions/:id — single admission detail
// ──────────────────────────────────────────────────────────────
router.get('/admissions/:id', async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id)
      .populate('userId', 'fullName email phone lastLogin createdAt');

    if (!admission) return res.status(404).json({ success: false, message: 'Not found.' });

    // Mark as read
    if (!admission.isRead) {
      admission.isRead = true;
      await admission.save();
    }

    res.json({ success: true, data: admission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ──────────────────────────────────────────────────────────────
// PATCH /api/admin/admissions/:id/status — update status
// ──────────────────────────────────────────────────────────────
router.patch('/admissions/:id/status', async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const valid = ['Pending','Under Review','Accepted','Rejected','Waitlisted'];
    if (!valid.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const admission = await Admission.findByIdAndUpdate(
      req.params.id,
      { status, adminNotes: adminNotes || '' },
      { new: true }
    );

    if (!admission) return res.status(404).json({ success: false, message: 'Not found.' });

    res.json({
      success: true,
      message: `Status updated to "${status}"`,
      data: { _id: admission._id, applicationId: admission.applicationId, status: admission.status },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/admin/admissions/:id/reply — send reply to applicant
// ──────────────────────────────────────────────────────────────
router.post('/admissions/:id/reply', async (req, res) => {
  try {
    const { message, status, sendEmail } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Reply message cannot be empty.' });
    }

    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: 'Application not found.' });

    // Update status if provided
    if (status) admission.status = status;

    let emailResult = { sent: false };
    const toEmail   = admission.email;

    // Send email if requested and email is available
    if (sendEmail && toEmail) {
      emailResult = await sendAdmissionReply({
        to:            toEmail,
        studentName:   admission.studentName,
        applicationId: admission.applicationId,
        status:        status || admission.status,
        message,
      });
    }

    // Save reply to history
    admission.replies.push({
      message,
      sentBy:    req.user.fullName,
      emailSent: emailResult.sent,
    });
    await admission.save();

    res.json({
      success:   true,
      message:   emailResult.sent ? 'Reply saved and email sent!' : 'Reply saved. (Email not sent — check config.)',
      emailSent: emailResult.sent,
      data:      admission.replies[admission.replies.length - 1],
    });
  } catch (err) {
    console.error('Admission reply error:', err);
    res.status(500).json({ success: false, message: 'Reply failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /api/admin/admissions/:id — delete application
// ──────────────────────────────────────────────────────────────
router.delete('/admissions/:id', async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: 'Not found.' });

    // Files are stored in DB, no need to delete from disk
    // const uploadDir = path.join('/tmp', 'uploads');
    // for (const doc of admission.documents) {
    //   const fp = path.join(uploadDir, doc.storedName);
    //   if (fs.existsSync(fp)) fs.unlinkSync(fp);
    // }
    await Admission.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Application deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admin/messages — list contact messages
// ──────────────────────────────────────────────────────────────
router.get('/messages', async (req, res) => {
  try {
    const { status, isRead, search, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status)             filter.status = status;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    if (search) {
      filter.$or = [
        { name:    { $regex: search, $options: 'i' } },
        { email:   { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await ContactMessage.countDocuments(filter);
    const data  = await ContactMessage.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admin/messages/:id — single message
// ──────────────────────────────────────────────────────────────
router.get('/messages/:id', async (req, res) => {
  try {
    const msg = await ContactMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });

    if (!msg.isRead) {
      msg.isRead = true;
      msg.status = 'Read';
      await msg.save();
    }

    res.json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/admin/messages/:id/reply — reply to contact message
// ──────────────────────────────────────────────────────────────
router.post('/messages/:id/reply', async (req, res) => {
  try {
    const { message, sendEmail } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Reply cannot be empty.' });
    }

    const contact = await ContactMessage.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: 'Message not found.' });

    let emailResult = { sent: false };
    if (sendEmail && contact.email) {
      emailResult = await sendContactReply({
        to:      contact.email,
        name:    contact.name,
        subject: contact.subject,
        message,
      });
    }

    contact.replies.push({ message, sentBy: req.user.fullName, emailSent: emailResult.sent });
    contact.status = 'Replied';
    await contact.save();

    res.json({
      success:   true,
      message:   emailResult.sent ? 'Reply sent via email!' : 'Reply saved. (Email not sent — check config.)',
      emailSent: emailResult.sent,
    });
  } catch (err) {
    console.error('Message reply error:', err);
    res.status(500).json({ success: false, message: 'Reply failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /api/admin/messages/:id
// ──────────────────────────────────────────────────────────────
router.delete('/messages/:id', async (req, res) => {
  try {
    await ContactMessage.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Message deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admin/users — list all users
// ──────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const filter = { role: 'user' };
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email:    { $regex: search, $options: 'i' } },
      ];
    }
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(filter);
    const data  = await User.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .populate('admissionId', 'applicationId status classApplying')
      .lean();

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// ──────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:id/toggle — activate / deactivate
// ──────────────────────────────────────────────────────────────
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    user.isActive = !user.isActive;
    await user.save();

    res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}.`, isActive: user.isActive });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Toggle failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/admin/admissions/:id/download/:index — download document
// ──────────────────────────────────────────────────────────────
router.get('/admissions/:id/download/:index', async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: 'Admission not found.' });

    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= admission.documents.length) {
      return res.status(400).json({ success: false, message: 'Invalid document index.' });
    }

    const doc = admission.documents[index];
    res.set({
      'Content-Type': doc.mimetype,
      'Content-Disposition': `attachment; filename="${doc.originalName}"`,
    });
    res.send(doc.data);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Download failed.' });
  }
});

module.exports = router;
