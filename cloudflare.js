const fetch = require("node-fetch");

// Support multiple env var names for compatibility
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_RENDER_TOKEN || process.env.CLOUDFLARE_RENDER_TOKEN || process.env.CLOUDFLARE_TOKEN;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error("Cloudflare environment variables missing. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_RENDER_TOKEN (or CF_ACCOUNT_ID and CF_API_TOKEN)");
}

/**
 * Extract text from a webpage using Cloudflare Browser Rendering
 * 
 * Uses Cloudflare Workers Browser Rendering API to fetch and render pages
 */
async function extractWithCloudflare(url) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error('Cloudflare credentials missing');
  }

  // Debug: log resolved env values (mask token)
  const maskedToken = CF_API_TOKEN.substring(0, 10) + '***';
  console.log(`[Cloudflare] Account ID: ${CF_ACCOUNT_ID}`);
  console.log(`[Cloudflare] Token (masked): ${maskedToken}`);

  // Try the official Cloudflare Browser Rendering endpoint
  // Documentation: https://developers.cloudflare.com/workers/platform/browser-rendering/
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts`;
  
  console.log(`[Cloudflare] Using endpoint pattern for account: ${CF_ACCOUNT_ID}`);
  
  // Alternative: Use the direct render endpoint (if available in your plan)
  const renderUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/render`;
  console.log(`[Cloudflare] Attempting render endpoint: ${renderUrl}`);
  
  const renderRes = await fetch(renderUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: url,
      screenshot: false,
      html: true
    })
  });

  console.log(`[Cloudflare] Render endpoint HTTP status: ${renderRes.status}`);
  const renderData = await safeJson(renderRes);

  if (renderRes.ok && renderData.result?.html) {
    // Successfully got HTML, now extract text from it
    const html = renderData.result.html;
    const text = extractTextFromHtml(html);
    console.log(`[Cloudflare] ✓ Successfully rendered and extracted (${text.length} chars)`);
    return text;
  }

  // If render endpoint fails, throw detailed error
  const detail = renderData.errors?.[0]?.message || renderData.raw || JSON.stringify(renderData);
  throw new Error(`Render failed (HTTP ${renderRes.status}): ${detail}`);
}

/**
 * Simple HTML text extraction (used by Cloudflare fallback)
 */
function extractTextFromHtml(html) {
  try {
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.substring(0, 20000); // Limit to 20k chars
  } catch (e) {
    throw new Error(`HTML extraction failed: ${e.message}`);
  }
}

// Helper to avoid JSON parse crashes
async function safeJson(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { raw: txt };
  }
}

module.exports = { extractWithCloudflare };
