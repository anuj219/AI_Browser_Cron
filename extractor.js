const { chromium } = require('playwright');
const TurndownService = require('turndown');
const { Readability } = require('@mozilla/readability');
const { JSDOM, VirtualConsole } = require('jsdom');

// This stops JSDOM from screaming about CSS it doesn't understand
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => { /* Silence is golden */ });
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '*'
});

// PASS THE PROMPT HERE
async function extractContent(url, userPrompt = "") {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    // THE STEALTH FIX
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    // Set extra headers to look like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/'
    });

    console.log(`[Extractor] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Human breather
    await page.waitForTimeout(Math.floor(Math.random() * 2000) + 2000);

    const html = await page.content();
    if (html.includes("Access Denied")) {
      // Try one more thing: scroll and wait
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(2000);
    }
    const title = await page.title();
    const dom = new JSDOM(html, { virtualConsole });
    const doc = dom.window.document;

    // --- NEW: Identify Intent ---
    const isListTask = /news|headline|list|top|latest/i.test(userPrompt);

    let extractedText = "";
    let method = "";

    // STRATEGY A: For "List" tasks (Headlines, Top News)
    if (isListTask) {
      console.log("[Extractor] List task detected: Using Structural Markdown");

      // Target the 'main' content or 'body'
      const container = doc.querySelector('main') || doc.querySelector('body');

      // CLEAN THE JUNK: Remove things that confuse LLMs
      const junkSelectors = ['script', 'style', 'noscript', 'iframe', 'header', 'footer', 'nav', '.ads', '.cookie-banner'];
      junkSelectors.forEach(sel => {
        container.querySelectorAll(sel).forEach(el => el.remove());
      });

      extractedText = turndownService.turndown(container.innerHTML);
      // console.log("Extracted Text: ", extractedText);
      method = "playwright-markdown-structural";
    }
    // STRATEGY B: For Deep-Dive Articles
    else {
      console.log("[Extractor] Article task detected: Using Readability");
      const reader = new Readability(doc);
      const article = reader.parse();

      if (article && article.textContent.length > 800) {
        extractedText = article.textContent;
        method = "readability";
      } else {
        extractedText = turndownService.turndown(doc.body.innerHTML);
        method = "playwright-fallback";
      }
    }

    await browser.close();

    return {
      success: true,
      text: extractedText.substring(0, 25000), // Increased limit for Gemini
      title: title,
      method: method
    };

  } catch (err) {
    if (browser) await browser.close();
    return { success: false, error: err.message };
  }
}

module.exports = { extractContent };