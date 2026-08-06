import { DateTime } from 'luxon'
import type { Session } from '@adonisjs/session'
import User from '#core/auth/models/user'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'
import CoffreVault from '#modules/coffre/models/coffre_vault'
import CoffreEntry, { type CoffreEntryType } from '#modules/coffre/models/coffre_entry'
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

/** Une entrée telle qu'une page la reçoit : déchiffrée, sans une trace du chiffré. */
export interface CoffreEntryView {
  id: number
  type: CoffreEntryType
  title: string
  content: string
  createdAt: string | null
}

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
   * Les entrées d'un compte, déchiffrées.
   *
   * ⚠️ **Une entrée illisible est SIGNALÉE, jamais sautée.** La faire disparaître de la liste
   * donnerait un écran qui paraît complet alors qu'il manque quelque chose — un coffre qui perd
   * une entrée en silence est pire qu'un coffre qui dit avoir mal. On rend un titre de repli et un
   * contenu vide ; l'utilisateur voit qu'il y a un problème sur cette ligne-là.
   *
   * ⚠️ **`created_at desc`, jamais le titre** : il est chiffré, Postgres ne voit que des octets.
   */
  async entriesFor(user: User, key: Buffer): Promise<CoffreEntryView[]> {
    const entries = await CoffreEntry.query()
      .where('owner_id', user.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')

    return entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: decrypt(entry.titleCipher, key) ?? '',
      content: decrypt(entry.contentCipher, key) ?? '',
      createdAt: entry.createdAt?.toISO() ?? null,
    }))
  }

  /** Ajoute une entrée. Le titre est chiffré comme le contenu — voir la migration. */
  async addEntry(
    user: User,
    key: Buffer,
    entry: { type: CoffreEntryType; title: string; content: string }
  ): Promise<CoffreEntry> {
    return CoffreEntry.create({
      ownerId: user.id,
      type: entry.type,
      titleCipher: encrypt(entry.title, key),
      contentCipher: encrypt(entry.content, key),
    })
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
