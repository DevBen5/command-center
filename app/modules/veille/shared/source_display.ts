/**
 * L'affichage d'une source dans `pages/sources.vue` — **du code pur**, sorti du template (CC-60).
 *
 * ⚠️ **Aucun import par alias `#modules/*` dans ce fichier.** L'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build : Vite ne le résout pas et la page casse.
 * Ce fichier n'importe rien du tout, et c'est très bien ainsi. Le garde-fou reste
 * `npm run build` — `tsc` ne lit pas les `.vue` et ne peut pas le dire.
 */

/**
 * L'`url` des sources **auto-provisionnées** n'est pas une adresse — c'est un identifiant.
 *
 * `immich:album:<uuid>` et `youtube:playlist:<id>` ne mènent nulle part et ne disent rien à qui
 * les lit. La colonne existe parce que le lot 1 a bâti tout l'écran autour d'elle, mais le
 * collecteur ne la lit jamais : il lit la configuration.
 *
 * ⚠️ **Une clé i18n, pas un libellé.** Traduire ici forcerait `shared/` à connaître `useI18n`, or
 * ce fichier doit rester importable par Japa sans compilateur Vue. La page traduit, ce module
 * décide — et le partage entre les deux reste la seule décision testable.
 */
const URL_LABEL_KEYS: Record<string, string> = {
  immich: 'veille.sources.immichAlbum',
  youtube: 'veille.sources.youtubePlaylist',
}

/**
 * La clé de libellé à afficher **à la place** de l'`url`, ou `null` s'il faut montrer l'`url`.
 *
 * ⚠️ **Le repli est de montrer l'`url`, jamais de masquer.** Une provenance ajoutée sans sa clé
 * affichera son identifiant brut — moche, mais lisible et immédiatement diagnostiquable. Un repli
 * qui cacherait la ligne, ou qui rendrait une clé inventée, laisserait un blanc à l'écran sans que
 * personne sache de quelle source il s'agit.
 */
export function sourceUrlLabelKey(kind: string): string | null {
  return URL_LABEL_KEYS[kind] ?? null
}
