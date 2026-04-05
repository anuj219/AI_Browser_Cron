const db = require('./db');
const { extractContent } = require('./extractor');
const { summarizeText, extractWeatherParams, generateExtractionSchema } = require('./llm-client');
const { getRichWeatherData } = require('./weather');
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

  let extraction = { method: 'none', title: 'none', text: '' };
  let contextForLLM = '';

  try {
    // 1. EXTRACTION
    console.log(`\n[Workflow ${id}] Type: ${type || 'general'} | URL: ${url}`);

    if (type === 'summary' && (!url || url.trim() === "")) {
      console.warn(`[Workflow ${id}] Error: No URL provided for a scraper-based task [Summary].`);

      // Optional: Allow LLM to answer from general knowledge if it's a summary task
      console.log(`[Workflow ${id}] Falling back to General Knowledge (No URL mode)...`);
      extraction.method = 'llm_only';
      extraction.title = 'General Knowledge';
      extraction.text = 'Use your internal knowledge base to complete the task. No website content was provided.';
      contextForLLM = extraction.text;
    }
    // --- NEW: THE WEATHER AGENT PRE-PROCESSOR ---
    else if (type === 'fetch_weather') {
      console.log(`[Weather Agent] Extracting parameters from: "${prompt}"`);
      const params = await extractWeatherParams(prompt);

      contextForLLM = await getRichWeatherData(params.location);
      // console.log(`[Weather Agent] Formulated URL: ${url}`);

      extraction.method = 'weather-api';
      extraction.title = `Weather for ${params.location || 'Unknown'}`;
      extraction.text = contextForLLM || '';
    }
    else if (type === 'price_tracker') {

      // 🚀 THE HYBRID MOVE: Analyze intent and run MCP + Scraper in PARALLEL
      const intent = await generateExtractionSchema(prompt);  // refer this functoin to understand how AI prepares schema to get exact details from MCP based on domain (ecommerce, finance etc)
      console.log(`[Price Agent] Intent: ${intent.domain}, Use MCP: ${intent.use_mcp}`);

      let mcpTask = Promise.resolve(null);
      // MCP LOGIC (FIRECRAWL) ------------------------------------------------------------------------------------------
      if (intent.use_mcp && process.env.FIRECRAWL_API_KEY) {
        // 🚀 DYNAMIC IMPORT (The 2026 way to fix CJS/ESM errors)
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

        const transport = new StdioClientTransport({
          command: "npx",
          args: ["-y", "firecrawl-mcp"],
          env: { ...process.env, FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY }
        });
        const client = new Client({ name: "Aera-Agent", version: "1.0.0" }, { capabilities: {} });

        mcpTask = (async () => {
          try {
            console.log(`[MCP] Attempting extract with schema:`, JSON.stringify(intent.schema));
            await client.connect(transport);

            // Check tool names! Some versions use 'extract', others use 'firecrawl_extract'
            const result = await client.callTool({
              name: "firecrawl_extract",
              arguments: {
                urls: [url],
                schema: intent.schema
              }
            });
            return result;
          } catch (err) {
            // This will now tell us IF it was a schema validation error
            console.error("[MCP Error Details]:", err.message);
            return null;
          } finally {
            await client.close();
          }
        })();
      }
      // MCP LOGIC (FIRECRAWL) ------------------------------------------------------------------------------------------

      // Run Firecrawl and Playwright at the same time (parallel processing)
      const [mcpResult, scraperData] = await Promise.all([
        mcpTask,
        extractContent(url, prompt)
      ]);

      extractionResult = scraperData;
      // Combine MCP Facts + Scraper Flavor
      contextForLLM = `
      DATA SOURCES:
      - SOURCE A (Structured)
      PRECISE DATA (MCP): ${mcpResult ? JSON.stringify(mcpResult) : 'N/A'}
      - SOURCE B (Raw Text):
      PAGE CONTEXT: ${scraperData.text.substring(0, 5000)}
      `;

      extraction.method = 'mcp';
      extraction.title = `Price Tracking task`;
      extraction.text = contextForLLM || '';
    }
    else if (type === 'pnr_tracker') {
      // 1. Extract PNR from URL
      const pnrNumber = url.split('/').pop()?.trim();
      console.log(`[PNR Agent] Tracking PNR: ${pnrNumber}`);

      // 🚀 THE HYBRID MOVE: Setup irctc-connect Task (Parallel Path A)
      let packageTask = (async () => {
        try {
          const irctc = await import('irctc-connect');

          // 🔎 AUTO-DISCOVERY: Find the function regardless of naming (pnrStatus, getPnrStatus, etc.)
          const pnrFunc = irctc.getPnrStatus || irctc.pnrStatus || irctc.default?.getPnrStatus || irctc.default;

          console.log(`[Package Agent] Fetching data for PNR: ${pnrNumber}`);

          const result = await pnrFunc(pnrNumber);

          // Check if the package actually returned data
          if (result && result.success !== false) {
            return result;
          }
          return null;
        } catch (err) {
          console.error("[PNR Package Error]:", err.message);
          return null;
        }
      })();

      // 🚀 THE HYBRID MOVE: Execute Package + Scraper in PARALLEL
      // Path B: Playwright navigates to ConfirmTkt as the primary scraper
      const [packageResult, scraperData] = await Promise.all([
        packageTask,
        extractContent(url, "Extract PNR status table, passenger details, and coach info")
      ]);

      // DATA INTEGRATION & FALLBACK LOGIC ---------------------------------------------------------

      if (packageResult) {
        console.log("[PNR Agent] Package Successful. Using Precise Data.");
        contextForLLM = `PRECISE DATA (IRCTC-CONNECT): ${JSON.stringify(packageResult)}`;
        extraction.method = 'package';
      }
      else if (scraperData && scraperData.text && !scraperData.text.includes("Something went wrong") && scraperData.text.length > 300) {
        console.log("[PNR Agent] Package Failed. Using Primary Scraper (Railyatri).");
        contextForLLM = scraperData.text;
        extraction.method = 'playwright';
      }
      else {
        // 🚨 TIER 3: EMERGENCY FALLBACK (RailYatri)
        // If both the package and the primary scraper fail, try one last reliable source
        console.log("[PNR Agent] Primary sources failed. Attempting ConfirmTkt fallback...");
        const ryUrl = `https://www.confirmtkt.com/pnr-status/${pnrNumber}`;
        const ryAttempt = await extractContent(ryUrl, "Extract PNR status table");

        contextForLLM = ryAttempt.text;
        extraction.method = 'playwright-fallback';
      }

      extraction.title = `PNR Status: ${pnrNumber}`;
      extraction.text = contextForLLM || 'ERROR: No PNR data could be retrieved from any source.';
    }
    else {
      // Standard Scraping for News/Summary
      extractionResult = await extractContent(url, prompt);
      if (!extractionResult.success) throw new Error(extractionResult.error);
      // console.log("[Standard Scraping] : ", extractionResult.text);
      contextForLLM = extractionResult.text;
      extraction.method = 'playwright';
      extraction.title = `General task`;
      extraction.text = contextForLLM || '';
    }

    // --- STEP 2: METADATA & PROMPT BIFURCATION ---
    result.metadata = {
      method: extraction.method,
      title: extraction.title,
      extractedLength: extraction.text ? extraction.text.length : 0
    };

    // 2. BIFURCATED PROMPT LOGIC
    let systemPersona = "";
    let finalPrompt = "";

    switch (type) {
      case 'price_tracker':
        systemPersona = "You are a precise Financial Data Watchdog.";
        finalPrompt = `
          Identity : ${systemPersona},
          TASK: "${prompt}"
          CONTEXT: ${contextForLLM}\n,
          RULE: 
          1. Priority: Use SOURCE A if data is present. 
          2. Fallback: If SOURCE A is null or empty, you MUST extract the value from SOURCE B.
          3. If the condition IS NOT MET (e.g., price is too high/low according to user request), you MUST return exactly [[NO_ACTION]].
          4. If the data is missing or "null" in both sources, return exactly [[NO_ACTION]].

          Otherwise, 1-sentence alert based on user prompt task. 
          Ignore EMI or 'Sponsored' or 'Related' items. 
          If no Price found, then also return exactly [[NO_ACTION]]`;
        break;

      case 'pnr_tracker':
        systemPersona = "You are a Railway Logistics Assistant";
        finalPrompt = `
          Identity: ${systemPersona},
          TASK: "${prompt}",
          DATA: ${contextForLLM},
          LOGIC: 
          1. Compare 'current_status' with 'booking_status'.
          2. Do what the user has told to do.
          3. If status is 'CNF' (Confirmed), send a joyful alert. 
          IF TASK IS TO OF 'ALERTING':
            4. If it is still 'WL' (Waitlist), only alert if the position has improved (e.g., WL 15 to WL 5).
        `;
        break;

      case 'fetch_weather':
        systemPersona = "Professional Weather Assitant";
        finalPrompt = `
          Identity: ${systemPersona},
          USER REQUEST: "${prompt}"
          DATA: ${contextForLLM}
          
          TASK: Extract ONLY the details the user asked for from the DATA.
          RULES: 
          1. Answer the user's specific question (e.g., if they asked about rain, focus on rain).
          2. Give a concise, helpful summary.
          3. Use metric units (°C, km/h).
        `;
        break;

      case 'news_headlines':
        systemPersona = "You are a News Editor.";
        contextForLLM = extraction.text; // Use full structural markdown
        finalPrompt = `
        Identity : ${systemPersona},
        TASK: "${prompt}".\nCONTEXT: ${contextForLLM}
                RULES:
                  1. LIST: Return exactly number of headlines asked by user.
                  2. FORMAT: Numbered list (1-n).
                  3. LANGUAGE: Detect from TASK, otherwise use English.
                  4. CLEANUP: No conversational filler or "Here is your news" intro.
                `;
        break;

      default: // summary
        systemPersona = "You are a Research Assistant.";
        contextForLLM = extraction.text.substring(0, 15000);
        finalPrompt = `
        Identity : ${systemPersona},
        TASK: ${prompt} | or Summarize this if no prompt given.\nCONTEXT: ${contextForLLM}`;
    }

    // 3. LLM EXECUTION
    console.log(`[Workflow ${id}] Consulting the ${systemPersona}...`);
    console.log(`[Final Prompt] ${finalPrompt}`);
    const rawSummary = await summarizeText(contextForLLM, finalPrompt);    // can also pass only finalPrompt, as contextForLLM is included in that

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
