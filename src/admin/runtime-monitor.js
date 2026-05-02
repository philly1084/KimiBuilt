let dashboardController = null;

function setDashboardController(controller) {
  dashboardController = controller;
}

function startRuntimeTask(payload) {
  try {
    return dashboardController?.recordRuntimeTaskStart(payload) || null;
  } catch (error) {
    console.warn(`[RuntimeMonitor] Failed to record task start: ${error.message}`);
    return null;
  }
}

function completeRuntimeTask(taskId, payload) {
  try {
    return dashboardController?.recordRuntimeTaskComplete(taskId, payload) || null;
  } catch (error) {
    console.warn(`[RuntimeMonitor] Failed to record task completion: ${error.message}`);
    return null;
  }
}

function failRuntimeTask(taskId, payload) {
  try {
    return dashboardController?.recordRuntimeTaskError(taskId, payload) || null;
  } catch (error) {
    console.warn(`[RuntimeMonitor] Failed to record task failure: ${error.message}`);
    return null;
  }
}

module.exports = {
  setDashboardController,
  startRuntimeTask,
  completeRuntimeTask,
  failRuntimeTask,
};
