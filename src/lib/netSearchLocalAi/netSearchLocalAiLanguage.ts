import type {
  NetSearchLocalAiLanguagePreference,
  NetSearchLocalAiOutputLanguage,
} from './netSearchLocalAiTypes'

export const NET_SEARCH_LOCAL_AI_PT_PT_FALLBACK =
  'Não existe informação verificada disponível sobre isso na rede de New Vega.'
export const NET_SEARCH_LOCAL_AI_EN_FALLBACK =
  'No verified information about that is available on the New Vega network.'

const PORTUGUESE_INDICATORS = new Set([
  'quem', 'qual', 'quais', 'onde', 'quando', 'porque', 'porquê', 'como', 'oq',
  'é', 'projeto', 'cena', 'bro', 'fica', 'criou', 'aconteceu', 'não', 'numa',
])
const ENGLISH_INDICATORS = new Set([
  'who', 'what', 'where', 'when', 'why', 'how', 'is', 'was', 'created',
  'project', 'tell',
])

const LANGUAGE_MARKERS: Record<'pt' | 'en' | 'fr' | 'es', ReadonlySet<string>> = {
  pt: new Set([
    'não', 'existe', 'informação', 'informações', 'verificada', 'verificadas',
    'rede', 'utilizador', 'ficheiro', 'ecrã', 'pesquisa', 'equipa', 'telemóvel',
    'aplicação', 'criou', 'criado', 'aconteceu', 'projeto', 'porquê', 'segundo',
    'fontes', 'foi', 'sobre', 'isso', 'é', 'um', 'uma', 'por', 'pelo', 'pela',
  ]),
  en: new Set([
    'the', 'and', 'is', 'was', 'were', 'created', 'verified', 'information',
    'available', 'network', 'according', 'sources', 'about', 'this', 'that',
    'there', 'does', 'not', 'it', 'by',
  ]),
  fr: new Set([
    'le', 'les', 'des', 'une', 'est', 'sont', 'dans', 'avec', 'pour', 'aucune',
    'informations', 'vérifiée', 'vérifiées', 'réseau', 'selon', 'cette', 'sur',
    'disponible', 'pas', 'été', 'créé', 'créée', 'par', 'projet', 'également',
    'cependant', 'mais',
  ]),
  es: new Set([
    'el', 'los', 'las', 'una', 'es', 'son', 'con', 'para', 'ninguna',
    'información', 'verificada', 'red', 'según', 'este', 'esta', 'fue', 'del',
    'disponible', 'sobre', 'creado', 'creada', 'por', 'proyecto', 'ocurrió',
  ]),
}

const BRAZILIAN_PORTUGUESE_MARKERS = new Set([
  'usuário', 'usuários', 'arquivo', 'arquivos', 'tela', 'telas', 'celular',
  'celulares', 'aplicativo', 'aplicativos',
])

function words(value: string): readonly string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function indicatorScore(query: string, indicators: ReadonlySet<string>): number {
  const queryWords = words(query)
  let score = 0
  for (const word of queryWords) {
    if (indicators.has(word)) score += 1
  }
  return score
}

export function resolveNetSearchLocalAiOutputLanguage(
  query: string,
  preference: NetSearchLocalAiLanguagePreference,
): NetSearchLocalAiOutputLanguage {
  if (preference !== 'auto') return preference

  const normalized = query.toLocaleLowerCase()
  const portugueseScore = indicatorScore(normalized, PORTUGUESE_INDICATORS)
    + (normalized.includes('o que') || normalized.includes('quem é') ? 2 : 0)
  const englishScore = indicatorScore(normalized, ENGLISH_INDICATORS)
    + (normalized.includes('tell me') ? 2 : 0)
  return englishScore > portugueseScore ? 'en' : 'pt-PT'
}

export function netSearchLocalAiFallback(
  language: NetSearchLocalAiOutputLanguage,
): string {
  return language === 'en'
    ? NET_SEARCH_LOCAL_AI_EN_FALLBACK
    : NET_SEARCH_LOCAL_AI_PT_PT_FALLBACK
}

export function netSearchLocalAiLanguageDirective(
  language: NetSearchLocalAiOutputLanguage,
  correctionAttempt: boolean,
): string {
  const correction = correctionAttempt
    ? '\nThis is a language-correction retry. Discard the previous response and obey this language instruction without exception.'
    : ''
  if (language === 'en') {
    return `OUTPUT_LANGUAGE: ENGLISH
You MUST answer in English. Do not answer in Portuguese, French, or Spanish.
Do not translate canonical proper nouns.${correction}`
  }
  return `OUTPUT_LANGUAGE: EUROPEAN_PORTUGUESE
You MUST answer in Portuguese from Portugal.
Use European Portuguese vocabulary, grammar, and spelling.
Do not answer in Brazilian Portuguese, French, Spanish, or English.
Where relevant, prefer European terms such as ficheiro, utilizador, ecrã, equipa, telemóvel, aplicação, and pesquisa.
Do not translate canonical proper nouns.${correction}`
}

function languageScores(answer: string): Record<'pt' | 'en' | 'fr' | 'es', number> {
  const answerWords = words(answer.replace(/^>.*$/gmu, ''))
  const scores = { pt: 0, en: 0, fr: 0, es: 0 }
  for (const word of answerWords) {
    for (const language of Object.keys(LANGUAGE_MARKERS) as Array<keyof typeof LANGUAGE_MARKERS>) {
      if (LANGUAGE_MARKERS[language].has(word)) scores[language] += 1
    }
  }
  return scores
}

export function isNetSearchLocalAiLanguageMismatch(
  answer: string,
  requestedLanguage: NetSearchLocalAiOutputLanguage,
): boolean {
  if (answer.trim().length < 16) return false
  const scores = languageScores(answer)

  if (requestedLanguage === 'pt-PT') {
    const foreignScore = Math.max(scores.en, scores.fr, scores.es)
    const brazilianTerms = words(answer).filter((word) => BRAZILIAN_PORTUGUESE_MARKERS.has(word)).length
    return (foreignScore >= 3 && foreignScore >= scores.pt + 2) || brazilianTerms >= 2
  }

  const foreignScore = Math.max(scores.pt, scores.fr, scores.es)
  return foreignScore >= 3 && foreignScore >= scores.en + 2
}
