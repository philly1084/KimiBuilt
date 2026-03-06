# HTTPS Deployment Guide

## Issue: Mixed Content & DNS Resolution

Your browser console shows:
```
Mixed Content: The page at 'https://kimibuilt.secdevsolutions.help/...' was loaded over HTTPS, 
but requested an insecure resource 'http://kimibuilt.local/health'
```

And:
```
ERR_NAME_NOT_RESOLVED for kimibuilt.local
```

## Solution

### Option 1: Use Your Actual Domain (Recommended)

Your frontend is already served at `https://kimibuilt.secdevsolutions.help/`

Update the backend to be available at the same domain:

```bash
# Option A: Backend as subdomain
https://api.kimibuilt.secdevsolutions.help/v1

# Option B: Backend at /v1 path on same domain
https://kimibuilt.secdevsolutions.help/v1
```

### Option 2: Update Ingress to Use Your Domain

Edit `k8s/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kimibuilt-ingress
  namespace: kimibuilt
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure  # Use HTTPS
    traefik.ingress.kubernetes.io/router.tls: "true"
spec:
  rules:
    - host: kimibuilt.secdevsolutions.help  # YOUR ACTUAL DOMAIN
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3000
  tls:
    - hosts:
        - kimibuilt.secdevsolutions.help
      secretName: kimibuilt-tls  # You'll need a TLS certificate
```

### Option 3: Use Port Forwarding (Local Dev Only)

```bash
# Terminal 1 - Port forward backend to localhost
kubectl port-forward svc/backend 3000:3000 -n kimibuilt

# Access frontend via http://localhost:8080 (not HTTPS)
```

## Quick Fix for Testing

Update frontend URLs to use your actual backend IP/hostname:

```javascript
// In web-chat/js/api.js
const API_BASE_URL = 'https://kimibuilt.secdevsolutions.help/v1';
// or
const API_BASE_URL = 'http://192.168.x.x:3000/v1';  // Your k3s node IP
```

## OpenAI SDK Loading Issues

If you see "OpenAI SDK not loaded":

1. Check if CDN is blocked by browser privacy settings
2. Try downloading and hosting locally:
```bash
curl -o openai.browser.js https://unpkg.com/openai@4.82.0/dist/index.browser.js
```
3. Update HTML to use local copy:
```html
<script src="./openai.browser.js"></script>
```

## Tracking Prevention Warnings

These are just warnings about localStorage access. The app should still work. To suppress:

1. Use same domain for frontend and backend
2. Or use HTTP (not HTTPS) for local development

## Testing

After fixes, verify:
```javascript
// In browser console
console.log(API_BASE_URL);  // Should match your backend

// Test connection
fetch(`${API_BASE_URL}/models`)
  .then(r => r.json())
  .then(console.log);
```
