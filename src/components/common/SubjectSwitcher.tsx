import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Profile } from "../../types/domain";
import {
  subjectName,
  subjectFileId,
  type SubjectNames,
} from "../../lib/archiveSubjects";
import { SubjectPortrait } from "./SubjectPortrait";
import { readRecentSheetIds } from "../../lib/shellRecents";

export function SubjectSwitcher({
  actorId,
  profiles,
  selectedId,
  names,
}: {
  actorId: string;
  profiles: Profile[];
  names: SubjectNames;
  selectedId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const characters = profiles.filter((entry) => entry.role !== "gm");
  const normalized = query.trim().toLocaleLowerCase();
  const matches = characters.filter((entry) =>
    [
      subjectName(entry, names),
      entry.displayName,
      entry.handle,
      entry.email,
      subjectFileId(entry),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
  const recent = normalized
    ? []
    : readRecentSheetIds(actorId)
        .flatMap((id) => characters.find((entry) => entry.id === id) ?? [])
        .slice(0, 3);
  const remaining = matches.filter(
    (entry) => !recent.some((item) => item.id === entry.id),
  );

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const renderEntries = (entries: Profile[]) =>
    entries.map((entry) => (
      <Link
        key={entry.id}
        to={`/app/sheets/${entry.id}`}
        className="gg-subject-option"
        aria-current={entry.id === selectedId ? "page" : undefined}
        onClick={() => setOpen(false)}
      >
        <SubjectPortrait profile={entry} names={names} />
        <span className="gg-subject-option-copy">
          <strong>{subjectName(entry, names)}</strong>
          <small>{entry.ownerDisplayName || entry.displayName}</small>
        </span>
        <span aria-hidden="true">{entry.id === selectedId ? "●" : "→"}</span>
      </Link>
    ));

  return (
    <div
      className="gg-subject-switcher"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="gg-switch-trigger"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        Mudar personagem <ChevronDown size={14} />
      </button>
      {open ? (
        <div
          className="gg-subject-popover"
          id={id}
          role="dialog"
          aria-label="Mudar personagem"
        >
          <div className="gg-popover-heading">
            <span>SUBJECT DIRECTORY</span>
            <button
              aria-label="Fechar seletor"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          </div>
          <label className="gg-subject-search">
            <Search size={15} />
            <input
              ref={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar personagem…"
              aria-label="Pesquisar personagem"
            />
          </label>
          <div className="gg-subject-results">
            {recent.length ? (
              <>
                <p className="gg-list-label">
                  RECENTES / {recent.length.toString().padStart(2, "0")}
                </p>
                {renderEntries(recent)}
              </>
            ) : null}
            <p className="gg-list-label">
              {normalized ? "RESULTADOS" : "ARQUIVO ACESSÍVEL"} /{" "}
              {remaining.length.toString().padStart(2, "0")}
            </p>
            {renderEntries(remaining)}
            {!matches.length ? (
              <p className="gg-empty-notes">Nenhuma personagem encontrada.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
