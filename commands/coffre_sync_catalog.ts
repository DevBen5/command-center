import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import CoffreVault from '#modules/coffre/models/coffre_vault'
import catalogSync from '#modules/coffre/services/catalog_sync_service'
import ImmichLockedCatalogSource from '#modules/coffre/services/immich_locked_catalog_source'
import type { CatalogSource } from '#modules/coffre/services/catalog_source'

/**
 * Synchronise le catalogue du coffre avec ses sources (CC-225, lot 1 de l'épique CC-224).
 *
 * ## Pourquoi une commande, et pas un provider planifié
 *
 * Le ticket ne rend un provider obligatoire que « si » la synchronisation tourne en tâche de
 * fond — ce lot ne le fait pas. Une commande manuelle suffit à prouver l'abstraction par un
 * usage réel, sans le coût d'un provider à garder par `isModuleEnabled('coffre')` et à tester
 * sur le modèle de CC-137 pour un déclenchement automatique que personne n'a encore demandé.
 *
 * ## Pourquoi elle vit dans `commands/`, à la racine
 *
 * Même raison structurelle que `auth:reset-account` — voir `commands/reset_account.ts` : le
 * noyau ace ne charge les commandes que depuis `app.commandsPath()`, un seul dossier.
 *
 * ## Ce qu'elle fait, dans l'ordre
 *
 * Pour chaque source enregistrée, ELLE énumère une seule fois (`source.enumerate()`), puis
 * applique ce résultat unique à chaque compte qui possède un coffre — les sources de ce lot sont
 * installation-wide (un seul compte Immich dans `.env`), donc une seconde requête réseau par
 * compte n'apporterait rien. La duplication du catalogue par compte, elle, reste en base
 * (décision du cadrage de CC-225) : chaque compte reçoit sa propre copie des lignes.
 *
 * ⚠️ **Une source qui échoue à s'énumérer n'écrit RIEN pour AUCUN compte**, et n'empêche pas les
 * autres sources de se synchroniser normalement — les échecs sont isolés par source.
 *
 * ⚠️ **Un compte qui échoue à appliquer une énumération (ex. contrainte unique violée par une
 * synchro concurrente lancée deux fois par erreur) n'empêche pas les AUTRES comptes d'être
 * synchronisés** — `applyEnumeration` est appelée dans son propre `try/catch`, pas seulement
 * `enumerate()` : sans lui, la première erreur de la boucle interromprait la commande entière et
 * laisserait tous les comptes suivants non synchronisés, silencieusement.
 */
export default class CoffreSyncCatalog extends BaseCommand {
  static commandName = 'coffre:sync-catalog'
  static description =
    'Synchronise le catalogue du coffre (CC-225) : découvre le neuf, met à jour ce qui a ' +
    'changé, marque absent ce qui a disparu — pour chaque compte, pour chaque source.'

  static options: CommandOptions = { startApp: true }

  async run() {
    const vaults = await CoffreVault.all()

    if (vaults.length === 0) {
      this.logger.info('Aucun coffre sur cette installation : rien à synchroniser.')
      return
    }

    const sources: CatalogSource[] = [await this.app.container.make(ImmichLockedCatalogSource)]

    for (const source of sources) {
      await this.#syncSource(source, vaults)
    }
  }

  async #syncSource(source: CatalogSource, vaults: CoffreVault[]): Promise<void> {
    this.logger.info(`Source « ${source.key} » : énumération…`)

    const enumeration = await source.enumerate().catch((error: unknown) => {
      this.logger.error(
        `Source « ${source.key} » : énumération échouée, rien n'a été modifié pour cette ` +
          `source — ${error instanceof Error ? error.message : String(error)}`
      )
      this.exitCode = 1
      return null
    })

    if (enumeration === null) return

    if (enumeration.truncated) {
      this.logger.warning(
        `Source « ${source.key} » : listing tronqué (plafond de pages atteint) — aucun ` +
          'élément ne sera marqué absent sur ce passage.'
      )
    }

    for (const vault of vaults) {
      try {
        const outcome = await catalogSync.applyEnumeration(vault.userId, source.key, enumeration)

        this.logger.info(
          `  compte #${vault.userId} : ${outcome.discovered} découvert(s), ` +
            `${outcome.updated} mis à jour, ${outcome.markedAbsent} marqué(s) absent(s).`
        )
      } catch (error) {
        this.logger.error(
          `  compte #${vault.userId} : synchronisation échouée pour la source « ${source.key} » ` +
            `— ${error instanceof Error ? error.message : String(error)}`
        )
        this.exitCode = 1
      }
    }
  }
}
