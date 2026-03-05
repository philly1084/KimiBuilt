#!/bin/bash
# Verify KimiBuilt k3s Deployment

NAMESPACE="kimibuilt"
GATEWAY_NAMESPACE="n8n-openai-gateway"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== KimiBuilt Deployment Verification ===${NC}"
echo ""

# Check namespace
if kubectl get namespace "$NAMESPACE" &> /dev/null; then
    echo -e "${GREEN}✓ Namespace $NAMESPACE exists${NC}"
else
    echo -e "${RED}✗ Namespace $NAMESPACE not found${NC}"
    exit 1
fi

# Check secret
echo -e "${YELLOW}Checking secrets...${NC}"
if kubectl get secret kimibuilt-secrets -n "$NAMESPACE" &> /dev/null; then
    echo -e "${GREEN}✓ Secret kimibuilt-secrets exists${NC}"
else
    echo -e "${RED}✗ Secret kimibuilt-secrets not found${NC}"
fi

# Check ConfigMap
echo -e "${YELLOW}Checking ConfigMap...${NC}"
if kubectl get configmap kimibuilt-config -n "$NAMESPACE" &> /dev/null; then
    echo -e "${GREEN}✓ ConfigMap kimibuilt-config exists${NC}"
    BASE_URL=$(kubectl get configmap kimibuilt-config -n "$NAMESPACE" -o jsonpath='{.data.OPENAI_BASE_URL}')
    echo -e "  OPENAI_BASE_URL: $BASE_URL"
else
    echo -e "${RED}✗ ConfigMap kimibuilt-config not found${NC}"
fi

# Check gateway connectivity
echo -e "${YELLOW}Checking n8n-openai-cli-gateway...${NC}"
if kubectl get svc n8n-openai-cli-gateway -n "$GATEWAY_NAMESPACE" &> /dev/null; then
    echo -e "${GREEN}✓ n8n-openai-cli-gateway service found${NC}"
else
    echo -e "${RED}✗ n8n-openai-cli-gateway not found in $GATEWAY_NAMESPACE${NC}"
fi

# Check pods
echo -e "${YELLOW}Checking pods...${NC}"
echo ""
kubectl get pods -n "$NAMESPACE"
echo ""

# Check if backend is ready
BACKEND_POD=$(kubectl get pod -l app=backend -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$BACKEND_POD" ]; then
    READY=$(kubectl get pod "$BACKEND_POD" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
    if [ "$READY" == "True" ]; then
        echo -e "${GREEN}✓ Backend pod is ready${NC}"
        
        # Test health endpoint
        echo -e "${YELLOW}Testing health endpoint...${NC}"
        kubectl port-forward svc/backend 3000:3000 -n "$NAMESPACE" &> /dev/null &
        PF_PID=$!
        sleep 2
        
        HEALTH=$(curl -s http://localhost:3000/health)
        if [ -n "$HEALTH" ]; then
            echo -e "${GREEN}✓ Health endpoint responding${NC}"
            echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
        else
            echo -e "${RED}✗ Health endpoint not responding${NC}"
        fi
        
        kill $PF_PID 2>/dev/null || true
    else
        echo -e "${RED}✗ Backend pod not ready${NC}"
        kubectl describe pod "$BACKEND_POD" -n "$NAMESPACE" | tail -20
    fi
else
    echo -e "${RED}✗ No backend pod found${NC}"
fi

echo ""
echo -e "${BLUE}=== Verification Complete ===${NC}"
