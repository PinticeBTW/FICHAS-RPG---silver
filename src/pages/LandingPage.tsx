import { AuthPanel } from '../components/auth/AuthPanel'
import '../styles/ghostLogin.css'

// Decorative wireframe, drawn as lines so it stays sharp at every screen size.
function meshPoint(column: number, row: number) {
  const x = column * 40
  const y = 620 + row * 14 - Math.sin(column * .17 + row * .075) * 65 - Math.cos(column * .3 - row * .1) * 25
  return `${x},${y.toFixed(1)}`
}

function TerminalBackdrop() {
  return (
    <div className="gg-terminal-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" fill="none">
        <g className="gg-terminal-traces">
          <path d="M0 175H190L265 100H610 M0 185H195L270 110H560 M1600 240H1420L1355 175H1120 M1600 250H1415L1350 185H1170 M55 0V330L115 390V590 M1545 0V390L1490 445V610" />
          <path d="M80 110h20m-10-10v20 M1500 110h20m-10-10v20 M80 775h20m-10-10v20 M1500 775h20m-10-10v20" />
          <circle cx="610" cy="100" r="3" /><circle cx="1120" cy="175" r="3" />
        </g>
        <g className="gg-terminal-mesh">
          {Array.from({ length: 24 }, (_, row) => <polyline key={`row-${row}`} points={Array.from({ length: 41 }, (_, column) => meshPoint(column, row)).join(' ')} />)}
          {Array.from({ length: 41 }, (_, column) => <polyline key={`col-${column}`} points={Array.from({ length: 24 }, (_, row) => meshPoint(column, row)).join(' ')} />)}
        </g>
      </svg>
      <pre className="gg-terminal-code">{'GHOST GRID [01]\n────────────────────\n> archive.mount\n  /personagens\n  /memórias\n  /segredos\n\n> session.await_\n  ░░░░▒▒▒▒▓▓▓▓\n\n0x00  01  00  FF\n0x10  00  01  0A'}</pre>
      <span className="gg-terminal-coordinate">01:00 // PRIVATE ARCHIVE</span>
    </div>
  )
}

export function LandingPage() {
  return (
    <main className="gg-login">
      <TerminalBackdrop />
      <header className="gg-login-top"><span className="gg-login-mark">G<span>G</span></span><span>ARCHIVE NODE // 01</span><span>ACESSO RESTRITO</span></header>
      <div className="gg-login-terminal">
      <div className="gg-terminal-titlebar" aria-hidden="true"><span><i /> GHOST_GRID / ACCESS.TERM</span><span>− &nbsp; □ &nbsp; ×</span></div>
      <div className="gg-login-layout">
        <section className="gg-login-identity" aria-label="Ghost Grid">
          <p className="gg-login-meta">ARQUIVO PRIVADO / CAMPANHA RPG</p>
          <h1>GHOST<br /><span>GRID</span><i aria-hidden="true">_</i></h1>
          <p>Personagens. Memórias. Segredos.<br />Tudo deixa um registo.</p>
          <div className="gg-login-signature" aria-hidden="true"><span>GG—01</span><span className="gg-login-bars" /></div>
        </section>
        <AuthPanel />
      </div>
      <div className="gg-terminal-status" aria-hidden="true"><span>› À ESPERA DE IDENTIFICAÇÃO<span className="gg-terminal-cursor">_</span></span><span>▰ ▰ ▰ ▱ ▱ &nbsp; GG—01</span></div>
      </div>
      <footer className="gg-login-footer"><span>GHOST GRID / PRIVATE ARCHIVE</span><span>IDENTIFICA-TE PARA CONTINUAR <span aria-hidden="true">↗</span></span></footer>
    </main>
  )
}
