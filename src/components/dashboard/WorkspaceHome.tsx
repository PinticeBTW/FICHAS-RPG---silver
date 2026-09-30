import {
  ArrowUpRight,
  BookOpenText,
  Folder,
  Plus,
  Shield,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Profile } from "../../types/domain";
import type { MasterNoteListItem } from "../../types/masterNotes";
import { listMasterNotes } from "../../lib/masterNotesService";
import { readRecentSheetIds } from "../../lib/shellRecents";
import {
  subjectFileId,
  subjectName,
  type SubjectNames,
} from "../../lib/archiveSubjects";
import { SubjectPortrait } from "../common/SubjectPortrait";
import { formatTimestamp } from "../../lib/utils";

type Props = {
  profile: Profile;
  profiles: Profile[];
  names: SubjectNames;
  selectedProfile: Profile | null;
  fieldData: Record<string, string>;
  onCreate: () => void;
};
export function WorkspaceHome({
  profile,
  profiles,
  names,
  selectedProfile,
  fieldData,
  onCreate,
}: Props) {
  const [notes, setNotes] = useState<MasterNoteListItem[]>([]);
  const [notesState, setNotesState] = useState("A carregar entradas…");
  const recent = readRecentSheetIds(profile.id)
    .flatMap((id) => profiles.find((entry) => entry.id === id) ?? [])
    .filter((entry) => entry.role !== "gm")
    .slice(0, 3);
  let playerPages: { id: string; title: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(fieldData.PLAYER_NOTE_PAGES || "[]");
    if (Array.isArray(parsed))
      playerPages = parsed
        .filter((page): page is { id: string; title: string } =>
          Boolean(
            page &&
              typeof page.id === "string" &&
              typeof page.title === "string",
          ),
        )
        .slice(0, 4);
  } catch {
    /* Legacy notebook opens normally. */
  }
  const ownPath = `/app/sheets/${profile.id}`;
  useEffect(() => {
    if (profile.role !== "gm") return;
    let cancelled = false;
    void listMasterNotes({ userId: profile.id })
      .then((entries) => {
        if (cancelled) return;
        setNotes(
          [...entries]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 4),
        );
        setNotesState("Ainda não há entradas neste caderno.");
      })
      .catch(() => {
        if (!cancelled)
          setNotesState("Abre o Caderno para consultar as tuas notas.");
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.role]);
  return (
    <div className="gg-home">
      <div className="gg-home-heading">
        <p className="gg-eyebrow">GHOST GRID / LOCAL ARCHIVE</p>
        <h1>
          Bem-vindo, <br />
          {profile.displayName}
          <span>.</span>
        </h1>
        <div className="gg-welcome-meta">
          <span>ACCESS // {profile.role === "gm" ? "MASTER" : "PLAYER"}</span>
          <p>Retoma a história. Escolhe o próximo destino.</p>
        </div>
      </div>
      <section className="gg-home-section" aria-labelledby="gg-recent-title">
        <div className="gg-section-heading">
          <h2 id="gg-recent-title">Operativos recentes</h2>
          <Link to={`${ownPath}?view=operatives`}>
            Ver todos <ArrowUpRight size={15} />
          </Link>
        </div>
        {recent.length ? (
          <div className="gg-operative-grid">
            {recent.map((entry) => (
              <Link
                className="gg-operative-card"
                key={entry.id}
                to={`/app/sheets/${entry.id}`}
              >
                <div className="gg-card-top">
                  <span>SUBJECT // {subjectFileId(entry)}</span>
                  <span className="gg-file-mark" aria-hidden="true">
                    ⌜
                  </span>
                </div>
                <div className="gg-dossier-identity">
                  <SubjectPortrait profile={entry} names={names} />
                  <div>
                    <h3>{subjectName(entry, names)}</h3>
                    <p>
                      {entry.ownerDisplayName
                        ? `Personagem de ${entry.ownerDisplayName}`
                        : `Ficha de ${entry.displayName}`}
                    </p>
                  </div>
                </div>
                <span className="gg-card-open">
                  Abrir dossier <ArrowUpRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="gg-empty">
            <Users size={24} />
            <div>
              <strong>Os teus próximos passos começam aqui.</strong>
              <p>As fichas que abrires aparecem aqui, até três de cada vez.</p>
            </div>
            <Link to={`${ownPath}?view=operatives`}>
              Explorar operativos <ArrowUpRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <div className="gg-home-lower">
        <section className="gg-home-section" aria-labelledby="gg-entries-title">
          <div className="gg-section-heading">
            <h2 id="gg-entries-title">Entradas recentes</h2>
            <Link to={`${ownPath}?view=notebook`}>
              Caderno <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="gg-entry-list">
            {profile.role !== "gm" ? (
              playerPages.length ? (
                playerPages.map((page) => (
                  <Link
                    key={page.id}
                    to={`${ownPath}?view=notebook&page=${encodeURIComponent(page.id)}`}
                    className="gg-entry"
                  >
                    <BookOpenText size={17} />
                    <span>
                      <strong>{page.title || "Sem título"}</strong>
                      <small>
                        No caderno de {selectedProfile?.displayName}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </Link>
                ))
              ) : (
                <p className="gg-empty-notes">
                  As tuas notas ficam no Caderno.
                </p>
              )
            ) : notes.length ? (
              notes.map((note) => (
                <Link
                  key={note.id}
                  to={`${ownPath}?view=notebook&note=${encodeURIComponent(note.id)}`}
                  className="gg-entry"
                >
                  <BookOpenText size={17} />
                  <span>
                    <strong>{note.title || "Sem título"}</strong>
                    <small>{formatTimestamp(note.updatedAt)}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))
            ) : (
              <p className="gg-empty-notes">{notesState}</p>
            )}
          </div>
        </section>
        <section className="gg-home-section" aria-labelledby="gg-actions-title">
          <div className="gg-section-heading">
            <h2 id="gg-actions-title">Ações rápidas</h2>
          </div>
          <div className="gg-quick-actions">
            {profile.role === "gm" ? (
              <button onClick={onCreate}>
                <Plus size={18} />
                Nova ficha
                <ArrowUpRight size={15} />
              </button>
            ) : (
              <Link to={`${ownPath}`}>
                <Users size={18} />
                Abrir a minha ficha
                <ArrowUpRight size={15} />
              </Link>
            )}
            <Link to={`${ownPath}?view=notebook`}>
              <BookOpenText size={18} />
              Abrir caderno
              <ArrowUpRight size={15} />
            </Link>
            <Link to="/app/history">
              <Folder size={18} />
              Continuar história
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
      </div>
      {profile.role === "gm" ? (
        <Link to={`${ownPath}?view=master`} className="gg-master-strip">
          <Shield size={18} />
          <span>
            <strong>Espaço do Mestre</strong>
            <small>Pastas, catálogo e ferramentas da campanha</small>
          </span>
          <ArrowUpRight size={18} />
        </Link>
      ) : null}
    </div>
  );
}
