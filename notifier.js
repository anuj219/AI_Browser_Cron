const { Resend } = require('resend');
require('dotenv').config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@aera.dev';

let resendClient = null;

/**
 * Initialize Resend client
 */
function initResend() {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured - email notifications will be skipped');
    return null;
  }
  resendClient = new Resend(RESEND_API_KEY);
  return resendClient;
}

/**
 * Send email notification via Resend
 * @param {object} params - { to, subject, summary, title }
 * @returns {Promise<object>} - { success, result, error }
 */
async function sendEmail(params) {
  const { to, subject, summary, title } = params;

  if (!RESEND_API_KEY) {
    console.warn('Email skipped: RESEND_API_KEY not configured');
    return { success: false, error: 'Resend not configured' };
  }

  try {
    if (!resendClient) {
      initResend();
    }

    const html = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2c3e50;">📰 ${title || 'Workflow Summary'}</h2>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Summary</h3>
            <pre style="white-space: pre-wrap; word-wrap: break-word; font-size: 14px;">${summary}</pre>
          </div>
          <hr />
          <p style="color: #7f8c8d; font-size: 12px;">
            Automated notification from Aera Cloud Scheduler
          </p>
        </body>
      </html>
    `;

    const result = await resendClient.emails.send({
      from: FROM_EMAIL,
      to,
      subject: subject || 'Aera Workflow Summary',
      html,
    });

    console.log(`[Email] Sent to ${to}`);
    return { success: true, result };
  } catch (err) {
    console.error('Email error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Save in-app notification (stored in database as result)
 * This is handled by workflows.js calling createWorkflowResult()
 */
async function saveInAppNotification(params) {
  // In-app notifications are handled by saving workflow_results
  // This function is here for API consistency
  return { success: true, method: 'in-app' };
}

// Initialize on module load
initResend();

module.exports = {
  initResend,
  sendEmail,
  saveInAppNotification,
};
