import { useEffect } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'

const DEFAULT_UNSAVED_CHANGES_MESSAGE =
  'Tens alteracoes por guardar. Guarda antes de sair para nao perderes o que fizeste.'

export function useUnsavedChangesWarning(
  when: boolean,
  message = DEFAULT_UNSAVED_CHANGES_MESSAGE,
) {
  useBeforeUnload(
    (event) => {
      if (!when) {
        return
      }

      event.preventDefault()
      event.returnValue = message
    },
    { capture: true },
  )

  const blocker = useBlocker(when)

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return
    }

    const shouldLeave = window.confirm(message)

    if (shouldLeave) {
      blocker.proceed()
      return
    }

    blocker.reset()
  }, [blocker, message])
}

