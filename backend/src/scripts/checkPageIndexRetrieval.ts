/**
 * Smoke-test PageIndex document + chat (retrieval-backed) using REST + PAGEINDEX_API_KEY.
 *
 * PageIndex uses PAGEINDEX_API_KEY — not OpenAI. (OpenAI is unrelated to this check.)
 *
 * Usage (from repo root — workspace):
 *   pnpm run check-pageindex-retrieval
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/checkPageIndexRetrieval.ts pi-xxxx
 *
 * From backend/ use filter or exec:
 *   pnpm --filter @workspace/api-server run check-pageindex-retrieval
 *
 * Env: PAGEINDEX_API_KEY (required). Optional: PAGEINDEX_API_URL (default https://api.pageindex.ai)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    return;
  }
}

function pickDocIdFromCli(): string | null {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith("--doc-id=")) return a.slice("--doc-id=".length).trim() || null;
  }
  const positional = args.find((a) => !a.startsWith("-") && a.startsWith("pi-"));
  return positional?.trim() || null;
}

function pickDocIdFromSavedIds(): string | null {
  const candidates = [
    resolve(process.cwd(), "src/playbooks/document_ids.json"),
    resolve(process.cwd(), "backend/src/playbooks/document_ids.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const map = JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
      const first = Object.values(map).find((v) => typeof v === "string" && v.startsWith("pi-"));
      if (first) return first;
    } catch {
      /* ignore */
    }
  }
  return null;
}

loadEnvFileSync();

async function main() {
  const apiKey = process.env.PAGEINDEX_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing PAGEINDEX_API_KEY in env or .env (this is PageIndex, not OpenAI).");
    process.exit(1);
  }

  const base = (process.env.PAGEINDEX_API_URL || "https://api.pageindex.ai").replace(/\/$/, "");
  const docId = pickDocIdFromCli() || pickDocIdFromSavedIds();
  if (!docId) {
    console.error(
      "No doc id: pass one argument like pi-abc123 or set --doc-id=... or add src/playbooks/document_ids.json",
    );
    process.exit(1);
  }

  const headers = {
    api_key: apiKey,
    "Content-Type": "application/json",
  } as const;

  console.log(`Base: ${base}\nDoc: ${docId}\n`);

  // 1) Document + tree (shows retrieval_ready)
  const treeUrl = `${base}/doc/${encodeURIComponent(docId)}/?type=tree`;
  const treeRes = await fetch(treeUrl, { method: "GET", headers: { api_key: apiKey } });
  const treeText = await treeRes.text();
  let treeJson: unknown;
  try {
    treeJson = JSON.parse(treeText);
  } catch {
    treeJson = { raw: treeText.slice(0, 500) };
  }
  console.log("--- GET doc/?type=tree ---");
  console.log("HTTP", treeRes.status);
  if (!treeRes.ok) {
    console.log(treeText.slice(0, 800));
    process.exit(1);
  }
  const t = treeJson as Record<string, unknown>;
  console.log("status:", t.status);
  console.log("retrieval_ready:", t.retrieval_ready);
  const result = t.result;
  console.log(
    "result nodes:",
    Array.isArray(result) ? result.length : typeof result,
  );

  // 2) Chat completions scoped to doc (practical retrieval check)
  const chatUrl = `${base}/chat/completions`;
  const chatBody = {
    doc_id: docId,
    stream: false,
    messages: [
      {
        role: "user",
        content:
          "In one or two sentences, what is this document mainly about? If you cannot access the document, say so explicitly.",
      },
    ],
  };
  const chatRes = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(chatBody),
  });
  const chatText = await chatRes.text();
  console.log("\n--- POST chat/completions (doc scoped) ---");
  console.log("HTTP", chatRes.status);
  let chatJson: any;
  try {
    chatJson = JSON.parse(chatText);
  } catch {
    console.log(chatText.slice(0, 800));
    process.exit(chatRes.ok ? 0 : 1);
  }
  if (!chatRes.ok) {
    console.log(JSON.stringify(chatJson, null, 2).slice(0, 2000));
    process.exit(1);
  }
  const reply =
    chatJson?.choices?.[0]?.message?.content ??
    chatJson?.choices?.[0]?.message ??
    "";
  console.log("assistant:", String(reply).slice(0, 1200));

  const ready = t.retrieval_ready === true;
  console.log(
    "\nSummary:",
    ready
      ? "retrieval_ready is true — indexing flag looks good for this doc."
      : "retrieval_ready is still false — tree may exist but retrieval layer not flagged ready; chat result above still shows whether chat could read the doc.",
  );
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
