#!/bin/bash
# Debug model fetching from n8n gateway

echo "=== KimiBuilt Model Debug ==="
echo ""

# 1. Check if backend pod is running
echo "1. Checking backend pod..."
kubectl get pods -n kimibuilt -l app=backend
echo ""

# 2. Check backend logs for model fetch errors
echo "2. Backend logs (last 50 lines)..."
kubectl logs -l app=backend -n kimibuilt --tail=50 | grep -i "model\|error\|fail" || echo "No model errors found"
echo ""

# 3. Test backend /v1/models endpoint directly
echo "3. Testing backend /v1/models..."
BACKEND_POD=$(kubectl get pod -l app=backend -n kimibuilt -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it "$BACKEND_POD" -n kimibuilt -- wget -qO- http://localhost:3000/v1/models 2>/dev/null || echo "Failed to fetch from backend"
echo ""

# 4. Test n8n gateway from backend pod
echo "4. Testing n8n gateway from backend pod..."
kubectl exec -it "$BACKEND_POD" -n kimibuilt -- wget -qO- \
  --header="Authorization: Bearer ${OPENAI_API_KEY}" \
  http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/v1/models 2>/dev/null || echo "Failed to reach n8n gateway"
echo ""

# 5. Check environment variables in backend
echo "5. Backend environment..."
kubectl exec -it "$BACKEND_POD" -n kimibuilt -- env | grep -E "OPENAI|URL" || echo "No env vars found"
echo ""

# 6. Test from local machine via port-forward
echo "6. Testing from local machine..."
echo "   Run: kubectl port-forward svc/backend 3000:3000 -n kimibuilt"
echo "   Then: curl http://localhost:3000/v1/models"
echo ""

echo "=== End Debug ==="
