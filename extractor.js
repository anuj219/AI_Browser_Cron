/**
 * Simple extraction using Cloudflare Browser Rendering + Readability fallback
 */

const { JSDOM } = require("jsdom");
const fetch = require("node-fetch");
const { extractWithCloudflare } = require("./cloudflare");
const { Readability } = require("@mozilla/readability");

/**
 * Extract text using Mozilla Readability.
 */
function extractUsingReadability(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.length < 80) {
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
 * Basic fallback extractor.
 */
function extractUsingBasicParser(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    Array.from(doc.querySelectorAll("script, style, nav, footer")).forEach(el =>
      el.remove()
    );

    const main =
      doc.querySelector("main") ||
      doc.querySelector("article") ||
      doc.querySelector("body");

    const text = (main?.textContent || "")
      .replace(/\s+/g, ' ')
      .replace(/(Advertisement|ADVT|Sponsored|Subscriber Only|Best Of Premium)/gi, '')
      .replace(/([A-Za-z]+\s+News\s+Update:.*?)\d{4}/gi, '')
      .replace(/(Latest News|Trending|Most Read|Top Stories)/gi, '')
      .replace(/[\|\•\(\)\[\]]+/g, ' ')
      .replace(/.{4000,}$/s, '')   // hard limit input to 4000 chars
      .trim();

    if (text.length < 150) {
      return { success: false, error: "Insufficient content (Basic)" };
    }

    return {
      success: true,
      method: "basic-parser",
      title: doc.querySelector("title")?.textContent || "",
      text
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Extract from URL
 */
async function extractContent(url) {
  console.log(`[Extractor] Fetching: ${url}`);

  // --------------------------
  // 1. TRY CLOUDFLARE FIRST
  // --------------------------
  try {
    console.log("[Extractor] Attempting Cloudflare...");

    const cf = await extractWithCloudflare(url);

    if (cf && typeof cf === "string" && cf.trim().length > 200) {
      console.log(`[Extractor] ✓ Cloudflare success (${cf.length} chars)`);
      return { success: true, method: "cloudflare", title: null, text: cf };
    } else {
      console.warn("[Extractor] Cloudflare returned insufficient text.");
    }

  } catch (err) {
    console.warn(`[Extractor] Cloudflare error: ${err.message}`);
  }

  // --------------------------
  // 2. FETCH RAW HTML
  let html;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 AeraCronFetcher" }
    });

    html = await res.text();
  } catch (err) {
    return { success: false, error: `HTTP fetch failed: ${err.message}` };
  }

  // --------------------------
  // 3. READABILITY
  // --------------------------
  console.log("[Extractor] Attempting Readability...");
  const readable = extractUsingReadability(html, url);

  if (readable.success) {
    console.log(
      `[Extractor] ✓ Readability success (${readable.text.length} chars)`
    );
    return readable;
  }

  // --------------------------
  // 4. BASIC PARSER
  // --------------------------
  console.log("[Extractor] Attempting Basic parser...");
  const basic = extractUsingBasicParser(html, url);

  if (basic.success) {
    console.log(
      `[Extractor] ✓ Basic parser success (${basic.text.length} chars)`
    );
    return basic;
  }

  // --------------------------
  // 5. FINAL FAILURE
  // --------------------------
  return {
    success: false,
    error: `All methods failed. Readability: ${readable.error}, Basic: ${basic.error}`
  };
}

module.exports = { extractContent };
