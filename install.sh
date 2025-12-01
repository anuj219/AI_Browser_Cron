#!/usr/bin/env bash
# Aera Cloud Scheduler Backend - Installation & Quick Start Script

set -e

echo "=========================================="
echo "  Aera Cloud Scheduler Backend Setup"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js 18+"
  exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo ""

# Navigate to backend
cd backend || exit 1
echo "✓ In backend directory"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Check for .env
if [ ! -f .env ]; then
  echo "⚠️  .env file not found"
  echo "📝 Creating .env from .env.example..."
  cp .env.example .env
  echo "✓ Created .env"
  echo ""
  echo "⚠️  IMPORTANT: Edit .env and add your API keys:"
  echo "   - SUPABASE_URL"
  echo "   - SUPABASE_KEY"
  echo "   - RESEND_API_KEY"
  echo "   - LLM_API_KEY"
  echo ""
else
  echo "✓ .env file exists"
fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit .env with your API keys"
echo "2. Run: npm start"
echo "3. Visit: http://localhost:3000/health"
echo ""
echo "For more info, see:"
echo "  - README.md (full documentation)"
echo "  - SETUP.md (detailed installation)"
echo "  - REACT_INTEGRATION.md (React examples)"
echo ""
