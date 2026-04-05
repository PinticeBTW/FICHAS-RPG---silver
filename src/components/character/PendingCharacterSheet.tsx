import type { Profile } from '../../types/domain'

interface PendingCharacterSheetProps {
  profile: Profile
  tone?: 'player' | 'gm'
}

const waitingRows = [
  ['Campanha', 'Pendente'],
  ['Personagem', 'Por ligar'],
  ['Inventario', 'A aguardar'],
  ['Cyberware', 'A aguardar'],
]

export function PendingCharacterSheet({
  profile,
  tone = 'player',
}: PendingCharacterSheetProps) {
  const roleLabel = tone === 'gm' ? 'Silver / GM' : 'Jogador'
  const helperText =
    tone === 'gm'
      ? 'Cria a campanha, adiciona os membros e liga as personagens ao arquivo.'
      : 'O Silver precisa de te adicionar a uma campanha e ligar a tua personagem.'

  return (
    <section className="sheet-frame rounded-[30px] p-5 md:p-7">
      <div className="sheet-grid rounded-[24px] p-4 md:p-5">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <div className="sheet-cell grid min-h-[250px] overflow-hidden md:grid-cols-[0.9fr_1.1fr]">
              <div className="flex items-center justify-center border-b border-white/10 bg-black/35 p-4 md:border-b-0 md:border-r md:border-white/10">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="h-full min-h-[180px] w-full object-cover"
                  />
                ) : (
                  <div className="sheet-title text-center text-[2.8rem] text-stone-500">FICHA</div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-px bg-white/10 p-px">
                {[
                  ['Nome', profile.displayName],
                  ['Handle', profile.handle],
                  ['Email', profile.email],
                  ['Papel', roleLabel],
                  ['Estado', 'Conta criada'],
                  ['Arquivo', 'Sem dados'],
                ].map(([label, value]) => (
                  <div key={label} className="sheet-cell px-4 py-3">
                    <p className="sheet-kicker">{label}</p>
                    <p className="mt-2 sheet-value">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="sheet-cell overflow-hidden">
              <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr] border-b border-white/10 bg-white/5 px-4 py-3">
                <span className="sheet-kicker">Ataques</span>
                <span className="sheet-kicker">Teste</span>
                <span className="sheet-kicker">Dano</span>
              </div>

              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`attack-row-${index}`}
                  className="grid grid-cols-[1.2fr_0.8fr_0.8fr] border-t border-white/10 px-4 py-3 text-sm text-stone-500"
                >
                  <span>--</span>
                  <span>--</span>
                  <span>--</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="sheet-cell p-4">
              <p className="sheet-title">Ficha em espera</p>
              <p className="mt-3 max-w-xl text-sm leading-7 text-stone-300">{helperText}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[
                ['Karma', '--'],
                ['Cyberpsychosis', '--'],
                ['RAM', '--'],
                ['HP', '--'],
              ].map(([label, value]) => (
                <div key={label} className="sheet-cell px-4 py-4">
                  <p className="sheet-kicker">{label}</p>
                  <p className="mt-3 sheet-title text-[2.6rem]">{value}</p>
                </div>
              ))}
            </div>

            <div className="sheet-cell overflow-hidden">
              <div className="grid grid-cols-[1.2fr_0.8fr] border-b border-white/10 bg-white/5 px-4 py-3">
                <span className="sheet-kicker">Inventario</span>
                <span className="sheet-kicker">Espaco</span>
              </div>

              {Array.from({ length: 10 }).map((_, index) => (
                <div
                  key={`inventory-row-${index}`}
                  className="grid grid-cols-[1.2fr_0.8fr] border-t border-white/10 px-4 py-3 text-sm text-stone-500"
                >
                  <span>--</span>
                  <span>--</span>
                </div>
              ))}
            </div>

            <div className="sheet-cell overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr] border-b border-white/10 bg-white/5 px-4 py-3">
                <span className="sheet-kicker">Estado do acesso</span>
                <span className="sheet-kicker">Valor</span>
              </div>

              {waitingRows.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[1fr_1fr] border-t border-white/10 px-4 py-3"
                >
                  <span className="sheet-value">{label}</span>
                  <span className="sheet-value">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
