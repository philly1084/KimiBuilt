'use strict';

function normalizeText(value = '') {
    return String(value || '').trim();
}

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const DEFAULT_SOURCE_FILE_PATHS = Object.freeze([
    'public/index.html',
    'public/styles.css',
    'public/app.js',
]);

function buildWorkflowYaml({
    appName = '',
    slug = '',
    giteaOrg = '',
    imageRepo = '',
    registryHost = '',
    buildEventsUrl = '',
} = {}) {
    return `name: build-and-publish

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      APP_NAME: ${appName}
      APP_SLUG: ${slug}
      IMAGE_REPO: ${imageRepo}
      REGISTRY_HOST: ${registryHost}
      DEFAULT_BUILD_EVENTS_URL: ${buildEventsUrl || 'https://kimibuilt.example.com/api/integrations/gitea/build-events'}
      BUILDKIT_HOST: \${BUILDKIT_HOST:-tcp://buildkitd.agent-platform.svc.cluster.local:1234}
      TARGET_PLATFORMS: \${TARGET_PLATFORMS:-linux/amd64,linux/arm64}
    steps:
      - name: Verify workspace
        shell: bash
        run: |
          set -euo pipefail
          test -f Dockerfile

      - name: Prepare tags
        shell: bash
        run: |
          set -euo pipefail
          echo "SHORT_SHA=\${GITHUB_SHA::12}" >> "$GITHUB_ENV"
          echo "IMAGE_TAG=sha-\${GITHUB_SHA::12}" >> "$GITHUB_ENV"

      - name: Install buildctl
        shell: bash
        run: |
          set -euo pipefail
          ARCH="$(uname -m)"
          case "$ARCH" in
            x86_64|amd64) BUILDKIT_ARCH=amd64 ;;
            aarch64|arm64) BUILDKIT_ARCH=arm64 ;;
            *)
              echo "Unsupported architecture: $ARCH" >&2
              exit 1
              ;;
          esac
          BUILDKIT_VERSION="\${BUILDKIT_VERSION:-v0.17.2}"
          curl -fsSL "https://github.com/moby/buildkit/releases/download/$BUILDKIT_VERSION/buildkit-$BUILDKIT_VERSION.linux-$BUILDKIT_ARCH.tar.gz" \\
            | tar -xz --strip-components=1 -C "$RUNNER_TEMP" bin/buildctl
          chmod +x "$RUNNER_TEMP/buildctl"
          echo "$RUNNER_TEMP" >> "$GITHUB_PATH"

      - name: Write registry auth
        shell: bash
        run: |
          set -euo pipefail
          test -n "\${GITEA_REGISTRY_USERNAME:-}"
          test -n "\${GITEA_REGISTRY_PASSWORD:-}"
          TARGET_REGISTRY_HOST="\${GITEA_REGISTRY_HOST:-$REGISTRY_HOST}"
          mkdir -p "$HOME/.docker"
          AUTH="$(printf '%s' "$GITEA_REGISTRY_USERNAME:$GITEA_REGISTRY_PASSWORD" | base64 | tr -d '\\n')"
          cat > "$HOME/.docker/config.json" <<EOF
          {"auths":{"$TARGET_REGISTRY_HOST":{"username":"$GITEA_REGISTRY_USERNAME","password":"$GITEA_REGISTRY_PASSWORD","auth":"$AUTH"}}}
          EOF

      - name: Validate build settings
        shell: bash
        run: |
          set -euo pipefail
          test -n "$IMAGE_REPO"
          test -n "$TARGET_PLATFORMS"
          case "$IMAGE_REPO" in
            */*/*) ;;
            *)
              echo "IMAGE_REPO must look like <registry>/<owner>/<repo>; got $IMAGE_REPO" >&2
              exit 1
              ;;
          esac
          case "/$IMAGE_REPO/" in
            *"/undefined/"*)
              echo "Invalid IMAGE_REPO=$IMAGE_REPO" >&2
              exit 1
              ;;
          esac

      - name: Build and push image
        shell: bash
        run: |
          set -euo pipefail
          buildctl --addr "$BUILDKIT_HOST" build \\
            --frontend dockerfile.v0 \\
            --local context=. \\
            --local dockerfile=. \\
            --opt platform="$TARGET_PLATFORMS" \\
            --output "type=image,name=$IMAGE_REPO:$IMAGE_TAG,$IMAGE_REPO:latest,push=true" \\
            --export-cache type=inline \\
            --import-cache "type=registry,ref=$IMAGE_REPO:latest"

      - name: Notify KimiBuilt on success
        if: success()
        shell: bash
        run: |
          set -euo pipefail
          IMAGE_TAG="\${IMAGE_TAG:-sha-\${GITHUB_SHA::12}}"
          test -n "\${KIMIBUILT_BUILD_EVENTS_SECRET:-}"
          TARGET_BUILD_EVENTS_URL="\${KIMIBUILT_BUILD_EVENTS_URL:-$DEFAULT_BUILD_EVENTS_URL}"
          PAYLOAD="$(cat <<EOF
          {"repoOwner":"${giteaOrg}","repoName":"${slug}","slug":"${slug}","imageRepo":"$IMAGE_REPO","platforms":"$TARGET_PLATFORMS","commitSha":"$GITHUB_SHA","imageTag":"$IMAGE_TAG","buildStatus":"success","runId":"\${{ gitea.run_id }}","runUrl":"\${{ gitea.server_url }}/${giteaOrg}/${slug}/actions/runs/\${{ gitea.run_id }}"}
          EOF
          )"
          curl -fsSL -X POST "$TARGET_BUILD_EVENTS_URL" \\
            -H "Content-Type: application/json" \\
            -H "X-KimiBuilt-Webhook-Secret: $KIMIBUILT_BUILD_EVENTS_SECRET" \\
            -d "$PAYLOAD"

      - name: Notify KimiBuilt on failure
        if: failure()
        shell: bash
        run: |
          set -euo pipefail
          IMAGE_TAG="\${IMAGE_TAG:-sha-\${GITHUB_SHA::12}}"
          test -n "\${KIMIBUILT_BUILD_EVENTS_SECRET:-}"
          TARGET_BUILD_EVENTS_URL="\${KIMIBUILT_BUILD_EVENTS_URL:-$DEFAULT_BUILD_EVENTS_URL}"
          PAYLOAD="$(cat <<EOF
          {"repoOwner":"${giteaOrg}","repoName":"${slug}","slug":"${slug}","imageRepo":"$IMAGE_REPO","platforms":"$TARGET_PLATFORMS","commitSha":"$GITHUB_SHA","imageTag":"$IMAGE_TAG","buildStatus":"failed","runId":"\${{ gitea.run_id }}","runUrl":"\${{ gitea.server_url }}/${giteaOrg}/${slug}/actions/runs/\${{ gitea.run_id }}"}
          EOF
          )"
          curl -fsSL -X POST "$TARGET_BUILD_EVENTS_URL" \\
            -H "Content-Type: application/json" \\
            -H "X-KimiBuilt-Webhook-Secret: $KIMIBUILT_BUILD_EVENTS_SECRET" \\
            -d "$PAYLOAD"
`;
}

