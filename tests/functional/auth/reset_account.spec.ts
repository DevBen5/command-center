import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ace from '@adonisjs/core/services/ace'
import ResetAccount from '#commands/reset_account'
import User from '#core/auth/models/user'
import UserRecoveryCode from '#core/auth/models/user_recovery_code'
import AccountResetEvent from '#core/auth/models/account_reset_event'
import twoFactor from '#core/auth/services/two_factor_service'
import { createAdmin, enrollTotp } from '#tests/helpers/users'

/**
 * La porte de service `auth:reset-account` (CC-129).
 *
 * ⚠️ **`process.stdin.isTTY` est forcé dans les DEUX sens, jamais laissé à l'ambiant.** Japa hérite
 * du terminal qui le lance : sous un shell la valeur est `true`, dans une CI elle ne l'est pas. Un
 * test qui compterait sur l'ambiant passerait donc sur un poste et rougirait sur l'autre — et,
 * pire, le test du refus serait vert *sans avoir rien vérifié* partout où il n'y a pas de terminal.
 *
 * ⚠️ **Ce qu'aucun test d'ici ne peut prouver : que le terminal existe vraiment sur le NAS**, sous
 * `docker compose run --rm` à travers SSH. Ce qui rend la garde sûre est structurel, pas testé :
 * elle vérifie exactement la précondition du prompt masqué (`stdin.setRawMode`, qui n'existe que
 * sur un TTY), donc elle ne peut pas refuser une invocation où la saisie aurait fonctionné.
 *
 * ⚠️ **La règle des 12 caractères est vérifiée sur le chemin réel**, parce qu'elle vit dans la
 * commande et non dans l'option `validate` du prompt : `TrapPrompt.handle` rend la réponse de
 * `replyWith` sans jamais appeler `validate`, donc une règle posée là serait inerte ici.
 */

/** Le mot de passe que les fabriques de `#tests/helpers/users` posent. */
const MOT_DE_PASSE_ORIGINE = 'secret123'
const MOT_DE_PASSE_NEUF = 'motdepasse-long-1'

/**
 * ⚠️ `false` plutôt que `undefined` — la valeur réelle d'un flux non-TTY — pour rester dans le type
 * `boolean` de `NodeJS.ReadStream`. La garde compare à `true`, les deux passent par le même chemin.
 */
function poserTerminal(present: boolean) {
  process.stdin.isTTY = present
}

/** Crée la commande et lui pose les réponses qu'un opérateur taperait. */
async function commandePour(
  email: string,
  reponses: { confirme?: boolean; motDePasse?: string; confirmation?: string } = {}
) {
  const command = await ace.create(ResetAccount, [email])

  if (reponses.confirme !== undefined) {
    const trap = command.prompt.trap('Réinitialiser ce compte ?')
    reponses.confirme ? trap.accept() : trap.reject()
  }

  if (reponses.motDePasse !== undefined) {
    command.prompt.trap('Nouveau mot de passe').replyWith(reponses.motDePasse)
  }

  if (reponses.confirmation !== undefined) {
    command.prompt.trap('Retape le mot de passe').replyWith(reponses.confirmation)
  }

  return command
}

