import vine from '@vinejs/vine'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#core/auth/constants/password_rules'

/**
 * Les validateurs du coffre (CC-178).
 *
 * ⚠️ **La longueur de la passphrase relit `password_rules.ts`, elle n'en invente pas une seconde.**
 * C'est la doctrine de CC-147 : une règle de longueur écrite à deux endroits diverge sans qu'aucun
 * test ne rougisse. Et ce n'est pas cette borne qui porte la sécurité du coffre — c'est le coût de
 * `scrypt` (`vault_crypto.ts`), qui rend chaque essai cher quelle que soit la longueur choisie.
 */

/**
 * ⚠️ **Des FABRIQUES, jamais des nœuds partagés — et ça a mordu.** Un schéma VineJS se construit
 * en **mutant** l'objet sur lequel on chaîne : avec une constante partagée, le `.confirmed()` de
 * la création se serait aussi appliqué à l'ouverture, qui aurait alors exigé un
 * `passphrase_confirmation` que le formulaire d'ouverture n'envoie pas. Mesuré : l'ouverture
 * échouait en refusant « les deux champs doivent être identiques », et le refus était
 * **indiscernable d'une passphrase fausse** — même redirection, même message.
 *
 * ⚠️ La passphrase n'est **pas** `trim()`ée : un espace de tête ou de fin en fait partie, et le
 * retirer changerait la clé dérivée d'un coffre existant.
 */
const passphrase = () => vine.string().minLength(MIN_PASSWORD_LENGTH).maxLength(MAX_PASSWORD_LENGTH)

/** Le code TOTP seul — jamais un code de secours, voir `coffre_door_controller`. */
const totpCode = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{6}$/)

/** Poser le coffre : la passphrase, sa confirmation, et le second facteur. */
export const vaultCreationValidator = vine.compile(
  vine.object({
    passphrase: passphrase().confirmed(),
    code: totpCode(),
  })
)

/** L'ouvrir : les deux facteurs, sans confirmation. */
export const vaultUnlockValidator = vine.compile(
  vine.object({
    passphrase: passphrase(),
    code: totpCode(),
  })
)

/**
 * Une entrée du coffre.
 *
 * ⚠️ **`url` n'est pas validée comme une URL, et surtout pas résolue.** Le serveur n'ira jamais la
 * chercher — ce n'est pas une source de veille, c'est un signet chiffré. Y poser une garde SSRF
 * suggérerait qu'un appel réseau existe quelque part ; il n'y en a aucun dans ce module.
 */
export const entryValidator = vine.compile(
  vine.object({
    type: vine.enum(['note', 'url'] as const),
    title: vine.string().trim().minLength(1).maxLength(200),
    content: vine.string().trim().minLength(1).maxLength(20_000),
  })
)
