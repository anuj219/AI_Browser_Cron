/**
 * BACKEND-ONLY WORKFLOWS CLIENT
 * Safe for Node.js (CommonJS). No import.meta, no window.
 */

require('dotenv').config();
const fetch = require('node-fetch');

// Determine API BASE for backend → only from environment
const API_BASE =
  process.env.API_BASE ||
  process.env.VITE_API_BASE ||        // optional, if you set it manually
  "http://localhost:3000";            // fallback for local dev

console.log("[Backend Workflows] API_BASE =", API_BASE);

// Unified request wrapper
async function request(path, opts = {}) {
  const url = API_BASE + path;
  console.log(`[Backend Workflows] Fetching: ${url}`);

  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    const ct = res.headers.get("content-type") || "";

    if (!res.ok) {
      let body = text;
      if (ct.includes("application/json")) {
        try {
          body = JSON.parse(text);
        } catch (_) {}
      }
      throw new Error(`${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }

    if (ct.includes("application/json")) {
      return JSON.parse(text);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    console.error(`[Backend Workflows] Fetch failed for ${url}:`, err.message);
    throw err;
  }
}

// API functions (Node-safe)
async function getWorkflows(userId) {
  return await request(`/workflows?user_id=${encodeURIComponent(userId)}`);
}

async function createWorkflow(payload) {
  return await request('/workflows', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function deleteWorkflow(id) {
  return await request(`/workflows/${id}`, { method: "DELETE" });
}

async function getWorkflowResults(workflowId) {
  return await request(`/workflow-results?workflow_id=${encodeURIComponent(workflowId)}`);
}

// Export for Node backend
module.exports = {
  API_BASE,
  getWorkflows,
  createWorkflow,
  deleteWorkflow,
  getWorkflowResults
};
