(function initWorkspaceEmbedBridge() {
    const workspaceHelpers = window.KimiBuiltWebChatWorkspace;
    const context = typeof workspaceHelpers?.getWorkspaceContext === 'function'
        ? workspaceHelpers.getWorkspaceContext()
        : null;

    if (!context?.embedded || window.parent === window) {
        return;
    }

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
})();