function buildDockerfile() {
    return `FROM nginx:1.27-alpine

COPY public/ /usr/share/nginx/html/

EXPOSE 80
`;
}

function buildKubernetesReference({
    slug = '',
    namespace = '',
    publicHost = '',
    imageRepo = '',
    imageTag = 'latest',
} = {}) {
    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${slug}
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${slug}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${slug}
    spec:
      containers:
        - name: app
          image: ${imageRepo}:${imageTag}
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: ${slug}
  namespace: ${namespace}
spec:
  selector:
    app.kubernetes.io/name: ${slug}
  ports:
    - name: http
      port: 80
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${slug}
  namespace: ${namespace}
spec:
  rules:
    - host: ${publicHost}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${slug}
                port:
                  number: 80
`;
}

function buildDefaultScaffoldFiles({
    appName = '',
    slug = '',
    publicHost = '',
    namespace = '',
    sourcePrompt = '',
    giteaOrg = '',
    imageRepo = '',
    registryHost = '',
    buildEventsUrl = '',
} = {}) {
    return [
        ...buildManagedAppInfrastructureFiles({
            appName,
            slug,
            publicHost,
            namespace,
            sourcePrompt,
            giteaOrg,
            imageRepo,
            registryHost,
            buildEventsUrl,
        }),
        ...buildDefaultManagedAppSourceFiles({
            appName,
            slug,
            sourcePrompt,
        }),
    ];
}

function buildManagedAppInfrastructureFiles({
    appName = '',
    slug = '',
    publicHost = '',
    namespace = '',
    sourcePrompt = '',
    giteaOrg = '',
    imageRepo = '',
    registryHost = '',
    buildEventsUrl = '',
} = {}) {
    const safePrompt = escapeHtml(sourcePrompt || 'Describe the application you want here.');

    return [
        {
            path: 'README.md',
            content: `# ${appName}

Managed by KimiBuilt.

- App slug: \`${slug}\`
- Public host: \`${publicHost}\`
- Namespace: \`${namespace}\`
- Image repo: \`${imageRepo}\`

Original request:

> ${sourcePrompt || 'No original prompt was recorded.'}

This repository is wired for Gitea Actions image publishing and KimiBuilt deployment orchestration.
`,
        },
        {
            path: '.dockerignore',
            content: `.git
.gitea
node_modules
npm-debug.log
Dockerfile*
deploy
README.md
`,
        },
        {
            path: 'Dockerfile',
            content: buildDockerfile(),
        },
        {
            path: 'deploy/k8s/reference.yaml',
            content: buildKubernetesReference({
                slug,
                namespace,
                publicHost,
                imageRepo,
                imageTag: 'latest',
            }),
        },
        {
            path: '.gitea/workflows/build-and-publish.yml',
            content: buildWorkflowYaml({
                appName,
                slug,
                giteaOrg,
                imageRepo,
                registryHost,
                buildEventsUrl,
            }),
        },
    ];
}

