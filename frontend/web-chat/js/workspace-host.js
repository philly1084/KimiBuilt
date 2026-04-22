(function initWorkspaceHost() {
    const workspaceHelpers = window.KimiBuiltWebChatWorkspace;
    const tabsRoot = document.getElementById('workspace-tabs');
    const panelsRoot = document.getElementById('workspace-panels');

    if (!workspaceHelpers || !tabsRoot || !panelsRoot) {
        return;
    }

    const ACTIVE_WORKSPACE_STORAGE_KEY = 'kimibuilt_web_chat_workspace_host_active';
    const workspaces = workspaceHelpers.listWorkspaceContexts();
    const panelsByKey = new Map();
    const tabsByKey = new Map();

    function getInitialWorkspaceKey() {
        const queryContext = workspaceHelpers.getWorkspaceContext(window.location.search);
        const fromQuery = queryContext?.key;
        if (fromQuery && workspaces.some((workspace) => workspace.key === fromQuery)) {
            return fromQuery;
        }

        try {
            const storedKey = workspaceHelpers.normalizeWorkspaceKey(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY));
            if (workspaces.some((workspace) => workspace.key === storedKey)) {
                return storedKey;
            }
        } catch (_error) {
            // Ignore storage lookup failures in privacy-restricted browsers.
        }

        return workspaceHelpers.DEFAULT_WORKSPACE_KEY;
    }

    function persistActiveWorkspace(key) {
        try {
            localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, key);
        } catch (_error) {
            // Ignore storage write failures.
        }
    }

    function buildWorkspaceFrameUrl(workspace) {
        const params = new URLSearchParams({
            workspace: workspace.key,
            workspaceLabel: workspace.label,
            embedded: '1',
        });
        return `app.html?${params.toString()}`;
    }

    function ensureWorkspaceFrame(workspace) {
        const panel = panelsByKey.get(workspace.key);
        if (!panel || panel.querySelector('iframe')) {
            return;
        }

        const iframe = document.createElement('iframe');
        iframe.className = 'workspace-frame';
        iframe.dataset.workspaceKey = workspace.key;
        iframe.title = `${workspace.label} chat workspace`;
        iframe.loading = workspace.key === workspaceHelpers.DEFAULT_WORKSPACE_KEY ? 'eager' : 'lazy';
        iframe.src = buildWorkspaceFrameUrl(workspace);
        panel.appendChild(iframe);
    }

    function setDocumentWorkspace(workspace) {
        document.title = `${workspace.label} · Lilly`;

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('workspace', workspace.key);
        window.history.replaceState({ workspace: workspace.key }, '', nextUrl);
    }

    function activateWorkspace(workspaceKey) {
        const workspace = workspaces.find((entry) => entry.key === workspaceKey) || workspaces[0];
        ensureWorkspaceFrame(workspace);

        tabsByKey.forEach((button, key) => {
            const isActive = key === workspace.key;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.tabIndex = isActive ? 0 : -1;
        });

        panelsByKey.forEach((panel, key) => {
            const isActive = key === workspace.key;
            panel.classList.toggle('is-active', isActive);
            panel.hidden = !isActive;
        });

        persistActiveWorkspace(workspace.key);
        setDocumentWorkspace(workspace);
    }

    function renderTabs() {
        workspaces.forEach((workspace) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.id = `workspace-tab-${workspace.key}`;
            tab.className = 'workspace-tab';
            tab.dataset.workspaceKey = workspace.key;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', `workspace-panel-${workspace.key}`);
            tab.innerHTML = `
                <span class="workspace-tab__eyebrow">Parallel slot</span>
                <span class="workspace-tab__title">${workspace.label}</span>
                <span class="workspace-tab__scope">${workspace.key === workspaceHelpers.DEFAULT_WORKSPACE_KEY ? 'Default chat history' : 'Isolated project space'}</span>
            `;
            tab.addEventListener('click', () => activateWorkspace(workspace.key));
            tabsRoot.appendChild(tab);
            tabsByKey.set(workspace.key, tab);

            const panel = document.createElement('section');
            panel.id = `workspace-panel-${workspace.key}`;
            panel.className = 'workspace-panel';
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', tab.id);
            panel.hidden = true;
            panelsRoot.appendChild(panel);
            panelsByKey.set(workspace.key, panel);
        });
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            const numericKey = Number.parseInt(event.key, 10);
            if (!Number.isFinite(numericKey) || numericKey < 1 || numericKey > workspaces.length) {
                return;
            }

            event.preventDefault();
            activateWorkspace(`workspace-${numericKey}`);
        });

        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) {
                return;
            }

            const messageType = String(event.data?.type || '').trim();
            if (messageType !== 'kimibuilt-web-chat-activate-workspace') {
                return;
            }

            activateWorkspace(event.data?.workspaceKey);
        });
    }

    renderTabs();
    setupKeyboardShortcuts();
    activateWorkspace(getInitialWorkspaceKey());
})();
