// server/utils/emailService.js
const nodemailer = require('nodemailer');

const createTransporter = () => nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false },
});

const isEmailConfigured = () =>
  process.env.EMAIL_USER && process.env.EMAIL_PASS &&
  process.env.EMAIL_USER !== 'your_gmail@gmail.com';

const wrap = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:0}
  .c{max-width:600px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
  .hd{background:linear-gradient(135deg,#094d29,#1a8f4e);padding:28px 32px}
  .hd h1{color:#fff;margin:0;font-size:20px;font-family:Georgia,serif}
  .hd p{color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px}
  .bd{padding:28px 32px;color:#333;line-height:1.7}
  .box{background:#f0fdf4;border-left:4px solid #0d6e3a;border-radius:4px;padding:14px 18px;margin:16px 0;word-break:break-all}
  .pw-box{background:#fff3cd;border-left:4px solid #c49a1a;border-radius:4px;padding:16px 20px;margin:16px 0;font-size:1.1rem;font-weight:bold;letter-spacing:2px;text-align:center;color:#333}
  .btn{display:inline-block;background:#0d6e3a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:12px 0}
  hr{border:none;border-top:1px solid #eee;margin:20px 0}
  .ft{background:#f9f9f9;padding:18px 32px;text-align:center;font-size:12px;color:#888;border-top:1px solid #eee}
  .ft strong{color:#0d6e3a}
  .badge{display:inline-block;padding:5px 14px;border-radius:100px;font-size:12px;font-weight:bold}
  .b-green{background:#d1fae5;color:#065f46}
  .b-red{background:#fee2e2;color:#7f1d1d}
  .b-blue{background:#dbeafe;color:#1e40af}
  .b-yellow{background:#fef3c7;color:#78350f}
</style></head><body>
<div class="c">
  <div class="hd"><h1>Allama Iqbal Public Model School</h1><p>Village Bagrianwala, Gujrat, Punjab, Pakistan</p></div>
  <div class="bd">${content}</div>
  <div class="ft"><strong>Allama Iqbal Public Model School</strong><br>
  Village Bagrianwala, Gujrat &bull; 0300-1234567 &bull; info@aipms.edu.pk</div>
</div></body></html>`;

// Send reset password email with new password
const sendPasswordReset = async ({ to, name, newPassword }) => {
  if (!isEmailConfigured()) {
    console.log('📧 Email not configured. New password would be:', newPassword);
    return { sent: false, reason: 'Email not configured', newPassword };
  }
  const html = wrap(`
    <p>Dear <strong>${name}</strong>,</p>
    <p>We received a request to reset your password for your <strong>AIPMS Portal</strong> account.</p>
    <p>Your new temporary password is:</p>
    <div class="pw-box">🔑 ${newPassword}</div>
    <p>Please log in using this password and change it immediately from your Profile settings.</p>
    <hr>
    <p style="color:#dc2626;font-size:.85rem">⚠️ If you did not request this, please contact the school office immediately.</p>
    <p>JazakAllah Khair,<br><strong>AIPMS Administration</strong></p>
  `);
  try {
    const t = createTransporter();
    await t.sendMail({
      from: process.env.EMAIL_FROM || `AIPMS <${process.env.EMAIL_USER}>`,
      to, subject: 'Password Reset — AIPMS Student Portal', html,
    });
    console.log('✅ Password reset email sent to', to);
    return { sent: true };
  } catch (err) {
    console.error('❌ Password reset email failed:', err.message);
    return { sent: false, reason: err.message };
  }
};

const sendWelcomeEmail = async ({ to, name, provider = 'local' }) => {
  if (!isEmailConfigured()) return;
  const html = wrap(`
    <p>Dear <strong>${name}</strong>,</p>
    <p>Welcome to the <strong>Allama Iqbal Public Model School</strong> student portal!</p>
    ${provider === 'google' ? '<div class="box">You signed in with <strong>Google</strong>. Your account is linked to your Gmail.</div>' : ''}
    <p>You can now submit your admission application, track its status, and receive updates directly to your email.</p>
    <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/portal" class="btn">Open My Portal →</a>
    <p>JazakAllah Khair,<br><strong>AIPMS Administration</strong></p>
  `);
  try {
    const t = createTransporter();
    await t.sendMail({
      from: process.env.EMAIL_FROM || `AIPMS <${process.env.EMAIL_USER}>`,
      to, subject: 'Welcome to AIPMS Student Portal', html,
    });
  } catch (err) { console.error('Welcome email failed:', err.message); }
};

const sendAdmissionReply = async ({ to, studentName, applicationId, status, message }) => {
  if (!isEmailConfigured()) { console.log('📧 Email not configured — reply not sent.'); return { sent: false }; }
  const statusMap = {
    Accepted: 'b-green', Rejected: 'b-red',
    'Under Review': 'b-blue', Waitlisted: 'b-yellow', Pending: 'b-yellow',
  };
  const cls = statusMap[status] || 'b-yellow';
  const html = wrap(`
    <p>Dear <strong>${studentName}</strong>,</p>
    <p>This is an update regarding your admission application at Allama Iqbal Public Model School.</p>
    <div class="box">
      <strong>Application ID:</strong> ${applicationId}<br>
      <strong>Status:</strong> <span class="badge ${cls}">${status}</span>
    </div>
    <hr>
    <p><strong>Message from Administration:</strong></p>
    <p style="background:#f9f9f9;padding:14px;border-radius:8px">${message.replace(/\n/g,'<br>')}</p>
    <hr>
    <p>For questions, call <strong>0300-1234567</strong> or visit the school office.</p>
    <p>JazakAllah Khair,<br><strong>Admissions Office — AIPMS</strong></p>
  `);
  try {
    const t = createTransporter();
    await t.sendMail({
      from: process.env.EMAIL_FROM || `AIPMS <${process.env.EMAIL_USER}>`,
      to, subject: `Admission Update — ${applicationId} | AIPMS`, html,
    });
    return { sent: true };
  } catch (err) { console.error('❌ Admission email failed:', err.message); return { sent: false, reason: err.message }; }
};

const sendContactReply = async ({ to, name, subject, message }) => {
  if (!isEmailConfigured()) { console.log('📧 Email not configured.'); return { sent: false }; }
  const html = wrap(`
    <p>Dear <strong>${name}</strong>,</p>
    <p>Thank you for contacting <strong>Allama Iqbal Public Model School</strong>. Here is our response:</p>
    <div class="box"><strong>Your Query:</strong> ${subject || 'General Inquiry'}</div>
    <hr>
    <p><strong>Our Response:</strong></p>
    <p style="background:#f9f9f9;padding:14px;border-radius:8px">${message.replace(/\n/g,'<br>')}</p>
    <hr>
    <p>For further help: <strong>0300-1234567</strong></p>
    <p>Warm regards,<br><strong>AIPMS Administration</strong></p>
  `);
  try {
    const t = createTransporter();
    await t.sendMail({
      from: process.env.EMAIL_FROM || `AIPMS <${process.env.EMAIL_USER}>`,
      to, subject: `Re: ${subject || 'Your Inquiry'} | AIPMS`, html,
    });
    return { sent: true };
  } catch (err) { return { sent: false, reason: err.message }; }
};

module.exports = { sendPasswordReset, sendWelcomeEmail, sendAdmissionReply, sendContactReply };
