// Determine API base automatically: prefer env var, fallback to localhost:3000
const API_BASE = (() => {
  // 1. Check explicit env var
  if (import.meta.env.VITE_API_BASE) {
    console.log('[Workflows API] Using VITE_API_BASE:', import.meta.env.VITE_API_BASE);
    return import.meta.env.VITE_API_BASE;
  }

  // 2. Check if running in Electron (file:// protocol) or Vite dev (localhost:5173)
  try {
    const loc = window.location;
    // Electron app: file:// or Vite dev server: http://localhost:5173
    const isElectron = loc.protocol === 'file:';
    const isViteDev = loc.port === '5173' || loc.hostname === 'localhost';

    if (isElectron || isViteDev) {
      const base = `http://localhost:3000`;
      console.log(`[Workflows API] Detected ${isElectron ? 'Electron' : 'Vite dev'}, using ${base}`);
      return base;
    }

    // 3. Same-origin API (production)
    console.log('[Workflows API] Using same-origin API');
    return '';
  } catch (e) {
    console.warn('[Workflows API] Failed to detect environment:', e.message);
    return '';
  }
})();

console.log('[Workflows API] Initialized with base:', API_BASE || '(same origin)');

async function request(path, opts) {
  const url = (API_BASE || '') + path;
  console.log(`[Workflows API] Fetching: ${url}`);
  
  try {
    const res = await fetch(url, opts);
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      // If server returned HTML (e.g. index.html) expose it for debugging
      const body = ct.includes('application/json') ? JSON.parse(text) : text;
      throw new Error(`${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }

    if (ct.includes('application/json')) {
      return JSON.parse(text);
    }

    // If response isn't JSON, try to parse, otherwise return raw text
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  } catch (err) {
    console.error(`[Workflows API] Fetch failed for ${url}:`, err.message);
    throw err;
  }
}

export async function getWorkflows(userId) {
  try {
    return await request(`/workflows?user_id=${encodeURIComponent(userId)}`);
  } catch (err) {
    console.error('getWorkflows error:', err.message);
    throw err;
  }
}

export async function createWorkflow(payload) {
  try {
    return await request('/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('createWorkflow error:', err.message);
    throw err;
  }
}

export async function deleteWorkflow(id) {
  try {
    return await request(`/workflows/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.error('deleteWorkflow error:', err.message);
    throw err;
  }
}

export async function getWorkflowResults(workflowId) {
  try {
    return await request(`/workflow-results?workflow_id=${encodeURIComponent(workflowId)}`);
  } catch (err) {
    console.error('getWorkflowResults error:', err.message);
    throw err;
  }
}
