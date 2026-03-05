#!/bin/bash
# KimiBuilt k3s Deployment Script
# Usage: ./deploy.sh [api-key]

set -e

NAMESPACE="kimibuilt"
GATEWAY_NAMESPACE="n8n-openai-gateway"
API_KEY="${1:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== KimiBuilt k3s Deployment ===${NC}"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}Error: kubectl not found${NC}"
    exit 1
fi

# Check cluster access
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}Error: Cannot connect to k3s cluster${NC}"
    exit 1
fi

# Check if n8n gateway exists
echo -e "${YELLOW}Checking n8n-openai-cli-gateway...${NC}"
if ! kubectl get svc n8n-openai-cli-gateway -n "$GATEWAY_NAMESPACE" &> /dev/null; then
    echo -e "${RED}Error: n8n-openai-cli-gateway service not found in $GATEWAY_NAMESPACE namespace${NC}"
    echo -e "${YELLOW}Please deploy the gateway first or update GATEWAY_NAMESPACE in this script${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Gateway found${NC}"

# Create namespace
echo -e "${YELLOW}Creating namespace...${NC}"
kubectl apply -f namespace.yaml

# Create or update secret
if [ -n "$API_KEY" ]; then
    echo -e "${YELLOW}Creating secret with provided API key...${NC}"
    kubectl create secret generic kimibuilt-secrets \
        --from-literal=OPENAI_API_KEY="$API_KEY" \
        -n "$NAMESPACE" \
        --dry-run=client -o yaml | kubectl apply -f -
else
    echo -e "${YELLOW}Checking for existing secret...${NC}"
    if ! kubectl get secret kimibuilt-secrets -n "$NAMESPACE" &> /dev/null; then
        echo -e "${RED}Error: No API key provided and no existing secret found${NC}"
        echo -e "${YELLOW}Usage: $0 <api-key>${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Using existing secret${NC}"
fi

# Apply ConfigMap
echo -e "${YELLOW}Applying ConfigMap...${NC}"
kubectl apply -f configmap.yaml

# Deploy dependencies
echo -e "${YELLOW}Deploying Qdrant...${NC}"
kubectl apply -f qdrant-deployment.yaml

echo -e "${YELLOW}Deploying Ollama...${NC}"
kubectl apply -f ollama-deployment.yaml

# Wait for dependencies
echo -e "${YELLOW}Waiting for dependencies...${NC}"
echo -e "${BLUE}This may take a few minutes...${NC}"

kubectl wait --for=condition=ready pod -l app=qdrant -n "$NAMESPACE" --timeout=120s || true
kubectl wait --for=condition=ready pod -l app=ollama -n "$NAMESPACE" --timeout=120s || true

# Deploy backend
echo -e "${YELLOW}Deploying KimiBuilt backend...${NC}"
kubectl apply -f backend-deployment.yaml

# Wait for backend
echo -e "${YELLOW}Waiting for backend...${NC}"
kubectl rollout status deployment/backend -n "$NAMESPACE" --timeout=120s

# Deploy ingress
echo -e "${YELLOW}Applying ingress...${NC}"
kubectl apply -f ingress.yaml

# Verify deployment
echo -e "${YELLOW}Verifying deployment...${NC}"
echo ""
echo -e "${BLUE}Pods:${NC}"
kubectl get pods -n "$NAMESPACE"
echo ""
echo -e "${BLUE}Services:${NC}"
kubectl get svc -n "$NAMESPACE"

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo -e "${BLUE}To test the deployment:${NC}"
echo "  kubectl port-forward svc/backend 3000:3000 -n $NAMESPACE"
echo "  curl http://localhost:3000/health"
echo ""
echo -e "${BLUE}To view logs:${NC}"
echo "  kubectl logs -l app=backend -n $NAMESPACE -f"
echo ""
echo -e "${BLUE}To update the API key:${NC}"
echo "  $0 <new-api-key>"
