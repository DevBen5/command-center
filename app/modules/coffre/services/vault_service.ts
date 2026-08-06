import { DateTime } from 'luxon'
import type { Session } from '@adonisjs/session'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { isImmichAssetId } from '#core/shared/services/immich_client'
import User from '#core/auth/models/user'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'
import CoffreVault from '#modules/coffre/models/coffre_vault'
import CoffreEntry, { type CoffreEntryType } from '#modules/coffre/models/coffre_entry'
import CoffreEntryMedia from '#modules/coffre/models/coffre_entry_media'
import CoffreEntryNasFile from '#modules/coffre/models/coffre_entry_nas_file'
import { nasFileKindFor, type NasFileKind } from '#modules/coffre/services/nas_file_format'
import keyring from '#modules/coffre/services/vault_keyring'
import {
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  sealVerifier,
  verifyKey,
} from '#modules/coffre/services/vault_crypto'
import {
  VAULT_UNLOCK_KEY,
  unlockMarkerFor,
  unlockedKeyId,
} from '#modules/coffre/services/vault_session'

/**
 * Une entrée telle qu'une page la reçoit : déchiffrée, sans une trace du chiffré.
 *
 * ⚠️ **Aucun champ de secret ici, et il ne faut pas en ajouter** (CC-179). Un identifiant porte
 * son service dans `title` et son nom d'utilisateur dans `content` ; son mot de passe ne descend
 * au navigateur que par `secretFor`, à la demande, pour une entrée à la fois.
 */
export interface CoffreEntryView {
  id: number
  type: CoffreEntryType
  title: string
  content: string
  createdAt: string | null
  /**
   * ⚠️ **Seul l'`id` de la ligne `coffre_entry_media` voyage jusqu'ici, jamais l'UUID Immich**
   * (CC-180). La page construit `/coffre/media/:id/thumbnail` avec cet `id` ; le serveur seul
   * déchiffre l'UUID, et seulement dans ce proxy. C'est ce qui interdit un remplacement intégral
   * du type `title`/`content` sur l'édition : le client ne peut pas renvoyer ce qu'il n'a jamais
   * reçu — voir `updateEntry` (`mediaAdd`/`mediaRemove`).
   */
  media: { id: number }[]
  /**
   * ⚠️ **Seul l'`id` et le `kind` de la ligne `coffre_entry_nas_file` voyagent jusqu'ici, jamais
   * le chemin sur le disque** (CC-181) — même doctrine que `media`. La page construit
   * `/coffre/nas/:id/stream` avec l'`id`, et choisit `<video>`/`<img>` avec `kind` — le serveur
   * seul déchiffre le chemin, et seulement dans ce proxy. `kind` n'est pas sensible : il ne
   * révèle que la nature du fichier, déjà connue de l'allow-list publique.
   */
  nasFiles: { id: number; kind: NasFileKind }[]
}

/**
 * Ce qu'une demande de secret peut donner.
 *
 * ⚠️ **`illisible` n'est pas `introuvable`, et surtout pas une chaîne vide.** C'est la doctrine du
 * module : un déchiffrement raté est un **refus**, jamais « pas de contenu » (voir le `unreadable`
 * de `TwoFactorService`). Les confondre désarmerait la protection au moment précis où quelque
 * chose d'anormal est arrivé à la base.
 */
export type CoffreSecret =
  { status: 'ok'; secret: string } | { status: 'introuvable' } | { status: 'illisible' }

/**
 * Les colonnes qu'une LISTE a le droit de charger.
 *
 * ⚠️ **`secret_cipher` n'y est pas, et c'est la garantie centrale du lot 2** (CC-179) — pas une
 * optimisation. Tant que la colonne n'est pas dans cette liste, le chiffré n'est jamais chargé,
 * donc le clair n'existe à **aucun instant** en mémoire du serveur pendant un rendu de liste : il
 * n'y a rien à oublier de retirer. Charger la colonne puis la filtrer en JS marcherait
 * aujourd'hui et fuirait au premier `...entry` de complaisance.
 *
 * ⚠️ **Énumérer plutôt que `select('*')` moins un** : une colonne ajoutée demain entre dans un
 * `*`, elle n'entre pas dans une liste. L'oubli va donc vers l'absence, jamais vers la fuite.
 */
