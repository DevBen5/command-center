import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { installationValidator } from '#core/auth/validators/auth'
import installationService from '#core/auth/services/installation_service'
import installationToken from '#core/auth/services/installation_token_service'
import installationThrottle from '#core/auth/services/installation_throttle_service'
import backupSettings from '#core/backup/services/backup_settings_service'
import backupService from '#core/backup/services/backup_service'

/**
 * L'écran d'installation (CC-138) : crée le premier compte — administrateur — d'une base
 * vide, et rien d'autre.
 *
 * ⚠️ **L'écran n'est atteignable que si `users` est vide, et la condition se relit à chaque
 * requête** — jamais mémorisée, jamais un drapeau. Dès qu'un compte existe, `GET` comme
 * `POST` redirigent vers `/login`, URL tapée à la main comprise. Une porte qui n'existe
 * qu'au moment où elle ne peut ouvrir sur rien.
 *
 * ⚠️ **Le jeton n'apparaît dans aucune réponse HTTP, erreurs comprises.** « Jeton
 * incorrect » suffit ; il ne doit jamais aider à le deviner. Seul le journal du serveur le
 * porte (`InstallationProvider`).
 */
export default class InstallationController {
  async show({ inertia, response }: HttpContext) {
    if (!(await installationService.isOpen())) {
      return response.redirect('/login')
    }

    // Statut des deux chemins fixes (CC-140), affiché — jamais saisi. Un formulaire acceptant
    // un chemin arbitraire réintroduirait le risque qu'il ne corresponde à aucun volume monté.
    const status = backupService.status()
    const settings = await backupSettings.current()

    return inertia.render('core/auth/installation', {
      backupDirectoryReady: status.directoryReady,
      backupMirrorConfigured: status.mirrorConfigured,
      backupKeep: settings.keep,
      backupDailyEnabled: settings.dailyEnabled,
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    if (!(await installationService.isOpen())) {
      return response.redirect('/login')
    }

    // Le blocage se vérifie AVANT toute autre lecture du corps : un client bloqué ne doit
    // rien apprendre — ni de la validation, ni du jeton (CC-78, même doctrine que /login).
    const retryInSeconds = await installationThrottle.secondsBeforeRetry(request.ip())
    if (retryInSeconds > 0) {
      session.flash('errorsBag', {
        token: i18n.t('auth.installationTooManyAttempts', {
          minutes: Math.max(1, Math.ceil(retryInSeconds / 60)),
        }),
      })
      return response.redirect().back()
    }

    const { fullName, email, password, token, backupKeep, backupDailyEnabled } =
      await request.validateUsing(installationValidator)

    // Comparaison à temps constant — et seul un échec de JETON compte dans le throttle :
    // une erreur de validation au-dessus n'est pas une attaque.
    if (!installationToken.matches(token)) {
      await installationThrottle.recordFailure(request.ip())
      session.flash('errorsBag', { token: i18n.t('auth.installationTokenInvalid') })
      return response.redirect().back()
    }

    // Le contrôle « aucun compte » et l'insertion tiennent dans la même transaction,
    // sérialisée — voir `InstallationService`. `null` = un autre POST a gagné la course :
    // l'installation est faite, ce client passe par la porte normale.
    const owner = await installationService.createOwner({ fullName, email, password })
    if (owner === null) {
      return response.redirect('/login')
    }

    // Le journal dit le fait, jamais le mot de passe — le pendant du jeton imprimé au boot.
    logger.info(`Écran d'installation : compte administrateur « ${owner.email} » créé.`)

    // Hors de la transaction du compte (CC-140) : pas de risque de course sur une ligne
    // singleton dont ce POST est, par construction, le seul écrivain possible tant que la
    // base est vide — la garde qui protège le compte n'a pas d'équivalent à protéger ici.
    await backupSettings.update({ keep: backupKeep, dailyEnabled: backupDailyEnabled })

    // Pas de connexion automatique : le compte se prouve en se connectant — et le chemin
    // nominal reste unique, throttle et (futur) second facteur compris.
    session.flash('notice', i18n.t('auth.installationDone'))
    return response.redirect('/login')
  }
}