function buildDefaultManagedAppSourceFiles({
    appName = '',
    slug = '',
    sourcePrompt = '',
} = {}) {
    const safePrompt = escapeHtml(sourcePrompt || 'Describe the application you want here.');

    return [
        {
            path: 'public/index.html',
            content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(appName)}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main class="shell">
    <p class="eyebrow">Managed App</p>
    <h1>${escapeHtml(appName)}</h1>
    <p class="lede">This app was provisioned through the KimiBuilt managed app control plane.</p>
    <section class="panel">
      <h2>Original prompt</h2>
      <p>${safePrompt}</p>
    </section>
    <section class="panel">
      <h2>Next step</h2>
      <p>Replace the placeholder frontend in <code>public/</code> with the generated application.</p>
    </section>
  </main>
  <script src="./app.js"></script>
</body>
</html>
`,
        },
        {
            path: 'public/styles.css',
            content: `:root {
  color-scheme: light;
  --bg: #f2eee5;
  --ink: #1f1c17;
  --accent: #bb5a2a;
  --panel: rgba(255, 255, 255, 0.75);
  --line: rgba(31, 28, 23, 0.12);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: Georgia, "Times New Roman", serif;
  color: var(--ink);
  background:
    radial-gradient(circle at top left, rgba(187, 90, 42, 0.18), transparent 32%),
    linear-gradient(135deg, #f9f6ef 0%, var(--bg) 100%);
}

.shell {
  width: min(760px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 72px 0 96px;
}

.eyebrow {
  margin: 0 0 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--accent);
  font-size: 0.78rem;
}

h1 {
  margin: 0;
  font-size: clamp(2.8rem, 6vw, 4.8rem);
  line-height: 0.95;
}

.lede {
  max-width: 44rem;
  font-size: 1.15rem;
}

.panel {
  margin-top: 24px;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--panel);
  backdrop-filter: blur(12px);
}

code {
  font-family: "Courier New", monospace;
}
`,
        },
        {
            path: 'public/app.js',
            content: `console.log('KimiBuilt managed app scaffold ready for ${slug}.');\n`,
        },
    ];
}

function buildManagedAppAuthoringPrompt({
    appName = '',
    slug = '',
    publicHost = '',
    namespace = '',
    sourcePrompt = '',
} = {}) {
    return [
        'Generate a compact production-ready static web app for a managed deployment repository.',
        'Return only JSON with this shape: {"files":[{"path":"public/index.html","content":"..."},{"path":"public/styles.css","content":"..."},{"path":"public/app.js","content":"..."}]}.',
        'Rules:',
        '- Only include the three public/* files listed above.',
        '- No markdown fences, no explanations, no extra keys.',
        '- Use plain HTML, CSS, and browser JavaScript only.',
        '- Do not use frameworks, build tools, npm dependencies, images, or remote assets.',
        '- Make it responsive and visually intentional.',
        '- The page should feel complete, not like a placeholder.',
        '- Keep JavaScript small and focused on progressive enhancement.',
        `App name: ${appName}`,
        `App slug: ${slug}`,
        `Public host: ${publicHost}`,
        `Kubernetes namespace: ${namespace}`,
        `User request: ${sourcePrompt || 'Create a polished web app.'}`,
    ].join('\n');
}

function normalizeGeneratedManagedAppSourceFiles(files = []) {
    const entries = Array.isArray(files) ? files : [];
    const allowedPaths = new Set(DEFAULT_SOURCE_FILE_PATHS);

    return entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
            path: normalizeText(entry.path),
            content: String(entry.content || ''),
        }))
        .filter((entry) => allowedPaths.has(entry.path) && entry.content.trim());
}

module.exports = {
    buildDefaultScaffoldFiles,
    buildDefaultManagedAppSourceFiles,
    buildManagedAppAuthoringPrompt,
    buildManagedAppInfrastructureFiles,
    normalizeGeneratedManagedAppSourceFiles,
};
