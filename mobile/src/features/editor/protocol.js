import { encodeUtf8 } from "./encoding.js";

export const editorProtocolVersion = 1;
export const editorMaximumMessageBytes = 4 * 1024 * 1024;
export const editorMaximumContentBytes = 512 * 1024;
const identifierPattern = /^[A-Za-z0-9_-]{1,100}$/;
const sourceTypes = new Set([
  "EDITOR_READY",
  "DOCUMENT_READY",
  "DOCUMENT_CHANGED",
  "CURSOR_CHANGED",
  "CONTENT_RESULT",
  "EDITOR_ERROR",
]);
const outboundTypes = new Set(["LOAD_DOCUMENT", "REQUEST_CONTENT", "SET_READ_ONLY"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bytes(value) {
  try {
    return encodeUtf8(value).length;
  } catch {
    return Infinity;
  }
}

function validPayload(message) {
  const payload = message.payload;
  if (!isRecord(payload)) return false;
  if (message.type === "EDITOR_READY" || message.type === "DOCUMENT_READY")
    return Object.keys(payload).every((key) => key === "readOnly") &&
      (payload.readOnly === undefined || typeof payload.readOnly === "boolean");
  if (message.type === "DOCUMENT_CHANGED") {
    return (
      typeof payload.content === "string" &&
      bytes(payload.content) <= editorMaximumContentBytes &&
      Number.isInteger(payload.line) && payload.line > 0 &&
      Number.isInteger(payload.column) && payload.column > 0 &&
      Object.keys(payload).every((key) => ["content", "line", "column"].includes(key))
    );
  }
  if (message.type === "CURSOR_CHANGED") {
    return Number.isInteger(payload.line) && payload.line > 0 &&
      Number.isInteger(payload.column) && payload.column > 0 &&
      Object.keys(payload).every((key) => ["line", "column"].includes(key));
  }
  if (message.type === "CONTENT_RESULT") {
    return typeof payload.content === "string" &&
      bytes(payload.content) <= editorMaximumContentBytes &&
      Object.keys(payload).every((key) => key === "content");
  }
  if (message.type === "EDITOR_ERROR") {
    return typeof payload.code === "string" &&
      /^[A-Z0-9_]{1,64}$/.test(payload.code) &&
      Object.keys(payload).every((key) => key === "code");
  }
  return false;
}

function validOutboundPayload(type, payload) {
  if (!isRecord(payload)) return false;
  if (type === "LOAD_DOCUMENT") {
    return (
      typeof payload.path === "string" && payload.path.length > 0 &&
      payload.path.length <= 1024 &&
      typeof payload.ref === "string" && payload.ref.length > 0 &&
      payload.ref.length <= 255 &&
      typeof payload.sha === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(payload.sha) &&
      typeof payload.content === "string" &&
      bytes(payload.content) <= editorMaximumContentBytes &&
      typeof payload.language === "string" && payload.language.length <= 32 &&
      typeof payload.readOnly === "boolean" &&
      Object.keys(payload).every((key) =>
        ["path", "ref", "sha", "content", "language", "readOnly"].includes(key),
      )
    );
  }
  if (type === "SET_READ_ONLY")
    return typeof payload.readOnly === "boolean" && Object.keys(payload).length === 1;
  return Object.keys(payload).length === 0;
}

export function isAllowedEditorNavigation(target) {
  if (target === "about:blank") return true;
  try {
    const url = new URL(target);
    return (
      url.origin === "https://editor.pocketops.invalid" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function createEditorBridge({
  sessionId,
  bootRequestId,
  postMessage,
  onMessage = () => {},
  onReject = () => {},
}) {
  const pending = new Map();
  const received = new Set();
  let ready = false;
  let closed = false;

  function remember(id) {
    received.add(id);
    if (received.size > 500) received.delete(received.values().next().value);
  }

  function send(type, payload, requestId) {
    if (closed || !outboundTypes.has(type) || !validOutboundPayload(type, payload))
      throw new Error("Invalid editor request");
    const id = requestId || `native-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!identifierPattern.test(id)) throw new Error("Invalid editor request ID");
    if (pending.has(id)) throw new Error("Duplicate editor request ID");
    if (type !== "SET_READ_ONLY") pending.set(id, type);
    const message = {
      version: editorProtocolVersion,
      type,
      sessionId,
      requestId: id,
      payload,
    };
    const serialized = JSON.stringify(message);
    if (bytes(serialized) > editorMaximumMessageBytes) {
      pending.delete(id);
      throw new Error("Editor message exceeds the allowed size");
    }
    postMessage(serialized);
    return id;
  }

  function receive(raw) {
    if (closed || typeof raw !== "string" || bytes(raw) > editorMaximumMessageBytes) {
      onReject("MESSAGE_SIZE_OR_STATE");
      return false;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      onReject("INVALID_JSON");
      return false;
    }
    if (
      !isRecord(message) ||
      Object.keys(message).some(
        (key) => !["version", "type", "sessionId", "requestId", "payload"].includes(key),
      ) ||
      message.version !== editorProtocolVersion ||
      !sourceTypes.has(message.type) ||
      message.sessionId !== sessionId ||
      !identifierPattern.test(message.requestId || "") ||
      !validPayload(message)
    ) {
      onReject("INVALID_MESSAGE");
      return false;
    }

    if (message.type === "EDITOR_READY") {
      if (ready || message.requestId !== bootRequestId || received.has(message.requestId)) {
        onReject("REPLAYED_OR_UNCORRELATED_MESSAGE");
        return false;
      }
      ready = true;
      remember(message.requestId);
      onMessage(message);
      return true;
    }
    if (message.type === "DOCUMENT_READY" || message.type === "CONTENT_RESULT") {
      if (!pending.has(message.requestId)) {
        onReject("REPLAYED_OR_UNCORRELATED_MESSAGE");
        return false;
      }
      if (
        message.type === "DOCUMENT_READY" &&
        pending.get(message.requestId) !== "LOAD_DOCUMENT"
      ) {
        onReject("REPLAYED_OR_UNCORRELATED_MESSAGE");
        return false;
      }
      if (
        message.type === "CONTENT_RESULT" &&
        pending.get(message.requestId) !== "REQUEST_CONTENT"
      ) {
        onReject("REPLAYED_OR_UNCORRELATED_MESSAGE");
        return false;
      }
      pending.delete(message.requestId);
      onMessage(message);
      return true;
    }
    if (message.type === "EDITOR_ERROR") {
      if (pending.has(message.requestId)) pending.delete(message.requestId);
      else if (received.has(message.requestId)) {
        onReject("REPLAYED_OR_UNCORRELATED_MESSAGE");
        return false;
      }
      remember(message.requestId);
      onMessage(message);
      return true;
    }
    if (!ready || received.has(message.requestId)) {
      onReject("REPLAYED_OR_UNCORRELATED_MESSAGE");
      return false;
    }
    remember(message.requestId);
    onMessage(message);
    return true;
  }

  return {
    send,
    receive,
    get ready() {
      return ready;
    },
    close() {
      closed = true;
      pending.clear();
      received.clear();
    },
  };
}
