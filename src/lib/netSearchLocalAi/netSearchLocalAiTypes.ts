import type { NetSearchSourceKind } from '../netSearchTypes'

export type NetSearchLocalAiPhase =
  | 'checking'
  | 'not_initialized'
  | 'consent_required'
  | 'initializing'
  | 'ready'
  | 'retrieving'
  | 'generating'
  | 'complete'
  | 'unsupported'
  | 'error'

export type NetSearchLocalAiInitializationStage = 'downloading' | 'loading_gpu'
export type NetSearchLocalAiLanguagePreference = 'auto' | 'pt-PT' | 'en'
export type NetSearchLocalAiOutputLanguage = Exclude<NetSearchLocalAiLanguagePreference, 'auto'>

export interface NetSearchLocalAiSource {
  readonly sourceId: string
  readonly sourceKind: NetSearchSourceKind
  readonly title: string
  readonly heading?: string
}

export interface NetSearchLocalAiState {
  readonly phase: NetSearchLocalAiPhase
  readonly progress: number
  readonly statusText: string
  readonly answer: string
  readonly sources: readonly NetSearchLocalAiSource[]
  readonly activeQuery: string
  readonly modelCached: boolean
  readonly languagePreference: NetSearchLocalAiLanguagePreference
  readonly outputLanguage: NetSearchLocalAiOutputLanguage
  readonly initializationStage?: NetSearchLocalAiInitializationStage
}

export type NetSearchLocalAiEnableResult =
  | 'ready'
  | 'consent_required'
  | 'unsupported'
  | 'failed'
