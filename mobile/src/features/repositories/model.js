export const maximumPreviewBytes = 512 * 1024;

export function singleParam(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function breadcrumbs(path = "") {
  return [
    { label: "Root", path: "" },
    ...path
      .split("/")
      .filter(Boolean)
      .map((label, index, parts) => ({
        label,
        path: parts.slice(0, index + 1).join("/"),
      })),
  ];
}

export function repositoryRoute(id, ref = "", path = "", preview = false) {
  return {
    pathname: preview ? "/repository/[id]/file" : "/repository/[id]",
    params: { id, ref, path },
  };
}

export function flattenPages(data, key = "id") {
  const seen = new Set();
  return (data?.pages || [])
    .flatMap((page) => page.data)
    .filter((item) => {
      if (seen.has(item[key])) return false;
      seen.add(item[key]);
      return true;
    });
}

export function previewReason(file) {
  if (file.size > maximumPreviewBytes)
    return "Files larger than 512 KiB cannot be previewed.";
  if (file.encoding !== "utf-8" || typeof file.content !== "string")
    return "Binary or unsupported content cannot be previewed as text.";
  return null;
}

export function readError(error) {
  if (error?.status === 401 && error.code === "UNAUTHENTICATED")
    return "Your PocketOps session expired. Sign in again.";
  if ([401, 403].includes(error?.status))
    return "GitHub access is no longer available. Reconnect or review repository selection.";
  if (error?.status === 404)
    return "This repository, branch or path is missing, or access was revoked.";
  if (error?.status === 429)
    return "Too many requests. Wait a minute before retrying.";
  if (error?.status === 413 || error?.code === "FILE_TOO_LARGE")
    return "Files larger than 512 KiB cannot be previewed.";
  if (error?.code === "GITHUB_APP_NOT_CONFIGURED")
    return "GitHub App access is not configured on this server.";
  if (["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error?.code))
    return "Unable to reach PocketOps. Check your connection and retry.";
  return "Repository data could not be loaded. Please retry.";
}

export function denied(error) {
  return [401, 403, 404].includes(error?.status);
}
