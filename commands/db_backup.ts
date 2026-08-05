import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import backupService from '#core/backup/services/backup_service'

/**
 * `node ace db:backup` (CC-140) — la sauvegarde comme fonction de l'application, pas un script
 * du dépôt. Pensée pour tourner DANS le conteneur applicatif, sans dépôt cloné :
 *
 *   docker compose exec app node ace db:backup
 *
 * ⚠️ Ne remplace pas `npm run db:backup` (`scripts/db-backup.js`) sur le poste de dev, qui
 * reste le chemin déjà prouvé (CC-153) pilotant `docker compose exec postgres pg_dump`. Cette
 * commande-ci parle directement à Postgres en TCP (`DB_HOST:DB_PORT`), pas via le CLI Docker —
 * le conteneur applicatif n'a accès à aucun démon Docker (voir `docker-compose.prod.yml`).
 *
 * Toute la logique (ordre des étapes, vérification, miroir, purge) vit dans `BackupService`,
 * partagé avec l'écran d'administration : cette commande n'est qu'un appelant de plus.
 */
export default class DbBackup extends BaseCommand {
  static commandName = 'db:backup'
  static description = 'Sauvegarde la base dans le dossier de sauvegarde monté par le compose.'

  static options: CommandOptions = { startApp: true }

  async run() {
    const resultat = await backupService.runBackup()

    if (!resultat.ok) {
      this.logger.error(resultat.error ?? 'Sauvegarde échouée.')
      this.exitCode = 1
      return
    }

    this.logger.success(
      `Sauvegarde : ${resultat.file} (${Math.round((resultat.sizeBytes ?? 0) / 1024)} Ko, vérifiée)`
    )
    this.logger.info(
      resultat.mirrored
        ? 'Copie hors-disque effectuée.'
        : 'Aucune copie hors-disque (miroir non monté ou déjà à jour) : ce dump vit sur le disque du dossier de sauvegarde.'
    )
    if (resultat.purged > 0) {
      this.logger.info(`Purge : ${resultat.purged} dump(s) supprimé(s).`)
    }
    // Un avertissement peut accompagner un succès (miroir en échec, dump local conservé) :
    // le dire sans faire échouer la commande, le dump local reste bon.
    if (resultat.error) {
      this.logger.warning(resultat.error)
    }
  }
}
