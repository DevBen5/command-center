import vine from '@vinejs/vine'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#core/auth/constants/password_rules'

/**
 * Les références de médias Immich (CC-180). Un UUID générique, pas `.uuid()` de VineJS : c'est la
 * même forme que `isImmichAssetId` du core, et il vaut mieux une seule définition cohérente entre
 * validation d'entrée et vérification de sortie plutôt que deux notions de « UUID valide ».
 *
 * ⚠️ **20 éléments au maximum** — un garde-fou contre un collage accidentel massif, pas une
 * limite produit : rien dans le module n'a besoin d'un plafond plus bas.
 */
const IMMICH_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEDIA_MAX = 20

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
 * Le mot de passe d'un identifiant (CC-179).
 *
 * ⚠️ **Il n'est PAS `trim()`é**, contrairement au titre et au contenu, et pour la même raison que
 * la passphrase ci-dessus : un espace de tête ou de fin fait partie du mot de passe. Le retirer
 * enregistrerait autre chose que ce que l'utilisateur a collé, et personne ne le verrait — le
 * champ ne se relit jamais à l'écran.
 *
 * ⚠️ **Le champ s'appelle `password`, et ce n'est pas cosmétique.** `@adonisjs/session` rejoue le
 * corps soumis dans la session sur toute erreur de validation, en excluant quatre clés en dur
 * dont `password` (voir `app/core/shared/exceptions/handler.ts`, qui ferme le cas général).
 * Porter ce nom-là ajoute une seconde barrière, indépendante de la nôtre.
 *
 * ⚠️ **Pas de longueur minimale au-delà de 1, délibérément.** Ce n'est pas un mot de passe qu'on
 * choisit ici, c'est un mot de passe qu'on **range** : celui d'un service tiers, dont les règles
 * ne sont pas les nôtres. Refuser un code à quatre chiffres imposé par une banque rendrait le
 * coffre inutilisable pour le cas qu'il sert.
 */
const password = () => vine.string().minLength(1).maxLength(1_000)

/**
 * Une entrée du coffre.
 *
 * ⚠️ **`url` n'est pas validée comme une URL, et surtout pas résolue.** Le serveur n'ira jamais la
 * chercher — ce n'est pas une source de veille, c'est un signet chiffré. Y poser une garde SSRF
 * suggérerait qu'un appel réseau existe quelque part ; il n'y en a aucun dans ce module.
 *
 * ⚠️ **Pour un `credential`, `title` est le SERVICE et `content` le NOM D'UTILISATEUR** — la
 * correspondance vit ici, dans le modèle et dans l'écran, jamais en base.
 *
 * ⚠️ **`requiredWhen` rend le mot de passe obligatoire, il n'INTERDIT rien sur les autres
 * natures** : un `password` posté avec une note passe la validation. C'est `VaultService.addEntry`
 * qui tranche et n'écrit la colonne que pour un identifiant — un validateur qui refuserait le
 * champ en trop rendrait un message d'erreur là où il n'y a rien à corriger côté utilisateur.
 */
export const entryValidator = vine.compile(
  vine.object({
    type: vine.enum(['note', 'url', 'credential'] as const),
    title: vine.string().trim().minLength(1).maxLength(200),
    content: vine.string().trim().minLength(1).maxLength(20_000),
    password: password().optional().requiredWhen('type', '=', 'credential'),
    // Les médias à attacher dès la création — voir `VaultService.addEntry` (CC-180).
    media: vine.array(vine.string().regex(IMMICH_ASSET_ID)).maxLength(MEDIA_MAX).optional(),
  })
)

/**
 * Modifier une entrée (CC-186). ⚠️ **Pas de champ `type` dans ce schéma** : une entrée ne change
 * pas de nature après coup, et VineJS ignore les propriétés non déclarées — le service ne verra
 * donc jamais de `type` posté, quoi qu'envoie le client.
 *
 * ⚠️ **`password` n'a PAS de longueur minimale ici, contrairement à `password()` ci-dessus.** Un
 * champ vide veut dire « ne pas changer le mot de passe existant », jamais « l'effacer ». C'est
 * `VaultService.updateEntry` qui tranche ce que « vide » signifie ; ce validateur se contente de
 * laisser passer la chaîne vide plutôt que de la refuser comme une saisie incomplète.
 */
const passwordOuVide = () => vine.string().maxLength(1_000).optional()

/**
 * ⚠️ **`mediaAdd`/`mediaRemove`, jamais un `media` unique de remplacement** (CC-180) — voir
 * `VaultService.updateEntry` pour la raison : l'UUID Immich ne redescend jamais vers le client,
 * qui ne peut donc pas réémettre l'état courant pour un remplacement intégral, contrairement à
 * `title`/`content`.
 */
export const entryUpdateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200),
    content: vine.string().trim().minLength(1).maxLength(20_000),
    password: passwordOuVide(),
    media: vine
      .object({
        add: vine.array(vine.string().regex(IMMICH_ASSET_ID)).maxLength(MEDIA_MAX).optional(),
        remove: vine.array(vine.number().positive()).maxLength(MEDIA_MAX).optional(),
      })
      .optional(),
  })
)
