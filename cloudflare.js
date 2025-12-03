const fetch = require('node-fetch');

async function extractWithCloudflare(url, maxChars = 12000) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_RENDER_TOKEN;

  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/v1/render`;

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url,
      render: {
        html: true,
        screenshot: false,
        scroll: true
      }
    })
  });

  const data = await resp.json();

  if (!data?.result?.html) {
    throw new Error("Cloudflare rendering failed");
  }

  // Strip tags → convert to text
  const raw = data.result.html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return raw.slice(0, maxChars);
}

module.exports = { extractWithCloudflare };
