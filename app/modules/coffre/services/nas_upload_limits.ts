/**
 * Le plafond d'un envoi vers le NAS (CC-240).
 *
 * ⚠️ **2 GiB, choisi arbitrairement — un chiffre à ajuster, pas une mesure.** Le plafond des
 * vignettes (CC-181) parlait de « 10 à 20 Mo » pour une photo d'appareil moderne ; une vidéo
 * personnelle (quelques minutes en 4K) dépasse largement ce chiffre. Source UNIQUE, relue à la
 * fois par `config/bodyparser.ts` (le plafond global de la requête) et par
 * `validators/coffre.ts` (`nasUploadValidator`, la garde qui compte réellement par route) — deux
 * définitions divergentes referaient la dérive que CC-147 a fermée ailleurs pour
 * `MIN_PASSWORD_LENGTH`.
 */
export const MAX_NAS_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
