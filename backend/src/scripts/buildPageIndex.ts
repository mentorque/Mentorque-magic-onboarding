/**
 * Build PageIndex trees for playbook PDFs and save document IDs.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/buildPageIndex.ts
 *
 * Optional env:
 *   PAGEINDEX_API_KEY                (required)
 *   PAGEINDEX_POLL_INTERVAL_MS       (default 3000)
 *   PAGEINDEX_OUTPUT_PATH            (default backend/src/playbooks/document_ids.json)
 *
 * Note:
 * - This script expects the official SDK package to be installed in this workspace.
 * - If install is blocked locally, install @pageindex/sdk in your environment first.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFileSync(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../.env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const noExport = trimmed.replace(/^export\s+/i, "");
      const eqIdx = noExport.indexOf("=");
      if (eqIdx === -1) continue;
      const key = noExport.slice(0, eqIdx).trim();
      let val = noExport.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return;
  }
}

loadEnvFileSync();

type PageIndexLike = {
  submit_documents?: (filePath: string) => Promise<{ document_id: string }>;
  submit_document?: (filePath: string) => Promise<{ document_id: string }>;
  submitDocuments?: (filePath: string) => Promise<{ document_id: string }>;
  submitDocument?: (filePath: string) => Promise<{ document_id: string }>;
  get_document_status?: (documentId: string) => Promise<{ status: string }>;
  getDocumentStatus?: (documentId: string) => Promise<{ status: string }>;
  get_tree?: (
    documentId: string,
    options?: { node_summary?: boolean },
  ) => Promise<unknown>;
  getTree?: (
    documentId: string,
    options?: { node_summary?: boolean },
  ) => Promise<unknown>;
};

type MpcToolListItem = { name?: string };

function coerceDocId(v: any): string {
  if (!v) return "";
  if (typeof v.document_id === "string") return v.document_id;
  if (typeof v.documentId === "string") return v.documentId;
  if (typeof v.id === "string") return v.id;
  return "";
}

function coerceStatus(v: any): string {
  if (!v) return "";
  if (typeof v.status === "string") return v.status;
  if (typeof v.state === "string") return v.state;
  if (typeof v.document_status === "string") return v.document_status;
  return "";
}

function toolByNameLike(
  tools: MpcToolListItem[],
  patterns: RegExp[],
): string | null {
  for (const t of tools) {
    const n = String(t?.name || "");
    if (!n) continue;
    if (patterns.some((p) => p.test(n))) return n;
  }
  return null;
}

async function getPageIndexClientFromMcp(): Promise<PageIndexLike> {
  const apiKey = process.env.PAGEINDEX_API_KEY?.trim();
  if (!apiKey) throw new Error("PAGEINDEX_API_KEY is required.");
  const bearerApiKey: string = apiKey;
  const url = process.env.PAGEINDEX_MCP_URL || "https://api.pageindex.ai/mcp";

  let reqId = 1;
  async function rpc(method: string, params: any): Promise<any> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${bearerApiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: reqId++,
        method,
        params,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.error) {
      const msg =
        json?.error?.message ||
        json?.message ||
        `MCP ${method} failed (${res.status})`;
      throw new Error(String(msg));
    }
    return json?.result;
  }

  async function notify(method: string, params: any): Promise<void> {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${bearerApiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
    }).catch(() => undefined);
  }

  // Initialize MCP session for servers that require it before tools/list.
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mentorque-pageindex-builder", version: "1.0.0" },
  }).catch(() => undefined);
  await notify("notifications/initialized", {});

  const listed = await rpc("tools/list", {});
  const tools: MpcToolListItem[] = Array.isArray(listed?.tools) ? listed.tools : [];
  if (tools.length === 0) {
    throw new Error("PageIndex MCP returned no tools.");
  }

  const submitTool =
    toolByNameLike(tools, [/submit.*document/i, /upload.*document/i]) || "";
  const statusTool =
    toolByNameLike(tools, [/get.*status/i, /document.*status/i]) || "";
  const treeTool = toolByNameLike(tools, [/get.*tree/i, /\btree\b/i]) || "";

  if (!submitTool || !statusTool) {
    throw new Error(
      `Could not resolve submit/status tools from MCP list: ${tools
        .map((t) => t.name)
        .filter(Boolean)
        .join(", ")}`,
    );
  }

  async function callTool(name: string, args: any): Promise<any> {
    const out = await rpc("tools/call", { name, arguments: args });
    // Some MCP servers wrap data in output/content; return best-effort parsed object.
    if (out && typeof out === "object" && !Array.isArray(out)) {
      if (out.structuredContent && typeof out.structuredContent === "object") {
        return out.structuredContent;
      }
      if (Array.isArray(out.content) && out.content.length > 0) {
        const txt = out.content
          .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
          .join("\n")
          .trim();
        if (txt) {
          try {
            return JSON.parse(txt);
          } catch {
            return { text: txt };
          }
        }
      }
      return out;
    }
    return out;
  }

  return {
    submit_document: async (filePath: string) => {
      const argAttempts = [
        { path: filePath },
        { file_path: filePath },
        { filePath },
        { document_path: filePath },
      ];
      let lastErr: unknown = null;
      for (const args of argAttempts) {
        try {
          const r = await callTool(submitTool, args);
          const document_id = coerceDocId(r);
          if (document_id) return { document_id };
        } catch (e) {
          lastErr = e;
        }
      }
      throw (
        lastErr ||
        new Error(`submit tool did not return document_id (${submitTool})`)
      );
    },
    get_document_status: async (documentId: string) => {
      const argAttempts = [
        { document_id: documentId },
        { documentId },
        { id: documentId },
      ];
      let lastErr: unknown = null;
      for (const args of argAttempts) {
        try {
          const r = await callTool(statusTool, args);
          const status = coerceStatus(r);
          if (status) return { status };
        } catch (e) {
          lastErr = e;
        }
      }
      throw (
        lastErr ||
        new Error(`status tool did not return status (${statusTool})`)
      );
    },
    get_tree: treeTool
      ? async (documentId: string, options?: { node_summary?: boolean }) => {
          const argAttempts = [
            { document_id: documentId, ...(options ?? {}) },
            { documentId, ...(options ?? {}) },
            { id: documentId, ...(options ?? {}) },
          ];
          let lastErr: unknown = null;
          for (const args of argAttempts) {
            try {
              return await callTool(treeTool, args);
            } catch (e) {
              lastErr = e;
            }
          }
          throw (
            lastErr || new Error(`tree tool call failed (${treeTool})`)
          );
        }
      : undefined,
  };
}

async function getPageIndexClient(): Promise<PageIndexLike> {
  if ((process.env.PAGEINDEX_CLIENT_MODE || "sdk").toLowerCase() === "mcp") {
    return getPageIndexClientFromMcp();
  }
  const apiKey = process.env.PAGEINDEX_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("PAGEINDEX_API_KEY is required.");
  }

  // Use a runtime package name so TS compile does not fail if SDK is not installed yet.
  const sdkPkg = process.env.PAGEINDEX_SDK_PACKAGE || "@pageindex/sdk";
  let mod: any;
  try {
    mod = await import(sdkPkg);
  } catch {
    throw new Error(
      `Could not import ${sdkPkg}. Install it first (e.g. pnpm --filter @workspace/api-server add ${sdkPkg}).`,
    );
  }

  const Ctor =
    mod.PageIndexClient || mod.PageIndex || mod.default?.PageIndexClient || mod.default;
  if (!Ctor) {
    throw new Error(
      `Loaded ${sdkPkg}, but no PageIndex client constructor was found.`,
    );
  }
  return new Ctor({ apiKey }) as PageIndexLike;
}

async function retry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (retries === 0) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    return retry(fn, retries - 1);
  }
}

const files: Record<string, string> = {
  sales: resolve(process.cwd(), "src/playbooks/Sales_Resume_Blueprint.pdf"),
  sde: resolve(process.cwd(), "src/playbooks/SDE_Cloud_Resume_Blueprint (1).pdf"),
  data: resolve(process.cwd(), "src/playbooks/DataScience_DE_Resume_Blueprint.pdf"),
  pm: resolve(process.cwd(), "src/playbooks/NonTech_PM_CS_PjM_Resume_Blueprint.pdf"),
  analyst: resolve(process.cwd(), "src/playbooks/Analyst_Resume_Blueprint.pdf"),
  baseline: resolve(process.cwd(), "src/playbooks/Baseline-Guide.pdf"),
};

async function waitUntilReady(
  client: PageIndexLike,
  documentId: string,
  pollIntervalMs: number,
  options?: { requireRetrievalReady?: boolean; quiet?: boolean; maxWaitMs?: number },
): Promise<void> {
  const requireRetrievalReady = options?.requireRetrievalReady ?? false;
  const quiet = options?.quiet ?? true;
  const maxWaitMs = options?.maxWaitMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();
  const getStatus =
    client.get_document_status?.bind(client) ||
    client.getDocumentStatus?.bind(client);
  for (;;) {
    let s = "";
    let retrievalReady = true;
    if (getStatus) {
      const status = await getStatus(documentId);
      s = String(status?.status ?? "").toLowerCase();
    } else {
      const api = (client as any)?.api;
      if (api?.getTree) {
        const treeResult = await api.getTree(documentId);
        s = String(treeResult?.status ?? "").toLowerCase();
        // SDK tree response may include retrieval readiness separately.
        if (typeof treeResult?.retrieval_ready === "boolean") {
          retrievalReady = Boolean(treeResult.retrieval_ready);
        } else if (typeof treeResult?.retrievalReady === "boolean") {
          retrievalReady = Boolean(treeResult.retrievalReady);
        } else {
          retrievalReady = s === "ready" || s === "completed" || s === "succeeded";
        }
      } else {
        throw new Error(
          "PageIndex client has no status method (expected get_document_status/getDocumentStatus or api.getTree).",
        );
      }
    }
    if (!quiet) {
      console.log(
        `[${documentId}] status=${s || "unknown"} retrieval_ready=${String(retrievalReady)}`,
      );
    }
    const doneByStatus = s === "ready" || s === "completed" || s === "succeeded";
    if (doneByStatus && (!requireRetrievalReady || retrievalReady)) {
      return;
    }
    if (s === "failed" || s === "error") {
      throw new Error(`Document ${documentId} failed with status=${s}`);
    }
    if (Date.now() - startedAt >= maxWaitMs) {
      if (requireRetrievalReady && doneByStatus && !retrievalReady) {
        console.warn(
          `[${documentId}] timed out waiting for retrieval_ready=true; continuing with completed status.`,
        );
        return;
      }
      throw new Error(`[${documentId}] timed out waiting for processing readiness.`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

async function main() {
  const pollIntervalMs = Number(process.env.PAGEINDEX_POLL_INTERVAL_MS || "3000");
  const requireRetrievalReady =
    (process.env.PAGEINDEX_REQUIRE_RETRIEVAL_READY || "0").toLowerCase() !== "0";
  const quietPolling =
    (process.env.PAGEINDEX_QUIET_POLLING || "1").toLowerCase() !== "0";
  const maxWaitMs = Number(
    process.env.PAGEINDEX_MAX_WAIT_MS || String(15 * 60 * 1000),
  );
  const refreshExistingTrees =
    (process.env.PAGEINDEX_REFRESH_EXISTING_TREES || "1").toLowerCase() !== "0";
  const outputPath = resolve(
    process.cwd(),
    process.env.PAGEINDEX_OUTPUT_PATH || "src/playbooks/document_ids.json",
  );
  const treesDir = resolve(
    process.cwd(),
    process.env.PAGEINDEX_TREES_DIR || "src/playbooks/trees",
  );
  mkdirSync(treesDir, { recursive: true });
  const client = await getPageIndexClient();
  const sdkApi = (client as any)?.api;
  const submitDocument =
    client.submit_documents?.bind(client) ||
    client.submit_document?.bind(client) ||
    client.submitDocuments?.bind(client) ||
    client.submitDocument?.bind(client) ||
    (sdkApi?.submitDocument
      ? async (filePath: string) => {
          const file = readFileSync(filePath);
          const result = await sdkApi.submitDocument(file, basename(filePath));
          const docId = String(result?.doc_id || result?.document_id || "").trim();
          return { document_id: docId };
        }
      : undefined);
  if (!submitDocument) {
    throw new Error(
      "PageIndex client has no submit_documents/submit_document method.",
    );
  }
  const getTree =
    client.get_tree?.bind(client) ||
    client.getTree?.bind(client) ||
    (sdkApi?.getTree
      ? async (documentId: string, options?: { node_summary?: boolean }) =>
          sdkApi.getTree(documentId, {
            nodeSummary: Boolean(options?.node_summary),
          })
      : undefined);

  let documentIds: Record<string, string> = {};
  if (existsSync(outputPath)) {
    try {
      const parsed = JSON.parse(readFileSync(outputPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        documentIds = parsed as Record<string, string>;
      }
    } catch {
      // Ignore invalid existing file and rebuild map from scratch.
    }
  }

  for (const [key, path] of Object.entries(files)) {
    if (!existsSync(path)) {
      throw new Error(`Playbook not found: ${path}`);
    }
    if (documentIds[key]) {
      console.log(`Skipping ${key}, already uploaded: ${documentIds[key]}`);
      if (refreshExistingTrees && typeof getTree === "function") {
        const existingDocId = documentIds[key];
        await waitUntilReady(client, existingDocId, pollIntervalMs, {
          requireRetrievalReady,
          quiet: quietPolling,
          maxWaitMs,
        });
        const tree = await retry(() =>
          getTree(existingDocId, { node_summary: true }),
        );
        const treePath = resolve(treesDir, `${key}_tree.json`);
        writeFileSync(treePath, JSON.stringify(tree, null, 2), "utf8");
        console.log(`Refreshed tree for ${key} -> ${treePath}`);
      }
      continue;
    }

    console.log(`Uploading ${key}: ${path}`);
    const upload = await retry(() => submitDocument(path));
    const docId = String(upload?.document_id || "").trim();
    if (!docId) {
      throw new Error(`Upload returned no document_id for ${key}`);
    }
    documentIds[key] = docId;
    console.log(`${key} -> ${docId}`);
    writeFileSync(outputPath, JSON.stringify(documentIds, null, 2), "utf8");

    await waitUntilReady(client, docId, pollIntervalMs, {
      requireRetrievalReady,
      quiet: quietPolling,
      maxWaitMs,
    });

    if (typeof getTree === "function") {
      const tree = await retry(() => getTree(docId, { node_summary: true }));
      const treePath = resolve(treesDir, `${key}_tree.json`);
      writeFileSync(treePath, JSON.stringify(tree, null, 2), "utf8");
      console.log(`Saved tree for ${key} -> ${treePath}`);
    } else {
      console.warn(
        "SDK client has no get_tree() method. Skipping local tree export.",
      );
    }
  }

  writeFileSync(outputPath, JSON.stringify(documentIds, null, 2), "utf8");
  console.log(`Saved document IDs to ${outputPath}`);
}

void main().catch((err: any) => {
  console.error(err?.message ?? err);
  process.exit(1);
});

