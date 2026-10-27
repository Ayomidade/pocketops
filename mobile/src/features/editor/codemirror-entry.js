/* global window, document, TextEncoder */
import { history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";

const maxMessageBytes = 4 * 1024 * 1024;
const maxContentBytes = 512 * 1024;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const supportedMessages = new Set([
  "LOAD_DOCUMENT",
  "REQUEST_CONTENT",
  "SET_READ_ONLY",
]);
const seenNativeRequests = new Set();
let active = null;

function utf8Size(value) {
  return new TextEncoder().encode(value).length;
}

function post(type, requestId, payload = {}) {
  if (!active) return;
  const message = {
    version: 1,
    type,
    sessionId: active.sessionId,
    requestId,
    payload,
  };
  const serialized = JSON.stringify(message);
  if (utf8Size(serialized) > maxMessageBytes) return;
  window.ReactNativeWebView.postMessage(serialized);
}

function languageFor(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(extension)) {
    return javascript({
      jsx: extension.endsWith("x"),
      typescript: extension.startsWith("t"),
    });
  }
  if (extension === "json") return json();
  if (["html", "htm"].includes(extension)) return html();
  if (extension === "css") return css();
  if (["md", "markdown"].includes(extension)) return markdown();
  return [];
}

function sendDocumentChange(view) {
  if (!active || active.readOnly) return;
  const content = view.state.doc.toString();
  if (utf8Size(content) > maxContentBytes) {
    post("EDITOR_ERROR", active.loadRequestId, { code: "DOCUMENT_TOO_LARGE" });
    return;
  }
  post("DOCUMENT_CHANGED", `change-${Date.now()}-${Math.random().toString(36).slice(2)}`, {
    content,
    line: view.state.doc.lineAt(view.state.selection.main.head).number,
    column:
      view.state.selection.main.head -
      view.state.doc.line(view.state.doc.lineAt(view.state.selection.main.head).number).from +
      1,
  });
}

function scheduleDocumentChange(view) {
  clearTimeout(active.changeTimer);
  active.changeTimer = setTimeout(() => sendDocumentChange(view), 250);
}

function showDocument(message) {
  if (typeof message.payload.content !== "string") throw new Error("INVALID_DOCUMENT");
  if (utf8Size(message.payload.content) > maxContentBytes) throw new Error("DOCUMENT_TOO_LARGE");
  if (active.view) active.view.destroy();
  active.readOnly = Boolean(message.payload.readOnly);
  active.loadRequestId = message.requestId;
  active.editable = new Compartment();
  const state = EditorState.create({
    doc: message.payload.content,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      languageFor(message.payload.path),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      active.editable.of(EditorView.editable.of(!active.readOnly)),
      EditorView.theme(
        {
          "&": { height: "100%", color: "#e2e8f0", backgroundColor: "#0b1220" },
          ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace", fontSize: "14px" },
          ".cm-content": { minHeight: "100%", padding: "12px 0" },
          ".cm-gutters": { color: "#94a3b8", backgroundColor: "#111c2f", border: "0" },
          ".cm-activeLine": { backgroundColor: "#152238" },
          ".cm-activeLineGutter": { backgroundColor: "#152238" },
        },
        { dark: true },
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) scheduleDocumentChange(update.view);
        if (update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          post("CURSOR_CHANGED", `cursor-${Date.now()}-${Math.random().toString(36).slice(2)}`, {
            line: line.number,
            column: head - line.from + 1,
          });
        }
      }),
    ],
  });
  active.view = new EditorView({ state, parent: document.getElementById("editor") });
  post("DOCUMENT_READY", message.requestId, { readOnly: active.readOnly });
}

function validNativeMessage(message) {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.keys(message).some(
      (key) => !["version", "type", "sessionId", "requestId", "payload"].includes(key),
    ) ||
    message.version !== 1 ||
    message.sessionId !== active?.sessionId ||
    !idPattern.test(message.requestId || "") ||
    !supportedMessages.has(message.type) ||
    !message.payload ||
    typeof message.payload !== "object" ||
    Array.isArray(message.payload) ||
    seenNativeRequests.has(message.requestId)
  ) {
    return false;
  }
  const payload = message.payload;
  if (message.type === "LOAD_DOCUMENT") {
    return (
      typeof payload.content === "string" &&
      utf8Size(payload.content) <= maxContentBytes &&
      typeof payload.path === "string" && payload.path.length > 0 && payload.path.length <= 1024 &&
      typeof payload.ref === "string" && payload.ref.length > 0 && payload.ref.length <= 255 &&
      typeof payload.sha === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(payload.sha) &&
      typeof payload.language === "string" && payload.language.length <= 32 &&
      typeof payload.readOnly === "boolean" &&
      Object.keys(payload).every((key) => ["content", "path", "ref", "sha", "language", "readOnly"].includes(key))
    );
  }
  if (message.type === "SET_READ_ONLY") {
    return typeof payload.readOnly === "boolean" && Object.keys(payload).length === 1;
  }
  return Object.keys(payload).length === 0;
}

function receive(message) {
  if (
    !active || !validNativeMessage(message)
  ) {
    return;
  }
  seenNativeRequests.add(message.requestId);
  if (seenNativeRequests.size > 500)
    seenNativeRequests.delete(seenNativeRequests.values().next().value);
  try {
    if (message.type === "LOAD_DOCUMENT") return showDocument(message);
    if (!active.view) return;
    if (message.type === "SET_READ_ONLY") {
      if (typeof message.payload.readOnly !== "boolean") return;
      active.readOnly = message.payload.readOnly;
      active.view.dispatch({
        effects: active.editable.reconfigure(EditorView.editable.of(!active.readOnly)),
      });
      return;
    }
    const content = active.view.state.doc.toString();
    if (utf8Size(content) > maxContentBytes) throw new Error("DOCUMENT_TOO_LARGE");
    post("CONTENT_RESULT", message.requestId, { content });
  } catch {
    post("EDITOR_ERROR", message.requestId, { code: "EDITOR_OPERATION_FAILED" });
  }
}

window.startPocketOpsEditor = ({ sessionId, bootRequestId }) => {
  if (!idPattern.test(sessionId) || !idPattern.test(bootRequestId)) return;
  active = {
    sessionId,
    bootRequestId,
    readOnly: true,
    view: null,
    changeTimer: null,
    loadRequestId: bootRequestId,
  };
  const receiveEvent = (event) => {
    try {
      if (typeof event.data !== "string" || utf8Size(event.data) > maxMessageBytes) return;
      receive(JSON.parse(event.data));
    } catch {
      post("EDITOR_ERROR", active.bootRequestId, { code: "INVALID_MESSAGE" });
    }
  };
  window.addEventListener("message", receiveEvent);
  document.addEventListener("message", receiveEvent);
  post("EDITOR_READY", bootRequestId, {});
};
