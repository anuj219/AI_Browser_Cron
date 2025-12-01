-- Aera Cloud Scheduler - Supabase Schema
-- Run this in Supabase SQL Editor to create tables

-- Workflows Table
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

-- Indexes for workflows
CREATE INDEX IF NOT EXISTS workflows_user_id_idx ON workflows(user_id);
CREATE INDEX IF NOT EXISTS workflows_status_idx ON workflows(status);
CREATE INDEX IF NOT EXISTS workflows_created_at_idx ON workflows(created_at DESC);

-- Workflow Results Table
CREATE TABLE IF NOT EXISTS workflow_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  seen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for workflow_results
CREATE INDEX IF NOT EXISTS workflow_results_workflow_id_idx ON workflow_results(workflow_id);
CREATE INDEX IF NOT EXISTS workflow_results_timestamp_idx ON workflow_results(timestamp DESC);
CREATE INDEX IF NOT EXISTS workflow_results_seen_idx ON workflow_results(seen);
