/**
 * L'**inventaire d'acquis** vu de la page : ce qui se compte et ce qui se regroupe
 * (CC-262). **PUR** — aucun modèle, aucune base, et le jour courant est un paramètre,
 * comme dans `leitner_habits.ts`.
 *
 * ⚠️ **Ce fichier vit dans `shared/`, donc il est importé par un `.vue`** : il n'importe
 * rien par un alias `#modules/*` (l'alias mappe vers `./app/modules/*.js`, qui n'existe
 * qu'après un build — Vite ne le résout pas et la page casse, sans que `tsc` le voie).
 * Il n'importe rien du tout, et c'est le plus sûr.
 *
 * Ce qu'il porte, et pourquoi ce n'est pas dans le `<script setup>` : un regroupement par
 * mois et un « dont N ce mois-ci » régressent en silence — un mois qui bascule d'un jour,
 * un tri qui s'inverse, et l'écran reste parfaitement plausible. Ce qui vit dans `setup`
 * n'est atteignable par aucun exécuteur.
 */

/** Ce que la page a besoin de savoir d'une carte acquise. */
export interface MasteredCard {
  id: number
  front: string
  /** `Catégorie · Thème`, ou le libellé « non classé » — déjà résolu côté serveur. */
  path: string
  /** La date d'acquisition, en ISO. **Jamais nulle** : c'est ce qui définit la liste. */
  masteredAt: string
  /** La prochaine vérification d'entretien, en ISO. */
  nextReview: string
}

/** Un mois d'acquisitions, tel que l'écran l'empile. */
export interface MasteryMonth {
  /** `2026-08` — stable, indépendant de la langue : c'est la clé, pas le libellé. */
  key: string
  /** Le 1ᵉʳ du mois, en ISO : c'est lui que la page passe à `Intl` pour l'afficher. */
  monthStart: string
  cards: MasteredCard[]
}

/** Le mois d'une date ISO, en temps local — `2026-08-16T…` → `2026-08`. */
function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * Les cartes acquises, groupées par mois d'acquisition, **du plus récent au plus ancien**,
 * et triées de même à l'intérieur d'un mois.
 *
 * ⚠️ **Un mois sans acquisition n'apparaît pas** — la liste n'est pas un calendrier : une
 * suite de mois vides entre deux paquets de travail ferait de l'inventaire un reproche.
 * C'est l'inverse exact de la heatmap d'habitude, qui rend les trous **parce que** son
 * sujet est la régularité.
 */
export function groupMasteredByMonth(cards: MasteredCard[]): MasteryMonth[] {
  const months = new Map<string, MasteredCard[]>()

  for (const card of cards) {
    const key = monthKey(card.masteredAt)
    const bucket = months.get(key)
    if (bucket) bucket.push(card)
    else months.set(key, [card])
  }

  return [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, group]) => ({
      key,
      monthStart: `${key}-01`,
      cards: [...group].sort((a, b) => b.masteredAt.localeCompare(a.masteredAt) || b.id - a.id),
    }))
}

/**
 * « 47 cartes maîtrisées, dont 6 ce mois-ci » — le chiffre qui fait la différence entre un
 * compteur et un inventaire d'acquis.
 *
 * ⚠️ **« Ce mois-ci » est le mois CIVIL courant, pas les trente derniers jours.** Le
 * second glisserait tous les jours : le même écran, rouvert demain sans rien avoir
 * révisé, annoncerait un chiffre plus bas. Un inventaire ne recule pas tout seul.
 *
 * @param today Le jour courant, en ISO (`AAAA-MM-JJ` suffit) — jamais lu de l'horloge ici :
 *   le module découpe ses journées en JS, à un seul endroit (CC-46).
 */
export function masteredThisMonth(cards: MasteredCard[], today: string): number {
  const current = monthKey(today)
  return cards.filter((card) => monthKey(card.masteredAt) === current).length
}

/**
 * Les acquis dont l'entretien est **dû** — ceux que `?queue=maintenance` va présenter.
 *
 * ⚠️ **Ce compte se dérive de l'inventaire, il ne se redemande pas à la base.** Les deux
 * questions ont exactement la même réponse (`mastered_at is not null` + échéance passée,
 * à visibilité égale), et deux requêtes finiraient par diverger : l'écran annoncerait
 * « 3 à vérifier » puis en présenterait 2, sans que rien ne lève. La file elle-même reste
 * servie par `whereMaintenanceDue`, l'unique copie côté SQL.
 *
 * @param today Le jour courant en `AAAA-MM-JJ`. La comparaison est lexicographique, ce qui
 *   est exact sur des dates ISO — et évite de refabriquer une horloge dans un fichier pur.
 */
export function maintenanceDueCount(cards: MasteredCard[], today: string): number {
  return cards.filter((card) => card.nextReview.slice(0, 10) <= today).length
}

/**
 * La prochaine vérification d'entretien, tous acquis confondus — `null` s'il n'y a aucun
 * acquis.
 *
 * ⚠️ **Elle existe pour que la file d'entretien reste visible quand elle est VIDE.** Un
 * panneau qui disparaîtrait à zéro laisserait croire que le mécanisme n'existe pas — le
 * reproche que CC-261 se faisait à lui-même. Zéro dû n'est pas rien à dire : c'est « la
 * prochaine, le 12 novembre ».
 */
export function nextMaintenanceAt(cards: MasteredCard[]): string | null {
  let next: string | null = null
  for (const card of cards) {
    if (next === null || card.nextReview < next) next = card.nextReview
  }
  return next
}

/**
 * La part du catalogue visible qui est acquise, en pourcentage entier.
 *
 * ⚠️ **`null` quand le catalogue est vide, jamais `0`** : « 0 % » se lit comme une mesure
 * (« tu n'as rien appris »), alors qu'il n'y a rien à mesurer. Même doctrine que la
 * rétention et que les durées de session, qui rendent `—` plutôt qu'un zéro.
 */
export function masteredShare(masteredCount: number, totalCards: number): number | null {
  if (totalCards <= 0) return null
  return Math.round((masteredCount / totalCards) * 100)
}
