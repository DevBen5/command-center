import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import encryption from '@adonisjs/core/services/encryption'
import User from '#core/auth/models/user'
import UserRecoveryCode from '#core/auth/models/user_recovery_code'
import { currentStep, generateSecret, otpauthUri, verify } from '#core/auth/services/totp'

/** Combien de codes de secours une génération produit. */
const RECOVERY_CODES_COUNT = 10

/**
 * L'alphabet des codes de secours — les 26 lettres **sans `I` ni `O`**, les chiffres **sans
 * `0` ni `1`**. Soit exactement 32 caractères, et c'est ce qui compte deux fois.
 *
 * Ces codes sont recopiés à la main, souvent depuis un papier, par quelqu'un qui vient de
 * perdre son téléphone : c'est le pire moment pour hésiter entre un zéro et un O. Le `L`
 * reste, lui, puisque le `1` avec lequel on le confond n'est pas de la partie.
 *
 * ⚠️ **32 exactement, jamais 31 complété d'un doublon** : le tirage est `octet % 32`, non
 * biaisé parce que 256 en est un multiple. Un caractère présent deux fois sortirait deux fois
 * plus souvent — de l'entropie perdue sans que rien ne le signale.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Le résultat d'une vérification de code TOTP, et les trois cas qu'il faut distinguer. */
export type TotpVerdict =
  | { status: 'ok' }
  | { status: 'invalid' }
  /**
   * ⚠️ **Le secret ne se déchiffre pas** — APP_KEY changée, ligne modifiée à la main.
   * Surtout pas confondu avec « ce compte n'a pas de TOTP » : ce serait désarmer le second
   * facteur au moment précis où quelque chose d'anormal est arrivé à la base. L'appelant
   * refuse la connexion et le dit ; les codes de secours, eux, restent utilisables — ils
   * sont hachés, donc indépendants d'APP_KEY.
   */
  | { status: 'unreadable' }

/**
 * Le second facteur TOTP, côté base (CC-114).
 *
 * L'algorithme vit dans `totp.ts`, pur et testé à part. Ici : le chiffrement du secret, les
 * codes de secours, et les transitions d'état d'un compte.
 */
class TwoFactorService {
  /**
   * Démarre un enrôlement : un secret neuf, **non confirmé**.
   *
   * ⚠️ Le compte n'est pas protégé à la sortie de cette méthode, et c'est le point : tant que
   * personne n'a prouvé savoir lire ce secret, l'exiger à la connexion verrouillerait dehors
   * quiconque a mal scanné son QR. `totp_confirmed_at` reste `null` jusqu'à `confirm`.
   *
   * Rend le secret **en clair** — la seule fois où il sort de la base lisible.
   */
  async startEnrollment(user: User): Promise<{ secret: string; uri: string }> {
    const secret = generateSecret()

    user.totpSecret = encryption.encrypt(secret)
    user.totpConfirmedAt = null
    user.totpLastStep = null
    await user.save()

    return { secret, uri: otpauthUri(secret, user.email) }
  }

  /** Le secret d'un enrôlement en cours, pour réafficher le QR sans en fabriquer un autre. */
  pendingEnrollment(user: User): { secret: string; uri: string } | null {
    if (user.totpSecret === null || user.totpConfirmedAt !== null) return null

    const secret = this.#decrypt(user)
    if (secret === null) return null

    return { secret, uri: otpauthUri(secret, user.email) }
  }

  /**
   * Confirme l'enrôlement avec un premier code, et rend les codes de secours **en clair**.
   *
   * Le pas consommé est enregistré du même geste : le code qui vient de servir à activer le
   * facteur ne doit pas pouvoir servir à s'y connecter dans la foulée.
   */
  async confirm(user: User, code: string): Promise<string[] | null> {
    if (user.totpSecret === null || user.totpConfirmedAt !== null) return null

    const secret = this.#decrypt(user)
    if (secret === null) return null

    const step = verify(secret, code, { lastStep: user.totpLastStep })
    if (step === null) return null

    user.totpConfirmedAt = DateTime.now()
    user.totpLastStep = step
    await user.save()

    return this.regenerateRecoveryCodes(user)
  }

