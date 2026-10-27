export const editorOrigin = "https://editor.pocketops.invalid";

export function createEditorHtml({ sessionId, bootRequestId, nonce, codeMirrorBundle }) {
  const session = JSON.stringify({ sessionId, bootRequestId });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <base href="${editorOrigin}/">
  <style nonce="${nonce}">
    html, body, #editor { height: 100%; margin: 0; padding: 0; overflow: hidden; background: #0b1220; }
    body { overscroll-behavior: contain; }
    .cm-editor { height: 100%; }
    .cm-scroller { -webkit-overflow-scrolling: touch; }
    .cm-search { background: #111c2f; color: #e2e8f0; }
  </style>
</head>
<body>
  <div id="editor" aria-label="Source code editor"></div>
  <script nonce="${nonce}">${codeMirrorBundle}</script>
  <script nonce="${nonce}">window.startPocketOpsEditor(${session});</script>
</body>
</html>`;
}
