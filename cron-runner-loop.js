require('dotenv').config();
const { processWorkflows } = require('./workflows');

async function loop() {
  while (true) {
    console.log("🔄 Running workflow cycle...");
    try {
      await processWorkflows();
    } catch (err) {
      console.error("Cron error:", err);
    }

    console.log("⏳ Sleeping for 15 minutes...");
    await new Promise(res => setTimeout(res, 15 * 60 * 1000));
  }
}

loop();
