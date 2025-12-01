const { processWorkflows } = require('./workflows');
require('dotenv').config();

/**
 * RENDER CRON JOB ENTRY POINT
 * 
 * This file is executed by Render Cron Job every minute.
 * It simply calls the reusable processWorkflows() function from workflows.js
 * 
 * The processWorkflows() function is framework-agnostic and can later be
 * imported into Cloudflare Workers without any modifications.
 */

async function main() {
  try {
    console.log('\n🔄 Cron Job Triggered');
    const result = await processWorkflows();
    
    console.log('\n✓ Cron Job Completed');
    console.log(JSON.stringify(result, null, 2));
    // Let Node exit naturally so background handles (Playwright, etc.) can close
  } catch (err) {
    console.error('\n✗ Cron Job Failed:', err.message);
    // Do not forcefully exit; allow graceful shutdown
  }
}

main();
