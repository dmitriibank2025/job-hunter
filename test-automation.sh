#!/bin/bash

# Test script for Job Hunter Automation

echo "🔍 Testing Job Automation Workflow"
echo "=================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check environment variables
echo -e "\n${YELLOW}1. Checking environment variables...${NC}"
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}❌ OPENAI_API_KEY not set${NC}"
else
    echo -e "${GREEN}✅ OPENAI_API_KEY is set${NC}"
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ DATABASE_URL not set${NC}"
else
    echo -e "${GREEN}✅ DATABASE_URL is set${NC}"
fi

MIN_MATCH_SCORE=${MIN_MATCH_SCORE:-60}
echo -e "${GREEN}✅ MIN_MATCH_SCORE = $MIN_MATCH_SCORE${NC}"

# Check if candidates exist
echo -e "\n${YELLOW}2. Checking if candidate profile exists...${NC}"
echo "Run: POST http://localhost:4000/candidate/seed"

# Test workflow
echo -e "\n${YELLOW}3. Starting job automation workflow...${NC}"
echo "Run: POST http://localhost:4000/jobs/automation/run"

echo -e "\n${YELLOW}4. Expected output in logs:${NC}"
echo "  ✓ [Job Automation] Collected X new jobs"
echo "  ✓ [Job Automation] Analysis done: [Job Title] | Score: X | Recommendation: [APPLY|MAYBE|SKIP]"
echo "  ✓ [Job Automation] ✓ Generating resume for: [Job Title]"
echo "  ✓ [Job Automation] Complete! Collected: X | Generated: Y"

echo -e "\n${YELLOW}5. Verify in database:${NC}"
echo "  - Check jobs with status 'ANALYZED'"
echo "  - Check matchScore and analysis fields"
echo "  - Check resumeVersions for generated resumes"

echo -e "\n${YELLOW}6. Troubleshooting:${NC}"
echo "  - If no resumes generated: check match scores"
echo "  - If analysis fails: check OPENAI_API_KEY"
echo "  - If no jobs collected: check browser providers"

echo -e "\n${GREEN}Done!${NC}"

