const fetch = require("node-fetch");
require("dotenv").config();

const LLM_API_URL = process.env.LLM_API_URL;   // For Gemini → leave empty
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL; // or gemini-1.5-pro

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
// const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const GROQ_API_KEY = process.env.OTHER_API_KEY;

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
  // const url = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}`;


  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${userPrompt}\n\n${text.substring(0, 30000)}`
          }
        ]
      }
    ],
    generationConfig: {
      max_output_tokens: 1024, // Increased from likely 100-200
      temperature: 0.1,        // Low temperature makes it more accurate with lists
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
 * Groq API (The reliable 2026 fallback)
 */
async function callGroqAPI(text, userPrompt) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');


  // 1. THE SLICE: Ensure we stay under ~9,000 tokens to leave room for the prompt/response
  const maxChars = 15000;
  const slicedText = text.length > maxChars
    ? text.substring(0, maxChars) + "... [Truncated for Token Limits]"
    : text;

  const body = {
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: 'system', content: 'You are an expert news editor. Clean up formatting and follow the task exactly.' },
      { role: 'user', content: `${userPrompt}\n\nContent:\n${slicedText}` }
    ],
    max_tokens: 1500, // Increased for full translation lists
    temperature: 0.2
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${data.error?.message || 'Unknown'}`);

  return data.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * MAIN summarizer entry
 */
async function summarizeText(rawText, userPrompt = "Provide a concise summary") {
  if (!LLM_API_KEY && !GROQ_API_KEY) throw new Error("No API keys configured");
  if (!rawText || !rawText.trim()) throw new Error("Empty text to summarize");

  const cleaned = rawText.replace(/\s+/g, " ").trim();

  // 1) PRIMARY: Try Gemini
  if (LLM_API_KEY) {
    try {
      console.log("[LLM] Using Google Gemini API (Primary)...");
      return await callGeminiAPI(cleaned, userPrompt);
    } catch (err) {
      console.error("[LLM] Gemini Primary Failed:", err.message);

      // Handle specific "Messy HTML" or "Empty Result" with a small-input fallback
      if (/empty|unrecognized|json/i.test(err.message)) {
        try {
          const small = cleaned.substring(0, 1000);
          console.log('[LLM] Attempting Gemini small-input fallback...');
          return await callGeminiAPI(small, `${userPrompt} (short-input fallback)`);
        } catch (err2) {
          console.error('[LLM] Gemini small-input fallback failed:', err2.message);
        }
      }
      // If we are here, Gemini is totally out. Fall through to Groq.
    }
  }

  // 2) FALLBACK: Try Groq
  if (GROQ_API_KEY) {
    try {
      console.log('[LLM] Gemini down. Triggering Groq Fallback...');
      return await callGroqAPI(cleaned, userPrompt);
    } catch (err) {
      console.error('[LLM] Groq Fallback failed:', err.message);
      throw err;
    }
  }

  throw new Error('All LLM providers (Gemini & Groq) failed');
}

async function extractWeatherParams(userPrompt) {
  const systemPrompt = "Extract the city/location from the user's weather request. Return ONLY a JSON object: {\"location\": \"CityName\"}. Default to 'Mumbai' if none found.";
  
  // Directly calling your Groq fallback logic
  const rawJson = await callGroqAPI("N/A", `${systemPrompt}\n\nUser Request: ${userPrompt}`);
  
  try {
    const cleanJson = rawJson.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("[Weather] Param extraction failed, using default.");
    return { location: "Mumbai" };
  }
}

module.exports = { summarizeText , extractWeatherParams};
