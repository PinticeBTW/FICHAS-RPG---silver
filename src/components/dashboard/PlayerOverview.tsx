import { ArrowUpRight, Heart, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { SilverBoardProfileSummary } from '../notes/SilverNotebook'
import { metricPercentage } from '../../lib/playerOverview'
import { formatTimestamp } from '../../lib/utils'
import '../../styles/playerOverview.css'

function Resource({ label, current, maximum }: { label: string; current: string; maximum: string }) {
  const percentage = metricPercentage(current, maximum)
  return <div className="gg-player-resource" data-low={label === 'Vida' && percentage !== null && percentage <= 35}>
    <div><span>{label === 'Vida' ? <Heart size={12} aria-hidden="true" /> : null}{label}</span><strong>{current.trim() || '—'}<small> / {maximum.trim() || '—'}</small></strong></div>
    <div className="gg-player-bar" aria-hidden="true"><i style={{ width: `${percentage ?? 0}%` }} /></div>
  </div>
}

export function PlayerOverview({ players, loading, failedIds, onRefresh }: {
  players: SilverBoardProfileSummary[]
  loading: boolean
  failedIds: string[]
  onRefresh: () => void
}) {
  return <section className="gg-player-overview" aria-labelledby="player-overview-title">
    <header className="gg-player-overview-heading">
      <div><p className="gg-eyebrow">SILVER / CAMPANHA // 08</p><h1 id="player-overview-title">Visão geral</h1><p>Os jogadores todos à vista. Vida, recursos e defesa, ligados às fichas.</p></div>
      <button type="button" onClick={onRefresh} disabled={loading}><RefreshCcw size={14} aria-hidden="true" />{loading ? 'A atualizar…' : 'Atualizar'}</button>
    </header>
    <div className="gg-player-overview-status" role="status"><span>{players.length} {players.length === 1 ? 'ficha de jogador' : 'fichas de jogadores'}</span><span>{loading ? 'A ler as fichas…' : failedIds.length ? 'Algumas fichas não carregaram. Tenta atualizar.' : 'Atualiza com as fichas · só consulta'}</span></div>
    {!players.length ? <p className="gg-player-overview-empty">{loading ? 'A procurar os jogadores da campanha…' : 'Ainda não há fichas de jogadores disponíveis.'}</p> : <div className="gg-player-grid">
      {players.map((player) => <article className="gg-player-card" key={player.profileId} aria-label={`Ficha de ${player.displayName}`}>
        <header><div><p>{player.subtitle}</p><h2>{player.displayName}</h2></div><span className="gg-player-index" aria-hidden="true">GG</span></header>
        <Resource label="Vida" current={player.hpCurrent} maximum={player.hpMax} />
        <div className="gg-player-resources"><Resource label="PS" current={player.psCurrent} maximum={player.psMax} /><Resource label="PE" current={player.peCurrent} maximum={player.peMax} /></div>
        <dl className="gg-player-stats"><div><dt>Defesa</dt><dd>{player.defense.trim() || '—'}</dd></div><div><dt>Bloqueio</dt><dd>{player.block.trim() || '—'}</dd></div><div><dt>Karma</dt><dd>{player.karma.trim() || '—'}</dd></div></dl>
        <footer><small title={player.updatedAt ? formatTimestamp(player.updatedAt) : undefined}>{failedIds.includes(player.profileId) ? 'Não foi possível carregar' : loading && !player.updatedAt ? 'A carregar…' : player.updatedAt ? 'Últimos valores guardados' : 'Ficha ainda sem valores'}</small><Link to={`/app/sheets/${encodeURIComponent(player.profileId)}?view=sheet`} aria-label={`Ver ficha de ${player.displayName}`}>Ver ficha<ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
      </article>)}
    </div>}
    <p className="gg-player-legend">PS / sanidade · PE / esforço · — / valor por preencher</p>
  </section>
}
