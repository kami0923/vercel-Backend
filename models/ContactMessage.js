// server/models/ContactMessage.js
const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  message:   { type: String, required: true },
  sentBy:    { type: String, default: 'Admin' },
  sentAt:    { type: Date, default: Date.now },
  emailSent: { type: Boolean, default: false },
});

const contactSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    phone:   { type: String, trim: true, default: '' },
    email:   { type: String, trim: true, lowercase: true, default: '' },
    subject: { type: String, trim: true, default: 'General Inquiry' },
    message: { type: String, required: true, trim: true },
    isRead:  { type: Boolean, default: false },
    status:  {
      type: String,
      enum: ['New', 'Read', 'Replied', 'Closed'],
      default: 'New',
    },
    replies: [replySchema],
  },
  { timestamps: true }
);

contactSchema.index({ isRead: 1 });
contactSchema.index({ status: 1 });
contactSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactSchema);
