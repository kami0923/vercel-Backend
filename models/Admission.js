// server/models/Admission.js
const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  message:   { type: String, required: true },
  sentBy:    { type: String, default: 'Admin' },
  sentAt:    { type: Date,   default: Date.now },
  emailSent: { type: Boolean, default: false },
});

const admissionSchema = new mongoose.Schema(
  {
    // ── Linked user ──────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ── Student info ─────────────────────────────────────────
    studentName: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    fatherName: {
      type: String,
      required: [true, "Father's name is required"],
      trim: true,
    },
    bFormCnic: {
      type: String,
      required: [true, 'B-Form/CNIC is required'],
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
    },
    gender: {
      type: String,
      required: true,
      enum: ['Male', 'Female'],
    },

    // ── Academic ─────────────────────────────────────────────
    classApplying: {
      type: String,
      required: [true, 'Class is required'],
      enum: [
        'Nursery', 'Kindergarten (KG)', 'Prep / Katchi',
        'Class 1','Class 2','Class 3','Class 4','Class 5',
        'Class 6','Class 7','Class 8','Class 9','Class 10 (Matric)',
      ],
    },
    previousSchool:  { type: String, trim: true, default: '' },
    lastClassPassed: { type: String, trim: true, default: '' },

    // ── Contact ──────────────────────────────────────────────
    contactNumber: {
      type: String,
      required: [true, 'Contact number is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    homeAddress: {
      type: String,
      required: [true, 'Home address is required'],
      trim: true,
    },

    // ── Documents ────────────────────────────────────────────
    documents: [
      {
        originalName: String,
        storedName:   String,
        mimetype:     String,
        size:         Number,
        data:         Buffer, // Store file data
        uploadedAt:   { type: Date, default: Date.now },
      },
    ],

    // ── Admin workflow ───────────────────────────────────────
    status: {
      type: String,
      enum: ['Pending', 'Under Review', 'Accepted', 'Rejected', 'Waitlisted'],
      default: 'Pending',
    },
    adminNotes: { type: String, default: '', maxlength: 1000 },
    isRead:     { type: Boolean, default: false }, // has admin seen it?
    replies:    [replySchema],                      // admin reply history

    // ── Auto ID ──────────────────────────────────────────────
    applicationId: {
      type: String,
      unique: true,
    },
  },
  { timestamps: true }
);

// Auto-generate application ID
admissionSchema.pre('save', async function (next) {
  if (!this.applicationId) {
    const year  = new Date().getFullYear();
    const count = await mongoose.model('Admission').countDocuments();
    this.applicationId = `AIPMS-${year}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

admissionSchema.index({ status: 1 });
admissionSchema.index({ isRead: 1 });
admissionSchema.index({ userId: 1 });
admissionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Admission', admissionSchema);
