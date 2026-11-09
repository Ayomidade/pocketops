// Capture the clock once: two readings can exceed the API's one-hour cap.
export function createLogWindow(now = Date.now()) {
  return {
    from: new Date(now - 3600000).toISOString(),
    to: new Date(now).toISOString(),
  };
}
