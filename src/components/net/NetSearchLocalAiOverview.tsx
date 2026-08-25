import {
  BrainCircuit,
  Cpu,
  Database,
  Download,
  FileText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
  NET_SEARCH_LOCAL_AI_DOWNLOAD_GB,
  NET_SEARCH_LOCAL_AI_MODEL_ID,
  NET_SEARCH_LOCAL_AI_MODEL_LABEL,
  NET_SEARCH_LOCAL_AI_VRAM_GB,
} from '../../lib/netSearchLocalAi/netSearchLocalAiConfig'
import {
  canGenerateNetSearchLocalAiOverview,
  cancelNetSearchLocalAiOperation,
  confirmNetSearchLocalAiConsent,
  declineNetSearchLocalAiConsent,
  generateNetSearchLocalAiOverview,
  getNetSearchLocalAiSnapshot,
  requestNetSearchLocalAiEnable,
  setNetSearchLocalAiLanguagePreference,
  subscribeNetSearchLocalAi,
} from '../../lib/netSearchLocalAi/netSearchLocalAiService'
import type { NetSearchLocalAiLanguagePreference } from '../../lib/netSearchLocalAi/netSearchLocalAiTypes'
import type { NetSearchSourceKind } from '../../lib/netSearchTypes'

interface NetSearchLocalAiOverviewProps {
  readonly query: string
  readonly searchReady: boolean
  readonly onOpenSource: (sourceId: string, sourceKind: NetSearchSourceKind) => void
}

const LANGUAGE_OPTIONS: ReadonlyArray<{
  readonly value: NetSearchLocalAiLanguagePreference
  readonly label: string
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'pt-PT', label: 'PT-PT' },
  { value: 'en', label: 'EN' },
]

