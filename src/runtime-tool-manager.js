const { getToolManager } = require('./agent-sdk/tools');

async function ensureRuntimeToolManager(app = null) {
    if (app?.locals?.toolManager) {
        return app.locals.toolManager;
    }

    const toolManager = getToolManager();
    await toolManager.initialize();

    if (app?.locals) {
        app.locals.toolManager = toolManager;
    }

    return toolManager;
}

module.exports = {
    ensureRuntimeToolManager,
};
