import { colors } from "../../theme/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { usePreventRemove } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { diffLines } from "diff";
import { useAuth } from "../auth/AuthProvider";
import { useConnectivity } from "../../hooks/useConnectivity";
import { useRepository } from "../repositories/queries.js";
import { useRepositoryApi } from "../repositories/queries.js";
import { Action, RetryState, RepositorySkeleton } from "../repositories/components.jsx";
import { denied, singleParam } from "../repositories/model.js";
import { editorDraftStore } from "./draft-storage.js";
import { createEditorHtml, editorOrigin } from "./html.js";
import { createEditorBridge, editorMaximumContentBytes, isAllowedEditorNavigation } from "./protocol.js";
import { encodeUtf8 } from "./encoding.js";
import codeMirrorBundle from "./codemirror.bundle.js";

function newId(prefix) {
  return `${prefix}-${Crypto.randomUUID()}`;
}

function language(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ["js", "jsx", "mjs", "cjs", "ts", "tsx", "json", "html", "htm", "css", "md", "markdown"].includes(extension)
    ? extension
    : "text";
}

function errorText(error) {
  if (error?.status === 409 && error.code === "FILE_VERSION_CONFLICT")
    return "The GitHub file changed since you opened it. Reload and review the current version before trying again.";
  if (error?.status === 409 && error.code === "BASE_VERSION_CONFLICT")
    return "The selected base branch moved. Reload branches and create a new fix branch.";
  if (error?.status === 403 || error?.code === "GITHUB_PERMISSION_DENIED")
    return "This GitHub App installation does not have the permissions required for this action.";
  if (error?.status === 404 || error?.code === "RESOURCE_NOT_FOUND")
    return "Repository access was revoked or this file is no longer available.";
  if (error?.status === 429) return "GitHub rate limited this request. Wait, then retry.";
  if (error?.code === "OPERATION_OUTCOME_UNKNOWN")
    return "GitHub may have applied this operation. Refresh the branch or pull request list before retrying.";
  return error?.message || "The editor could not complete this action. Retry when connected.";
}

function NativeFrame({ title, subtitle, onBack, children }) {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right", "bottom"]}>
      <View className="border-b border-border px-5 pb-4 pt-2">
        <Action label="Back" onPress={onBack} />
        <Text accessibilityRole="header" className="mt-3 text-2xl font-bold text-textPrimary">{title}</Text>
        <Text className="mt-1 text-sm text-textSecondary">{subtitle}</Text>
      </View>
      {children}
    </SafeAreaView>
  );
}

function NativeDiff({ before, after }) {
  const rows = useMemo(() => diffLines(before, after).flatMap((part, partIndex) =>
    part.value.split("\n").slice(0, -1).map((line, lineIndex) => ({
      id: `${partIndex}:${lineIndex}`,
      text: `${part.added ? "+ " : part.removed ? "− " : "  "}${line}`,
      color: part.added ? "#86efac" : part.removed ? "#fca5a5" : "#cbd5e1",
      backgroundColor: part.added ? "#123126" : part.removed ? "#3a2029" : "transparent",
    })),
  ).slice(0, 10000), [before, after]);
  return (
    <FlatList
      accessibilityLabel="Native file diff"
      data={rows}
      keyExtractor={(item) => item.id}
      initialNumToRender={40}
      maxToRenderPerBatch={40}
      windowSize={7}
      renderItem={({ item }) => (
        <Text selectable style={{ color: item.color, backgroundColor: item.backgroundColor, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, paddingHorizontal: 10, paddingVertical: 2 }}>
          {item.text.slice(0, 2000) || " "}
        </Text>
      )}
      ListEmptyComponent={<Text className="p-5 text-textSecondary">No changes to commit.</Text>}
    />
  );
}