const COLONNES_DE_LISTE = [
  'id',
  'owner_id',
  'type',
  'title_cipher',
  'content_cipher',
  'created_at',
  'updated_at',
] as const

/**
 * Ce que la partie « base » du coffre sait faire (CC-178).
 *
 * La cryptographie vit dans `vault_crypto.ts` (pure), le marqueur dans `vault_session.ts` (pur), la
 * clé dans `vault_keyring.ts` (mémoire). Ici : ce qui touche Postgres et la session, c'est-à-dire
 * ce qu'aucun des trois autres ne doit connaître.
 */
class VaultService {
  /** Le coffre de ce compte, ou `null` s'il n'en a pas encore posé. */
  async vaultFor(user: User): Promise<CoffreVault | null> {
    return CoffreVault.query().where('user_id', user.id).first()
  }

  /**
   * Pose le coffre d'un compte et l'ouvre dans la foulée.
   *
   * ⚠️ **L'unicité vient de la base, pas d'un contrôle ici.** Un `if (déjà un coffre) return` ne
   * couvrirait pas deux requêtes concurrentes : les deux liraient « aucun coffre » avant que l'une
   * n'écrive, et le second sel rendrait indéchiffrables les entrées déjà posées **sans lever**.
   * L'index unique sur `user_id` fait échouer la seconde insertion ; l'appelant traduit l'échec.
   */
  async createVault(user: User, passphrase: string, session: Session): Promise<CoffreVault> {
    const kdfSalt = generateSalt()
    const key = deriveKey(passphrase, kdfSalt)

    const vault = await CoffreVault.create({
      userId: user.id,
      kdfSalt,
      verifier: sealVerifier(key),
    })

    this.#open(user, key, session)

    return vault
  }

  /**
   * Ouvre le coffre si la passphrase est la bonne. `false` sinon, sans dire pourquoi.
   *
   * ⚠️ **Un coffre absent rend `false`, jamais une ouverture à vide.** L'appelant a déjà envoyé
   * vers l'écran de création quand il n'y a pas de coffre ; ici, le sens sûr est le refus.
   */
  async unlock(user: User, passphrase: string, session: Session): Promise<boolean> {
    const vault = await this.vaultFor(user)
    if (vault === null) return false

    const key = deriveKey(passphrase, vault.kdfSalt)
    if (!verifyKey(vault.verifier, key)) return false

    this.#open(user, key, session)

    return true
  }

  /** Referme le coffre : la clé part de la mémoire, le marqueur de la session. */
  lock(user: User, session: Session): void {
    keyring.closeAllFor(user.id)
    session.forget(VAULT_UNLOCK_KEY)
  }

  /**
   * La clé ouverte de ce compte, ou `null` — **l'unique porte d'entrée du mur**.
   *
   * Le middleware et les contrôleurs passent tous par là : deux lectures différentes du marqueur
   * finiraient par diverger, et c'est la plus permissive qui gagnerait.
   */
  keyFor(user: User, session: Session, now: DateTime = DateTime.now()): Buffer | null {
    const keyId = unlockedKeyId(
      session.get(VAULT_UNLOCK_KEY),
      user.id,
      session.get(LOGIN_STAMP_KEY),
      now
    )
    if (keyId === null) return null

    return keyring.keyFor(keyId, user.id, now)
  }

