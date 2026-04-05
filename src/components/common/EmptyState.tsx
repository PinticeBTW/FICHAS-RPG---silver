interface EmptyStateProps {
  title: string
  detail: string
}

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="hud-panel rounded-[28px] p-6 text-center">
      <p className="panel-title">Sem dados</p>
      <h3 className="mt-4 text-[2rem] text-white">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-stone-300">{detail}</p>
    </div>
  )
}
