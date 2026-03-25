const { chromium } = require('playwright');
const TurndownService = require('turndown');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '*'
});

// PASS THE PROMPT HERE
async function extractContent(url, userPrompt = "") {
  let browser;
  try {
    console.log(`[Extractor] Launching browser for: ${url}`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // --- NEW: Trigger Lazy Loading ---
    // Scroll down slightly to make sure dynamic news cards load
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(1000); 

    const html = await page.content();
    const title = await page.title();
    const dom = new JSDOM(html);
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