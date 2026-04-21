/**
 * Build BulletChange rows by diffing the resume JSON before vs after admin "Make Changes".
 * Used when apply-studio-feedback returns a merged resume but no AI revamp diff list.
 */

import type { BulletChange, ChangeCategory, ChangeSection } from "./resumeRevampAI.js";

const CATEGORY: ChangeCategory = "Impact Clarity";

function studioMeta(): Pick<
  BulletChange,
  "reason" | "category" | "guidelineRef" | "coachTip"
> {
  return {
    reason:
      "This text was updated when studio feedback was applied to your resume.",
    category: CATEGORY,
    guidelineRef: "Rule 5 — Show impact, not just activity",
    coachTip:
      "Compare with the PDF on the left to see the full context of each edit.",
  };
}

function pushIfDiff(
  out: BulletChange[],
  id: string,
  section: ChangeSection,
  original: string,
  revised: string,
  sectionIndex?: number,
  bulletIndex?: number,
): void {
  const o = original.trim();
  const r = revised.trim();
  if (o === r) return;
  out.push({
    id,
    section,
    sectionIndex,
    bulletIndex,
    original: o || "(empty)",
    revised: r || "(empty)",
    ...studioMeta(),
  });
}

/**
 * Diff two resume objects and emit BulletChange entries for every altered bullet / line.
 */
export function computeStudioApplyBulletChanges(before: unknown, after: unknown): BulletChange[] {
  const out: BulletChange[] = [];
  let n = 0;
  const b = before as Record<string, unknown> | null;
  const a = after as Record<string, unknown> | null;
  if (!b || !a || typeof b !== "object" || typeof a !== "object") {
    return out;
  }

  pushIfDiff(
    out,
    `studio-${n++}`,
    "summary",
    String(b.professionalSummary ?? ""),
    String(a.professionalSummary ?? ""),
  );

  const be = Array.isArray(b.experience) ? b.experience : [];
  const ae = Array.isArray(a.experience) ? a.experience : [];
  const em = Math.max(be.length, ae.length);
  for (let si = 0; si < em; si++) {
    const bh = (be[si] as { highlights?: unknown })?.highlights;
    const ah = (ae[si] as { highlights?: unknown })?.highlights;
    const bhl = Array.isArray(bh) ? bh : [];
    const ahl = Array.isArray(ah) ? ah : [];
    const hm = Math.max(bhl.length, ahl.length);
    for (let bi = 0; bi < hm; bi++) {
      pushIfDiff(
        out,
        `studio-${n++}`,
        "experience",
        String(bhl[bi] ?? ""),
        String(ahl[bi] ?? ""),
        si,
        bi,
      );
    }
  }

  const bp = Array.isArray(b.projects) ? b.projects : [];
  const ap = Array.isArray(a.projects) ? a.projects : [];
  const pm = Math.max(bp.length, ap.length);
  for (let si = 0; si < pm; si++) {
    const bhl = (bp[si] as { highlights?: unknown })?.highlights;
    const ahl = (ap[si] as { highlights?: unknown })?.highlights;
    const bha = Array.isArray(bhl) ? bhl : [];
    const aha = Array.isArray(ahl) ? ahl : [];
    const hm = Math.max(bha.length, aha.length);
    for (let bi = 0; bi < hm; bi++) {
      pushIfDiff(
        out,
        `studio-${n++}`,
        "projects",
        String(bha[bi] ?? ""),
        String(aha[bi] ?? ""),
        si,
        bi,
      );
    }
  }

  const bsk = b.skills;
  const ask = a.skills;
  if (Array.isArray(bsk) && Array.isArray(ask)) {
    const sm = Math.max(bsk.length, ask.length);
    for (let i = 0; i < sm; i++) {
      pushIfDiff(
        out,
        `studio-${n++}`,
        "skills",
        String(bsk[i] ?? ""),
        String(ask[i] ?? ""),
        i,
      );
    }
  }

  const bslt = Array.isArray(b.skillsLineTime) ? b.skillsLineTime : [];
  const aslt = Array.isArray(a.skillsLineTime) ? a.skillsLineTime : [];
  const slm = Math.max(bslt.length, aslt.length);
  for (let i = 0; i < slm; i++) {
    const br = bslt[i] as { heading?: string; skills?: string } | undefined;
    const ar = aslt[i] as { heading?: string; skills?: string } | undefined;
    const line = (x: typeof br) =>
      [x?.heading, x?.skills].filter(Boolean).join(" — ");
    pushIfDiff(out, `studio-${n++}`, "skills", line(br), line(ar), i);
  }

  return out;
}
