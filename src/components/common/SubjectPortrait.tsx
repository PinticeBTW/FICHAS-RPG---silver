import { useState } from "react";
import type { Profile } from "../../types/domain";
import {
  subjectName,
  subjectPortrait,
  type SubjectNames,
} from "../../lib/archiveSubjects";
import { SharedMediaImage } from "../shared/SharedMediaImage";

export function SubjectPortrait({
  profile,
  names,
}: {
  profile: Profile;
  names: SubjectNames;
}) {
  const source = subjectPortrait(profile, names);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials = subjectName(profile, names)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  const fallback = (
    <span className="gg-portrait-fallback" aria-hidden="true">
      <span>{initials}</span>
      <small>SEM RETRATO</small>
    </span>
  );
  return (
    <span className="gg-subject-portrait" aria-hidden="true">
      {source && failedSource !== source ? (
        <SharedMediaImage
          key={source}
          source={source}
          variant="thumbnail"
          alt=""
          loading="lazy"
          decoding="async"
          fallback={fallback}
          onError={() => setFailedSource(source)}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
