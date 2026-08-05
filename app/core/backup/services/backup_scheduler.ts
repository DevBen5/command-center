import logger from '@adonisjs/core/services/logger'
import backupService from '#core/backup/services/backup_service'
import backupSettings from '#core/backup/services/backup_settings_service'

/**
 * Le déclenchement de la sauvegarde automatique quotidienne (CC-140) — même patron que
 * `veille_scheduler` : aucune infrastructure de job dans ce projet, une boucle dans le
 * processus, démarrée par un provider.
 *
 * ⚠️ **« Due » se déduit de l'âge du dernier dump du dossier de sauvegarde, pas d'une colonne
 * `last_backup_at`.** Le nom d'un dump EST son horodatage (`MOTIF_DUMP`) : une seconde source de
 * vérité en base aurait pu diverger du contenu réel du dossier (dump supprimé à la main, par
 * exemple). Conséquence recherchée : la boucle est auto-réparatrice après un arrêt prolongé —
 * aucun dump depuis 3 jours = due, sans distinguer « jamais lancée » de « en retard ».
 */
const TICK_MS = 60 * 60 * 1000
const UNE_JOURNEE_MS = 24 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let running = false

async function estDue(): Promise<boolean> {
  const { dailyEnabled } = await backupSettings.current()
  if (!dailyEnabled) return false

  const dumps = await backupService.list()
  if (dumps.length === 0) return true

  const dernier = dumps.reduce((plusRecent, dump) =>
    dump.mtimeMs > plusRecent.mtimeMs ? dump : plusRecent
  )
  return Date.now() - dernier.mtimeMs >= UNE_JOURNEE_MS
}

async function tick(): Promise<void> {
  if (running) return

  running = true
  try {
    if (!(await estDue())) return

    const resultat = await backupService.runBackup()
    if (!resultat.ok) {
      logger.error(`Sauvegarde automatique : ${resultat.error}`)
      return
    }
    logger.info(`Sauvegarde automatique : ${resultat.file}`)
  } catch (error) {
    logger.error({ err: error }, 'Sauvegarde automatique : la passe a échoué.')
  } finally {
    running = false
  }
}

/** Démarre la boucle. Idempotent : un second appel ne crée pas un second timer. */
export function startBackupScheduler(): void {
  if (timer !== null) return

  timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  timer.unref()

  void tick()
}

export function stopBackupScheduler(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}
