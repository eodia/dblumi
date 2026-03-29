import { createContext, useContext } from 'react'
import { fr } from './fr'
import { en } from './en'

export type Locale = 'fr' | 'en'
export type TranslationKey = keyof typeof fr

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { fr, en }

export type I18nContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TranslationKey, replacements?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'fr',
  setLocale: () => {},
  t: (key) => key,
})

export function useI18n() {
  return useContext(I18nContext)
}

export function createTranslator(locale: Locale) {
  return (key: TranslationKey, replacements?: Record<string, string | number>): string => {
    let text = dictionaries[locale][key] ?? dictionaries.fr[key] ?? key
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return text
  }
}

/** Detect browser locale, return 'fr' or 'en' */
export function detectLocale(): Locale {
  const lang = navigator.language?.slice(0, 2) ?? 'en'
  return lang === 'fr' ? 'fr' : 'en'
}

export { fr, en }
