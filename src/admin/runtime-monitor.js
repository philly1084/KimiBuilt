let dashboardController = null;

function setDashboardController(controller) {
  dashboardController = controller;
}

function startRuntimeTask(payload) {
  return dashboardController?.recordRuntimeTaskStart(payload) || null;
}

function completeRuntimeTask(taskId, payload) {
  return dashboardController?.recordRuntimeTaskComplete(taskId, payload) || null;
}

function failRuntimeTask(taskId, payload) {
  return dashboardController?.recordRuntimeTaskError(taskId, payload) || null;
}

module.exports = {
  setDashboardController,
  startRuntimeTask,
  completeRuntimeTask,
  failRuntimeTask,
};
