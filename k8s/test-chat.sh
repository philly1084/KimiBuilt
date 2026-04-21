#!/bin/bash
# Test chat endpoint directly

echo "Testing chat endpoint..."

curl -X POST https://kimibuilt.demoserver2.buzz/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }' 2>&1 | head -100

echo ""
echo "If this returns 400, check backend logs:"
echo "kubectl logs -l app=backend -n kimibuilt --tail=50"
