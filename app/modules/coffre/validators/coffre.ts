import vine from '@vinejs/vine'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#core/auth/constants/password_rules'
import { NAS_EXTENSIONS } from '#modules/coffre/services/nas_file_format'
import { MAX_NAS_UPLOAD_BYTES } from '#modules/coffre/services/nas_upload_limits'

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
 * Un chemin relatif de média NAS — photo ou vidéo (CC-181) — **première ligne de défense
 * seulement**. La seule qui compte est `NasRootsService.resolve`, qui compare après `realpath`
 * (voir son fichier) : cette regex ne fait qu'empêcher d'écrire en base une forme manifestement
 * hostile, avant même d'y arriver.
 *
 * Refuse : un chemin absolu (`/etc/passwd`), une lettre de lecteur Windows (`C:\...`), une
 * traversée (`..`), l'antislash (un seul séparateur, `/`, pour une forme stockée cohérente) et
 * l'octet nul. Exige une extension de l'allow-list partagée avec le serveur de contenu — vidéo ET
 * photo, la même garde de chemin sert les deux (amendement du ticket du 2026-08-06).
 */
const NAS_PATH = new RegExp(
  `^(?!/)(?![a-zA-Z]:)(?!.*\\.\\.)(?!.*\\\\)(?!.*\\x00).+\\.(${NAS_EXTENSIONS.join('|')})$`,
  'i'
)
const NAS_FILE_MAX = 20

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
    // Les médias NAS (photo ou vidéo) à attacher dès la création (CC-181) — même doctrine que
    // `media`, la nature (`kind`) se dérive du chemin, jamais postée par le client.
    nasFiles: vine.array(vine.string().regex(NAS_PATH)).maxLength(NAS_FILE_MAX).optional(),
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
    // ⚠️ `add`/`remove`, jamais un remplacement intégral — même raison que `media` (CC-180) : le
    // chemin ne redescend jamais vers le client, qui ne peut donc pas réémettre l'état complet.
    nasFiles: vine
      .object({
        add: vine.array(vine.string().regex(NAS_PATH)).maxLength(NAS_FILE_MAX).optional(),
        remove: vine.array(vine.number().positive()).maxLength(NAS_FILE_MAX).optional(),
      })
      .optional(),
  })
)

/**
 * L'écriture sur le NAS (CC-240). `root`/`path`/`targetPath` traversent `resolveInRoot` — c'est
 * LUI la vraie garde de confinement (traversée, chemin absolu, lien sortant). Ces bornes de
 * longueur ne sont qu'un premier filet contre un abus manifeste, même doctrine que `NAS_PATH`
 * ci-dessus vis-à-vis de `NasRootsService.resolve`.
 *
 * ⚠️ **`newName`/le nom de fichier envoyé ne passent PAS par ces champs** — ils sont validés à
 * part par `isValidNasFileName` (`services/nas_filename.ts`), jamais par une regex ici : un nom de
 * fichier n'a aucune raison de porter une extension de l'allow-list media (`NAS_PATH`), ce n'est
 * pas une pièce jointe, c'est un gestionnaire de fichiers généraliste.
 */
const nasRootName = () => vine.string().trim().minLength(1).maxLength(100)
/**
 * ⚠️ **`.optional()`, délibérément** : `''` désigne la RACINE d'un dossier (le contrat déjà tenu
 * par `nas_folder_browser.ts`), mais `config/bodyparser.ts` convertit toute chaîne vide en `null`
 * (`convertEmptyStringsToNull`) AVANT que ce validateur ne la voie. Sans `.optional()`, un client
 * qui veut viser la racine ('') se verrait refuser sa requête (champ requis manquant) au lieu
 * d'atteindre le service — `payload.path ?? ''` au point d'appel restaure le sens voulu.
 */
const nasFolderPath = () => vine.string().trim().maxLength(4000).optional()
const nasEntryPath = () => vine.string().trim().minLength(1).maxLength(4000)
const nasFileName = () => vine.string().trim().minLength(1).maxLength(255)

export const nasUploadValidator = vine.compile(
  vine.object({
    root: nasRootName(),
    path: nasFolderPath(),
    file: vine.file({ size: MAX_NAS_UPLOAD_BYTES }),
  })
)

export const nasRenameValidator = vine.compile(
  vine.object({
    root: nasRootName(),
    path: nasEntryPath(),
    newName: nasFileName(),
  })
)

export const nasMoveValidator = vine.compile(
  vine.object({
    root: nasRootName(),
    path: nasEntryPath(),
    targetRoot: nasRootName(),
    targetPath: nasFolderPath(),
  })
)

export const nasDeleteValidator = vine.compile(
  vine.object({
    root: nasRootName(),
    path: nasEntryPath(),
  })
)
