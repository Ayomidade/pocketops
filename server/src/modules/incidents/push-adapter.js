// Expo receipts acknowledge provider handoff, never that a person saw the alert.
export function createPushAdapter({ accessToken, fetchImpl = fetch } = {}) {
  async function call(endpoint, body) {
    let response;
    try {
      response = await fetchImpl(
        `https://exp.host/--/api/v2/push/${endpoint}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return {
          status: "error",
          code: response.status === 429 ? "RATE_LIMITED" : "PUSH_UNAVAILABLE",
          retryable: response.status === 429,
          ambiguous: response.status >= 500,
        };
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) {
          await reader.cancel();
          throw new Error("Oversized");
        }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return { status: "error", code: "PUSH_OUTCOME_UNKNOWN", ambiguous: true };
    }
  }
  const normalized = (r) =>
    r?.status === "ok"
      ? {
          status: "ok",
          id: typeof r.id === "string" && r.id.length <= 100 ? r.id : null,
        }
      : {
          status: "error",
          code:
            r?.details?.error === "DeviceNotRegistered"
              ? "DEVICE_NOT_REGISTERED"
              : r?.details?.error === "MessageRateExceeded"
                ? "RATE_LIMITED"
                : "PUSH_REJECTED",
          retryable: r?.details?.error === "MessageRateExceeded",
        };
  return {
    async send(token, incidentId, eventId) {
      const result = await call("send", {
        to: token,
        title: "PocketOps incident update",
        body: "Open PocketOps to review the current incident status.",
        data: { incidentId, eventId },
        channelId: "incidents",
        sound: "default",
        ttl: 300,
      });
      if (result.status === "error") return result;
      const ticket = normalized(
        Array.isArray(result.data) ? result.data[0] : result.data,
      );
      return ticket.status === "ok" && !ticket.id
        ? { status: "error", code: "PUSH_OUTCOME_UNKNOWN", ambiguous: true }
        : ticket;
    },
    async receipt(id) {
      const result = await call("getReceipts", { ids: [id] });
      if (result.status === "error")
        return { ...result, retryable: true, ambiguous: false };
      return result.data?.[id]
        ? normalized(result.data[id])
        : { status: "pending" };
    },
  };
}
