import type { PropsWithChildren } from 'react'
import type { KarmaMode } from '../../types/domain'
import { cn, getToneClasses } from '../../lib/utils'

interface PanelProps extends PropsWithChildren {
  title?: string
  eyebrow?: string
  description?: string
  tone?: KarmaMode
  className?: string
  contentClassName?: string
}

export function Panel({
  title,
  eyebrow,
  description,
  tone,
  className,
  contentClassName,
  children,
}: PanelProps) {
  return (
    <section
      className={cn(
        'hud-panel rounded-[28px] p-5 md:p-6',
        tone && getToneClasses(tone),
        className,
      )}
    >
      {(title || eyebrow || description) && (
        <header className="mb-5">
          {eyebrow ? <p className="panel-title">{eyebrow}</p> : null}
          {title ? <h2 className="mt-3 text-[2rem] text-white md:text-[2.35rem]">{title}</h2> : null}
          {description ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-300">{description}</p>
          ) : null}
          <div className="ghost-divider mt-4" />
        </header>
      )}

      <div className={contentClassName}>{children}</div>
    </section>
  )
}
