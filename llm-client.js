const fetch = require("node-fetch");
require("dotenv").config();

const LLM_API_URL = process.env.LLM_API_URL;   // For Gemini → leave empty
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-1.5-flash"; // or gemini-1.5-pro

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

/**
 * Detect if using Google Gemini
 */
function isGoogleGemini() {
  return true; // You ONLY use Gemini, so simplify detection
}

/**
 * UNIVERSAL RESPONSE PARSER for all Gemini API formats
 */
function extractGeminiText(data) {
  // Newest format: output_text
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Standard Gemini response (candidates[].content.parts[].text)
  if (Array.isArray(data.candidates)) {
    const c = data.candidates[0];

    // Standard parts
    if (c?.content?.parts?.length) {
      const txt = c.content.parts
        .map((p) => p.text || "")
        .join("\n")
        .trim();

      if (txt) return txt;
    }

    // Some responses use a "text" field inside candidates
    if (typeof c?.text === "string" && c.text.trim()) {
      return c.text.trim();
    }
  }

  // Rare old format: .text field on root
  if (typeof data.text === "string" && data.text.trim()) {
    return data.text.trim();
  }

  return "";
}

/**
 * Call Google Gemini API with modern universal format
 */
async function callGeminiAPI(text, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${userPrompt}\n\n${text.substring(0, 4000)}`
          }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: 600,
      temperature: 0.7,
    }
  };

  // Diagnostics: log a trimmed snapshot of the request payload (avoid sensitive data)
  try {
    const payloadSnapshot = JSON.stringify(requestBody).substring(0, 2000);
    console.log('[LLM] Gemini request snapshot (trimmed):', payloadSnapshot);
    console.log('[LLM] Gemini request headers:', { 'Content-Type': 'application/json' });
    // Log url without key for safety
    const safeUrl = url.replace(/([?&])key=[^&]+/, '$1key=REDACTED');
    console.log('[LLM] Gemini endpoint (safe):', safeUrl);
  } catch (e) {
    console.error('[LLM] Failed to build request snapshot for diagnostics');
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    timeout: 30000,
  });

  const raw = await response.text();
  let data;

  // Safe JSON parse
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Include a small raw snapshot for diagnostics
    throw new Error(`Gemini returned non-JSON response: ${raw.substring(0, 300)}`);
  }

  if (!response.ok) {
    // Provide trimmed raw body for error diagnostics
    throw new Error(`Gemini API error ${response.status}: ${raw.substring(0, 500)}`);
  }

  const summary = extractGeminiText(data);
  if (!summary) {
    // Log a trimmed snapshot of the raw response for debugging (avoid dumping huge payloads)
    try {
      const snapshot = JSON.stringify(data, Object.keys(data).slice(0, 20), 2).substring(0, 1500);
      console.error('[LLM] Gemini raw response snapshot:', snapshot);
    } catch (e) {
      console.error('[LLM] Failed to stringify Gemini response for diagnostics');
    }

    throw new Error("Gemini returned empty or unrecognized format");
  }

  return summary;
}

/**
 * OpenAI-like API (unused, but kept for fallback)
 */
async function callOpenAIAPI(text, userPrompt) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const messages = [
    { role: 'system', content: 'You are a helpful assistant that creates concise, accurate summaries.' },
    { role: 'user', content: `${userPrompt}\n\nContent:\n${text.substring(0, 4000)}` }
  ];

  const body = {
    model: OPENAI_MODEL,
    messages,
    max_tokens: 500,
    temperature: 0.7
  };

  // Diagnostics
  try {
    console.log('[LLM] OpenAI request snapshot (trimmed):', JSON.stringify(body).substring(0, 1000));
    console.log('[LLM] OpenAI endpoint (safe):', OPENAI_API_URL);
  } catch (e) {}

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body),
    timeout: 30000
  });

  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch (e) { throw new Error(`OpenAI returned non-JSON response: ${txt.substring(0,300)}`); }

  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${txt.substring(0,500)}`);
  }

  const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
  if (typeof content === 'string' && content.trim()) return content.trim();

  throw new Error('OpenAI returned empty or unrecognized format');
}

/**
 * MAIN summarizer entry
 */
async function summarizeText(rawText, userPrompt = "Provide a concise summary") {
  if (!LLM_API_KEY && !OPENAI_API_KEY) throw new Error("No LLM API key configured (LLM_API_KEY or OPENAI_API_KEY required)");
  if (!rawText || !rawText.trim()) throw new Error("Empty text to summarize");

  const cleaned = rawText.replace(/\s+/g, " ").trim();

  // 1) Try Gemini if key present
  if (LLM_API_KEY) {
    try {
      console.log("[LLM] Using Google Gemini API...");
      return await callGeminiAPI(cleaned, userPrompt);
    } catch (err) {
      console.error("LLM summarization error (Gemini):", err.message);

      // small-input fallback for Gemini
      if (/empty or unrecognized format|returned non-JSON response/i.test(err.message)) {
        try {
          const small = cleaned.substring(0, 800);
          console.log('[LLM] Attempting Gemini small-input fallback (800 chars)');
          const smallSummary = await callGeminiAPI(small, `${userPrompt} (short-input fallback)`);
          console.log('[LLM] Gemini small-input fallback succeeded');
          return smallSummary;
        } catch (err2) {
          console.error('[LLM] Gemini small-input fallback failed:', err2.message);
        }
      }
      // If Gemini fails entirely, fall through to OpenAI (if available)
    }
  }

  // 2) Try OpenAI fallback if configured
  if (OPENAI_API_KEY) {
    try {
      console.log('[LLM] Falling back to OpenAI API...');
      return await callOpenAIAPI(cleaned, userPrompt);
    } catch (err) {
      console.error('[LLM] OpenAI fallback failed:', err.message);
      throw err;
    }
  }

  // 3) No provider succeeded
  throw new Error('All LLM providers failed to produce a summary');
}

module.exports = {
  summarizeText,
};
