const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const playwright = require('playwright');
const fetch = require('node-fetch');
require('dotenv').config();

const PLAYWRIGHT_TIMEOUT = parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000', 10);
const MIN_CONTENT_LENGTH = 200;

/**
 * Extract content using Readability (Mozilla)
 * @param {string} html - Raw HTML content
 * @param {string} url - URL for context
 * @returns {object} - { text, title, success }
 */
function extractWithReadability(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return { text: null, title: null, success: false };
    }

    // Extract clean text
    const textContent = dom.window.document.body.innerText || '';
    const cleanText = textContent.trim();

    if (cleanText.length < MIN_CONTENT_LENGTH) {
      return { text: null, title: null, success: false };
    }

    return {
      text: cleanText,
      title: article.title || null,
      success: true,
    };
  } catch (err) {
    console.error('Readability extraction error:', err.message);
    return { text: null, title: null, success: false };
  }
}

/**
 * Extract content using Playwright (headless Chrome)
 * @param {string} url - URL to scrape
 * @returns {Promise<object>} - { text, title, success }
 */
async function extractWithPlaywright(url) {
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);
    page.setDefaultNavigationTimeout(PLAYWRIGHT_TIMEOUT);

    // Navigate and wait for network idle
    await page.goto(url, { waitUntil: 'networkidle' });

    // Extract content
    const textContent = await page.evaluate(() => document.body.innerText);
    const title = await page.evaluate(() => document.title);

    const cleanText = (textContent || '').trim();

    if (cleanText.length < MIN_CONTENT_LENGTH) {
      await context.close();
      await browser.close();
      return { text: null, title: null, success: false };
    }

    await context.close();
    await browser.close();

    return {
      text: cleanText,
      title: title || null,
      success: true,
    };
  } catch (err) {
    console.error('Playwright extraction error:', err.message);
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('Error closing browser:', closeErr.message);
      }
    }
    return { text: null, title: null, success: false };
  }
}

/**
 * Hybrid extraction: try Readability first, fallback to Playwright
 * @param {string} url - URL to extract content from
 * @returns {Promise<object>} - { text, title, method, success, error }
 */
async function extractContent(url) {
  try {
    // Fetch HTML
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: PLAYWRIGHT_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Try Readability first (fast)
    const readabilityResult = extractWithReadability(html, url);
    if (readabilityResult.success) {
      return {
        text: readabilityResult.text,
        title: readabilityResult.title,
        method: 'readability',
        success: true,
      };
    }

    console.log(`[${url}] Readability failed, trying Playwright...`);

    // Fallback to Playwright (slower but handles JS)
    const playwrightResult = await extractWithPlaywright(url);
    if (playwrightResult.success) {
      return {
        text: playwrightResult.text,
        title: playwrightResult.title,
        method: 'playwright',
        success: true,
      };
    }

    // Both failed
    return {
      text: null,
      title: null,
      method: null,
      success: false,
      error: 'Both extraction methods returned insufficient content',
    };
  } catch (err) {
    console.error(`[${url}] Extraction error: ${err.message}`);
    return {
      text: null,
      title: null,
      method: null,
      success: false,
      error: err.message,
    };
  }
}

module.exports = {
  extractContent,
  extractWithReadability,
  extractWithPlaywright,
};
