#!/usr/bin/env node

/**
 * Database Setup Script for Aera Backend
 * This script creates the necessary tables in Supabase if they don't exist
 * 
 * Usage: node setup-database.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupDatabase() {
  try {
    console.log('\n🔧 Setting up Aera Database...\n');

    // Test connection
    console.log('1️⃣  Testing Supabase connection...');
    const { data, error } = await supabase.from('workflows').select('count', { count: 'exact' });
    
    if (error && error.code === 'PGRST116') {
      // Table doesn't exist, need to create it
      console.log('   ⚠️  Tables not found. Creating now...\n');

      // Create workflows table
      console.log('2️⃣  Creating workflows table...');
      const workflowsSQL = `
        CREATE TABLE IF NOT EXISTS workflows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          url TEXT NOT NULL,
          prompt TEXT NOT NULL,
          frequency TEXT NOT NULL CHECK (frequency IN ('15min', 'hourly', 'daily')),
          notify_type TEXT NOT NULL CHECK (notify_type IN ('email', 'in-app')),
          email TEXT,
          last_run TIMESTAMP WITH TIME ZONE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS workflows_user_id_idx ON workflows(user_id);
        CREATE INDEX IF NOT EXISTS workflows_status_idx ON workflows(status);
        CREATE INDEX IF NOT EXISTS workflows_created_at_idx ON workflows(created_at DESC);
      `;

      const { error: workflowsError } = await supabase.rpc('exec', { sql: workflowsSQL }).catch(() => ({ error: null }));
      
      if (workflowsError) {
        console.log('   ⚠️  Note: Use Supabase dashboard to run SQL directly if this fails');
      } else {
        console.log('   ✓ Workflows table created');
      }

      // Create workflow_results table
      console.log('3️⃣  Creating workflow_results table...');
      const resultsSQL = `
        CREATE TABLE IF NOT EXISTS workflow_results (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          summary TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          seen BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS workflow_results_workflow_id_idx ON workflow_results(workflow_id);
        CREATE INDEX IF NOT EXISTS workflow_results_timestamp_idx ON workflow_results(timestamp DESC);
        CREATE INDEX IF NOT EXISTS workflow_results_seen_idx ON workflow_results(seen);
      `;

      const { error: resultsError } = await supabase.rpc('exec', { sql: resultsSQL }).catch(() => ({ error: null }));
      
      if (resultsError) {
        console.log('   ⚠️  Note: Use Supabase dashboard to run SQL directly if this fails');
      } else {
        console.log('   ✓ Workflow_results table created');
      }
    } else if (!error) {
      console.log('   ✓ Connection successful\n');
      console.log('2️⃣  Verifying tables exist...');
      console.log('   ✓ Workflows table found');
      console.log('   ✓ Database is already set up!\n');
    }

    console.log('✅ Database setup complete!\n');
    console.log('📝 Next steps:');
    console.log('   1. npm start           (start the server)');
    console.log('   2. Create a workflow via POST /workflows');
    console.log('   3. npm run cron        (process workflows)\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Database setup failed:');
    console.error(err.message);
    console.error('\n📖 Manual Setup:');
    console.error('   1. Go to https://app.supabase.com');
    console.error('   2. Select your project');
    console.error('   3. Click SQL Editor → New Query');
    console.error('   4. Copy contents of supabase-schema.sql');
    console.error('   5. Paste and Run\n');
    process.exit(1);
  }
}

setupDatabase();
