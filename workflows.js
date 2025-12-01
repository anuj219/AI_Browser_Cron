const db = require('./db');
const { extractContent } = require('./extractor');
const { summarizeText } = require('./llm-client');
const { sendEmail } = require('./notifier');
require('dotenv').config();

/**
 * Check if a workflow is due based on frequency and last_run
 * @param {object} workflow - Workflow object from DB
 * @returns {boolean}
 */
function shouldRunNow(workflow) {
  const { frequency, last_run } = workflow;
  const now = new Date();
  const lastRun = last_run ? new Date(last_run) : new Date(0);
  const diffMs = now - lastRun;

  const frequencyMs = {
    '15min': 15 * 60 * 1000,
    'hourly': 60 * 60 * 1000,
    'daily': 24 * 60 * 60 * 1000,
  };

  const threshold = frequencyMs[frequency] || 24 * 60 * 60 * 1000;
  return diffMs >= threshold;
}

/**
 * Execute a single workflow: extract → summarize → notify
 * @param {object} workflow - Workflow object
 * @returns {Promise<object>} - Result object
 */
async function runWorkflowRow(workflow) {
  const { id: workflowId, url, prompt, notify_type, email, user_id } = workflow;

  const result = {
    workflowId,
    success: false,
    summary: null,
    metadata: {},
    error: null,
  };

  try {
    // Step 1: Extract content
    console.log(`[Workflow ${workflowId}] Extracting from ${url}`);
    const extraction = await extractContent(url);

    if (!extraction.success) {
      throw new Error(`Extraction failed: ${extraction.error}`);
    }

    result.metadata.method = extraction.method;
    result.metadata.title = extraction.title;
    result.metadata.extractedLength = extraction.text.length;

    // Step 2: Summarize (use LLM if available; fall back to simple extractor summary)
    console.log(`[Workflow ${workflowId}] Summarizing...`);
    let summary;
    try {
      summary = await summarizeText(extraction.text, prompt);
    } catch (llmErr) {
      console.warn(`[Workflow ${workflowId}] LLM summarization failed: ${llmErr.message}. Falling back to local summary.`);
      // Simple fallback: take first two sentences or first 500 chars
      const text = extraction.text || '';
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
      if (sentences.length >= 2) {
        summary = (sentences.slice(0, 2).join(' ')).trim();
      } else {
        summary = text.substring(0, 500).trim();
      }
    }
    result.summary = summary;

    // Step 3: Store result in database
    console.log(`[Workflow ${workflowId}] Storing result...`);
    await db.createWorkflowResult({
      workflow_id: workflowId,
      summary,
      metadata: result.metadata,
      timestamp: new Date().toISOString(),
      seen: notify_type === 'email', // Auto-seen for email
    });

    // Step 4: Send notification
    if (notify_type === 'email' && email) {
      console.log(`[Workflow ${workflowId}] Sending email to ${email}`);
      await sendEmail({
        to: email,
        subject: `Aera: ${result.metadata.title || 'Workflow Summary'}`,
        summary,
        title: result.metadata.title,
      });
    } else if (notify_type === 'in-app') {
      console.log(`[Workflow ${workflowId}] In-app notification saved`);
    }

    // Step 5: Update workflow
    console.log(`[Workflow ${workflowId}] Updating workflow...`);
    await db.updateWorkflow(workflowId, {
      last_run: new Date().toISOString(),
      status: 'active',
    });

    result.success = true;
    console.log(`[Workflow ${workflowId}] ✓ Complete`);
  } catch (err) {
    result.error = err.message;
    console.error(`[Workflow ${workflowId}] ✗ Error: ${err.message}`);

    // Mark workflow as error
    try {
      await db.updateWorkflow(workflowId, {
        status: 'error',
        last_run: new Date().toISOString(),
      });
    } catch (updateErr) {
      console.error(`Failed to update workflow status: ${updateErr.message}`);
    }

    // Store error result
    try {
      await db.createWorkflowResult({
        workflow_id: workflowId,
        summary: `Error: ${err.message}`,
        metadata: { error: err.message },
        timestamp: new Date().toISOString(),
        seen: false,
      });
    } catch (resultErr) {
      console.error(`Failed to store error result: ${resultErr.message}`);
    }
  }

  return result;
}

/**
 * CORE BUSINESS LOGIC - Process all due workflows
 * This function is framework-agnostic and reusable for both Render Cron and Cloudflare Workers
 * @returns {Promise<object>} - { timestamp, totalWorkflows, processedWorkflows, successfulWorkflows, failedWorkflows, results }
 */
async function processWorkflows() {
  console.log('\n========== WORKFLOW PROCESSING STARTED ==========');
  console.log(`Time: ${new Date().toISOString()}`);

  const summary = {
    timestamp: new Date().toISOString(),
    totalWorkflows: 0,
    processedWorkflows: 0,
    successfulWorkflows: 0,
    failedWorkflows: 0,
    results: [],
  };

  try {
    // Fetch all active workflows
    const workflows = await db.getAllActiveWorkflows();
    summary.totalWorkflows = workflows.length;

    if (workflows.length === 0) {
      console.log('No active workflows');
      console.log('========== WORKFLOW PROCESSING ENDED ==========\n');
      return summary;
    }

    console.log(`Found ${workflows.length} active workflows`);

    // Process each workflow due for execution
    for (const workflow of workflows) {
      if (shouldRunNow(workflow)) {
        console.log(`\n➜ Processing: ${workflow.id}`);
        const result = await runWorkflowRow(workflow);
        summary.results.push(result);
        summary.processedWorkflows++;

        if (result.success) {
          summary.successfulWorkflows++;
        } else {
          summary.failedWorkflows++;
        }
      } else {
        console.log(`⊘ ${workflow.id} not due yet (${workflow.frequency})`);
      }
    }

    console.log('\n========== SUMMARY ==========');
    console.log(`Total: ${summary.totalWorkflows}`);
    console.log(`Processed: ${summary.processedWorkflows}`);
    console.log(`✓ Success: ${summary.successfulWorkflows}`);
    console.log(`✗ Failed: ${summary.failedWorkflows}`);
    console.log('========== WORKFLOW PROCESSING ENDED ==========\n');
  } catch (err) {
    console.error('Fatal error:', err.message);
    summary.error = err.message;
  }

  return summary;
}

module.exports = {
  shouldRunNow,
  runWorkflowRow,
  processWorkflows,
};