  /**
   * Vérifie un code TOTP à la connexion, et **avance le pas consommé** en cas de succès.
   *
   * L'écriture de `totp_last_step` est ce qui rend l'anti-rejeu réel : sans elle, `totp.ts`
   * comparerait éternellement à `null` et un code intercepté resservirait 90 s durant.
   */
  async verifyTotp(user: User, code: string): Promise<TotpVerdict> {
    if (!user.hasTotp) return { status: 'invalid' }

    const secret = this.#decrypt(user)
    if (secret === null) return { status: 'unreadable' }

    const step = verify(secret, code, { lastStep: user.totpLastStep })
    if (step === null) return { status: 'invalid' }

    user.totpLastStep = step
    await user.save()

    return { status: 'ok' }
  }

  /**
   * Consomme un code de secours. `true` s'il valait quelque chose, et il ne vaut plus rien.
   *
   * ⚠️ **L'usage unique tient à un `UPDATE` conditionnel, pas à un lire-puis-écrire.** Deux
   * requêtes concurrentes portant le même code liraient toutes deux une ligne `used_at IS
   * NULL` et passeraient toutes deux ; ici, c'est la base qui arbitre — la seconde met à jour
   * zéro ligne et repart bredouille. Même raison que l'atomicité des compteurs du throttle
   * (CC-78), qui vient du store et non du service.
   */
  async consumeRecoveryCode(user: User, code: string): Promise<boolean> {
    const normalized = this.#normalize(code)
    if (normalized.length === 0) return false

    const affected = await UserRecoveryCode.query()
      .where('user_id', user.id)
      .where('code_hash', this.#hash(normalized))
      .whereNull('used_at')
      .update({ used_at: DateTime.now().toSQL() }, ['id'])

    if (affected.length === 0) return false

    // Le pas courant avance aussi : se connecter par la porte de secours ne doit pas laisser
    // derrière soi un `totp_last_step` vieux de plusieurs mois, qui rouvrirait la fenêtre de
    // rejeu à tous les codes TOTP émis depuis.
    user.totpLastStep = currentStep()
    await user.save()

    return true
  }

  /** Remplace tous les codes de secours et rend les nouveaux **en clair**, une seule fois. */
  async regenerateRecoveryCodes(user: User): Promise<string[]> {
    await UserRecoveryCode.query().where('user_id', user.id).delete()

    const codes = Array.from({ length: RECOVERY_CODES_COUNT }, () => this.#generateRecoveryCode())

    await UserRecoveryCode.createMany(
      codes.map((code) => ({
        userId: user.id,
        codeHash: this.#hash(this.#normalize(code)),
        usedAt: null,
      }))
    )

    return codes
  }

  /** Combien de codes de secours restent utilisables. */
  async remainingRecoveryCodes(user: User): Promise<number> {
    const codes = await UserRecoveryCode.query().where('user_id', user.id).whereNull('used_at')
    return codes.length
  }

  /**
   * Retire le second facteur : secret, confirmation, anti-rejeu **et** codes de secours.
   *
   * ⚠️ Les codes partent avec le reste. En laisser derrière soi rendrait utilisables, après un
   * réenrôlement, des codes distribués sous l'ancien secret — que leur porteur croit périmés.
   */
  async disable(user: User): Promise<void> {
    user.totpSecret = null
    user.totpConfirmedAt = null
    user.totpLastStep = null
    await user.save()

    await UserRecoveryCode.query().where('user_id', user.id).delete()
  }

  #decrypt(user: User): string | null {
    if (user.totpSecret === null) return null
    return encryption.decrypt<string>(user.totpSecret)
  }

  /** Empreinte SHA-256 nue — même raison que les jetons d'invitation : 40 bits tirés au sort. */
  #hash(code: string): string {
    return createHash('sha256').update(code).digest('hex')
  }

  /**
   * La forme comparable d'un code : sans séparateurs ni espaces, en majuscules.
   *
   * Le code est **affiché** en `XXXX-XXXX` — c'est ce qui le rend recopiable. Sans cette
   * normalisation, le recopier tel qu'affiché échouerait, et la seule façon de s'en servir
   * serait de deviner qu'il faut retirer le tiret.
   */
  #normalize(code: string): string {
    return code.replace(/[\s-]/g, '').toUpperCase()
  }

  /** Huit caractères, affichés en deux groupes de quatre. */
  #generateRecoveryCode(): string {
    const chars = [...randomBytes(8)].map((byte) => RECOVERY_ALPHABET[byte % 32])
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
  }
}

export default new TwoFactorService()