  /**
   * La requête que la liste exécute — **publique pour être INSPECTABLE**, pas pour être appelée
   * ailleurs (CC-179).
   *
   * ⚠️ **Sans elle, la promesse du lot 2 n'était mesurable qu'à son résultat, et c'est
   * insuffisant.** Deux mécanismes indépendants empêchent le mot de passe d'atteindre le
   * navigateur : cette liste de colonnes, et le fait qu'`entriesFor` construise une vue qui n'a
   * pas de champ pour lui. Retirer le `select` laisserait donc **toute** la suite verte — c'est
   * exactement la situation que `coffre_wall.spec.ts` a mesurée sur le middleware du mur, où dix
   * tests restaient verts parce qu'un second garde rendait le même refus. Un test qui mesure un
   * comportement ne prouve pas le mécanisme qui le tient : `coffre_credentials.spec.ts` lit donc
   * le SQL, comme le test du mur lit le routeur.
   *
   * ⚠️ **`created_at desc`, jamais le titre** : il est chiffré, Postgres ne voit que des octets.
   */
  listQueryFor(userId: number) {
    return CoffreEntry.query()
      .select([...COLONNES_DE_LISTE])
      .where('owner_id', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
  }

  /**
   * Les entrées d'un compte, déchiffrées.
   *
   * ⚠️ **Une entrée illisible est SIGNALÉE, jamais sautée.** La faire disparaître de la liste
   * donnerait un écran qui paraît complet alors qu'il manque quelque chose — un coffre qui perd
   * une entrée en silence est pire qu'un coffre qui dit avoir mal. On rend un titre de repli et un
   * contenu vide ; l'utilisateur voit qu'il y a un problème sur cette ligne-là.
   *
   * ⚠️ **Le mot de passe d'un identifiant n'est PAS chargé** (CC-179) — voir `COLONNES_DE_LISTE`.
   * C'est la promesse du lot 2, et elle est tenue par la requête, pas par ce qui suit.
   */
  async entriesFor(user: User, key: Buffer): Promise<CoffreEntryView[]> {
    const entries = await this.listQueryFor(user.id)
    const mediaByEntry = await this.#mediaIdsByEntry(user.id)
    const nasFilesByEntry = await this.#nasFileIdsByEntry(user.id)

    return entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: decrypt(entry.titleCipher, key) ?? '',
      content: decrypt(entry.contentCipher, key) ?? '',
      createdAt: entry.createdAt?.toISO() ?? null,
      media: mediaByEntry.get(entry.id) ?? [],
      nasFiles: nasFilesByEntry.get(entry.id) ?? [],
    }))
  }

  /**
   * Les médias de CHAQUE entrée d'un compte, en une seule requête — plutôt qu'une par entrée.
   *
   * ⚠️ **`asset_id_cipher` n'est PAS sélectionnée, même doctrine que `COLONNES_DE_LISTE`** : rien
   * n'a besoin de l'UUID pour construire une liste, donc rien ne le charge. Seul le proxy de
   * vignette le déchiffre, une ligne à la fois.
   */
  async #mediaIdsByEntry(userId: number): Promise<Map<number, { id: number }[]>> {
    const rows = await CoffreEntryMedia.query()
      .select(['id', 'entry_id'])
      .where('owner_id', userId)
      .orderBy('id', 'asc')

    const byEntry = new Map<number, { id: number }[]>()
    for (const row of rows) {
      const list = byEntry.get(row.entryId) ?? []
      list.push({ id: row.id })
      byEntry.set(row.entryId, list)
    }

    return byEntry
  }

  /**
   * Les médias NAS de CHAQUE entrée d'un compte, en une seule requête — même doctrine que
   * `#mediaIdsByEntry` (CC-181).
   *
   * ⚠️ **`path_cipher` n'est PAS sélectionnée** : rien n'a besoin du chemin pour construire une
   * liste, donc rien ne le charge. Seul le proxy de streaming le déchiffre, une ligne à la fois.
   * `kind`, lui, EST sélectionné : ce n'est pas le secret que cette liste protège (voir la
   * migration), et c'est ce qui permet à l'écran de choisir `<video>`/`<img>` sans déchiffrer.
   */
  async #nasFileIdsByEntry(
    userId: number
  ): Promise<Map<number, { id: number; kind: NasFileKind }[]>> {
    const rows = await CoffreEntryNasFile.query()
      .select(['id', 'entry_id', 'kind'])
      .where('owner_id', userId)
      .orderBy('id', 'asc')

    const byEntry = new Map<number, { id: number; kind: NasFileKind }[]>()
    for (const row of rows) {
      const list = byEntry.get(row.entryId) ?? []
      list.push({ id: row.id, kind: row.kind })
      byEntry.set(row.entryId, list)
    }

    return byEntry
  }

  /**
   * Le mot de passe d'UNE entrée, à la demande — l'unique chemin par lequel un secret descend
   * jusqu'au navigateur (CC-179).
   *
   * ⚠️ **`owner_id` est dans la clause**, comme pour la suppression : un identifiant deviné ne
   * doit pas atteindre l'entrée de quelqu'un d'autre, et il n'y a alors rien à comparer donc rien
   * à oublier de comparer.
   *
   * ⚠️ **Une entrée qui n'est pas un identifiant est `introuvable`, pas « secret vide ».** Il n'y
   * a pas de secret à révéler sur une note ; répondre une chaîne vide inviterait l'écran à
   * afficher un mot de passe blanc.
   */
  async secretFor(user: User, key: Buffer, id: number): Promise<CoffreSecret> {
    const entry = await CoffreEntry.query().where('id', id).where('owner_id', user.id).first()

    if (entry === null || entry.type !== 'credential' || entry.secretCipher === null) {
      return { status: 'introuvable' }
    }

    const secret = decrypt(entry.secretCipher, key)
    if (secret === null) return { status: 'illisible' }

    return { status: 'ok', secret }
  }

  /**
   * L'UUID Immich d'UNE référence de média, pour le proxy de vignette — l'unique endroit qui le
   * déchiffre (CC-180).
   *
   * ⚠️ **`owner_id` est dans la clause de lecture**, même doctrine que `secretFor` : un identifiant
   * deviné ne trouve rien pour un autre compte, donc rien à comparer et rien à oublier de
   * comparer. `null` couvre indistinctement « ligne introuvable », « déchiffrement raté » et
   * « forme invalide » — la même distinction que veille fait entre « pas de média » et une panne
   * Immich se rejoue ensuite côté contrôleur (log détaillé, 404 uniforme au client).
   */
  async mediaThumbnailAssetId(user: User, key: Buffer, mediaId: number): Promise<string | null> {
    const media = await CoffreEntryMedia.query()
      .where('id', mediaId)
      .where('owner_id', user.id)
      .first()
    if (media === null) return null

    const assetId = decrypt(media.assetIdCipher, key)
    return assetId !== null && isImmichAssetId(assetId) ? assetId : null
  }

  /**
   * Le chemin relatif d'UNE référence de média NAS, pour le proxy de streaming — l'unique endroit
   * qui le déchiffre (CC-181).
   *
   * ⚠️ **`owner_id` est dans la clause de lecture**, même doctrine que `mediaThumbnailAssetId` :
   * un identifiant deviné ne trouve rien pour un autre compte. `null` couvre indistinctement
   * « ligne introuvable » et « déchiffrement raté » — la résolution contre les racines autorisées
   * (`NasRootsService`) se rejoue ensuite côté contrôleur, jamais ici : cette méthode ne touche
   * pas au disque, seulement à la base et au chiffrement.
   */
  async nasFilePathFor(user: User, key: Buffer, nasFileId: number): Promise<string | null> {
    const file = await CoffreEntryNasFile.query()
      .where('id', nasFileId)
      .where('owner_id', user.id)
      .first()
    if (file === null) return null

    return decrypt(file.pathCipher, key)
  }

  /**
   * Ajoute une entrée. Le titre est chiffré comme le contenu — voir la migration.
   *
   * ⚠️ **Le mot de passe n'est écrit que pour un `credential`**, quoi qu'ait envoyé le
   * formulaire. Le validateur le rend obligatoire sur cette nature-là mais n'interdit pas de le
   * poster avec une note ; c'est **ici** que ça se tranche, pour qu'une colonne de secret ne
   * s'attache jamais à une entrée dont l'écran ne proposera jamais de la révéler — un chiffré que
   * plus rien ne lit, mais que chaque sauvegarde emporterait.
   */
  async addEntry(
    user: User,
    key: Buffer,
    entry: {
      type: CoffreEntryType
      title: string
      content: string
      password?: string
      media?: string[]
      nasFiles?: string[]
    }
  ): Promise<CoffreEntry> {
    const secret = entry.type === 'credential' ? (entry.password ?? null) : null

    return db.transaction(async (trx) => {
      const created = await CoffreEntry.create(
        {
          ownerId: user.id,
          type: entry.type,
          titleCipher: encrypt(entry.title, key),
          contentCipher: encrypt(entry.content, key),
          secretCipher: secret === null ? null : encrypt(secret, key),
        },
        { client: trx }
      )

      await this.#attachMedia(trx, user.id, created.id, entry.media ?? [], key)
      await this.#attachNasFiles(trx, user.id, created.id, entry.nasFiles ?? [], key)

      return created
    })
  }

  /**
   * Modifie une entrée existante : remplace, ne fusionne pas — comme partout ailleurs dans le
   * dépôt (CC-186). Rien ne rend cette édition « lisible » : elle rechiffre avec la clé de
   * session élevée, exactement comme une création.
   *
   * ⚠️ **`owner_id` est dans la clause de lecture, jamais vérifié après coup** — même doctrine que
   * `deleteEntry` et `secretFor` : un identifiant deviné ne trouve rien, donc rien à comparer.
   * L'entrée absente ou d'un autre compte produit un no-op silencieux ; l'appelant redirige dans
   * tous les cas, pour que l'édition ne soit pas plus un oracle d'existence que la suppression.
   *
   * ⚠️ **Le mot de passe n'est réécrit que s'il est fourni ET non vide, et seulement sur un
   * `credential`.** Un champ vide veut dire « garde l'actuel » : cette méthode ne charge ni ne
   * déchiffre l'ancien secret pour le décider, elle regarde seulement ce que le formulaire vient
   * de poster. Un mot de passe posté en éditant une note ou un lien est sans effet — le type de
   * l'entrée, lu en base, tranche.
   *
   * ⚠️ **`media.add`/`media.remove` sont additifs, PAS un remplacement intégral comme
   * `title`/`content`** (CC-180) — décision délibérée, pas un oubli de la doctrine « remplace, ne
   * fusionne pas » du reste du module. Elle suppose que le client peut renvoyer l'état courant en
   * entier, ce qui est vrai pour `title`/`content` (envoyés en clair à la liste) et faux ici :
   * l'UUID Immich ne redescend JAMAIS vers le client (voir `CoffreEntryView.media`), donc rien ne
   * permettrait de le lui faire réémettre pour un remplacement complet. Même famille de raison
   * que `password`, qui reste vide = « ne change rien ».
   */
  async updateEntry(
    user: User,
    key: Buffer,
    id: number,
    patch: {
      title: string
      content: string
      password?: string
      media?: { add?: string[]; remove?: number[] }
      nasFiles?: { add?: string[]; remove?: number[] }
    }
  ): Promise<void> {
    await db.transaction(async (trx) => {
      const entry = await CoffreEntry.query({ client: trx })
        .where('id', id)
        .where('owner_id', user.id)
        .first()
      if (entry === null) return

      entry.titleCipher = encrypt(patch.title, key)
      entry.contentCipher = encrypt(patch.content, key)

      if (entry.type === 'credential' && patch.password) {
        entry.secretCipher = encrypt(patch.password, key)
      }

      await entry.useTransaction(trx).save()

      // ⚠️ Scopé `entry_id` + `owner_id` : un id posté qui n'appartient pas à cette entrée (la
      // sienne ou celle d'un autre compte) ne supprime rien — no-op silencieux, même doctrine que
      // la suppression d'entrée.
      const mediaRemove = patch.media?.remove ?? []
      if (mediaRemove.length > 0) {
        await CoffreEntryMedia.query({ client: trx })
          .where('entry_id', entry.id)
          .where('owner_id', user.id)
          .whereIn('id', mediaRemove)
          .delete()
      }

      await this.#attachMedia(trx, user.id, entry.id, patch.media?.add ?? [], key)

      // ⚠️ Même doctrine que `media` ci-dessus (CC-181) : additif/soustractif, scopé.
      const nasFilesRemove = patch.nasFiles?.remove ?? []
      if (nasFilesRemove.length > 0) {
        await CoffreEntryNasFile.query({ client: trx })
          .where('entry_id', entry.id)
          .where('owner_id', user.id)
          .whereIn('id', nasFilesRemove)
          .delete()
      }

      await this.#attachNasFiles(trx, user.id, entry.id, patch.nasFiles?.add ?? [], key)
    })
  }

  /**
   * Insère les nouvelles références de médias d'une entrée. Dédupe les UUID répétés dans un même
   * lot — coller deux fois le même asset ne doit pas poser deux vignettes identiques.
   *
   * ⚠️ **Normalisé en minuscules avant la dédup ET le chiffrement** : `isImmichAssetId` accepte
   * les deux casses, donc deux UUID identiques à la casse près échapperaient sinon au `Set`.
   */
  async #attachMedia(
    trx: TransactionClientContract,
    ownerId: number,
    entryId: number,
    assetIds: string[],
    key: Buffer
  ): Promise<void> {
    const uniques = [
      ...new Set(
        assetIds
          .filter((assetId) => isImmichAssetId(assetId))
          .map((assetId) => assetId.toLowerCase())
      ),
    ]

    for (const assetId of uniques) {
      await CoffreEntryMedia.create(
        { ownerId, entryId, assetIdCipher: encrypt(assetId, key) },
        { client: trx }
      )
    }
  }

  /**
   * Insère les nouvelles références de médias NAS d'une entrée. Dédupe les chemins répétés dans un
   * même lot — coller deux fois le même chemin ne doit pas poser deux lignes identiques.
   *
   * ⚠️ **PAS de normalisation de casse, contrairement à `#attachMedia`.** Un UUID Immich est
   * insensible à la casse par construction ; un chemin de fichier sur le NAS ne l'est pas — le
   * mettre en minuscules changerait un chemin réel en un chemin qui n'existe plus. La dédup porte
   * donc sur la chaîne exacte.
   *
   * ⚠️ **`kind` est dérivé ICI, jamais posté par le client** — même doctrine que `type` sur
   * `addEntry` : un chemin dont l'extension n'est pas dans l'allow-list (`nasFileKindFor` rend
   * `null`) est silencieusement écarté, seconde barrière derrière le validateur.
   */
  async #attachNasFiles(
    trx: TransactionClientContract,
    ownerId: number,
    entryId: number,
    paths: string[],
    key: Buffer
  ): Promise<void> {
    const uniques = [...new Set(paths)]

    for (const path of uniques) {
      const kind = nasFileKindFor(path)
      if (kind === null) continue

      await CoffreEntryNasFile.create(
        { ownerId, entryId, pathCipher: encrypt(path, key), kind },
        { client: trx }
      )
    }
  }

  /**
   * Supprime une entrée de ce compte. `false` si elle n'existe pas — ou n'est pas la sienne.
   *
   * ⚠️ **`owner_id` est dans la clause, jamais vérifié après coup.** C'est ce qui empêche un
   * identifiant deviné d'atteindre l'entrée de quelqu'un d'autre : la requête ne la trouve pas,
   * il n'y a rien à comparer et rien à oublier de comparer.
   */
  async deleteEntry(user: User, id: number): Promise<boolean> {
    const supprimees = await CoffreEntry.query().where('id', id).where('owner_id', user.id).delete()

    return Number(supprimees[0] ?? 0) > 0
  }

  /**
   * ⚠️ **Toute ouverture referme la précédente.** Sans ça, une seconde ouverture laisserait la
   * clé d'avant vivre jusqu'à son échéance sans qu'aucun marqueur ne la désigne — et si la
   * passphrase a changé entre-temps, deux clés différentes coexisteraient pour le même compte.
   */
  #open(user: User, key: Buffer, session: Session): void {
    keyring.closeAllFor(user.id)

    const keyId = keyring.open(user.id, key)
    session.put(VAULT_UNLOCK_KEY, unlockMarkerFor(user.id, keyId))
  }
}

export default new VaultService()
