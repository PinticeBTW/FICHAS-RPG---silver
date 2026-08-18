import { X } from 'lucide-react'
import { useState } from 'react'

import { trustReviewReasons } from './idenData'
import { useNetDialog } from './netDialogStack'

interface IdenReviewDialogProps {
  onClose: () => void
  onSubmit: (reason: string, details: string) => void
}

export function IdenReviewDialog({ onClose, onSubmit }: IdenReviewDialogProps) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onClose)

  const handleSubmit = () => {
    if (!reason) {
      setError('Select a reason before submitting.')
      return
    }

    onSubmit(reason, details.trim())
  }

  return (
    <div
      className="iden-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="iden-modal"
        ref={dialogRef}
        role="dialog"
        aria-label="Request score review"
        aria-modal="true"
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <header className="iden-modal__head">
          <strong>Request Score Review</strong>
          <button
            type="button"
            data-net-dialog-initial-focus
            onClick={onClose}
            aria-label="Close review dialog"
            title="Close"
          >
            <X size={15} />
          </button>
        </header>

        <div className="iden-modal__body">
          <span className="iden-modal__label">Reason</span>

          <div className="iden-modal__reasons">
            {trustReviewReasons.map((option) => (
              <button
                key={option}
                type="button"
                data-active={reason === option ? 'true' : 'false'}
                onClick={() => {
                  setReason(option)
                  setError(null)
                }}
              >
                {option}
              </button>
            ))}
          </div>

          <span className="iden-modal__label">Details (optional)</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="Add context for the review (optional)"
            aria-label="Review details"
            maxLength={500}
          />

          {error ? <p className="iden-modal__error">{error}</p> : null}
        </div>

        <footer className="iden-modal__foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="iden-modal__submit" onClick={handleSubmit}>
            Submit Review
          </button>
        </footer>
      </div>
    </div>
  )
}
