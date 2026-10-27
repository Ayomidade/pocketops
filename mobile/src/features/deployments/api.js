export function createDeploymentApi(request) {
  const query = (options = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (key !== "signal" && value !== undefined && value !== null && value !== "") q.set(key, String(value));
    return q.toString() ? `?${q}` : "";
  };
  const get = (path, options = {}) => request(`${path}${query(options)}`, { signal: options.signal });
  const item = (base, id) => `${base}/${encodeURIComponent(id)}`;
  return {
    connections: (options) => get("/provider-connections", options),
    connect: (body) => request("/provider-connections/render", { method: "POST", body }),
    disconnect: (id) => request(item("/provider-connections", id), { method: "DELETE" }),
    services: (id, options) => get(`${item("/provider-connections", id)}/services`, options),
    projects: (options) => get("/projects", options),
    createProject: (body) => request("/projects", { method: "POST", body }),
    project: (id, options) => get(item("/projects", id), options),
    updateProject: (id, body) => request(item("/projects", id), { method: "PATCH", body }),
    deployments: (id, options) => get(`${item("/projects", id)}/deployments`, options),
    logs: (id, options) => get(`${item("/projects", id)}/logs`, options),
    redeploy: (id, body, key) => request(`${item("/projects", id)}/deployments`, { method: "POST", headers: { "Idempotency-Key": key }, body }),
    deployment: (id, options) => get(item("/deployments", id), options),
    operation: (id, options) => get(item("/operations", id), options),
  };
}
