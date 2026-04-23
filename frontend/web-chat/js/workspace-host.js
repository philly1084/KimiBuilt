(function initWorkspaceHost() {
    const workspaceHelpers = window.KimiBuiltWebChatWorkspace;
    const tabsRoot = document.getElementById('workspace-tabs');
    const panelsRoot = document.getElementById('workspace-panels');
    const switcherToggle = document.getElementById('workspace-switcher-toggle');
    const switcherPopover = document.getElementById('workspace-switcher-popover');
    const switcherBackdrop = document.getElementById('workspace-switcher-backdrop');
    const switcherCurrentSlot = document.getElementById('workspace-switcher-current-slot');
    const switcherCurrentLabel = document.getElementById('workspace-switcher-current-label');

    if (
        !workspaceHelpers
        || !tabsRoot
        || !panelsRoot
        || !switcherToggle
        || !switcherPopover
        || !switcherBackdrop
        || !switcherCurrentSlot
        || !switcherCurrentLabel
    ) {
        return;
    }

    const ACTIVE_WORKSPACE_STORAGE_KEY = 'kimibuilt_web_chat_workspace_host_active';
    const THEME_PRESET_STORAGE_KEY = 'kimibuilt_theme_preset';
    const THEME_MODE_STORAGE_KEY = 'kimibuilt_theme';
    const workspaces = workspaceHelpers.listWorkspaceContexts();
    const panelsByKey = new Map();
    const tabsByKey = new Map();
    let activeWorkspaceKey = workspaceHelpers.DEFAULT_WORKSPACE_KEY;
    let isSwitcherOpen = false;

    function readStoredTheme() {
        try {
            const storedMode = String(localStorage.getItem(THEME_MODE_STORAGE_KEY) || '').trim().toLowerCase();
            const storedPreset = String(localStorage.getItem(THEME_PRESET_STORAGE_KEY) || '').trim().toLowerCase();
            const mode = storedMode === 'light' ? 'light' : 'dark';
            return {
                mode,
                preset: storedPreset || (mode === 'light' ? 'paper' : 'obsidian'),
            };
        } catch (_error) {
            return {
                mode: 'dark',
                preset: 'obsidian',
            };
        }
    }

    function syncThemeMetaColor() {
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (!metaThemeColor) {
            return;
        }

        const rootStyles = window.getComputedStyle(document.documentElement);
        const nextColor = String(rootStyles.getPropertyValue('--bg-primary') || '').trim() || '#0b1220';
        metaThemeColor.setAttribute('content', nextColor);
    }

    function applyStoredTheme() {
        const theme = readStoredTheme();
        document.documentElement.setAttribute('data-theme', theme.mode);
        document.documentElement.setAttribute('data-chat-theme', theme.preset);
        syncThemeMetaColor();
    }

    function getWorkspaceNumber(workspace) {
        const match = String(workspace?.key || '').match(/(\d+)$/);
        const workspaceNumber = match ? Number(match[1]) : 1;
        if (!Number.isFinite(workspaceNumber) || workspaceNumber < 1) {
            return 1;
        }

        return workspaceNumber;
    }

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
        iframe.addEventListener('load', () => {
            postWorkspaceState(workspace.key);
        });
        panel.appendChild(iframe);
    }

    function postWorkspaceState(workspaceKey) {
        const panel = panelsByKey.get(workspaceKey);
        const frame = panel?.querySelector('iframe');
        if (!frame?.contentWindow) {
            return;
        }

        frame.contentWindow.postMessage({
            type: 'kimibuilt-web-chat-workspace-state',
            workspaceKey,
            active: workspaceKey === activeWorkspaceKey,
        }, window.location.origin);
    }

    function syncAllWorkspaceStates() {
        workspaces.forEach((workspace) => {
            postWorkspaceState(workspace.key);
        });
    }

    function updateSwitcherSummary(workspace) {
        const workspaceNumber = getWorkspaceNumber(workspace);
        const accessibleLabel = `${workspace.label} active. Switch workspace`;

        switcherCurrentSlot.textContent = String(workspaceNumber);
        switcherCurrentLabel.textContent = accessibleLabel;
        switcherToggle.setAttribute('aria-label', accessibleLabel);
        switcherToggle.setAttribute('title', accessibleLabel);
    }

    function setDocumentWorkspace(workspace) {
        document.title = `${workspace.label} - Lilly`;
        document.body.dataset.workspaceKey = workspace.key;

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('workspace', workspace.key);
        window.history.replaceState({ workspace: workspace.key }, '', nextUrl);
    }

    function openSwitcher({ focusActiveWorkspace = true } = {}) {
        if (isSwitcherOpen) {
            return;
        }

        isSwitcherOpen = true;
        document.body.classList.add('workspace-switcher-open');
        switcherBackdrop.hidden = false;
        switcherPopover.hidden = false;
        switcherToggle.setAttribute('aria-expanded', 'true');

        if (focusActiveWorkspace) {
            const activeButton = tabsByKey.get(activeWorkspaceKey);
            if (activeButton) {
                window.requestAnimationFrame(() => {
                    activeButton.focus();
                });
            }
        }
    }

    function closeSwitcher({ restoreFocus = false } = {}) {
        if (!isSwitcherOpen && switcherPopover.hidden) {
            return;
        }

        isSwitcherOpen = false;
        document.body.classList.remove('workspace-switcher-open');
        switcherBackdrop.hidden = true;
        switcherPopover.hidden = true;
        switcherToggle.setAttribute('aria-expanded', 'false');

        if (restoreFocus) {
            switcherToggle.focus();
        }
    }

    function activateWorkspace(workspaceKey, { closeMenu = true, restoreFocus = false } = {}) {
        const workspace = workspaces.find((entry) => entry.key === workspaceKey) || workspaces[0];
        activeWorkspaceKey = workspace.key;
        ensureWorkspaceFrame(workspace);

        tabsByKey.forEach((button, key) => {
            const isActive = key === workspace.key;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        panelsByKey.forEach((panel, key) => {
            const isActive = key === workspace.key;
            panel.classList.toggle('is-active', isActive);
            panel.hidden = !isActive;
        });

        persistActiveWorkspace(workspace.key);
        updateSwitcherSummary(workspace);
        setDocumentWorkspace(workspace);
        syncAllWorkspaceStates();

        if (closeMenu) {
            closeSwitcher({ restoreFocus });
        }
    }

    function renderTabs() {
        workspaces.forEach((workspace) => {
            const workspaceNumber = getWorkspaceNumber(workspace);
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.id = `workspace-tab-${workspace.key}`;
            tab.className = 'workspace-tab';
            tab.dataset.workspaceKey = workspace.key;
            tab.innerHTML = `
                <span class="workspace-tab__badge">${workspaceNumber}</span>
                <span class="workspace-tab__copy">
                    <span class="workspace-tab__title">${workspace.label}</span>
                    <span class="workspace-tab__scope">${workspace.key === workspaceHelpers.DEFAULT_WORKSPACE_KEY ? 'Default chat history' : 'Isolated project space'}</span>
                </span>
            `;
            tab.addEventListener('click', () => activateWorkspace(workspace.key));
            tabsRoot.appendChild(tab);
            tabsByKey.set(workspace.key, tab);

            const panel = document.createElement('section');
            panel.id = `workspace-panel-${workspace.key}`;
            panel.className = 'workspace-panel';
            panel.setAttribute('aria-label', `${workspace.label} chat workspace`);
            panel.hidden = true;
            panelsRoot.appendChild(panel);
            panelsByKey.set(workspace.key, panel);
        });
    }

    function setupSwitcherControls() {
        switcherToggle.addEventListener('click', () => {
            if (isSwitcherOpen) {
                closeSwitcher();
                return;
            }

            openSwitcher();
        });

        switcherBackdrop.addEventListener('click', () => {
            closeSwitcher({ restoreFocus: true });
        });
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isSwitcherOpen) {
                event.preventDefault();
                closeSwitcher({ restoreFocus: true });
                return;
            }

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

        window.addEventListener('storage', (event) => {
            if (![THEME_PRESET_STORAGE_KEY, THEME_MODE_STORAGE_KEY].includes(String(event.key || '').trim())) {
                return;
            }

            applyStoredTheme();
        });
    }

    applyStoredTheme();
    renderTabs();
    setupSwitcherControls();
    setupKeyboardShortcuts();
    activateWorkspace(getInitialWorkspaceKey(), { closeMenu: false });
})();
