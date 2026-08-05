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
