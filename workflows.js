const db = require('./db');
const { extractContent } = require('./extractor');
const { summarizeText } = require('./llm-client');
const { sendEmail } = require('./notifier');
const sleep = (ms) => new Promise(resolve => resolve(setTimeout(resolve, ms)));

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

  console.log(`${workflow.id} : ` + diff);
  return diff >= (ms[frequency] || ms["daily"]);
}

function cleanTextForLLM(raw) {
  return raw
    // remove "123 points by … hours ago | hide | 456 comments"
    .replace(/\d+\s+points?\s+by\s+[^\|]+?\|\s*\d+\s+comments?/gi, '')
    // remove "hide | discuss | past"
    .replace(/\b(hide|discuss|past|jobs|submit)\b/gi, '')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Run a single workflow row
 */
async function runWorkflowRow(workflow) {
  const { id, url, prompt, notify_type, email, type } = workflow;

  const result = {
    workflowId: id, success: false, summary: null, metadata: {}, error: null
  };

  try {
    // 1. EXTRACTION
    console.log(`\n[Workflow ${id}] Strategy: ${type || 'general'} | URL: ${url}`);
    const extraction = await extractContent(url, prompt);

    if (!extraction.success) throw new Error(extraction.error);

    result.metadata = {
      method: extraction.method,
      title: extraction.title,
      extractedLength: extraction.text.length
    };

    // 2. LLM EXECUTION (The Corrected Persona + Sandwich Prompt)
    console.log(`[Workflow ${id}] Executing Agent...`);

    const personas = {
      news_headlines: "You are a professional News Editor. Extract 5 clear headlines.",
      price_tracker: "You are a Financial Data Analyst. Find the exact price or numerical value.",
      summary: "You are a Research Assistant. Provide a concise executive summary.",
      general: "You are an AI Browser Agent."
    };

    const systemPersona = personas[type] || personas.general;

    const enhancedPrompt = `
  STRICT COMMAND: ${systemPersona} 
  TASK: "${workflow.prompt}"
  
  CONTEXT (WEBPAGE CONTENT):
  ---
  ${extraction.text}
  ---

  OUTPUT RULES:
  1. You MUST find exactly 5 distinct items.
  2. You MUST return a Numbered List (1. , 2. , 3. , 4. , 5. ) if told to do so.
  3. Language: Output in the language asked by user, if none asked, default is english
  4. LENGTH: Each headline should be 1-2 sentences.
  2. DATA SOURCE: Only use information from the CONTEXT provided. Do NOT use your internal knowledge to guess the news.

  
  STRICT: DO NOT summarize into one paragraph. I need a list of 5.
`;

    const rawSummary = await summarizeText(extraction.text, enhancedPrompt);

    // SANITIZER: This kills the "Hindi Gap" bug
    result.summary = rawSummary
      .replace(/[^\S\r\n]{2,}/g, ' ') // Collapses multiple spaces but keeps newlines
      .replace(/\n{3,}/g, '\n\n')    // Prevents massive vertical voids
      .trim();

    // 3. PERSISTENCE
    console.log(`[Workflow ${id}] Saving result...`);
    await db.createWorkflowResult({
      workflow_id: id,
      summary: result.summary,
      metadata: result.metadata,
      timestamp: new Date().toISOString(),
      seen: notify_type === "email"
    });

    // 4. NOTIFICATION (Optional)
    if (notify_type === "email" && email) {
      await sendEmail({
        to: email,
        subject: `Aera Workflow: ${result.metadata.title}`,
        summary: result.summary,
        title: result.metadata.title
      });
    }

    // 5. UPDATE STATE
    await db.updateWorkflow(id, {
      last_run: new Date().toISOString(),
      status: "active"
    });

    result.success = true;
    return result;

  } catch (err) {
    result.error = err.message;
    console.error(`[Workflow ${id}] Error: ${err.message}`);
    await db.updateWorkflow(id, { status: "error", last_run: new Date().toISOString() });
    return result;
  }
}


/**
 * Process all workflows due to run
 */
async function processWorkflows() {
  console.log("=== PROCESSING WORKFLOWS ===");

  const workflows = await db.getAllActiveWorkflows();
  console.log(`📊 Found ${workflows.length} active workflows`);

  const summary = {
    total: workflows.length,
    processed: 0,
    success: 0,
    failed: 0,
    results: []
  };

  for (const workflow of workflows) {
    const isDue = shouldRunNow(workflow);
    console.log(`[Workflow ${workflow.id}] Due: ${isDue}, Last run: ${workflow.last_run || 'never'}`);

    if (isDue) {
      console.log(`\n\n----------------------- \n ▶️  Running workflow ${workflow.id}...`);
      const result = await runWorkflowRow(workflow);
      summary.results.push(result);
      summary.processed++;

      // ADD THIS DELAY HERE 👇 (Wait 5 seconds between each LLM call)
      console.log("💤 Cooling down for 5 seconds to prevent Rate Limit (429)...");
      await sleep(5000);

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
