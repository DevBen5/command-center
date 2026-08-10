import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les lignes `coffre_catalog_items` de source `nas` portent l'ancien format de référence — un
 * chemin relatif NU, sans l'identité de sa racine (CC-233). Elles sont DÉRIVÉES : `reference` est
 * ce qu'une source contient, pas ce que l'utilisateur a écrit (voir la migration CC-225). La
 * réponse générale est donc de les SUPPRIMER — la prochaine `node ace coffre:sync-catalog` les
 * recrée, dans le nouveau format `<nom de racine>/<chemin relatif>`.
 *
 * ⚠️ **Sauf pour les lignes rattachées à une entrée** (`entry_id NOT NULL`) — anticipé par CC-225
 * mais non exploité avant ce lot (aucun code n'écrit encore ce champ, voir le `CLAUDE.md` du
 * module) : les supprimer perdrait un rattachement que rien ne recréerait à l'identique au
 * prochain passage de `coffre:sync-catalog` (la ligne renaîtrait avec un `id` différent, l'entrée
 * pointerait dans le vide). Ces lignes-là sont réécrites EN PLACE, jamais supprimées.
 *
 * ⚠️ **La réécriture suppose une racine NAS UNIQUE et déclarée.** L'ancien format ne portait
 * aucune identité de racine — c'est exactement le défaut que ce lot corrige — donc il n'existe
 * aucun moyen de savoir à quelle racine appartenait une référence existante s'il y en a plusieurs :
 * la migration LÈVE plutôt que de deviner, sur le même principe que
 * `…_move_progress_from_leitner_cards_table.ts` (« lever plutôt que d'inventer »). En pratique, ce
 * chemin n'a jamais été exercé — aucun code ne pose `entry_id` avant le lot 3 de l'épique CC-224 —
 * mais le lire dans le schéma plutôt que de le supposer est ce que le ticket demandait.
 *
 * ⚠️ **`COFFRE_NAS_ROOTS` est lu directement dans `process.env`, jamais via `#config/coffre_nas`**
 * — une migration est de l'histoire figée, elle ne doit pas casser parce qu'un helper a bougé
 * (même doctrine que la migration Leitner citée plus haut, qui recopie sa règle d'attribution du
 * propriétaire plutôt que de l'importer). Le format attendu (`nom=chemin`, séparé par des
 * virgules) est celui que ce même lot impose désormais au démarrage de l'application : au moment
 * où cette migration peut s'exécuter, l'application a déjà démarré avec succès une fois, donc
 * `COFFRE_NAS_ROOTS` est déjà dans ce format si elle est renseignée.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_catalog_items'

  async up() {
    this.defer(async (db) => {
      await db.from(this.tableName).where('source', 'nas').whereNull('entry_id').delete()

      const restantes = await db
        .from(this.tableName)
        .where('source', 'nas')
        .whereNotNull('entry_id')
        .select(['id', 'reference'])

      if (restantes.length === 0) return

      const roots = parseRootNames(process.env.COFFRE_NAS_ROOTS)
      if (roots.length !== 1) {
        throw new Error(
          `${restantes.length} ligne(s) de coffre_catalog_items (source « nas ») sont ` +
            'rattachées à une entrée et ne peuvent pas être supprimées, mais COFFRE_NAS_ROOTS ' +
            `ne déclare pas une racine UNIQUE (${roots.length} trouvée(s)) : impossible de ` +
            'savoir sans ambiguïté à quelle racine appartient chaque référence existante. ' +
            'Corrige ces lignes à la main (ou réduis temporairement COFFRE_NAS_ROOTS à la ' +
            'racine concernée) avant de relancer la migration.'
        )
      }

      const [rootName] = roots
      for (const row of restantes) {
        await db
          .from(this.tableName)
          .where('id', row.id)
          .update({ reference: `${rootName}/${row.reference}` })
      }
    })
  }

  /**
   * ⚠️ **Retour en arrière partiel, et c'est assumé** — même famille que la migration Leitner
   * citée en tête de fichier : les lignes supprimées par `up()` sont dérivées, `down()` ne les
   * recrée pas (le prochain `coffre:sync-catalog` s'en charge). Seules les lignes rattachées à
   * une entrée, réécrites en place par `up()`, sont réellement réversibles ici.
   */
  async down() {
    this.defer(async (db) => {
      const roots = parseRootNames(process.env.COFFRE_NAS_ROOTS)
      if (roots.length !== 1) return // rien à défaire de façon fiable sans une racine connue

      const prefixe = `${roots[0]}/`
      const rows = await db
        .from(this.tableName)
        .where('source', 'nas')
        .whereNotNull('entry_id')
        .select(['id', 'reference'])

      for (const row of rows) {
        if (typeof row.reference === 'string' && row.reference.startsWith(prefixe)) {
          await db
            .from(this.tableName)
            .where('id', row.id)
            .update({ reference: row.reference.slice(prefixe.length) })
        }
      }
    })
  }
}

/** Recopie volontaire du strict minimum de `normalizeCoffreNasConfig` — voir le commentaire de tête. */
function parseRootNames(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const indexEgal = entry.indexOf('=')
      return indexEgal === -1 ? null : entry.slice(0, indexEgal).trim()
    })
    .filter((nom): nom is string => nom !== null && nom.length > 0)
}
