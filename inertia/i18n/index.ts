import { createI18n } from 'vue-i18n'
import fr from './fr.json'
import en from './en.json'
import { mergeModuleMessages, type Messages } from './messages'

// Traductions co-localisées par module : chaque `app/<couche>/<module>/i18n/<locale>.json`
// est ramassé ici et fusionné sous un namespace = nom du dossier module (voir `messages.ts`).
// `eager` garde `createI18n` synchrone au boot ; `import: 'default'` extrait l'objet JSON.
// Le pattern `/app/**` reprend celui, déjà éprouvé, de la résolution des pages (`app/app.ts`).
const frModules = import.meta.glob('/app/**/i18n/fr.json', {
  eager: true,
  import: 'default',
}) as Record<string, Messages>
const enModules = import.meta.glob('/app/**/i18n/en.json', {
  eager: true,
  import: 'default',
}) as Record<string, Messages>

// Instance vue-i18n partagée. Le français est la langue de repli : toute clé
// absente d'une autre langue retombe automatiquement sur le texte français.
export const i18n = createI18n({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: {
    fr: mergeModuleMessages(fr, frModules),
    en: mergeModuleMessages(en, enModules),
  },
})

export function setLocale(locale: string): void {
  i18n.global.locale.value = locale as 'fr' | 'en'
}
