import vine from '@vinejs/vine'

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email(),
    // minLength(1) rejette la chaîne vide : un mot de passe manquant produit
    // une erreur de champ claire plutôt que « Identifiants invalides ».
    password: vine.string().minLength(1),
  })
)
