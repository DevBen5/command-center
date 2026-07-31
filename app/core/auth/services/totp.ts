import { Secret, TOTP } from 'otpauth'

/**
 * Le TOTP (RFC 6238) — la couche mince au-dessus d'`otpauth` (CC-114).
 *
 * ⚠️ **Ce fichier est pur** : ni base, ni session, ni `HttpContext`. C'est ce qui le rend
 * atteignable par un test unitaire, au même titre que `scripts/lib/dumps.js` et
 * `inertia/i18n/messages.ts`. Tout ce qui touche à la base vit dans `TwoFactorService`.
 *
 * ⚠️ **Ces trois paramètres ne se changent pas librement** : ils sont ceux que toutes les
 * applications d'authentification supposent par défaut (Google Authenticator, Aegis, 1Password
 * n'affichent même pas la question). Un `digits: 8` ou un `algorithm: 'SHA256'` produirait des
 * codes que l'application du téléphone refuserait de reconnaître — sans erreur, juste des codes
 * qui « ne marchent pas ». `tests/unit/totp.spec.ts` les fige contre un vecteur de la RFC.
 */
const ALGORITHM = 'SHA1'
const DIGITS = 6
const PERIOD_SECONDS = 30

/** Le nom qui s'affichera dans l'application d'authentification. */
const ISSUER = 'Command Center'

/**
 * La tolérance, en pas de 30 s **de part et d'autre** de l'instant courant.
 *
 * 1 (donc ~90 s de validité) est la valeur usuelle : elle absorbe l'horloge du téléphone qui
 * dérive et le temps de recopier six chiffres. Monter à 2 ou 3 multiplierait d'autant la
 * surface d'un code intercepté, que l'anti-rejeu ci-dessous ne ferme qu'après usage.
 */
const WINDOW_STEPS = 1

/** Un secret neuf, en base32 — le format que lisent les QR `otpauth://`. */
export function generateSecret(): string {
  // 20 octets = 160 bits, la taille recommandée par la RFC 4226 §4 pour HMAC-SHA1.
  return new Secret({ size: 20 }).base32
}

/**
 * L'URI que le QR code encode, et que l'application d'authentification lit.
 *
 * L'`issuer` y figure deux fois — en paramètre **et** en préfixe du label — parce que les
 * applications ne lisent pas toutes le même : c'est ce que recommande la spécification
 * `otpauth` de Google, et `otpauth` s'en charge à partir de `issuer` + `label`.
 */
export function otpauthUri(secret: string, accountLabel: string): string {
  return totpFor(secret, accountLabel).toString()
}

/**
 * Le pas de temps courant — l'unité de l'anti-rejeu.
 *
 * Exporté parce que `TwoFactorService` en a besoin pour les codes de secours : consommer un
 * code de secours doit avancer le compteur au même titre qu'un code TOTP, sans quoi le pas
 * enregistré vieillirait pendant qu'on se connecte par l'autre porte.
 */
export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / PERIOD_SECONDS)
}

/**
 * Vérifie un code et rend **le pas qu'il a consommé**, ou `null` s'il ne vaut rien.
 *
 * Rendre le pas plutôt qu'un booléen n'est pas une coquetterie : c'est ce que l'appelant doit
 * écrire en base pour que le même code ne resserve pas. Un `boolean` obligerait à le
 * recalculer, donc à dupliquer la logique de fenêtre — et à la faire diverger un jour.
 *
 * Trois refus, tous rendus identiquement (`null`) : un secret illisible, un code hors fenêtre,
 * et **un pas déjà consommé**. Ce dernier est l'anti-rejeu de la RFC 6238 §5.2 : un code reste
 * valable ~90 s, donc sans lui un code intercepté (épaule, capture d'écran, hameçonnage en
 * temps réel) resservirait tant que sa fenêtre n'est pas passée.
 */
export function verify(
  secret: string,
  token: string,
  options: { now?: number; lastStep?: number | null } = {}
): number | null {
  const now = options.now ?? Date.now()
  const lastStep = options.lastStep ?? null

  // ⚠️ La chaîne vide est un base32 **valide** pour `otpauth` : elle décode en clé de zéro
  // octet, avec laquelle un HMAC se calcule très bien. Sans cette garde, un secret vide
  // vérifierait donc des codes — refusés par le `catch` de personne.
  if (secret.length === 0) return null

  let totp: TOTP
  try {
    totp = totpFor(secret, ISSUER)
  } catch {
    // Secret illisible : APP_KEY changée, ligne corrompue à la main. Ce n'est **pas** un
    // « pas de TOTP » — l'appelant doit refuser la connexion, pas l'ouvrir. Voir
    // `TwoFactorService.verifyTotp`, qui distingue les deux cas par leur type de retour.
    return null
  }

  const delta = totp.validate({ token, window: WINDOW_STEPS, timestamp: now })
  if (delta === null) return null

  const step = currentStep(now) + delta
  if (lastStep !== null && step <= lastStep) return null

  return step
}

/** Le secret est vérifié ici : `fromBase32` lève sur une entrée illisible. */
function totpFor(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  })
}
