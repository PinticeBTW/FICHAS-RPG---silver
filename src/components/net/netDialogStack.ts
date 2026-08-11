import { useEffect, useId, useRef } from 'react'

type DialogEntry = {
  id: string
  close: () => void
  getContainer: () => HTMLElement | null
}

const dialogStack: DialogEntry[] = []

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
}

function focusInitial(container: HTMLElement) {
  const initial = container.querySelector<HTMLElement>('[data-net-dialog-initial-focus]')
  const target = initial ?? getFocusable(container)[0] ?? container
  target.focus()
}

function handleKeyDown(event: KeyboardEvent) {
  const top = dialogStack[dialogStack.length - 1]

  if (!top) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    top.close()
    return
  }

  if (event.key !== 'Tab') return

  const container = top.getContainer()
  if (!container) return

  const focusable = getFocusable(container)

  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }

  const active = document.activeElement as HTMLElement | null
  const currentIndex = focusable.indexOf(active ?? container)

  if (event.shiftKey && (currentIndex <= 0 || !container.contains(active))) {
    event.preventDefault()
    focusable[focusable.length - 1]?.focus()
  } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
    event.preventDefault()
    focusable[0]?.focus()
  }
}

function registerDialog(entry: DialogEntry) {
  dialogStack.push(entry)

  if (dialogStack.length === 1) {
    document.addEventListener('keydown', handleKeyDown, true)
  }

  return () => {
    const index = dialogStack.findIndex((candidate) => candidate.id === entry.id)
    if (index !== -1) dialogStack.splice(index, 1)

    if (dialogStack.length === 0) {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }
}

function promoteDialog(id: string) {
  const index = dialogStack.findIndex((entry) => entry.id === id)
  if (index === -1 || index === dialogStack.length - 1) return

  const [entry] = dialogStack.splice(index, 1)
  if (entry) dialogStack.push(entry)
}

export function useNetDialog<T extends HTMLElement>(onClose: () => void) {
  const dialogId = useId()
  const dialogRef = useRef<T | null>(null)
  const closeRef = useRef(onClose)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  closeRef.current = onClose

  useEffect(() => {
    const container = dialogRef.current
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const unregister = registerDialog({
      id: dialogId,
      close: () => closeRef.current(),
      getContainer: () => dialogRef.current,
    })

    const frame = window.requestAnimationFrame(() => {
      if (container) focusInitial(container)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      unregister()

      const previous = previouslyFocusedRef.current
      if (previous?.isConnected) previous.focus()
    }
  }, [dialogId])

  return {
    dialogRef,
    onFocusCapture: () => promoteDialog(dialogId),
  }
}
