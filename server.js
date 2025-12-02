const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - CORS must be first and very permissive for preflight requests
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400 // 24 hours
}));

// Handle preflight y
app.options('*', cors());

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// WORKFLOW ENDPOINTS
// ============================================

/**
 * POST /workflows
 * Create a new workflow
 * Body: { user_id, url, prompt, frequency, notify_type, email? }
 */
app.post('/workflows', async (req, res) => {
  try {
    const { user_id, url, prompt, frequency, notify_type, email } = req.body;

    // Validation
    if (!user_id || !url || !prompt || !frequency || !notify_type) {
      return res.status(400).json({
        error: 'Missing required fields: user_id, url, prompt, frequency, notify_type',
      });
    }

    if (!['email', 'in-app'].includes(notify_type)) {
      return res.status(400).json({
        error: 'notify_type must be "email" or "in-app"',
      });
    }

    if (!['15min', 'hourly', 'daily'].includes(frequency)) {
      return res.status(400).json({
        error: 'frequency must be "15min", "hourly", or "daily"',
      });
    }

    if (notify_type === 'email' && !email) {
      return res.status(400).json({
        error: 'email is required when notify_type is "email"',
      });
    }

    // Create workflow
    const workflow = await db.createWorkflow({
      id: uuidv4(),
      user_id,
      url,
      prompt,
      frequency,
      notify_type,
      email: email || null,
      last_run: null,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    res.status(201).json(workflow);
  } catch (err) {
    console.error('POST /workflows error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /workflows
 * List workflows by user_id (query param)
 */
app.get('/workflows', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id query parameter required' });
    }

    const workflows = await db.getWorkflowsByUser(user_id);
    res.json(workflows);
  } catch (err) {
    console.error('GET /workflows error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /workflows/:id
 * Delete a workflow
 */
app.delete('/workflows/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await db.deleteWorkflow(id);

    if (deleted) {
      res.json({ success: true, message: 'Workflow deleted' });
    } else {
      res.status(404).json({ error: 'Workflow not found' });
    }
  } catch (err) {
    console.error('DELETE /workflows/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// WORKFLOW RESULTS ENDPOINTS
// ============================================

/**
 * GET /workflow-results
 * Get results by workflow_id (query param)
 */
app.get('/workflow-results', async (req, res) => {
  try {
    const { workflow_id } = req.query;

    if (!workflow_id) {
      return res.status(400).json({ error: 'workflow_id query parameter required' });
    }

    const results = await db.getWorkflowResults(workflow_id);
    res.json(results);
  } catch (err) {
    console.error('GET /workflow-results error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /workflow-results/:id/seen
 * Mark a result as seen
 */
app.put('/workflow-results/:id/seen', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.markResultAsSeen(id);

    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Result not found' });
    }
  } catch (err) {
    console.error('PUT /workflow-results/:id/seen error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// SERVER STARTUP
// ============================================

app.listen(PORT, () => {
  console.log(`\n✓ Aera Cloud Scheduler Backend running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${process.env.SUPABASE_URL ? '✓ Supabase' : '✗ Not configured'}\n`);
});

module.exports = app;
