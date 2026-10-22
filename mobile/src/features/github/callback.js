export function parseGitHubAppCallback(url, allowedRedirect) {
  let actual;
  let expected;
  try {
    actual = new URL(url);
    expected = new URL(allowedRedirect);
  } catch {
    throw new Error("GitHub callback URL is invalid.");
  }
  if (
    actual.protocol !== expected.protocol ||
    actual.hostname !== expected.hostname ||
    actual.port !== expected.port ||
    actual.pathname !== expected.pathname ||
    actual.username ||
    actual.password ||
    actual.hash ||
    [...actual.searchParams.keys()].some(
      (key) => !["status"].includes(key),
    )
  ) {
    throw new Error("GitHub callback did not match this app.");
  }
  const statuses = [...actual.searchParams.getAll("status")];
  if (
    statuses.length !== 1 ||
    !["connected", "cancelled", "failed"].includes(statuses[0])
  ) {
    throw new Error("GitHub callback is invalid.");
  }
  return statuses[0];
}
