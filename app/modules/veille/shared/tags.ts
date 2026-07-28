/**
 * Ce qu'est un tag de veille — **la règle, écrite une seule fois** (CC-21).
 *
 * **Pur, serveur ET page** : la page normalise à la frappe, le validateur refuse ce qui n'a pas
 * la forme attendue. Deux définitions de « qu'est-ce qu'un tag valide » divergeraient, et la
 * divergence serait muette — la page accepterait une saisie que le serveur rejette, ou l'inverse.
 *
 * ⚠️ **CC-109 réutilise cette règle dans SON propre validateur**, et pas en étendant
 * `captureValidator` : poser un tag sur une capture et en poser un sur une sélection de trente
 * items sont deux gestes, avec deux charges utiles. Ce qui est commun, c'est la *forme d'un tag*,
 * et c'est exactement ce que ce fichier porte.
 *
 * ⚠️ **Aucun import par alias `#modules/*`** : l'alias vise des `.js` qui n'existent qu'après un
 * build, Vite ne les résout pas et la page casse.
 */

/**
 * ⚠️ **Un tag est un libellé affiché ET un paramètre d'URL** (`?tag=ia`), et le filtre est un
 * `? = ANY(tags)` **exact**. `IA` et `ia` feraient donc deux entrées dans la barre de tags et deux
 * filtres qui ne se rejoignent jamais — sans qu'aucune erreur ne le signale. D'où les minuscules.
 */
export const TAG_MAX_LENGTH = 32

/**
 * Combien de tags un item peut porter.
 *
 * Ce n'est pas une limite de stockage (`text[]` n'en a pas) mais d'affichage : la ligne du flux
 * porte déjà douze éléments, et vingt pastilles la rendraient illisible. Assez large pour que
 * personne ne la rencontre en usage normal.
 */
export const TAGS_MAX = 12

/**
 * ⚠️ **Les accents sont autorisés, et ce n'est pas un oubli.** Aucun tag de la base n'en porte —
 * mais les quatre qui existent (`facebook`, `linkedin`, `tiktok`, `youtube`) viennent tous de
 * `networkTagFor`, qui découpe sur `[^a-z0-9]+` et ne peut structurellement produire que de
 * l'ASCII. L'absence d'accent est un artefact des collecteurs, pas une règle : interdire
 * `sécurité` figerait une limite machine dans une saisie humaine.
 *
 * L'espace, lui, est refusé — il est remplacé par un tiret à la normalisation. Un tag à espaces
 * s'afficherait `#veille perso` (deux mots, une pastille) et voyagerait encodé dans l'URL.
 */
const TAG_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u

/**
 * Le tag tel qu'il sera stocké, ou `null` s'il n'y a rien d'exploitable.
 *
 * ⚠️ **La page applique cette fonction À LA FRAPPE**, pas seulement à l'envoi : une normalisation
 * faite en silence côté serveur laisserait l'utilisateur croire qu'il a écrit autre chose que ce
 * qui sera stocké — puis chercher pourquoi son filtre ne trouve rien. Ce qui s'affiche est ce qui
 * part.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .toLowerCase()
    // Les espaces internes deviennent des tirets, les suites de tirets se réduisent.
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, TAG_MAX_LENGTH)

  return tag !== '' && TAG_SHAPE.test(tag) ? tag : null
}

/**
 * Un tag est-il **déjà** sous sa forme stockable ? C'est la question du validateur, et pas une
 * autre — la page a normalisé à la frappe, le serveur n'a donc rien à corriger, seulement à
 * refuser ce qui n'a pas la bonne forme.
 *
 * ⚠️ **Défini comme un point fixe de `normalizeTag`, jamais par une seconde regex.** La première
 * version testait la forme et la longueur séparément : `\p{L}` acceptant les majuscules,
 * `isValidTag('IA')` répondait **vrai** alors que `normalizeTag('IA')` rend `'ia'`. Le serveur
 * aurait donc stocké `IA` envoyé par un client forgé — deux entrées dans la barre de tags pour
 * une même idée, et deux filtres `? = ANY(tags)` qui ne se rejoignent jamais. Écrit ainsi, les
 * deux ne **peuvent pas** diverger : la longueur, la casse et la forme viennent toutes du même
 * endroit.
 */
export function isValidTag(value: string): boolean {
  return normalizeTag(value) === value
}

/**
 * Ce qu'une saisie libre donne — **normalisé, dédoublonné, borné**.
 *
 * ⚠️ **La déduplication n'est pas du confort.** `tags` est un `text[]` sans contrainte : rien
 * n'empêche `{ia,ia}` en base, et le doublon ferait apparaître deux pastilles identiques sur la
 * ligne **et** compterait deux fois dans la barre de tags. C'est le même invariant que CC-109
 * devra tenir avec `array_append`, qui ne déduplique pas non plus.
 *
 * ⚠️ **L'ordre de saisie est conservé** : trier alphabétiquement réordonnerait les pastilles d'un
 * item à chaque ajout, et l'utilisateur perdrait le fil de ce qu'il vient de poser.
 */
export function parseTagInput(raw: string): string[] {
  const seen = new Set<string>()

  for (const candidate of raw.split(/[,\n]/)) {
    const tag = normalizeTag(candidate)
    if (tag !== null) seen.add(tag)
    if (seen.size >= TAGS_MAX) break
  }

  return [...seen]
}

/**
 * Ajoute un tag à une liste — **sans doublon, et sans dépasser le plafond**.
 *
 * Rend la liste **inchangée** quand le tag est invalide ou déjà là : la page peut appeler sans
 * vérifier, et le geste « ajouter deux fois » est simplement sans effet plutôt qu'une erreur.
 */
export function addTag(tags: readonly string[], raw: string): string[] {
  const tag = normalizeTag(raw)
  if (tag === null || tags.includes(tag) || tags.length >= TAGS_MAX) return [...tags]

  return [...tags, tag]
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((candidate) => candidate !== tag)
}
