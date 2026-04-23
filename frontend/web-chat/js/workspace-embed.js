(function initWorkspaceEmbedBridge() {
    const workspaceHelpers = window.KimiBuiltWebChatWorkspace;
    const context = typeof workspaceHelpers?.getWorkspaceContext === 'function'
        ? workspaceHelpers.getWorkspaceContext()
        : null;

    if (!context?.embedded || window.parent === window) {
        return;
    }

    function applyWorkspaceActivityState(active = true) {
        const nextActive = active !== false;
        const previousActive = window.__kimibuiltWebChatHostWorkspaceActive !== false;
        window.__kimibuiltWebChatHostWorkspaceActive = nextActive;

        if (previousActive === nextActive) {
            return;
        }

        window.dispatchEvent(new CustomEvent('kimibuilt-web-chat-workspace-activity', {
            detail: {
                active: nextActive,
                workspaceKey: context.key,
            },
        }));
    }

    window.KimiBuiltWebChatWorkspaceEmbed = {
        isHostWorkspaceActive() {
            return window.__kimibuiltWebChatHostWorkspaceActive !== false;
        },
    };
    window.__kimibuiltWebChatHostWorkspaceActive = true;

    document.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey)) {
            return;
        }

        const numericKey = Number.parseInt(event.key, 10);
        if (!Number.isFinite(numericKey) || numericKey < 1 || numericKey > (workspaceHelpers?.WORKSPACE_COUNT || 4)) {
            return;
        }

        event.preventDefault();
        window.parent.postMessage({
            type: 'kimibuilt-web-chat-activate-workspace',
            workspaceKey: `workspace-${numericKey}`,
        }, window.location.origin);
    });

    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) {
            return;
        }

        const messageType = String(event.data?.type || '').trim();
        if (messageType !== 'kimibuilt-web-chat-workspace-state') {
            return;
        }

        const workspaceKey = String(event.data?.workspaceKey || '').trim();
        if (workspaceKey && workspaceKey !== context.key) {
            return;
        }

        applyWorkspaceActivityState(event.data?.active !== false);
    });
})();