export default function EditorScreen() {
  const params = useLocalSearchParams();
  const repositoryId = singleParam(params.id);
  const path = singleParam(params.path);
  const baseRef = singleParam(params.ref);
  const router = useRouter();
  const { status, user } = useAuth();
  const { isOffline } = useConnectivity();
  const { api } = useRepositoryApi();
  const repository = useRepository(repositoryId);
  const [file, setFile] = useState(null);
  const [branch, setBranch] = useState("");
  const [baseSha, setBaseSha] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [draftContent, setDraftContent] = useState(null);
  const [sha, setSha] = useState("");
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [stage, setStage] = useState("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("Fix: update source file");
  const [pullTitle, setPullTitle] = useState("Fix: update source file");
  const [pullBody, setPullBody] = useState("");
  const [pullRequest, setPullRequest] = useState(null);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [webViewRevision, setWebViewRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const webView = useRef(null);
  const bridge = useRef(null);
  const callbacks = useRef(new Map());
  const idempotency = useRef({});
  const bridgeIds = useRef(null);
  const saveTimer = useRef(null);
  const canEdit = Boolean(file?.editable && file.encoding === "utf-8" && !file.binary && file.size <= editorMaximumContentBytes);
  const activeApp = useRef(AppState.currentState);

  const createBridge = useCallback(() => {
    callbacks.current.clear();
    const sessionId = newId("session");
    const bootRequestId = newId("boot");
    bridge.current?.close();
    bridge.current = createEditorBridge({
      sessionId,
      bootRequestId,
      postMessage: (message) => webView.current?.postMessage(message),
      onReject: () => setError({ code: "EDITOR_BRIDGE_REJECTED" }),
      onMessage: (message) => {
        if (message.type === "EDITOR_READY") setReady(true);
        if (message.type === "DOCUMENT_READY") callbacks.current.get(message.requestId)?.resolve(true);
        if (message.type === "CONTENT_RESULT") callbacks.current.get(message.requestId)?.resolve(message.payload.content);
      if (message.type === "DOCUMENT_CHANGED") {
          setContent(message.payload.content);
        setDirty(message.payload.content !== file?.content);
          setCursor({ line: message.payload.line, column: message.payload.column });
        }
        if (message.type === "CURSOR_CHANGED") setCursor(message.payload);
        if (message.type === "EDITOR_ERROR") {
          callbacks.current.get(message.requestId)?.reject(new Error(message.payload.code));
          setError({ code: message.payload.code });
        }
        callbacks.current.delete(message.requestId);
      },
    });
    bridgeIds.current = { sessionId, bootRequestId };
    return bridgeIds.current;
  }, [file?.content]);

  const requestEditor = useCallback((type, payload) => {
    if (!bridge.current?.ready) return Promise.reject(new Error("Editor is not ready"));
    const requestId = newId("native");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        callbacks.current.delete(requestId);
        reject(new Error("Editor request timed out"));
      }, 10000);
      callbacks.current.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (reason) => { clearTimeout(timer); reject(reason); },
      });
      try { bridge.current.send(type, payload, requestId); }
      catch (reason) { clearTimeout(timer); callbacks.current.delete(requestId); reject(reason); }
    });
  }, []);

  const sendDocument = useCallback(async (source, readOnly = false) => {
    const requestId = newId("load");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { callbacks.current.delete(requestId); reject(new Error("Editor load timed out")); }, 10000);
      callbacks.current.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (reason) => { clearTimeout(timer); reject(reason); } });
      bridge.current.send("LOAD_DOCUMENT", {
        content: source,
        path,
        ref: branch || baseRef,
        sha,
        language: language(path),
        readOnly,
      }, requestId);
    });
  }, [path, branch, baseRef, sha]);

  const getIdempotencyKey = async (operation, fingerprintValue) => {
    const fingerprint = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      fingerprintValue,
    );
    const existing = idempotency.current[operation];
    if (existing?.fingerprint === fingerprint) return existing.key;
    const next = { fingerprint, key: newId("idem") };
    idempotency.current[operation] = next;
    return next.key;
  };

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      bridge.current?.close();
      callbacks.current.forEach((item) => item.reject(new Error("Editor closed")));
      callbacks.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!repositoryId || !path || !baseRef || !repository.data || isOffline) return;
    let cancelled = false;
    setStage("loading");
    setError(null);
    api.getFile(repositoryId, path, baseRef).then(async (response) => {
      if (cancelled) return;
      const nextFile = response.data;
      if (!nextFile.editable || nextFile.encoding !== "utf-8" || nextFile.binary || nextFile.size > editorMaximumContentBytes) {
        setFile(nextFile); setStage("unsupported"); return;
      }
      setFile(nextFile); setSha(nextFile.sha); setBranch(baseRef);
      setSourceLoaded(true);
      setOriginal(nextFile.content);
      const selectedBranch = await api.getBranch(repositoryId, baseRef);
      if (!selectedBranch.data?.commitSha) throw new Error("The selected branch revision could not be verified. Retry before editing.");
      setBaseSha(selectedBranch.data.commitSha);
      const draft = user?.id ? await editorDraftStore.find({ userId: user.id, repositoryId, path }) : null;
      if (cancelled) return;
      if (draft) {
        Alert.alert("Saved draft found", "Restore the encrypted local draft? It expires after 24 hours and has not been sent to GitHub.", [
          { text: "Discard", style: "destructive", onPress: () => { void editorDraftStore.delete({ userId: user.id, repositoryId, branch: draft.branch, path }); setDraftContent(null); } },
          { text: "Restore draft", onPress: async () => {
            try {
              const [draftBranch, draftFile] = await Promise.all([
                api.getBranch(repositoryId, draft.branch),
                api.getFile(repositoryId, path, draft.branch),
              ]);
              if (draftFile.data.sha !== draft.expectedSha) {
                await editorDraftStore.delete({ userId: user.id, repositoryId, branch: draft.branch, path });
                setError({ status: 409, code: "FILE_VERSION_CONFLICT" });
                setStage("error");
                return;
              }
              if (!draftBranch.data?.commitSha) throw new Error("The saved branch could not be verified.");
              setBranch(draft.branch);
              setBaseSha(draft.baseSha);
              setFile(draftFile.data);
              setSha(draftFile.data.sha);
              setOriginal(draftFile.data.content);
              setDraftContent(draft.content);
              setSourceLoaded(true);
            } catch (reason) { setError(reason); setStage("error"); }
          } },
        ]);
      } else setDraftContent(null);
    }).catch((reason) => { if (!cancelled) { setError(reason); setStage("error"); } });
    return () => { cancelled = true; };
  }, [api, repositoryId, path, baseRef, repository.data?.data.id, repository.data?.data.defaultBranch, isOffline, user?.id, loadAttempt]);

  // Load the source only after WebView's one-time bridge handshake.
  useEffect(() => {
    if (!ready || !file || !sourceLoaded || !["loading", "edit"].includes(stage)) return;
    let cancelled = false;
    const source = draftContent ?? file.content;
    setOriginal(file.content);
    setContent(source);
    setDirty(source !== file.content);
    sendDocument(source, !canEdit || branch === baseRef).then(() => {
      if (!cancelled) setStage("edit");
    }).catch((reason) => { if (!cancelled) { setError(reason); setStage("error"); } });
    return () => { cancelled = true; };
  }, [ready, file, sourceLoaded, stage, canEdit, draftContent, sendDocument, branch, baseRef]);

  useEffect(() => {
    if (!dirty || !file || !user?.id || !branch || stage !== "edit") return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void editorDraftStore.save({ userId: user.id, repositoryId, branch, path, baseSha, expectedSha: sha, content }).catch((reason) => setError(reason));
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [dirty, file, user?.id, repositoryId, branch, path, baseSha, sha, content, stage]);

  const discardAndLeave = useCallback(() => {
    Alert.alert("Discard unsaved changes?", "Your encrypted local draft will be deleted.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: async () => {
        if (user?.id && branch) await editorDraftStore.delete({ userId: user.id, repositoryId, branch, path });
        setDirty(false); router.back();
      } },
    ]);
  }, [user?.id, branch, repositoryId, path, router]);

  usePreventRemove(dirty && ["edit", "diff"].includes(stage), ({ data }) => {
    Alert.alert("Unsaved changes", "Save an encrypted draft or discard your changes before leaving.", [
      { text: "Stay", style: "cancel" },
      { text: "Save draft", onPress: () => {
        void editorDraftStore.save({ userId: user.id, repositoryId, branch, path, baseSha, expectedSha: sha, content })
          .then(() => { setDirty(false); router.dispatch(data.action); })
          .catch((reason) => setError(reason));
      } },
      { text: "Discard", style: "destructive", onPress: () => { void editorDraftStore.delete({ userId: user.id, repositoryId, branch, path }); setDirty(false); router.dispatch(data.action); } },
    ]);
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        activeApp.current = state;
        Keyboard.dismiss();
        if (dirty && file && user?.id) void editorDraftStore.save({ userId: user.id, repositoryId, branch, path, baseSha, expectedSha: sha, content }).catch(() => {});
        setReady(false);
        setWebViewRevision((current) => current + 1);
      } else if (file && activeApp.current !== "active") {
        activeApp.current = "active";
        if (dirty) {
          setDraftContent(content);
          setStage("loading");
        }
        createBridge();
        setWebViewRevision((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, [dirty, file, user?.id, repositoryId, branch, path, baseSha, sha, content, createBridge]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (dirty) { discardAndLeave(); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [dirty, discardAndLeave]);

  async function createBranch() {
    const name = branchName.trim();
    if (!name) return setError(new Error("Enter a new fix branch name."));
    if (!/^(?:fix|bugfix|chore|docs)\/[A-Za-z0-9._/-]{1,180}$/.test(name) || name.includes("..") || name.endsWith(".lock"))
      return setError(new Error("Use a safe new branch name such as fix/incident-123."));
    setBusy(true); setError(null);
    try {
      const key = await getIdempotencyKey("branch", `${repositoryId}\n${name}\n${baseRef}\n${baseSha}`);
      const result = await api.createFixBranch(repositoryId, { branch: name, baseBranch: baseRef, baseSha }, key);
      delete idempotency.current.branch;
      setBranch(result.data.branch);
      setBranchName("");
      setOriginal(file.content);
      setContent(content || file.content);
      setShowBranchForm(false);
      setDirty(content !== file.content);
      bridge.current.send("SET_READ_ONLY", { readOnly: false });
      setStage("edit");
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  async function showDiff() {
    setBusy(true); setError(null); Keyboard.dismiss();
    try {
      const latest = await requestEditor("REQUEST_CONTENT", {});
      if (encodeUtf8(latest).length > editorMaximumContentBytes) throw new Error("File is larger than the 512 KiB editing limit.");
      const lines = latest.split("\n");
      if (lines.length > 10000 || lines.some((line) => line.length > 2000)) {
        throw new Error("This file is editable, but its diff exceeds the mobile review limit (10,000 lines or 2,000 characters per line). Reduce the change before committing.");
      }
      setContent(latest); setDirty(latest !== original); setStage("diff");
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  async function confirmCommit() {
    Alert.alert("Commit to fix branch?", `${repository.data?.data.fullName}\n${branch}\n${path}\n\nThis creates a commit on the new fix branch. It does not run tests or deploy.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Commit changes", onPress: async () => {
        setBusy(true); setError(null);
        try {
          const latestFile = await api.getFile(repositoryId, path, branch);
          if (latestFile.data.sha !== sha) {
            const conflict = Object.assign(new Error("File changed on GitHub. Reload before committing."), { status: 409, code: "FILE_VERSION_CONFLICT" });
            setError(conflict); setStage("error"); return;
          }
          const contentHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
          const key = await getIdempotencyKey("commit", `${repositoryId}\n${branch}\n${path}\n${sha}\n${contentHash}\n${commitMessage.trim()}`);
          const result = await api.commitFixFile(repositoryId, { branch, path, content, expectedSha: sha, commitMessage: commitMessage.trim() }, key);
          delete idempotency.current.commit;
          setSha(result.data.contentSha || sha);
          setDirty(false);
          await editorDraftStore.delete({ userId: user.id, repositoryId, branch, path });
          setStage("pull-request");
        } catch (reason) { setError(reason); }
        finally { setBusy(false); }
      } },
    ]);
  }

  async function confirmPullRequest() {
    if (!pullTitle.trim()) return setError(new Error("Enter a pull request title."));
    Alert.alert("Open pull request?", `From ${branch} into ${baseRef}. GitHub checks and review still apply.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Open pull request", onPress: async () => {
        setBusy(true); setError(null);
        try {
          const key = await getIdempotencyKey("pull-request", `${repositoryId}\n${branch}\n${baseRef}\n${pullTitle.trim()}\n${pullBody.trim()}`);
          const result = await api.createPullRequest(repositoryId, { head: branch, base: baseRef, title: pullTitle.trim(), body: pullBody.trim(), draft: false }, key);
          delete idempotency.current["pull-request"];
          setPullRequest(result.data);
          setStage("done");
        } catch (reason) { setError(reason); } finally { setBusy(false); }
      } },
    ]);
  }

  async function reloadCurrentFile() {
    setBusy(true);
    try {
      const latest = await api.getFile(repositoryId, path, branch || baseRef);
      setFile(latest.data);
      setSha(latest.data.sha);
      setOriginal(latest.data.content);
      setDraftContent(content);
      setReady(false);
      createBridge();
      setStage("loading");
      setError(null);
      setWebViewRevision((current) => current + 1);
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  if (status !== "authenticated") return <Redirect href="/(auth)/login" />;
  if (!repositoryId || !path || !baseRef) return <NativeFrame title="Editor unavailable" subtitle="Open a file from a repository first." onBack={() => router.back()}><RetryState error={{ code: "INVALID_ROUTE" }} onRetry={() => router.back()} /></NativeFrame>;
  if (isOffline) return <NativeFrame title="Editor offline" subtitle={path} onBack={() => router.back()}><RetryState error={{ code: "NETWORK_ERROR" }} onRetry={() => repository.refetch()} /></NativeFrame>;
  if (repository.isPending) return <RepositorySkeleton label="Loading repository" />;
  if (denied(repository.error)) return <NativeFrame title="Repository unavailable" subtitle="Access could be revoked." onBack={() => router.back()}><RetryState error={repository.error} onRetry={() => repository.refetch()} /></NativeFrame>;

  if (!bridge.current) createBridge();
  const activeBridgeIds = bridgeIds.current;
  const html = createEditorHtml({ ...activeBridgeIds, nonce: activeBridgeIds.sessionId, codeMirrorBundle });

  return (
    <NativeFrame title={stage === "diff" ? "Review changes" : stage === "pull-request" ? "Open pull request" : stage === "done" ? "Pull request created" : "Code editor"} subtitle={`${repository.data?.data.fullName} · ${branch || baseRef} · ${path}`} onBack={() => dirty ? discardAndLeave() : router.back()}>
      {error ? <View className="p-4"><Text accessibilityRole="alert" className="mb-3 text-warning">{errorText(error)}</Text>{error.code === "FILE_VERSION_CONFLICT" || error.message?.includes("crashed") || error.message?.includes("stopped") ? <Action label="Reload editor and current file" onPress={reloadCurrentFile} /> : <Action label="Dismiss" onPress={() => {
        setError(null);
        if (stage === "error") {
          if (file && sourceLoaded && ready) { if (dirty) setDraftContent(content); setStage("loading"); }
          else { setReady(false); createBridge(); setWebViewRevision((current) => current + 1); setLoadAttempt((attempt) => attempt + 1); }
        }
      }} />}</View> : null}
      {stage === "unsupported" ? <View className="p-5"><Text className="mb-4 text-textPrimary">This file is binary, oversized, or marked non-editable by GitHub. It remains available in read-only preview.</Text><Action label="Back to preview" onPress={() => router.back()} /></View> : null}
      {stage === "loading" || (stage === "edit" && !ready) || stage === "error" ? <RepositorySkeleton label="Loading source into local editor" /> : null}
      {file && canEdit && ["loading", "edit", "diff", "error"].includes(stage) ? (
        <>
          <View className="flex-row items-center justify-between border-b border-border px-4 py-2"><Text className="text-xs text-textSecondary">{file.size} bytes · {language(path)} · cursor {cursor.line}:{cursor.column}</Text><Text className="text-xs text-warning">Local only until confirmed</Text></View>
          <WebView
            key={`${activeBridgeIds.sessionId}:${webViewRevision}`}
            ref={webView}
            source={{ html, baseUrl: editorOrigin }}
            originWhitelist={["about:blank", editorOrigin]}
            onShouldStartLoadWithRequest={(request) => isAllowedEditorNavigation(request.url)}
            onMessage={(event) => bridge.current?.receive(event.nativeEvent.data)}
            onError={() => { setError(new Error("The local editor crashed. Reload the editor; your encrypted draft is preserved.")); setReady(false); }}
            onRenderProcessGone={() => { setError(new Error("The editor process stopped. Reload the editor; your encrypted draft is preserved.")); setReady(false); }}
            onContentProcessDidTerminate={() => { setError(new Error("The editor process stopped. Reload the editor; your encrypted draft is preserved.")); setReady(false); }}
            javaScriptEnabled
            domStorageEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            incognito
            cacheEnabled={false}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            accessibilityLabel="Local source code editor"
            style={{ flex: 1, backgroundColor: "#0b1220" }}
          />
          {stage === "edit" ? (
            <View className="gap-3 border-t border-border p-4">
              {showBranchForm ? <>
                <Text className="text-sm text-textPrimary">Create a fix branch from {baseRef} ({baseSha.slice(0, 8) || "loading revision"})</Text>
                <TextInput value={branchName} onChangeText={setBranchName} placeholder="fix/short-description" placeholderTextColor={colors.textSecondary} autoCapitalize="none" maxLength={190} accessibilityLabel="New fix branch name" className="min-h-12 rounded-xl border border-border bg-surface px-3 text-textPrimary" />
                <Action label={busy ? "Creating branch…" : "Create fix branch"} disabled={busy || !baseSha} onPress={() => Alert.alert("Create a new branch?", `Create ${branchName || "fix/…"} from ${baseRef}.`, [{ text: "Cancel", style: "cancel" }, { text: "Create branch", onPress: createBranch }])} />
              </> : branch === baseRef ? <>
                <Text className="text-sm text-textSecondary">Create a separate fix branch before editing this base branch.</Text>
                <Action label="Choose fix branch" disabled={busy || !baseSha} onPress={() => setShowBranchForm(true)} />
              </> : <>
                <TextInput value={commitMessage} onChangeText={setCommitMessage} maxLength={200} accessibilityLabel="Commit message" placeholder="Commit message" placeholderTextColor={colors.textSecondary} className="min-h-12 rounded-xl border border-border bg-surface px-3 text-textPrimary" />
                <Action label={busy ? "Reading editor…" : "Review native diff"} disabled={busy || !dirty || !commitMessage.trim()} onPress={showDiff} />
              </>}
            </View>
          ) : null}
          {stage === "diff" ? <><NativeDiff before={original} after={content} /><View className="gap-3 border-t border-border p-4"><Text className="text-sm text-textPrimary">{repository.data?.data.fullName} · {branch} → commit message: {commitMessage}</Text><Action label={busy ? "Committing…" : "Confirm and commit"} disabled={busy || !dirty} onPress={confirmCommit} /><Action label="Continue editing" disabled={busy} onPress={() => setStage("edit")} /></View></> : null}
        </>
      ) : null}
      {stage === "pull-request" ? <View className="gap-4 p-5"><Text className="leading-6 text-textSecondary">Commit created on {branch}. Tests and deployment have not been run.</Text><TextInput value={pullTitle} onChangeText={setPullTitle} maxLength={200} accessibilityLabel="Pull request title" placeholder="Pull request title" placeholderTextColor={colors.textSecondary} className="min-h-12 rounded-xl border border-border bg-surface px-3 text-textPrimary" /><TextInput value={pullBody} onChangeText={setPullBody} maxLength={4000} multiline accessibilityLabel="Pull request description" placeholder="Describe the change" placeholderTextColor={colors.textSecondary} className="min-h-32 rounded-xl border border-border bg-surface px-3 py-3 text-textPrimary" /><Text className="text-sm text-textSecondary">{branch} → {baseRef}</Text><Action label={busy ? "Opening pull request…" : "Review and open pull request"} disabled={busy || !pullTitle.trim()} onPress={confirmPullRequest} /></View> : null}
      {stage === "done" && pullRequest ? <View className="gap-4 p-5"><Text className="text-lg text-textPrimary">Pull request #{pullRequest.number} is open.</Text><Text className="text-sm text-textSecondary">GitHub CI and review determine whether it can merge. PocketOps has not merged or deployed it.</Text><Action label="Open on GitHub" onPress={() => void Linking.openURL(pullRequest.url)} /><Action label="Done" onPress={() => router.back()} /></View> : null}
      {busy ? <ActivityIndicator accessibilityLabel="Saving change" color={colors.accentHi} /> : null}
    </NativeFrame>
  );
}
