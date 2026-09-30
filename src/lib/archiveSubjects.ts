import { useEffect, useState } from "react";
import type { Profile } from "../types/domain";
import {
  fetchSheetSummaryBatch,
  getCachedSheetRecord,
} from "./webSheetService";

export type SubjectNames = Readonly<
  Record<string, { name: string; portrait: string; updatedAt: string }>
>;

export function subjectName(profile: Profile, names: SubjectNames = {}) {
  const cached = getCachedSheetRecord(profile.id);
  const summary = names[profile.id];
  if (cached && (!summary || cached.updatedAt >= summary.updatedAt)) {
    return cached.fieldData.NOME?.trim() || profile.displayName;
  }
  return summary?.name || profile.displayName;
}

export function subjectPortrait(profile: Profile, names: SubjectNames = {}) {
  const cached = getCachedSheetRecord(profile.id);
  const summary = names[profile.id];
  if (cached && (!summary || cached.updatedAt >= summary.updatedAt)) {
    return (
      cached.fieldData.FOTO2?.trim() || cached.fieldData.FOTO?.trim() || ""
    );
  }
  return summary?.portrait || "";
}

export function subjectFileId(profile: Profile) {
  return profile.id.replace(/^npc:/, "").slice(0, 8).toUpperCase();
}

// Reuse the existing authorised batch reader; no new access path or stored personal data.
export function useSubjectNames(actorId: string | null, profiles: Profile[]) {
  const [result, setResult] = useState<{
    actorId: string;
    profiles: Profile[];
    names: SubjectNames;
  } | null>(null);
  useEffect(() => {
    if (!actorId || !profiles.length) return;
    let cancelled = false;
    void fetchSheetSummaryBatch(profiles.filter((entry) => entry.role !== "gm"))
      .then(({ summaries }) => {
        if (cancelled) return;
        const names = Object.fromEntries(
          [...summaries].flatMap(([id, record]) =>
            record
              ? [
                  [
                    id,
                    {
                      name: record.fieldData.NOME?.trim() || "",
                      portrait:
                        record.fieldData.FOTO2?.trim() ||
                        record.fieldData.FOTO?.trim() ||
                        "",
                      updatedAt: record.updatedAt,
                    },
                  ],
                ]
              : [],
          ),
        );
        setResult({ actorId, profiles, names });
      })
      .catch(() => {
        // A missing summary must never prevent opening an accessible dossier.
        if (!cancelled) setResult({ actorId, profiles, names: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, profiles]);
  return result?.actorId === actorId && result?.profiles === profiles
    ? result.names
    : EMPTY_NAMES;
}
const EMPTY_NAMES: SubjectNames = {};
