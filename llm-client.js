const fetch = require('node-fetch');
require('dotenv').config();

const LLM_API_URL = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-3.5-turbo';

/**
 * Summarize text using LLM API (OpenAI-like)
 * @param {string} text - Text to summarize
 * @param {string} userPrompt - User's summarization prompt
 * @returns {Promise<string>} - Summarized text
 */
async function summarizeText(text, userPrompt = 'Provide a concise summary') {
  if (!LLM_API_KEY) {
    throw new Error('LLM_API_KEY not configured');
  }

  if (!text || text.trim().length === 0) {
    throw new Error('Empty text provided for summarization');
  }

  try {
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant that creates concise, accurate summaries.',
      },
      {
        role: 'user',
        content: `${userPrompt}\n\nContent:\n${text.substring(0, 4000)}`,
      },
    ];

    const requestBody = {
      model: LLM_MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    };

    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
      timeout: 30000,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Sanitize HTML responses (common when endpoint URL is wrong or returns an HTML error page)
      const isHtml = /<(!doctype|html)/i.test(errorText);
      const shortMsg = isHtml
        ? `LLM API returned non-JSON HTML (status ${response.status})`
        : errorText.substring(0, 500);
      throw new Error(`LLM API error ${response.status}: ${shortMsg}`);
    }

    // Try parsing JSON safely
    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      const txt = await response.text();
      const isHtml = /<(!doctype|html)/i.test(txt);
      const shortMsg = isHtml ? `LLM API returned non-JSON HTML (status ${response.status})` : txt.substring(0, 500);
      throw new Error(`LLM API parse error: ${shortMsg}`);
    }

    // Parse response (supports different formats)
    let summary;
    if (data.choices?.[0]?.message?.content) {
      summary = data.choices[0].message.content;
    } else if (data.result) {
      summary = data.result;
    } else {
      throw new Error('Unexpected LLM response format');
    }

    return summary.trim();
  } catch (err) {
    console.error('LLM summarization error:', err.message);
    throw err;
  }
}

module.exports = {
  summarizeText,
};
