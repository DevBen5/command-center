/**
 * Déclarations de types pour `dumps.js`, écrites à la main.
 *
 * ⚠️ Ce module reste volontairement en JavaScript, inchangé (voir son en-tête) : les 19 tests
 * de `tests/unit/db_dumps.spec.ts` le couvrent déjà, et une réécriture n'a rien à y gagner.
 * Ce fichier existe pour que `commands/db_backup.ts` et `commands/db_restore.ts` — sous
 * `tsc --strict`, sans `allowJs` — puissent l'importer sans en faire une copie.
 */

export const MOTIF_DUMP: RegExp
export const GARDER_PAR_DEFAUT: number

export interface ResultatVerification {
  ok: boolean
  raison?: string
}

export function verifierDump(chemin: string): ResultatVerification
export function listerDumps(dossier: string): string[]
export function lireGarder(valeur: string | undefined): number
export function dumpsAPurger(noms: string[], garder: number): string[]
