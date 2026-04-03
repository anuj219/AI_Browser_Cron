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

    const structured = await extractStructuredData(page);
    console.log(`[Extractor] Structured Data Found: ${structured ? 'Yes' : 'No'}`);

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
    const isListTask = /news|headline|top|latest/i.test(userPrompt) && !/price|buy|cost/i.test(userPrompt);

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
    // STRATEGY B: For Deep-Dive Articles (UPGRADED)
    else {
      console.log("[Extractor] Article task detected: Using Readability");

      const reader = new Readability(doc);
      const article = reader.parse();

      // STEP 1: Try Readability
      // console.log("[Extractor > Readability] Article: ", article.textContent.substring(0, 25000));
      if (article && article.textContent && article.textContent.length > 800) {
        extractedText = article.textContent;
        method = "readability";
      }
      else {
        console.log("[Extractor] Readability weak. Trying HTML → Markdown...");

        // STEP 2: Try HTML → Markdown
        extractedText = turndownService.turndown(doc.body.innerHTML);

        // STEP 3: FINAL FALLBACK (CRITICAL FIX)
        if (!extractedText || extractedText.trim().length < 200) {
          console.log("[Extractor] Markdown weak. Falling back to raw visible text...");

          extractedText = await page.evaluate(() => document.body.innerText);
          method = "raw-text-fallback";
        } else {
          method = "playwright-markdown";
        }
      }
    }

    await browser.close();

    return {
      success: true,
      text: extractedText.substring(0, 25000), // Increased limit for Gemini
      structured: structured,
      title: title,
      method: method
    };

  } catch (err) {
    if (browser) await browser.close();
    return { success: false, error: err.message };
  }
}


// For price tracking feature
async function extractStructuredData(page) {
  return await page.evaluate(() => {
    let productInfo = null;

    // 1. Search JSON-LD
    const ldJsonTags = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const tag of ldJsonTags) {
      try {
        const data = JSON.parse(tag.textContent);
        const items = Array.isArray(data) ? data : [data];

        // Find the actual product entry
        const found = items.find(i => i['@type'] === 'Product' || i['@type'] === 'Offer');
        if (found) {
          productInfo = {
            source: 'json-ld',
            name: found.name,
            price: found.offers?.price || found.offers?.[0]?.price,
            currency: found.offers?.priceCurrency || found.offers?.[0]?.priceCurrency,
            availability: found.offers?.availability || found.offers?.[0]?.availability
          };
          break;
        }
      } catch (e) { }
    }

    // 2. Fallback to Meta Tags (OpenGraph/Twitter) if JSON-LD failed
    if (!productInfo || !productInfo.price) {
      productInfo = {
        source: 'meta-tags',
        name: document.querySelector('meta[property="og:title"]')?.content,
        price: document.querySelector('meta[property="product:price:amount"]')?.content ||
          document.querySelector('meta[name="twitter:data1"]')?.content,
        currency: document.querySelector('meta[property="product:price:currency"]')?.content
      };
    }

    return productInfo;
  });
}

// for fetch_weather feature
// async function extractWeatherParams(userPrompt) {
//   const extractionPrompt = `
//     TASK: Extract the location (city) from the user's weather request.
//     PROMPT: "${userPrompt}"
//     RULE: Return ONLY a JSON object like {"location": "CityName"}. 
//     If no location is found, use "Mumbai".
//   `;

//   // Use a cheap/fast model call (Gemini Flash is perfect here)
//   const rawJson = await summarizeText("N/A", extractionPrompt);
//   try {
//     // Clean potential markdown backticks from LLM output
//     const cleanJson = rawJson.replace(/```json|```/g, "").trim();
//     return JSON.parse(cleanJson);
//   } catch (e) {
//     return { location: "Delhi" };
//   }
// }

module.exports = { extractContent };