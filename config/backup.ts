import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'

/**
 * Chemins FIXES du conteneur pour la sauvegarde (CC-140).
 *
 * ⚠️ Volontairement des constantes, jamais lues depuis `.env` ni la base : c'est le dossier de
 * sauvegarde et le miroir qui doivent être des chemins fixes, montés une fois par le compose
 * (`BACKUP_DIR_PATH` / `BACKUP_MIRROR_DIR_PATH` côté hôte, voir `docker-compose.prod.yml`),
 * exactement comme `/var/lib/postgresql/data` pour Postgres. Un formulaire acceptant un chemin
 * arbitraire réintroduirait le risque qu'un chemin accepté ne corresponde à aucun volume monté
 * — voir le CLAUDE.md racine.
 *
 * Le dossier de sauvegarde doit EXISTER, il n'est jamais créé — même règle que
 * `BACKUP_MIRROR_DIR` sur le poste de dev, désormais uniforme sur les deux chemins.
 */
export const BACKUP_DIR = '/data/backups'
export const BACKUP_MIRROR_DIR = '/data/backup-mirror'

/**
 * Le chiffrement des dumps (CC-223), passé par la config plutôt que lu dans l'environnement
 * (CC-231).
 *
 * ⚠️ **Contrairement aux deux chemins ci-dessus, celle-ci vient bien de `.env`** — et c'est
 * exactement pour ça qu'elle doit passer par ici : `BackupService` la lisait en `env.get(...)`
 * direct, donc hors de toute isolation. Sur un poste qui a réellement activé CC-223, la fusion
 * par *truthiness* d'`@adonisjs/env` (CC-88) la faisait entrer sous `NODE_ENV=test` — `.env.test`
 * ne la déclare pas, le `.env` réel passait derrière — et la suite chiffrait avec la clé du
 * propriétaire, en rougissant sur le seul test qui couvre le comportement par défaut.
 *
 * ⚠️ **Même frontière que `config/coffre_nas.ts`, et pour la même raison — pas parce que ce
 * serait un « service externe ».** Aucun appel réseau ici : c'est la contamination par
 * truthiness qui menace n'importe quelle variable, client externe ou non.
 *
 * ⚠️ **Ne « simplifie » pas en rétablissant `env.get('BACKUP_ENCRYPTION_RECIPIENT')` dans le
 * service.** Rien ne le signalerait : la CI n'a aucun `.env`, elle restera verte sur ce défaut
 * — c'est précisément ce qui l'a laissé passer pendant tout CC-223, review comprise.
 */
export interface BackupEncryptionConfig {
  /** Clé publique age (`age1...`), ou `undefined` quand le chiffrement n'est pas configuré. */
  recipient: string | undefined
}

/** Valeur brute telle que lue dans l'environnement, avant nettoyage. */
export interface RawBackupEncryptionConfig {
  recipient?: string
}

/**
 * Fonction **pure**, séparée de la lecture d'`env` — même raison que `normalizeCoffreNasConfig` :
 * un module qui calcule tout à l'import ne se teste pas.
 *
 * ⚠️ `|| undefined`, PAS `?? undefined` : `Env.schema.string.optional()` traduit bien `VAR=` en
 * `undefined`, mais PAS `VAR="   "`, qui arrive ici en `'   '` puis devient `''` au `trim()`. Ce
 * `''` est falsy — aucun chiffrement n'aurait lieu — tout en étant `!== undefined`, donc
 * `BackupService.status()` annoncerait le chiffrement CONFIGURÉ sur l'écran d'administration
 * pendant que les dumps partent en clair.
 */
export function normalizeBackupEncryptionConfig(
  raw: RawBackupEncryptionConfig
): BackupEncryptionConfig {
  const recipient = (raw.recipient ?? '').trim()

  return { recipient: recipient || undefined }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101, CC-231).
 *
 * ⚠️ **La garde est ici et pas dans `normalizeBackupEncryptionConfig`**, pour la même raison que
 * côté Immich et coffre : les tests qui doivent prouver le chiffrement construisent leur propre
 * `BackupService` avec un `recipient` explicite, engendré pour la durée du test — c'est le SEUL
 * chemin qui exerce le chiffrement en test, sur le patron de `NasRootsService` substitué avec des
 * racines de fixtures.
 */
export function backupEncryptionConfigFrom(
  nodeEnv: string | undefined,
  raw: RawBackupEncryptionConfig
): BackupEncryptionConfig {
  return normalizeBackupEncryptionConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const backupEncryptionConfig = backupEncryptionConfigFrom(env.get('NODE_ENV'), {
  recipient: env.get('BACKUP_ENCRYPTION_RECIPIENT'),
})

export default backupEncryptionConfig