export function NetSearchLocalAiOverview({
  query,
  searchReady,
  onOpenSource,
}: NetSearchLocalAiOverviewProps) {
  const queryRef = useRef(query)
  useEffect(() => {
    queryRef.current = query
  }, [query])
  const state = useSyncExternalStore(
    subscribeNetSearchLocalAi,
    getNetSearchLocalAiSnapshot,
    getNetSearchLocalAiSnapshot,
  )

  const generateIfEligible = async (result: string) => {
    if (result === 'ready' && searchReady) {
      await generateNetSearchLocalAiOverview(queryRef.current)
    }
  }

  const enable = async () => {
    await generateIfEligible(await requestNetSearchLocalAiEnable())
  }

  const confirmDownload = async () => {
    await generateIfEligible(await confirmNetSearchLocalAiConsent())
  }

  const retry = async () => {
    if (canGenerateNetSearchLocalAiOverview()) {
      if (searchReady) await generateNetSearchLocalAiOverview(queryRef.current)
      return
    }
    await enable()
  }

  const isBusy = state.phase === 'initializing'
    || state.phase === 'retrieving'
    || state.phase === 'generating'
  const showAnswer = state.phase === 'generating' || state.phase === 'complete'

  return (
    <section className="net-search-ai-overview" data-phase={state.phase} aria-label="Local AI Overview">
      <div className="net-search-ai-overview__icon">
        {state.phase === 'unsupported' || state.phase === 'error'
          ? <TriangleAlert size={22} aria-hidden="true" />
          : <BrainCircuit size={22} aria-hidden="true" />}
      </div>

      <div className="net-search-ai-overview__body">
        <header>
          <span>AI OVERVIEW</span>
          <i>LOCAL DEVICE // OPTIONAL</i>
        </header>

        <div className="net-search-ai-overview__language" role="group" aria-label="AI Overview answer language">
          <span>LANGUAGE</span>
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={state.languagePreference === option.value}
              onClick={() => setNetSearchLocalAiLanguagePreference(option.value)}
            >
              {option.label}
            </button>
          ))}
          <small>AUTO chooses PT-PT or English; uncertain queries default to PT-PT.</small>
        </div>

        {state.phase === 'checking' ? (
          <div className="net-search-ai-overview__status" role="status">
            <LoaderCircle className="net-search-spin" size={15} />
            <div><strong>Checking local AI support</strong><p>{state.statusText}</p></div>
          </div>
        ) : null}

        {state.phase === 'not_initialized' ? (
          <div className="net-search-ai-overview__status">
            <Cpu size={16} aria-hidden="true" />
            <div>
              <strong>NOT INITIALIZED</strong>
              <p>AI Overview runs privately on this device. Verified search results remain authoritative.</p>
            </div>
            <button type="button" onClick={() => void enable()}><Cpu size={13} /> Enable local AI</button>
          </div>
        ) : null}

        {state.phase === 'consent_required' ? (
          <div className="net-search-ai-overview__consent">
            <Download size={18} aria-hidden="true" />
            <div>
              <strong>ONE-TIME MODEL DOWNLOAD</strong>
              <p>
                Local AI downloads approximately {NET_SEARCH_LOCAL_AI_DOWNLOAD_GB} GB once and needs about {NET_SEARCH_LOCAL_AI_VRAM_GB} GB of GPU memory. Generation runs on this device and uses no paid AI credits or API keys.
              </p>
              <small>{NET_SEARCH_LOCAL_AI_MODEL_LABEL}<br />{NET_SEARCH_LOCAL_AI_MODEL_ID}</small>
            </div>
            <footer>
              <button type="button" onClick={declineNetSearchLocalAiConsent}>Not now</button>
              <button type="button" className="primary" onClick={() => void confirmDownload()}><Download size={13} /> Download &amp; enable</button>
            </footer>
          </div>
        ) : null}

        {state.phase === 'initializing' ? (
          <div className="net-search-ai-overview__initializing" role="status">
            <div>
              <LoaderCircle className="net-search-spin" size={16} />
              <span>
                <strong>{state.initializationStage === 'loading_gpu' ? 'Loading into GPU…' : 'Downloading model…'}</strong>
                <small>{NET_SEARCH_LOCAL_AI_MODEL_LABEL}</small>
              </span>
              <b>{Math.round(state.progress * 100)}%</b>
            </div>
            <progress value={state.progress} max={1} aria-label="Local model initialization progress" />
            <p>{state.statusText}</p>
            <button type="button" onClick={cancelNetSearchLocalAiOperation}><Square size={11} /> Cancel</button>
          </div>
        ) : null}

        {state.phase === 'ready' ? (
          <div className="net-search-ai-overview__status">
            <ShieldCheck size={16} aria-hidden="true" />
            <div><strong>AI READY</strong><p>The cached local model is ready to synthesize verified sources.</p></div>
            <button type="button" onClick={() => void generateNetSearchLocalAiOverview(queryRef.current)} disabled={!searchReady}>
              <BrainCircuit size={13} /> Generate overview
            </button>
          </div>
        ) : null}

        {state.phase === 'retrieving' ? (
          <div className="net-search-ai-overview__status" role="status">
            <LoaderCircle className="net-search-spin" size={15} />
            <div><strong>Retrieving verified context</strong><p>{state.statusText}</p></div>
            <button type="button" onClick={cancelNetSearchLocalAiOperation}><Square size={11} /> Cancel</button>
          </div>
        ) : null}

        {showAnswer ? (
          <div className="net-search-ai-overview__answer" aria-live="polite">
            <div className="net-search-ai-overview__answer-head">
              <strong>{state.phase === 'generating' ? `GENERATING LOCALLY · ${state.outputLanguage === 'en' ? 'EN' : 'PT-PT'}` : 'AI OVERVIEW'}</strong>
              {state.phase === 'generating' ? <LoaderCircle className="net-search-spin" size={13} /> : <ShieldCheck size={13} />}
            </div>
            <p>{state.answer || 'Reading the supplied verified sources…'}</p>
            {state.sources.length > 0 ? (
              <div className="net-search-ai-overview__sources">
                <strong>Sources used</strong>
                {state.sources.map((source, index) => (
                  <button
                    key={`${source.sourceKind}:${source.sourceId}`}
                    type="button"
                    onClick={() => onOpenSource(source.sourceId, source.sourceKind)}
                  >
                    {source.sourceKind === 'lore_document'
                      ? <FileText size={11} aria-hidden="true" />
                      : <Database size={11} aria-hidden="true" />}
                    <span>[{index + 1}] {source.title}{source.heading ? <small>{source.heading}</small> : null}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <footer>
              <span>The local synthesis is not canon. Open the verified sources below.</span>
              {state.phase === 'generating' ? (
                <button type="button" onClick={cancelNetSearchLocalAiOperation}><Square size={11} /> Stop</button>
              ) : (
                <button type="button" onClick={() => void generateNetSearchLocalAiOverview(queryRef.current)} disabled={!searchReady}><RefreshCw size={11} /> Regenerate</button>
              )}
            </footer>
          </div>
        ) : null}

        {state.phase === 'unsupported' || state.phase === 'error' ? (
          <div className="net-search-ai-overview__error" role="status">
            <TriangleAlert size={16} aria-hidden="true" />
            <div>
              <strong>LOCAL AI UNAVAILABLE</strong>
              <p>Local AI isn't available on this device. Verified search results are still available below.</p>
              <small>{state.statusText}</small>
            </div>
            {state.phase === 'error' ? <button type="button" onClick={() => void retry()}><RefreshCw size={12} /> Retry</button> : null}
          </div>
        ) : null}

        <div className="net-search-ai-overview__privacy">
          <LockKeyhole size={11} aria-hidden="true" />
          Lore retrieval uses the VEIL backend. AI generation runs on this device.
          {isBusy ? <span>LOCAL PROCESS ACTIVE</span> : null}
        </div>
      </div>
    </section>
  )
}
