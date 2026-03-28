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

// Running single workflow
async function runWorkflowRow(workflow) {
  const { id, url, prompt, notify_type, email, type } = workflow;

  const result = {
    workflowId: id, success: false, summary: null, metadata: {}, error: null
  };

  try {
    // 1. EXTRACTION
    console.log(`\n[Workflow ${id}] Type: ${type || 'general'} | URL: ${url}`);
    const extraction = await extractContent(url, prompt);
    if (!extraction.success) throw new Error(extraction.error);

    result.metadata = {
      method: extraction.method,
      title: extraction.title,
      extractedLength: extraction.text.length
    };

    // 2. BIFURCATED PROMPT LOGIC
    let systemPersona = "";
    let finalPrompt = "";

    if (type === 'price_tracker') {
      systemPersona = "You are a precise Financial Data Watchdog.";
      finalPrompt = `
        STRICT TASK: "${prompt}"
        
        CONTEXT (WEBPAGE):
        ---
        ${extraction.text}
        ---

        RULES:
        1. THRESHOLD CHECK: Look at the limit mentioned in the TASK. 
        2. If the current price is HIGHER than the limit, return exactly: [[NO_ACTION]]
        3. If the price is AT or BELOW the limit, provide a 1-sentence alert (Price vs Limit).
        4. If the page shows "Access Denied" or "Out of Stock", report that instead.
        5. Return ONLY the result. No filler.
      `;
    } 
    else if (type === 'news_headlines') {
      systemPersona = "You are a professional News Editor.";
      finalPrompt = `
        STRICT TASK: "${prompt}"
        
        CONTEXT (WEBPAGE):
        ---
        ${extraction.text}
        ---

        RULES:
        1. LIST: Return exactly 5 distinct headlines.
        2. FORMAT: Numbered list (1-5).
        3. LANGUAGE: Detect from TASK, otherwise use English.
        4. CLEANUP: No conversational filler or "Here is your news" intro.
      `;
    } 
    else {
      systemPersona = "You are a helpful Research Assistant.";
      finalPrompt = `
        TASK: "${prompt}"
        CONTEXT: ${extraction.text}
        RULE: Provide a concise, professional executive summary.
      `;
    }

    // 3. LLM EXECUTION
    console.log(`[Workflow ${id}] Consulting the ${systemPersona}...`);
    const rawSummary = await summarizeText(extraction.text, finalPrompt);

    // 4. THE SILENCE CHECK (Bifurcation Part 2)
    if (type === 'price_tracker' && rawSummary.includes('[[NO_ACTION]]')) {
      console.log(`[Workflow ${id}] Price threshold not met. Silence Protocol active.`);
      
      // We update the 'last_run' so it doesn't loop, but we DON'T save a result
      await db.updateWorkflow(id, { last_run: new Date().toISOString(), status: "active" });
      
      result.summary = "Threshold not met (Silent)";
      result.success = true;  
      return result;
    }

    // 5. SANITIZER & PERSISTENCE (For successful alerts/news)
    result.summary = rawSummary
      .replace(/[^\S\r\n]{2,}/g, ' ') 
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    console.log(`[Workflow ${id}] Alert Condition Met! Saving...`);
    
    await db.createWorkflowResult({
      workflow_id: id,
      summary: result.summary,
      metadata: result.metadata,
      timestamp: new Date().toISOString(),
      seen: notify_type === "email"
    });

    // 6. NOTIFICATION
    if (notify_type === "email" && email) {
      await sendEmail({
        to: email,
        subject: `Aera Alert: ${result.metadata.title}`,
        summary: result.summary,
        title: result.metadata.title
      });
    }

    // 7. UPDATE STATE
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
