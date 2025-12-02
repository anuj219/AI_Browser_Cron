const db = require('./db');
const { extractContent } = require('./extractor');
const { summarizeText } = require('./llm-client');
const { sendEmail } = require('./notifier');

/**
 * Check if workflow is due to run
 */
function shouldRunNow(workflow) {
  const { frequency, last_run } = workflow;
  const now = new Date();
  const lastRun = last_run ? new Date(last_run) : new Date(0);

  const diff = now - lastRun;

  const ms = {
    "15min": 15 * 60 * 1000,
    "hourly": 60 * 60 * 1000,
    "daily": 24 * 60 * 60 * 1000
  };

  return diff >= (ms[frequency] || ms["daily"]);
}

/**
 * Run a single workflow row
 */
async function runWorkflowRow(workflow) {
  const { id, url, prompt, notify_type, email } = workflow;

  const result = {
    workflowId: id,
    success: false,
    summary: null,
    metadata: {},
    error: null
  };

  try {
    console.log(`[Workflow ${id}] Extracting from ${url}`);
    const extraction = await extractContent(url);

    if (!extraction.success) {
      throw new Error(`Extraction failed: ${extraction.error}`);
    }

    result.metadata = {
      method: extraction.method,
      title: extraction.title,
      extractedLength: extraction.text.length
    };

    console.log(`[Workflow ${id}] Summarizing...`);
    let summary;
    try {
      summary = await summarizeText(extraction.text, prompt);
    } catch (e) {
      console.warn(`[Workflow ${id}] LLM failed, falling back: ${e.message}`);
      summary = extraction.text.slice(0, 500);
    }

    result.summary = summary;

    console.log(`[Workflow ${id}] Saving result...`);
    await db.createWorkflowResult({
      workflow_id: id,
      summary,
      metadata: result.metadata,
      timestamp: new Date().toISOString(),
      seen: notify_type === "email"
    });

    if (notify_type === "email" && email) {
      console.log(`[Workflow ${id}] Sending email to ${email}`);
      await sendEmail({
        to: email,
        subject: `Aera Workflow Summary`,
        summary,
        title: result.metadata.title
      });
    }

    await db.updateWorkflow(id, {
      last_run: new Date().toISOString(),
      status: "active"
    });

    result.success = true;
    return result;

  } catch (err) {
    result.error = err.message;
    console.error(`[Workflow ${id}] Error: ${err.message}`);

    await db.updateWorkflow(id, {
      status: "error",
      last_run: new Date().toISOString()
    });

    return result;
  }
}

/**
 * Process all workflows due to run
 */
async function processWorkflows() {
  console.log("=== PROCESSING WORKFLOWS ===");

  const workflows = await db.getAllActiveWorkflows();
  const summary = {
    total: workflows.length,
    processed: 0,
    success: 0,
    failed: 0,
    results: []
  };

  for (const workflow of workflows) {
    if (shouldRunNow(workflow)) {
      const result = await runWorkflowRow(workflow);
      summary.results.push(result);
      summary.processed++;

      if (result.success) summary.success++;
      else summary.failed++;
    }
  }

  return summary;
}

module.exports = {
  shouldRunNow,
  runWorkflowRow,
  processWorkflows
};
