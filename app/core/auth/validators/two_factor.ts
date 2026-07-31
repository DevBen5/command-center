import vine from '@vinejs/vine'

/**
 * Le code demandé à la connexion : **six chiffres OU un code de secours** (CC-114).
 *
 * ⚠️ Un seul champ, et une contrainte volontairement lâche : le formulaire ne demande pas
 * lequel des deux on saisit. Exiger de le déclarer obligerait quelqu'un qui vient de perdre
 * son téléphone à comprendre la distinction avant de pouvoir entrer. Le serveur essaie l'un,
 * puis l'autre.
 *
 * Les bornes ne valident donc pas un format : elles bornent ce qui atteint la vérification.
 */
export const twoFactorChallengeValidator = vine.compile(
  vine.object({
    code: vine.string().trim().minLength(6).maxLength(20),
  })
)

/** La confirmation d'enrôlement, elle, ne peut être qu'un code TOTP. */
export const totpConfirmationValidator = vine.compile(
  vine.object({
    code: vine
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
)
