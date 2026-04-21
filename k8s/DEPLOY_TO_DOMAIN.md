# Deploy to Custom Domain

Your domain: `kimibuilt.demoserver2.buzz`

## Current Issue
- Frontend: `https://kimibuilt.demoserver2.buzz/web-chat/` ✅
- Backend: `http://kimibuilt.local/v1` ❌ (doesn't exist in DNS)

## Solution: Update Ingress

Apply this updated ingress to expose backend at your domain:

```bash
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kimibuilt-backend-ingress
  namespace: kimibuilt
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web,websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
    # IMPORTANT: Allow CORS since frontend and backend are same domain now
    traefik.ingress.kubernetes.io/router.middlewares: kimibuilt-headers@kubernetescrd
spec:
  tls:
    - hosts:
        - kimibuilt.demoserver2.buzz
      secretName: kimibuilt-tls-secret  # You need a TLS cert
  rules:
    - host: kimibuilt.demoserver2.buzz
      http:
        paths:
          # Backend API at /v1
          - path: /v1
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3000
          # Health at /health
          - path: /health
            pathType: Exact
            backend:
              service:
                name: backend
                port:
                  number: 3000
          # WebSocket at /ws
          - path: /ws
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3000
EOF
```

## Important: TLS Certificate

You need a TLS certificate for HTTPS. Options:

### Option A: cert-manager (Recommended)

```bash
# Install cert-manager if not present
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create a ClusterIssuer for Let's Encrypt
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: philly1084@gmail.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: traefik
EOF

# Update ingress to use cert-manager
kubectl annotate ingress kimibuilt-backend-ingress \
  cert-manager.io/cluster-issuer=letsencrypt-prod \
  -n kimibuilt
```

### Option B: Use Existing Certificate

If you already have a certificate:

```bash
# Create TLS secret
kubectl create secret tls kimibuilt-tls-secret \
  --cert=path/to/cert.crt \
  --key=path/to/key.key \
  -n kimibuilt
```

### Option C: Use Rancher Generated Cert

If using Rancher:
1. Go to your cluster in Rancher UI
2. Resources > Secrets > Certificates
3. Add Certificate for `kimibuilt.demoserver2.buzz`
4. Reference it in the ingress

## After Deployment

Update your frontend to use the same domain:

```javascript
// In web-chat/js/api.js
const API_BASE_URL = '/v1';  // Relative path - same domain!
```

Or the auto-detect code I already added should handle it automatically.

## Verification

```bash
# Test backend
curl https://kimibuilt.demoserver2.buzz/v1/models

# Test health
curl https://kimibuilt.demoserver2.buzz/health
```

## If You're Using a Separate Frontend Server

If your frontend (`kimibuilt.demoserver2.buzz`) is served by a different server (nginx, Apache, etc.):

Add a proxy rule to forward `/v1` to the backend:

```nginx
# In your nginx config
server {
    listen 443 ssl;
    server_name kimibuilt.demoserver2.buzz;
    
    # Frontend files
    location / {
        root /var/www/kimibuilt;
        try_files $uri $uri/ /index.html;
    }
    
    # Proxy /v1 to backend
    location /v1 {
        proxy_pass http://backend-service.kimibuilt.svc.cluster.local:3000/v1;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
    
    # Proxy /health
    location /health {
        proxy_pass http://backend-service.kimibuilt.svc.cluster.local:3000/health;
    }
}
```

## Quick Fix Without Ingress Changes

If you just want to test quickly, update frontend to use your Rancher node IP:

```javascript
// In each frontend js/api.js
const API_BASE_URL = 'https://<rancher-node-ip>:3000/v1';
// Or with port-forward
const API_BASE_URL = 'http://localhost:3000/v1';
```

Then port-forward:
```bash
kubectl port-forward svc/backend 3000:3000 -n kimibuilt
```
