import vine from '@vinejs/vine'
import registry from '#core/auth/capabilities/registry'

/**
 * ⚠️ Une capacité qui n'existe dans aucun module est **refusée à la saisie**.
 *
 * Sans cette règle, un rôle pourrait porter `leitner.reviw` : la ligne existerait en base,
 * l'écran l'afficherait, et elle n'ouvrirait jamais rien. Le droit paraîtrait accordé et
 * ne le serait pas — le genre de panne qu'on cherche des heures du mauvais côté.
 */
const capability = vine
  .string()
  .trim()
  .use(
    vine.createRule((value, _options, field) => {
      if (typeof value === 'string' && !registry.has(value)) {
        field.report(
          `La capacité « ${value} » n'est déclarée par aucun module.`,
          'capabilityExists',
          field
        )
      }
    })()
  )

export const createUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(1).maxLength(120),
    email: vine.string().trim().email().maxLength(254),
    roleId: vine.number().positive().nullable().optional(),
    isAdmin: vine.boolean().optional(),
  })
)

export const updateUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(1).maxLength(120),
    roleId: vine.number().positive().nullable().optional(),
    // ⚠️ **Requis, contrairement à la création.** Le contrôleur remplace l'état complet : un
    // `isAdmin` absent y vaudrait `false`, donc un appel partiel — un script, un futur écran
    // qui ne modifierait que le nom — **dégraderait un administrateur sans le vouloir et sans
    // rien signaler**. Exiger le champ transforme cet oubli en 422.
    isAdmin: vine.boolean(),
  })
)

/** Les surcharges : chaque entrée accorde (`true`) ou retire (`false`) hors du rôle. */
export const userCapabilitiesValidator = vine.compile(
  vine.object({
    overrides: vine
      .array(
        vine.object({
          capability,
          granted: vine.boolean(),
        })
      )
      .distinct('capability'),
  })
)

export const roleValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(60),
    capabilities: vine.array(capability).distinct(),
  })
)

export const acceptInvitationValidator = vine.compile(
  vine.object({
    password: vine.string().minLength(12).maxLength(180).confirmed(),
  })
)
