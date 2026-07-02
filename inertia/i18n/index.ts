import { createI18n } from 'vue-i18n'
import fr from './fr.json'
import en from './en.json'

// Instance vue-i18n partagée. Le français est la langue de repli : toute clé
// absente d'une autre langue retombe automatiquement sur le texte français.
export const i18n = createI18n({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: { fr, en },
})

export function setLocale(locale: string): void {
  i18n.global.locale.value = locale as 'fr' | 'en'
}
