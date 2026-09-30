import {
  ArrowUpRight,
  BookOpenText,
  ChevronLeft,
  Cpu,
  Home,
  Network,
  PanelLeft,
  Search,
  Shield,
  StickyNote,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";
import "../../styles/ghostShell.css";

export type ShellSlots = {
  statusSlot: HTMLDivElement | null;
  accountSlot: HTMLDivElement | null;
};

export function GhostShell() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("ghost-grid:shell:v1:compact") === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [query, setQuery] = useState("");
  const [campaign, setCampaign] = useState("Campanha RPG");
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const [accountSlot, setAccountSlot] = useState<HTMLDivElement | null>(null);
  const slots = useMemo(
    () => ({ statusSlot, accountSlot }),
    [statusSlot, accountSlot],
  );
  const sheetPath = location.pathname.startsWith("/app/sheets/")
    ? location.pathname
    : "/app/sheets";
  const ownPath =
    profile ? `/app/sheets/${profile.id}` : sheetPath;
  const requestedView = new URLSearchParams(location.search).get("view");
  const view = profile?.role !== "gm" && ["cyberware", "board", "notes"].includes(requestedView ?? "") ? "sheet" : requestedView;
  const active = location.pathname.startsWith("/app/history")
    ? "history"
    : location.pathname.startsWith("/app/net")
      ? "net"
      : view === "sheet"
        ? "operatives"
        : (view ??
          (location.pathname === "/app/sheets" ? "home" : "operatives"));
  const links = [
    {
      id: "home",
      label: "Início",
      icon: Home,
      to: `/app/sheets/${profile?.id}?view=home`,
    },
    { id: "net", label: "The Net", icon: Network, to: "/app/net" },
    {
      id: "history",
      label: "História",
      icon: BookOpenText,
      to: "/app/history",
    },
    {
      id: "operatives",
      label: "Operativos",
      icon: Users,
      to: `${sheetPath}?view=operatives`,
    },
    {
      id: "cyberware",
      label: "Cyberware",
      icon: Cpu,
      to: `${sheetPath}?view=cyberware`,
    },
    {
      id: "notebook",
      label: "Caderno",
      icon: BookOpenText,
      to: `${ownPath}?view=notebook`,
    },
    {
      id: "board",
      label: "Quadro",
      icon: StickyNote,
      to: `${ownPath}?view=board`,
    },
    {
      id: "notes",
      label: "Notas",
      icon: StickyNote,
      to: `${ownPath}?view=notes`,
    },
  ].filter((link) => profile?.role === "gm" || !["cyberware", "board", "notes"].includes(link.id));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname, location.search]);
  const actorId = profile?.id;
  const campaignId = profile?.activeCampaignId;
  useEffect(() => {
    let cancelled = false;
    if (!actorId || !supabase) return;
    void supabase
      .from("campaign_members")
      .select("campaign:campaigns(name)")
      .eq("profile_id", actorId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const row: unknown = data?.campaign;
        const name = Array.isArray(row)
          ? row[0]?.name
          : (row as { name?: string } | null)?.name;
        if (!cancelled)
          setCampaign(
            name || import.meta.env.VITE_CAMPAIGN_NAME || "Campanha RPG",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, campaignId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "ghost-grid:shell:v1:compact",
        collapsed ? "1" : "0",
      );
    } catch {
      /* Optional preference. */
    }
  }, [collapsed]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setCollapsed((current) => !current);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  return (
    <div
      className={`gg-shell ${collapsed ? "gg-compact" : ""} ${mobileOpen ? "gg-mobile-open" : ""}`}
    >
      <a className="gg-skip" href="#gg-content">
        Saltar para o conteúdo
      </a>
      {mobileOpen ? (
        <button
          className="gg-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <aside
        className="gg-sidebar"
        aria-label="Navegação principal"
        id="gg-navigation"
      >
        <Link
          className="gg-brand"
          to="/app/sheets?view=home"
          onClick={() => setMobileOpen(false)}
          aria-label="Ghost Grid — Início"
        >
          <span className="gg-monogram">
            G<span>G</span>
          </span>
          <span className="gg-brand-name">
            GHOST GRID<small>ARCHIVE NODE // 01</small>
          </span>
        </Link>
        <p className="gg-nav-caption">LOCAL ARCHIVE</p>
        <nav>
          {links.map(({ id, label, icon: Icon, to }, index) => (
            <Link
              key={id}
              to={to}
              target={id === "net" ? "_blank" : undefined}
              rel={id === "net" ? "noopener noreferrer" : undefined}
              className={`gg-nav-link ${active === id ? "is-active" : ""}`}
              aria-label={label}
              aria-current={active === id ? "page" : undefined}
              title={id === "net" ? "The Net — abre numa nova aba" : label}
              onClick={() => setMobileOpen(false)}
            >
              <span className="gg-nav-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon className="gg-nav-icon" size={18} />
              <span>{label}</span>
              {id === "net" ? (
                <ArrowUpRight className="gg-external" size={14} />
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="gg-sidebar-bottom">
          {profile?.role === "gm" ? (
            <>
              <p className="gg-nav-caption">MASTER ACCESS</p>
              <Link
                to={`${ownPath}?view=master`}
                title="Ferramentas do Mestre"
                className={`gg-nav-link ${active === "master" ? "is-active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <Shield size={18} />
                <span>Mestre</span>
              </Link>
            </>
          ) : null}
          <button
            className="gg-collapse"
            onClick={() => setCollapsed((current) => !current)}
            aria-expanded={!collapsed}
            aria-controls="gg-navigation"
            title="Alternar sidebar (Alt+S)"
          >
            {collapsed ? <PanelLeft size={18} /> : <ChevronLeft size={18} />}
            <span>Recolher navegação</span>
          </button>
          <span className="gg-sidebar-foot" data-online={online}>
            SYS // {online ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </aside>
      <div className="gg-stage">
        <header className="gg-topbar">
          <button
            className="gg-mobile-toggle"
            aria-label={mobileOpen ? "Fechar navegação" : "Abrir navegação"}
            aria-expanded={mobileOpen}
            aria-controls="gg-navigation"
            onClick={() => setMobileOpen((current) => !current)}
          >
            <PanelLeft size={19} />
          </button>
          <div className="gg-campaign">
            <span>CAMPAIGN //</span>
            <strong title={campaign}>{campaign}</strong>
          </div>
          <form
            className="gg-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(
                `${sheetPath}?view=operatives&q=${encodeURIComponent(query.trim())}`,
              );
              setMobileOpen(false);
            }}
          >
            <Search size={16} />
            <input
              aria-label="Pesquisar operativos"
              placeholder="SEARCH ARCHIVE…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" aria-label="Pesquisar">
              ↵
            </button>
          </form>
          <div className="gg-status-slot" ref={setStatusSlot} />
          <span className="gg-node">
            NODE <b>01</b>
          </span>
          <div className="gg-account">
            <span className="gg-account-name">{profile?.displayName}</span>
            <div ref={setAccountSlot} />
          </div>
        </header>
        <div id="gg-content" className="gg-content" tabIndex={-1}>
          <Outlet context={slots} />
        </div>
      </div>
    </div>
  );
}
