const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Your actual gmail
    pass: process.env.GMAIL_APP_PASS // The 16-character App Password
  }
});

async function sendEmail(params) {
  const { to, subject, summary, title } = params;

  const mailOptions = {
    from: `"Aera Agent" <${process.env.GMAIL_USER}>`,
    to,
    subject: subject || 'Aera Workflow Update',
    text: summary, // Plain text version
    html: `<div style="font-family: sans-serif;"><h2>${title}</h2><p>${summary}</p></div>`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] Sent successfully: ${info.messageId}`);
    return { success: true };
  } catch (err) {
    console.error('[Email Error]:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail };