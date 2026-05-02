const {
  completeRuntimeTask,
  failRuntimeTask,
  setDashboardController,
  startRuntimeTask,
} = require('./runtime-monitor');

describe('runtime monitor', () => {
  afterEach(() => {
    setDashboardController(null);
    jest.restoreAllMocks();
  });

  test('does not propagate dashboard recording failures into runtime requests', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    setDashboardController({
      recordRuntimeTaskStart: jest.fn(() => {
        throw new Error('dashboard start failed');
      }),
      recordRuntimeTaskComplete: jest.fn(() => {
        throw new Error('dashboard complete failed');
      }),
      recordRuntimeTaskError: jest.fn(() => {
        throw new Error('dashboard error failed');
      }),
    });

    expect(startRuntimeTask({ sessionId: 'session-1' })).toBeNull();
    expect(completeRuntimeTask('task-1', {})).toBeNull();
    expect(failRuntimeTask('task-1', {})).toBeNull();
  });
});
