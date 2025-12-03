const fetch = require("node-fetch");

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error("Cloudflare environment variables missing");
}

/**
 * Extract text from a webpage using Cloudflare Browser Rendering
 */
async function extractWithCloudflare(url) {
  // 1. Create a browser session
  const sessionRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/v1/sessions`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        browser: "chromium",
        viewport: { width: 1200, height: 1200 }
      })
    }
  );

  const sessionData = await safeJson(sessionRes);

  if (!sessionRes.ok) {
    throw new Error(`Session create failed: ${JSON.stringify(sessionData)}`);
  }

  const sessionId = sessionData.result.id;

  // 2. Navigate to the URL
  const navRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/v1/sessions/${sessionId}/navigate`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    }
  );

  const navData = await safeJson(navRes);

  if (!navRes.ok) {
    throw new Error(`Navigation failed: ${JSON.stringify(navData)}`);
  }

  // 3. Extract page content (DOM text)
  const contentRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/v1/sessions/${sessionId}/content/text`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`
      }
    }
  );

  const contentData = await safeJson(contentRes);

  if (!contentRes.ok || !contentData.result?.text) {
    throw new Error(`Text extraction failed: ${JSON.stringify(contentData)}`);
  }

  const text = contentData.result.text;

  // 4. Cleanup session
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/v1/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`
      }
    }
  );

  return text;
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
