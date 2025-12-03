
# Test Cron Job Feature for Aera Backend
# This script tests the complete workflow pipeline

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "AERA CRON JOB FEATURE TEST" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Start the server in background
Write-Host "[1/4] Starting Express server..." -ForegroundColor Yellow
$serverProcess = Start-Process -FilePath "node" -ArgumentList "server.js" -PassThru -NoNewWindow -WorkingDirectory $PSScriptRoot
Start-Sleep -Seconds 2

Write-Host "✓ Server started (PID: $($serverProcess.Id))`n" -ForegroundColor Green

# Step 2: Create a test workflow
Write-Host "[2/4] Creating test workflow..." -ForegroundColor Yellow

$workflowBody = @{
    user_id = "test-user-001"
    url = "https://www.wikipedia.org"
    prompt = "What is this page about? Summarize in 2 sentences."
    frequency = "15min"
    notify_type = "in-app"
} | ConvertTo-Json

try {
    $createResponse = Invoke-WebRequest -Uri "http://localhost:3000/workflows" `
        -Method POST `
        -ContentType "application/json" `
        -Body $workflowBody `
        -UseBasicParsing
    
    $workflow = $createResponse.Content | ConvertFrom-Json
    $workflowId = $workflow.id
    
    Write-Host "✓ Workflow created`n" -ForegroundColor Green
    Write-Host "  Workflow ID: $workflowId" -ForegroundColor Cyan
    Write-Host "  URL: $($workflow.url)`n" -ForegroundColor Cyan
} catch {
    Write-Host "✗ Failed to create workflow: $_" -ForegroundColor Red
    Stop-Process -Id $serverProcess.Id
    exit 1
}

# Step 3: Run the cron job
Write-Host "[3/4] Running cron job to process workflows..." -ForegroundColor Yellow
Write-Host "  Command: npm run cron`n" -ForegroundColor Gray

$cronOutput = & npm run cron 2>&1
Write-Host $cronOutput -ForegroundColor Gray

# Step 4: Check results
Write-Host "`n[4/4] Checking workflow results..." -ForegroundColor Yellow

try {
    $resultsResponse = Invoke-WebRequest -Uri "http://localhost:3000/workflow-results?workflow_id=$workflowId" `
        -UseBasicParsing
    
    $results = $resultsResponse.Content | ConvertFrom-Json
    
    if ($results -and $results.Count -gt 0) {
        Write-Host "`n✓ Results found!`n" -ForegroundColor Green
        
        foreach ($result in $results) {
            Write-Host "Result Summary:" -ForegroundColor Cyan
            Write-Host "  Status: $($result.status)" -ForegroundColor Gray
            Write-Host "  Created: $($result.created_at)" -ForegroundColor Gray
            Write-Host "  Summary: $($result.summary.Substring(0, [Math]::Min(200, $result.summary.Length)))..." -ForegroundColor Gray
            Write-Host ""
        }
    } else {
        Write-Host "⚠ No results found yet (workflow may still be processing)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Could not fetch results: $_" -ForegroundColor Yellow
}

# Cleanup
Write-Host "`n[CLEANUP] Stopping server..." -ForegroundColor Yellow
Stop-Process -Id $serverProcess.Id -Force
Write-Host "✓ Server stopped`n" -ForegroundColor Green

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TEST COMPLETE" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
