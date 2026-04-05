import type { ReactNode } from 'react'
import { StatusBadge } from '../common/StatusBadge'

interface DashboardHeroProps {
  eyebrow: string
  title: string
  description: string
  tone?: 'blue' | 'red' | 'gray'
  aside?: ReactNode
}

export function DashboardHero({
  eyebrow,
  title,
  description,
  tone = 'blue',
  aside,
}: DashboardHeroProps) {
  return (
    <section className="hud-panel overflow-hidden rounded-[32px] p-6 md:p-8">
      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr] xl:items-end">
        <div className="relative">
          <div className="cut-label">{eyebrow}</div>
          <h2 className="mt-5 max-w-4xl text-[3.2rem] text-white md:text-[4.6rem]">{title}</h2>
          <p className="mt-4 max-w-3xl text-[15px] leading-7 text-stone-300">{description}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <StatusBadge label="Canal privado" tone={tone} />
            <StatusBadge label="Arquivo ativo" tone="gray" />
          </div>
        </div>

        <div className="flex min-h-full items-end">{aside}</div>
      </div>
    </section>
  )
}
