import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Le chiffrement au repos du coffre (CC-178) — **code pur**, sans base ni requête.
 *
 * ## Pourquoi PAS `@adonisjs/core/services/encryption`
 *
 * ⚠️ **C'est le réflexe à ne pas suivre ici, et il est tentant :** `two_factor_service.ts:57,188`
 * chiffre le secret TOTP avec `encryption.encrypt/decrypt`, qui dérive d'`APP_KEY`. Cette clé vit
 * dans le `.env`, **à côté de la base** — les deux partent ensemble dans une sauvegarde, une image
 * de disque, un vol de machine. Un coffre chiffré par `APP_KEY` ne protège donc de rien de ce
 * contre quoi on le construit.
 *
 * C'est exactement le raisonnement des codes de secours de CC-114, qui sont **hachés** et non
 * chiffrés : ils ne devaient pas tomber avec ce qu'ils sont censés rattraper. Ici la clé vient de
 * la **passphrase**, qui n'est stockée nulle part.
 *
 * ## Ce que porte chaque valeur chiffrée
 *
 * `iv.tag.ciphertext`, trois blocs base64 séparés par des points. **AES-256-GCM** : le tag
 * d'authentification n'est pas décoratif, c'est lui qui fait échouer un déchiffrement avec la
 * mauvaise clé au lieu de rendre du bruit — et c'est sur cette propriété que repose la
 * vérification de la passphrase (voir `VERIFIER_PLAINTEXT`).
 *
 * ⚠️ **Un IV neuf à CHAQUE écriture, tiré au sort.** Réutiliser un couple (clé, IV) sous GCM ne
 * dégrade pas la confidentialité « un peu » : ça la détruit, et ça compromet la clé
 * d'authentification. 96 bits aléatoires donnent une borne d'anniversaire vers 2^32 messages sous
 * une même clé — sans objet à la volumétrie d'un coffre personnel, mais c'est la raison pour
 * laquelle l'IV ne doit jamais devenir un compteur « pour simplifier ».
 */

/** AES-256 : 32 octets de clé, ni plus ni moins. */
const KEY_LENGTH = 32

/** 96 bits, la taille recommandée pour GCM — la seule qui n'impose pas de re-dériver l'IV. */
const IV_LENGTH = 12

/** 16 octets de sel : au-delà, on n'achète rien ; en dessous, les tables précalculées reviennent. */
const SALT_LENGTH = 16

/**
 * Les paramètres de scrypt, **explicites plutôt qu'implicites**.
 *
 * `N = 2^15` (32768), `r = 8`, `p = 1` : ~32 Mo de mémoire et quelques dizaines de millisecondes
 * par dérivation. C'est ce qui porte réellement la résistance à la force brute — pas la règle de
 * longueur de la passphrase, qui n'est qu'un plancher de bon sens.
 *
 * ⚠️ **`maxmem` doit être relevé, sinon Node refuse.** Le défaut de `node:crypto` est de 32 Mo, soit
 * exactement `128 * N * r` : la dérivation échouerait avec un `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`
 * qu'on prendrait pour un bug de paramètres plutôt que pour un plafond.
 *
 * ⚠️ **Changer ces valeurs rend TOUS les coffres existants illisibles**, sans erreur au démarrage :
 * la clé dérivée ne sera simplement plus la même, le témoin ne se déchiffrera plus, et chaque
 * ouverture répondra « passphrase invalide ». Même famille que le paramétrage TOTP de `totp.ts`,
 * figé pour la même raison.
 */
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

/**
 * Le clair du témoin — une constante connue, publiée ici sans que ça n'affaiblisse rien.
 *
 * ⚠️ **Un témoin chiffré, jamais un second hachage de la passphrase.** Ce que l'ouverture doit
 * établir n'est pas « cette chaîne correspond à celle qu'on connaît » mais « cette clé **déchiffre**
 * réellement ce coffre » — les deux ne coïncident que tant qu'aucun bug ne les sépare. Le tag GCM
 * répond exactement à la seconde question, et ça coûte une dérivation au lieu de deux.
 *
 * Un hachage stocké à côté aurait en plus été une prise de plus sur la passphrase dans le dump.
 */
const VERIFIER_PLAINTEXT = 'command-center:coffre:v1'

/** Un sel de coffre, en hexadécimal. Public par construction : il n'a jamais été un secret. */
export function generateSalt(): string {
  return randomBytes(SALT_LENGTH).toString('hex')
}

/**
 * La clé de 32 octets d'une passphrase, pour un coffre donné.
 *
 * ⚠️ **Synchrone, et c'est assumé.** `scryptSync` bloque la boucle d'événements le temps de la
 * dérivation. Elle n'est appelée qu'à l'ouverture et à la création d'un coffre — deux gestes rares
 * et volontaires — jamais sur une lecture d'entrée, qui réutilise la clé du trousseau. Passer à la
 * forme asynchrone n'achèterait rien ici et ferait remonter une promesse dans du code pur.
 */
export function deriveKey(passphrase: string, salt: string): Buffer {
  return scryptSync(passphrase, Buffer.from(salt, 'hex'), KEY_LENGTH, SCRYPT_PARAMS)
}

/** Chiffre une valeur. Rend `iv.tag.ciphertext`, en base64. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

/**
 * Déchiffre une valeur, ou rend `null`.
 *
 * ⚠️ **Rend `null`, ne lève pas — mais l'appelant doit traiter `null` comme un REFUS**, jamais
 * comme « pas de contenu ». C'est la même distinction que le `unreadable` de `TwoFactorService` :
 * confondre « illisible » et « absent » désarmerait la protection au moment précis où quelque
 * chose d'anormal est arrivé à la base. Les trois causes possibles — mauvaise clé, ligne modifiée
 * à la main, valeur tronquée — sont indiscernables ici, et c'est sans importance : aucune ne
 * justifie de rendre quoi que ce soit.
 */
export function decrypt(payload: string, key: Buffer): string | null {
  const parts = payload.split('.')
  if (parts.length !== 3) return null

  try {
    const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'))

    // Un IV ou un tag de la mauvaise taille fait lever `createDecipheriv`/`setAuthTag` avant même
    // le déchiffrement : le `catch` les couvre, mais autant ne pas confondre ce refus-là avec une
    // authentification échouée.
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // `final()` lève quand le tag ne correspond pas : c'est la vérification d'intégrité qui parle,
    // et c'est précisément ce qu'on attend d'elle.
    return null
  }
}

/** Le témoin d'un coffre neuf : la constante connue, chiffrée avec sa clé. */
export function sealVerifier(key: Buffer): string {
  return encrypt(VERIFIER_PLAINTEXT, key)
}

/**
 * Cette clé est-elle celle de ce coffre ?
 *
 * La comparaison finale est à **temps constant**, comme celle du jeton d'installation (CC-138).
 * Le gain est théorique — le tag GCM a déjà tranché avant elle, et un attaquant devrait payer un
 * scrypt par essai — mais une comparaison de secret en `===` dans un fichier de crypto est
 * exactement le genre de détail qu'on recopie ailleurs sans y penser.
 */
export function verifyKey(verifier: string, key: Buffer): boolean {
  const plaintext = decrypt(verifier, key)
  if (plaintext === null) return false

  const attendu = Buffer.from(VERIFIER_PLAINTEXT, 'utf8')
  const obtenu = Buffer.from(plaintext, 'utf8')

  if (attendu.length !== obtenu.length) return false

  return timingSafeEqual(attendu, obtenu)
}
