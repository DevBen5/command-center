import vine from '@vinejs/vine'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#core/auth/constants/password_rules'

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email(),
    // minLength(1) rejette la chaîne vide : un mot de passe manquant produit
    // une erreur de champ claire plutôt que « Identifiants invalides ».
    password: vine.string().minLength(1),
  })
)

/**
 * Le changement de mot de passe d'un compte pour lui-même (CC-147).
 *
 * ⚠️ `currentPassword` n'a qu'une borne de non-vide, jamais de règle de format : c'est un
 * oracle vérifié par `SettingsController.changePassword` via `User.verifyCredentials`, pas
 * une saisie à mettre en forme. Le nouveau mot de passe suit la même règle que l'invitation
 * (`acceptInvitationValidator`) — la même constante, pas une quatrième copie.
 */
export const changePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string().minLength(1),
    password: vine
      .string()
      .minLength(MIN_PASSWORD_LENGTH)
      .maxLength(MAX_PASSWORD_LENGTH)
      .confirmed(),
  })
)
