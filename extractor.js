/**
 * Simple extraction using Readability with fallback to basic HTML parsing.
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
 * Fallback: Extract text using basic HTML parsing (remove tags, get text).
 */
function extractUsingBasicParser(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    
    // Remove script and style tags
    Array.from(doc.querySelectorAll('script, style, nav, footer')).forEach(el => el.remove());
    
    // Get main content (prioritize main, article, or just body)
    const main = doc.querySelector('main') || doc.querySelector('article') || doc.querySelector('body');
    const text = main?.textContent || '';
    
    // Clean up whitespace
    const cleaned = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 500) // Limit to first 500 lines
      .join('\n');
    
    if (cleaned.length < 100) {
      return { success: false, error: "Insufficient content (Basic parser)" };
    }
    
    return {
      success: true,
      method: "basic-parser",
      title: doc.querySelector('title')?.textContent || "",
      text: cleaned
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
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    
    const body = await res.text();

    // Try Readability first
    console.log(`[Extractor] Attempting Readability...`);
    const readable = extractUsingReadability(body, url);
    if (readable.success) {
      console.log(`[Extractor] ✓ Success with Readability (${readable.text.length} chars)`);
      return readable;
    }

    console.log(`[Extractor] Readability failed, trying basic parser...`);
    const basic = extractUsingBasicParser(body, url);
    if (basic.success) {
      console.log(`[Extractor] ✓ Success with basic parser (${basic.text.length} chars)`);
      return basic;
    }

    return {
      success: false,
      error: `Both extraction methods failed: Readability - ${readable.error}, Basic - ${basic.error}`
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { extractContent };
