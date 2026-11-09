export function createIncidentApi(request) {
  const get = (path, query = {}) => {
    const { signal, ...values } = query;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(values))
      if (v !== undefined && v !== "") params.set(k, String(v));
    return request(`${path}${params.size ? "?" + params : ""}`, { signal });
  };
  const idPath = (root, id) => `${root}/${encodeURIComponent(id)}`;
  return {
    list: (q) => get("/incidents", q),
    detail: (id, q) => get(idPath("/incidents", id), q),
    timeline: (id, q) => get(`${idPath("/incidents", id)}/timeline`, q),
    create: (body, key) =>
      request("/incidents", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": key },
      }),
    update: (id, body) =>
      request(idPath("/incidents", id), { method: "PATCH", body }),
    resolve: (id, version) =>
      request(`${idPath("/incidents", id)}/resolve`, {
        method: "POST",
        body: { version, confirmation: "RESOLVE" },
      }),
    health: (id, q) => get(`${idPath("/projects", id)}/health-status`, q),
    configure: (id, body) =>
      request(`${idPath("/projects", id)}/health-checks`, {
        method: "POST",
        body: { ...body, confirmation: "MONITOR" },
      }),
    preferences: () => get("/notification-preferences"),
    setPreferences: (enabled) =>
      request("/notification-preferences", {
        method: "PATCH",
        body: { enabled },
      }),
    devices: () => get("/devices/push-tokens"),
    register: (body) =>
      request("/devices/push-tokens", { method: "POST", body }),
    revoke: (id) =>
      request(idPath("/devices/push-tokens", id), { method: "DELETE" }),
  };
}
