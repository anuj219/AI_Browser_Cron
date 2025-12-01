const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase = null;

/**
 * Initialize Supabase client
 */
function initSupabase() {
  if (supabase) return supabase;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.warn(
      '⚠️  Supabase credentials not configured. Database operations will fail.'
    );
    console.warn('Please copy .env.example to .env and configure your credentials.');
    return null;
  }

  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return supabase;
}

/**
 * Get all active workflows
 */
async function getAllActiveWorkflows() {
  try {
    const client = initSupabase();
    if (!client) {
      console.error('Database not initialized');
      return [];
    }

    const { data, error } = await client
      .from('workflows')
      .select('*')
      .eq('status', 'active');
    
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching workflows:', err.message);
    return [];
  }
}

/**
 * Get workflows for a specific user
 */
async function getWorkflowsByUser(userId) {
  try {
    const client = initSupabase();
    if (!client) {
      console.error('Database not initialized');
      return [];
    }

    const { data, error } = await client
      .from('workflows')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching user workflows:', err.message);
    return [];
  }
}

/**
 * Create a new workflow
 */
async function createWorkflow(payload) {
  try {
    const client = initSupabase();
    if (!client) throw new Error('Database not initialized');

    const { data, error } = await client
      .from('workflows')
      .insert([payload])
      .select();
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.error('Error creating workflow:', err.message);
    throw err;
  }
}

/**
 * Update workflow (status, last_run, etc)
 */
async function updateWorkflow(workflowId, updates) {
  try {
    const client = initSupabase();
    if (!client) throw new Error('Database not initialized');

    const { data, error } = await client
      .from('workflows')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workflowId)
      .select();
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.error('Error updating workflow:', err.message);
    throw err;
  }
}

/**
 * Delete a workflow
 */
async function deleteWorkflow(workflowId) {
  try {
    const client = initSupabase();
    if (!client) throw new Error('Database not initialized');

    const { error } = await client
      .from('workflows')
      .delete()
      .eq('id', workflowId);
    
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Error deleting workflow:', err.message);
    throw err;
  }
}

/**
 * Get workflow results by workflow_id
 */
async function getWorkflowResults(workflowId) {
  try {
    const client = initSupabase();
    if (!client) {
      console.error('Database not initialized');
      return [];
    }

    const { data, error } = await client
      .from('workflow_results')
      .select('*')
      .eq('workflow_id', workflowId)
      .order('timestamp', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching workflow results:', err.message);
    return [];
  }
}

/**
 * Create a workflow result
 */
async function createWorkflowResult(payload) {
  try {
    const client = initSupabase();
    if (!client) throw new Error('Database not initialized');

    const { data, error } = await client
      .from('workflow_results')
      .insert([payload])
      .select();
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.error('Error creating workflow result:', err.message);
    throw err;
  }
}

/**
 * Mark result as seen
 */
async function markResultAsSeen(resultId) {
  try {
    const client = initSupabase();
    if (!client) throw new Error('Database not initialized');

    const { data, error } = await client
      .from('workflow_results')
      .update({ seen: true })
      .eq('id', resultId)
      .select();
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.error('Error marking result as seen:', err.message);
    throw err;
  }
}

module.exports = {
  initSupabase,
  getAllActiveWorkflows,
  getWorkflowsByUser,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowResults,
  createWorkflowResult,
  markResultAsSeen,
};
