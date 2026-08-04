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

/**
 * L'écran d'installation (CC-138) : le premier compte de la base.
 *
 * Nom et email suivent les bornes de la création d'un compte par un admin
 * (`createUserValidator`) ; le mot de passe suit la même constante que l'invitation et le
 * changement de mot de passe — jamais une copie de la règle.
 *
 * ⚠️ `token` n'a qu'une borne de non-vide, comme `currentPassword` ci-dessus et pour la même
 * raison : c'est un oracle — vérifié par `InstallationTokenService.matches`, à temps
 * constant — pas une saisie à mettre en forme. Une règle de format ici (longueur exacte,
 * hexadécimal) renseignerait sur ce que le jeton doit être.
 */
export const installationValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(1).maxLength(120),
    email: vine.string().trim().email().maxLength(254),
    password: vine
      .string()
      .minLength(MIN_PASSWORD_LENGTH)
      .maxLength(MAX_PASSWORD_LENGTH)
      .confirmed(),
    token: vine.string().trim().minLength(1),
  })
)
