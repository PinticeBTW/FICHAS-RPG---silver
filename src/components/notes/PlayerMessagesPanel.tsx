import { Archive, BellRing, Check, Inbox, RotateCcw, Send, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getUnreadPlayerInboxCount,
  parsePlayerInboxMessages,
  playPlayerInboxAlert,
  serializePlayerInboxMessages,
  type PlayerInboxMessage,
  type SilverMessageRecipientOption,
} from '../../lib/playerInbox'

type PlayerInboxPanelProps = {
  value: string
  onChange: (value: string) => void
  canEdit: boolean
}

type SilverMessageComposerPanelProps = {
  recipients: SilverMessageRecipientOption[]
  onSend: (recipientId: string, title: string, body: string) => Promise<void> | void
  canEdit: boolean
  sending?: boolean
  error?: string | null
}

function formatMessageTimestamp(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return 'Agora mesmo'
  }

  return parsed.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function updateMessageCollection(
  messages: PlayerInboxMessage[],
  messageId: string,
  updater: (message: PlayerInboxMessage) => PlayerInboxMessage,
) {
  return messages.map((message) => (message.id === messageId ? updater(message) : message))
}

export function PlayerInboxPanel({ value, onChange, canEdit }: PlayerInboxPanelProps) {
  const messages = useMemo(() => parsePlayerInboxMessages(value), [value])
  const unreadCount = useMemo(() => getUnreadPlayerInboxCount(messages), [messages])
  const activeMessages = useMemo(
    () => messages.filter((message) => !message.archivedAt),
    [messages],
  )
  const archivedMessages = useMemo(
    () => messages.filter((message) => Boolean(message.archivedAt)),
    [messages],
  )
  const knownMessageIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const knownMessageIds = knownMessageIdsRef.current
    const nextKnownMessageIds = new Set(messages.map((message) => message.id))

    if (!knownMessageIds) {
      knownMessageIdsRef.current = nextKnownMessageIds
      return
    }

    const hasNewUnreadMessage = messages.some(
      (message) => !message.readAt && !message.archivedAt && !knownMessageIds.has(message.id),
    )

    knownMessageIdsRef.current = nextKnownMessageIds

    if (hasNewUnreadMessage) {
      void playPlayerInboxAlert()
    }
  }, [messages])

  const persistMessages = (nextMessages: PlayerInboxMessage[]) => {
    onChange(serializePlayerInboxMessages(nextMessages))
  }

  const markAsRead = (messageId: string) => {
    persistMessages(
      updateMessageCollection(messages, messageId, (message) => ({
        ...message,
        readAt: message.readAt ?? new Date().toISOString(),
      })),
    )
  }

  const archiveMessage = (messageId: string) => {
    persistMessages(
      updateMessageCollection(messages, messageId, (message) => ({
        ...message,
        readAt: message.readAt ?? new Date().toISOString(),
        archivedAt: message.archivedAt ?? new Date().toISOString(),
      })),
    )
  }

  const restoreMessage = (messageId: string) => {
    persistMessages(
      updateMessageCollection(messages, messageId, (message) => ({
        ...message,
        archivedAt: undefined,
      })),
    )
  }

  return (
    <section className="mt-4 rounded-[22px] border border-white/10 bg-black/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Inbox size={15} className="text-[#f3e600]" />
            <p className="panel-title">Inbox do Silver</p>
          </div>
          <p className="mt-2 text-xs leading-6 text-stone-500">
            Recados, pistas e alertas privados que o Silver te enviou.
          </p>
        </div>

        <div className="rounded-full border border-[#f3e600]/30 bg-[#f3e600]/10 px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-[#f3e600]">
          {unreadCount} nova{unreadCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {activeMessages.length ? (
          activeMessages.map((message) => {
            const unread = !message.readAt

            return (
              <article
                key={message.id}
                className={`border px-3 py-3 transition ${
                  unread
                    ? 'border-[#f3e600]/35 bg-[#f3e600]/10'
                    : 'border-white/10 bg-black/25'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {message.title || 'Recado do Silver'}
                    </p>
                    <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                      {message.senderName} · {formatMessageTimestamp(message.sentAt)}
                    </p>
                  </div>

                  {unread ? (
                    <span className="rounded-full bg-[#f3e600] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-black">
                      Nova
                    </span>
                  ) : null}
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-200">
                  {message.body}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => markAsRead(message.id)}
                    disabled={!canEdit || !unread}
                    className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                    data-variant={unread ? 'ghost' : undefined}
                  >
                    <Check size={12} />
                    {unread ? 'Marcar lida' : 'Lida'}
                  </button>

                  <button
                    type="button"
                    onClick={() => archiveMessage(message.id)}
                    disabled={!canEdit}
                    className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                    data-variant="ghost"
                  >
                    <Archive size={12} />
                    Arquivar
                  </button>
                </div>
              </article>
            )
          })
        ) : (
          <div className="border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center text-xs leading-6 text-stone-500">
            Ainda nao tens recados novos do Silver.
          </div>
        )}
      </div>

      {archivedMessages.length ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
            Arquivadas
          </p>

          <div className="mt-2 space-y-2">
            {archivedMessages.map((message) => (
              <article key={message.id} className="border border-white/10 bg-black/20 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {message.title || 'Recado do Silver'}
                    </p>
                    <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                      {message.senderName} · {formatMessageTimestamp(message.sentAt)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => restoreMessage(message.id)}
                    disabled={!canEdit}
                    className="signal-button inline-flex items-center gap-2 px-2 py-1 text-[0.68rem]"
                    data-variant="ghost"
                  >
                    <RotateCcw size={11} />
                    Restaurar
                  </button>
                </div>

                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-stone-400">
                  {message.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function SilverMessageComposerPanel({
  recipients,
  onSend,
  canEdit,
  sending = false,
  error,
}: SilverMessageComposerPanelProps) {
  const [recipientId, setRecipientId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!recipients.length) {
      setRecipientId('')
      return
    }

    if (!recipients.some((recipient) => recipient.id === recipientId)) {
      setRecipientId(recipients[0].id)
    }
  }, [recipientId, recipients])

  useEffect(() => {
    if (error) {
      setFeedback(null)
    }
  }, [error])

  const handleSend = async () => {
    if (!recipientId || !body.trim()) {
      return
    }

    setFeedback(null)

    try {
      await onSend(recipientId, title.trim() || 'Recado do Silver', body.trim())
      setTitle('')
      setBody('')
      setFeedback('Mensagem enviada com alerta para o player.')
    } catch {
      // O erro visivel vem do prop `error`.
    }
  }

  return (
    <div className="rounded-[22px] border border-white/10 bg-[#0b0b0b]/95 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.4)] backdrop-blur">
      <div className="flex items-center gap-2">
        <BellRing size={16} className="text-[#f3e600]" />
        <p className="panel-title">Mensagens para players</p>
      </div>

      {recipients.length ? (
        <>
          <div className="mt-3 border border-white/10 bg-black/30 p-3">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-[#f3e600]" />
              <p className="text-xs uppercase tracking-[0.18em] text-stone-300">
                Destinatario
              </p>
            </div>

            <select
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
              disabled={!canEdit || sending}
              className="mt-3 w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#f3e600]/45"
            >
              {recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={title}
              readOnly={!canEdit || sending}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Titulo do recado"
              className="mt-3 w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#f3e600]/45"
            />

            <textarea
              value={body}
              readOnly={!canEdit || sending}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Escreve a mensagem que queres enviar..."
              className="mt-3 min-h-[108px] w-full resize-none border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#f3e600]/45"
            />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canEdit || sending || !recipientId || !body.trim()}
              className="signal-button mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs"
            >
              <Send size={13} />
              {sending ? 'A enviar...' : 'Enviar mensagem'}
            </button>
          </div>

          <p className={`mt-3 text-xs ${error ? 'text-rose-400' : 'text-stone-400'}`}>
            {error || feedback || 'O player recebe isto na inbox e toca um alerta quando chegar.'}
          </p>
        </>
      ) : (
        <div className="mt-3 border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center text-xs leading-6 text-stone-500">
          Nao ha players disponiveis para receber mensagens agora.
        </div>
      )}
    </div>
  )
}
