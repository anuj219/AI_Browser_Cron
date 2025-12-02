/**
 * Simple extraction using Readability only.
 * Playwright is disabled for Railway compatibility.
 */

const { JSDOM } = require("jsdom");
const fetch = require("node-fetch");

/**
 * Extract text using Mozilla Readability.
 */
function extractUsingReadability(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new (require("readability"))(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.length < 50) {
      return { success: false, error: "Insufficient content (Readability)" };
    }

    return {
      success: true,
      method: "readability",
      title: article.title || "",
      text: article.textContent
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Main exported function: Extract content from a URL
 */
async function extractContent(url) {
  console.log(`[Extractor] Fetching: ${url}`);

  try {
    const res = await fetch(url);
    const body = await res.text();

    // Try Readability first
    const readable = extractUsingReadability(body, url);
    if (readable.success) {
      return readable;
    }

    // Since Playwright is removed, no fallback
    return {
      success: false,
      error: "Readability failed (Playwright disabled for Railway)"
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { extractContent };
