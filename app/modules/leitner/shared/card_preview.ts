/**
 * L'aperçu du rendu Markdown d'une carte (CC-257) — ce que le validateur et les pages doivent
 * savoir **de la même façon**.
 *
 * ⚠️ **Ce fichier vit ici pour une seule raison, et c'est la leçon de CC-60** : une constante ne
 * peut pas être partagée depuis un `.vue`. `MEASURE_MAX_MS` était déclaré deux fois — dans un
 * service, d'où le validateur l'importait, et recopié dans `pages/index.vue`, qui ne pouvait pas
 * l'importer. Baisser le plafond serveur sans toucher la copie faisait poster une valeur au-dessus
 * de la borne : **422, rien à l'écran, rien de rouge**. La même divergence ici rendrait l'aperçu
 * définitivement muet — la page enverrait un contenu que le validateur refuse, le `fetch` rendrait
 * un 422 que personne ne regarde, et le panneau resterait vide sans dire pourquoi.
 *
 * ⚠️ **N'importe JAMAIS par un alias `#modules/*` ni `#core/*` depuis ce dossier.** Deux raisons
 * qui se cumulent : l'alias mappe vers `./app/**\/*.js`, des fichiers qui n'existent qu'après un
 * build (Vite ne les résout pas, la page casse) — et surtout, **tout ce qu'un fichier de `shared/`
 * importe part dans le bundle du navigateur**, puisqu'un `.vue` l'importe. Un
 * `import { renderMarkdown } from '#core/shared/services/markdown_renderer'` posé ici y
 * embarquerait `markdown-it` **et** `sanitize-html`, c'est-à-dire exactement l'acquis que CC-133
 * a construit en gardant le rendu côté serveur. Le rendu vit dans les contrôleurs, et nulle part
 * ailleurs.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue.
 */

/**
 * Le plafond de l'aperçu, par champ.
 *
 * ⚠️ **Il ne borne QUE l'aperçu, jamais l'enregistrement.** `cardValidator` n'impose aucune
 * longueur à `front`/`back` (les colonnes sont des `text` sans plafond), et ce lot ne change pas
 * ça : borner la saisie changerait ce qui est acceptable en base, sur du contenu déjà écrit. La
 * conséquence est assumée et visible — une carte au-delà de cette borne **s'enregistre** mais ne
 * se prévisualise pas, et le panneau le dit au lieu de rester vide.
 *
 * 20 000 caractères, soit deux ordres de grandeur au-dessus d'une carte réelle : le rendu y coûte
 * ~6 ms (mesuré : 0,11 ms sur une carte de 138 caractères, 30 ms sur 100 000). Ce n'est pas un
 * seuil de performance, c'est le refus d'une route qui rendrait du HTML sur un corps sans borne.
 *
 * ⚠️ **C'est l'unique déclaration, et un test la garde** : `leitner_card_preview.spec.ts` relit
 * `pages/settings.vue` et `pages/ingest_show.vue`, et rougit si le littéral y réapparaît.
 */
export const PREVIEW_MAX_CHARS = 20_000

/**
 * Le contenu dépasse-t-il ce que l'aperçu sait rendre ?
 *
 * Interrogé **avant** d'émettre la requête : sans ça, le seul retour serait un 422 que la page
 * traduirait en « erreur », alors que ce n'est pas une panne mais une limite connue. Le serveur
 * borne quand même — une vérification côté client n'est pas une garantie, c'est une politesse.
 *
 * Chaque champ est mesuré **séparément**, comme le validateur : c'est un plafond par champ, pas
 * un budget commun. Les mesurer ensemble refuserait un recto court accompagné d'un verso long
 * que la route, elle, accepterait.
 */
export function previewTooLong(front: string, back: string): boolean {
  return front.trim().length > PREVIEW_MAX_CHARS || back.trim().length > PREVIEW_MAX_CHARS
}
