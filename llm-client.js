const fetch = require("node-fetch");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const LLM_API_URL = process.env.LLM_API_URL;   // For Gemini → leave empty
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL; // or gemini-1.5-pro

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
// const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

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
  // 1. Initialize the SDK
  // Note: Check your .env to ensure the key name is LLM_API_KEY
  const genAI = new GoogleGenerativeAI(process.env.LLM_API_KEY);

  try {
    // 2. Select the latest 2026 Model
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.1, // Keeps facts stable for price tracking
      }
    });

    console.log('[LLM] Sending request to Gemini 2.5 Flash...');

    // 3. Generate Content
    // We combine the prompt and the text context clearly
    const result = await model.generateContent([
      userPrompt,
      { text: text.substring(0, 30000) }
    ]);

    const response = await result.response;
    const summary = response.text();

    // 4. DEEP LOGGING (To avoid seeing [Object])
    // This lets you see the full reasoning in your console
    console.log('[LLM] Gemini Response Received:');
    console.log('-----------------------------------');
    console.log(summary); 
    console.log('-----------------------------------');

    if (!summary || summary.trim().length === 0) {
      throw new Error("Gemini returned empty text.");
    }

    return summary;

  } catch (error) {
    // Detailed error logging for your Testing & Debugging section
    console.error('[LLM] Gemini SDK Error:', error.message);
    
    // If it's an API Key error, we log a specific tip
    if (error.message.includes("API key not valid")) {
      console.error("👉 TIP: Check if your .env variable 'LLM_API_KEY' is correct and has no spaces.");
    }

    // Re-throw so your Groq Fallback logic can catch it and take over
    throw error; 
  }
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
  console.log("[GROQ Text]:", data.choices[0].message.content);
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
      // console.log(`[LLM-GROQ] cleaned - ${cleaned}, \n userPrompt - ${userPrompt}`);
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
  const rawJson = await callGroqAPI("N/A", `${systemPrompt}\n\nUser Request: ${userPrompt.substring(0, 12000)}`);

  try {
    const cleanJson = rawJson.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("[Weather] Param extraction failed, using default.");
    return { location: "Mumbai" };
  }
}

async function generateExtractionSchema(userPrompt) {
  const systemPrompt = `
  You are an Autonomous Extraction Architect for a Model Context Protocol (MCP) agent.
  Your goal is to analyze a user's tracking task and design a JSON Extraction Schema for Firecrawl.

  RULES:
  1. IDENTIFY INTENT: Determine if the user wants to track a Price, Stock Availability, a Version Number, Railway PNR Tracking or a general Fact.
  2. DYNAMIC PROPERTIES: Design the "properties" object to match the facts needed (e.g., use "price" for money, "availability" for stock, "headline" for news, "current status" for pnr etc).
  3. DATA TYPES: Use "number" for prices/counts and "string" for statuses/names.
  4. CLEAN FACTS: Do NOT include user-defined thresholds (e.g., "61L") in the schema. Only extract what is visible on the website.
  5. CURRENCY: Always convert shorthand (L/Lakhs -> 100000, Cr/Crores -> 1000000) into descriptions.

  RETURN ONLY JSON in this format:
  {
    "use_mcp": true,
    "domain": "ecommerce | finance | news | general",
    "schema": {
      "type": "object",
      "properties": { 
        /* Dynamic properties here */ 
      },
      "required": ["primary_variable_name"]
    }
  }

  If the request is a simple conversation or doesn't require structured web data, set use_mcp to false.
`;

  // Standard cleanup and execution
  const response = await callGroqAPI("N/A", `${systemPrompt}\n\nUser Prompt: ${userPrompt}`);

  try {
    // Robust parsing to handle potential markdown wrappers
    const cleanedJson = response.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanedJson);
  } catch (e) {
    console.error("[Schema Generator] Failed to parse dynamic schema:", e);
    return { use_mcp: false, schema: {}, domain: "general" };
  }
}



module.exports = { summarizeText, extractWeatherParams, generateExtractionSchema };