test.group('Auth / reprise en main d’un compte', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  group.each.setup(() => {
    const origine = process.stdin.isTTY
    // `raw` est ce qui rend `command.logger.getLogs()` lisible : sans ce mode, les messages partent
    // à l'écran et rien ne permet d'assertir ce que la commande a dit — ni ce qu'elle n'a pas dit.
    ace.ui.switchMode('raw')

    return () => {
      ace.ui.switchMode('normal')
      process.stdin.isTTY = origine
    }
  })

  test('sans terminal, elle refuse et ne touche à rien', async ({ assert }) => {
    poserTerminal(false)
    const user = await createAdmin()
    await enrollTotp(user)

    // Aucun trap : si la garde laissait passer, la commande atteindrait un vrai prompt — le test
    // resterait bloqué au lieu de passer, ce qui est exactement le bon échec.
    const command = await commandePour(user.email)
    await command.exec()

    command.assertFailed()

    // Le nerf : « elle a refusé » ne suffit pas, il faut que le compte soit intact.
    await user.refresh()
    assert.isNotNull(user.totpSecret)
    assert.equal(await twoFactor.remainingRecoveryCodes(user), 0)
    const connecte = await User.verifyCredentials(user.email, MOT_DE_PASSE_ORIGINE)
    assert.equal(connecte.id, user.id)

    assert.lengthOf(await AccountResetEvent.all(), 0)

    // Le message doit dire comment s'y prendre, pas seulement que c'est refusé : sans ça, la
    // commande est inutilisable le jour où elle sert.
    const messages = command.logger.getLogs().map((log) => log.message)
    assert.isTrue(messages.some((message) => message.includes('run --rm')))
  })

  test('le mot de passe posé connecte réellement, l’ancien ne connecte plus', async ({
    assert,
  }) => {
    poserTerminal(true)
    const user = await createAdmin()

    const command = await commandePour(user.email, {
      confirme: true,
      motDePasse: MOT_DE_PASSE_NEUF,
      confirmation: MOT_DE_PASSE_NEUF,
    })
    await command.exec()

    command.assertSucceeded()

    // ⚠️ On va jusqu'à `verifyCredentials` : vérifier que la colonne a changé ne dirait pas si
    // le compte est utilisable par la personne qui vient de taper ce mot de passe.
    const connecte = await User.verifyCredentials(user.email, MOT_DE_PASSE_NEUF)
    assert.equal(connecte.id, user.id)
    await assert.rejects(() => User.verifyCredentials(user.email, MOT_DE_PASSE_ORIGINE))
  })

  test('les sessions ouvertes ailleurs sont fermées', async ({ assert }) => {
    // ⚠️ Sans ce geste, la commande livre un mot de passe neuf en laissant l'intrus dans la
    // place : un cookie volé reste valable jusqu'à la borne des 7 jours (CC-176). Elle est le
    // filet du compte perdu — la moitié du filet ne rattrape rien.
    poserTerminal(true)
    const user = await createAdmin()
    // ⚠️ Relu depuis la base, pas lu sur le modèle fraîchement créé : `User.create` ne rapporte
    // pas les colonnes qu'il n'a pas écrites, et l'attribut vaudrait `undefined` — l'assertion
    // passerait sans avoir regardé la base.
    await user.refresh()
    assert.isNull(user.sessionsValidFrom)

    const command = await commandePour(user.email, {
      confirme: true,
      motDePasse: MOT_DE_PASSE_NEUF,
      confirmation: MOT_DE_PASSE_NEUF,
    })
    await command.exec()

    command.assertSucceeded()

    await user.refresh()
    assert.isNotNull(user.sessionsValidFrom)
  })

  test('le second facteur est désarmé, codes de secours compris', async ({ assert }) => {
    poserTerminal(true)
    const user = await createAdmin()
    await enrollTotp(user)
    await twoFactor.regenerateRecoveryCodes(user)
    assert.equal(await twoFactor.remainingRecoveryCodes(user), 10)

    const command = await commandePour(user.email, {
      confirme: true,
      motDePasse: MOT_DE_PASSE_NEUF,
      confirmation: MOT_DE_PASSE_NEUF,
    })
    await command.exec()

    command.assertSucceeded()

    await user.refresh()
    assert.isNull(user.totpSecret)
    assert.isNull(user.totpConfirmedAt)
    assert.isNull(user.totpLastStep)
    assert.isFalse(user.hasTotp)

    // ⚠️ Les codes partent avec le reste. En laisser derrière soi rendrait utilisables, après un
    // réenrôlement, des codes distribués sous l'ancien secret.
    assert.lengthOf(await UserRecoveryCode.query().where('user_id', user.id), 0)
  })

  test('un mot de passe trop court est refusé, l’ancien reste valable', async ({ assert }) => {
    poserTerminal(true)
    const user = await createAdmin()
    await enrollTotp(user)

    const command = await commandePour(user.email, { confirme: true, motDePasse: 'court' })
    await command.exec()

    command.assertFailed()

    // ⚠️ « Ça a échoué » et « le compte est intact » sont deux assertions différentes : la
    // seconde est celle qui compte, puisque le refus arrive **après** la confirmation et **avant**
    // toute écriture.
    const connecte = await User.verifyCredentials(user.email, MOT_DE_PASSE_ORIGINE)
    assert.equal(connecte.id, user.id)

    await user.refresh()
    assert.isNotNull(user.totpSecret)
    assert.lengthOf(await AccountResetEvent.all(), 0)
  })

  test('deux saisies différentes sont refusées sans rien écrire', async ({ assert }) => {
    poserTerminal(true)
    const user = await createAdmin()

    const command = await commandePour(user.email, {
      confirme: true,
      motDePasse: MOT_DE_PASSE_NEUF,
      confirmation: 'motdepasse-long-2',
    })
    await command.exec()

    command.assertFailed()

    const connecte = await User.verifyCredentials(user.email, MOT_DE_PASSE_ORIGINE)
    assert.equal(connecte.id, user.id)
    assert.lengthOf(await AccountResetEvent.all(), 0)
  })

  test('un refus à la confirmation laisse le compte intact', async ({ assert }) => {
    poserTerminal(true)
    const user = await createAdmin()

    const command = await commandePour(user.email, { confirme: false })
    await command.exec()

    command.assertFailed()

    const connecte = await User.verifyCredentials(user.email, MOT_DE_PASSE_ORIGINE)
    assert.equal(connecte.id, user.id)
    assert.lengthOf(await AccountResetEvent.all(), 0)
  })

  test('une adresse inconnue échoue sans rien modifier', async ({ assert }) => {
    poserTerminal(true)
    const user = await createAdmin()

    const command = await commandePour('personne@example.com')
    await command.exec()

    command.assertFailed()

    const connecte = await User.verifyCredentials(user.email, MOT_DE_PASSE_ORIGINE)
    assert.equal(connecte.id, user.id)
    assert.lengthOf(await AccountResetEvent.all(), 0)
  })

  test('le passage laisse une trace qui nomme le compte, et jamais le mot de passe', async ({
    assert,
  }) => {
    poserTerminal(true)
    const user = await createAdmin()

    const command = await commandePour(user.email, {
      confirme: true,
      motDePasse: MOT_DE_PASSE_NEUF,
      confirmation: MOT_DE_PASSE_NEUF,
    })
    await command.exec()

    command.assertSucceeded()

    // La ligne qui survit au conteneur jetable — la seule chose qui distingue, six mois plus tard,
    // « je l'ai fait » de « quelqu'un d'autre l'a fait ».
    const traces = await AccountResetEvent.all()
    assert.lengthOf(traces, 1)
    assert.equal(traces[0].userId, user.id)
    assert.equal(traces[0].userEmail, user.email)
    assert.isNotNull(traces[0].createdAt)

    // ⚠️ Couvre ce que la commande **dit**, pas ce que le transport pino écrit : celui-ci tourne
    // dans un worker thread et n'est pas capturable ici. Structurellement, la valeur saisie n'est
    // passée qu'à `user.password`.
    const messages = command.logger.getLogs().map((log) => log.message)
    assert.isFalse(messages.some((message) => message.includes(MOT_DE_PASSE_NEUF)))
    assert.isTrue(messages.some((message) => message.includes(user.email)))
  })

  test('un compte désactivé est signalé, pas réactivé', async ({ assert }) => {
    poserTerminal(true)
    const user = await createAdmin()
    user.isActive = false
    await user.save()

    const command = await commandePour(user.email, {
      confirme: true,
      motDePasse: MOT_DE_PASSE_NEUF,
      confirmation: MOT_DE_PASSE_NEUF,
    })
    await command.exec()

    command.assertSucceeded()

    // ⚠️ Le mot de passe est bien posé — c'est ce qui a été demandé — mais le compte reste fermé.
    // Corriger ça ici ferait de la commande un outil d'élévation de privilèges.
    await user.refresh()
    assert.isFalse(user.isActive)

    const messages = command.logger.getLogs().map((log) => log.message)
    assert.isTrue(messages.some((message) => message.includes('DÉSACTIVÉ')))
  })
})
