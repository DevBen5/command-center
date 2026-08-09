/**
 * Déclarations de types pour `dumps.js`, écrites à la main.
 *
 * ⚠️ Ce module reste volontairement en JavaScript, inchangé (voir son en-tête) :
 * `tests/unit/db_dumps.spec.ts` le couvre déjà, et une réécriture n'a rien à y gagner.
 * Ce fichier existe pour que `commands/db_backup.ts` et `commands/db_restore.ts` — sous
 * `tsc --strict`, sans `allowJs` — puissent l'importer sans en faire une copie.
 *
 * ⚠️ Ce fichier ne se régénère pas : toute nouvelle fonction/export de `dumps.js` doit être
 * ajoutée ICI à la main, sinon `tsc` échoue avec « has no exported member » sur les appelants
 * TypeScript (`backup_service.ts`, `commands/db_backup.ts`, `commands/db_restore.ts`, les
 * specs) — constaté sur CC-223.
 */

export const MOTIF_DUMP: RegExp
export const MOTIF_DUMP_CHIFFRE: RegExp
export const GARDER_PAR_DEFAUT: number

export interface ResultatVerification {
  ok: boolean
  raison?: string
}

export function estDumpChiffre(nom: string): boolean
export function verifierDump(chemin: string): ResultatVerification
export function verifierDumpChiffre(chemin: string): ResultatVerification
export function chiffrerDump(cheminClair: string, clePublique: string): Promise<Buffer>
export function dechiffrerDump(
  cheminChiffre: string,
  clePrivee: string | undefined
): Promise<Buffer>
export function listerDumps(dossier: string): string[]
export function lireGarder(valeur: string | undefined): number
export function dumpsAPurger(noms: string[], garder: number): string[]
