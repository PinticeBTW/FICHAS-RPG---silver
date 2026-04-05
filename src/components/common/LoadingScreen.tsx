interface LoadingScreenProps {
  label?: string
}

export function LoadingScreen({
  label = 'A sincronizar dados...',
}: LoadingScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(243,230,0,0.08),transparent_24%),#060606] px-6">
      <div className="hud-panel max-w-md rounded-[28px] px-8 py-10 text-center">
        <div className="mx-auto h-20 w-20 border border-[#f3e600]/30 bg-[#f3e600]/8 p-5">
          <div className="h-full w-full border border-[#f3e600]/50" />
        </div>
        <p className="panel-title mt-6">Ghost Grid</p>
        <h1 className="mt-3 text-[2.6rem] text-white">{label}</h1>
        <p className="mt-3 text-sm leading-7 text-stone-300">
          A preparar permissoes, campanha e navegacao.
        </p>
      </div>
    </div>
  )
}
