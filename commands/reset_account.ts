import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import logger from '@adonisjs/core/services/logger'
import User from '#core/auth/models/user'
import AccountResetEvent from '#core/auth/models/account_reset_event'
import twoFactor from '#core/auth/services/two_factor_service'
import { revokeSessions } from '#core/auth/services/session_revocation'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#core/auth/constants/password_rules'

/**
 * La porte de service : reposer un mot de passe et désarmer le second facteur d'un compte,
 * depuis la machine (CC-129).
 *
 * ## Pourquoi une commande, et jamais une route
 *
 * Toute sa valeur tient à ce qu'elle exige un accès que le réseau ne donne pas. Qui a un shell
 * ici a déjà le disque et la base : elle n'accorde rien de neuf. Exposée en HTTP, même « bien
 * protégée », ce serait une porte dérobée sur l'écran de connexion.
 *
 * ## Pourquoi elle vit dans `commands/`, à la racine
 *
 * ⚠️ **C'est la 2ᵉ exception au découpage par feature, et elle est structurelle** — comme
 * `providers/`, le framework impose le chemin. `createAceKernel` construit son seul chargeur de
 * fichiers sur `app.commandsPath()`, qui résout `directories.commands` (défaut `"commands"`).
 * Les deux contournements possibles sont pires : le tableau `commands` d'`adonisrc.ts` n'accepte
 * pas une classe — il faudrait écrire à la main un module `getMetaData`/`getCommand` pour un seul
 * fichier — et détourner `directories.commands` vers `app/core/auth/` est un réglage **global**,
 * qui forcerait la prochaine commande, quel que soit son module, à atterrir dans l'auth.
 *
 * ⚠️ **Et l'erreur est silencieuse** : une commande posée dans un dossier de module n'est pas
 * refusée, elle n'apparaît simplement jamais dans `node ace list`. Même famille que les migrations
 * dont le path n'est pas déclaré dans `config/database.ts`.
 *
 * ## Ce qu'elle refuse de faire
 *
 * ⚠️ **Aucun drapeau `--password`, aucune variable d'environnement.** La leçon de CC-75 est qu'un
 * secret posé dans un `.env` y reste : un mode dégradé silencieux recréerait exactement ce que ce
 * lot retire. Sans terminal, elle s'arrête — elle ne retombe sur rien.
 *
 * ⚠️ **Elle ne réactive pas un compte désactivé et ne rend personne administrateur.** Elle le
 * *signale*. Agir dessus en ferait un outil d'élévation de privilèges, ce qui n'est pas ce qu'on
 * répare ici.
 */
export default class ResetAccount extends BaseCommand {
  static commandName = 'auth:reset-account'
  static description =
    "Repose le mot de passe d'un compte et désarme son second facteur. Saisie interactive obligatoire."

  /** La base est indispensable : sans `startApp`, aucun modèle n'est connecté. */
  static options: CommandOptions = { startApp: true }

  @args.string({
    description: "L'adresse email du compte à reprendre, exactement comme elle est en base",
  })
  declare email: string

  async run() {
    if (!this.#interactif()) {
      this.#refuserSansTerminal()
      return
    }

    /**
     * ⚠️ **Recherche exacte, jamais insensible à la casse** — parce que la connexion l'est aussi :
     * `withAuthFinder` cherche l'uid par égalité stricte (`models/user.ts:12-15`). Être tolérant
     * ici et pas là réinitialiserait un compte auquel l'opérateur ne pourrait toujours pas se
     * connecter avec l'adresse qu'il vient de taper — le pire des deux mondes.
     */
    const email = this.email.trim()
    const user = await User.findBy('email', email)

    if (user === null) {
      this.logger.error(`Aucun compte ne porte l'adresse « ${email} ».`)
      this.logger.info(
        'Les adresses se lisent en base : ' +
          `docker compose exec postgres psql -U root -d app -c 'select email from users order by id'`
      )
      this.exitCode = 1
      return
    }

    // Relevés **avant** le désarmement : après, les colonnes sont vides et la commande ne pourrait
    // plus dire ce qu'elle a retiré.
    const avaitSecondFacteur = user.hasTotp
    const enrolementEnCours = user.totpSecret !== null && !user.hasTotp

    if (!(await this.#confirmer(user, avaitSecondFacteur))) {
      this.logger.info('Rien n’a été modifié.')
      this.exitCode = 1
      return
    }

    const motDePasse = await this.#saisirMotDePasse()
    if (motDePasse === null) {
      this.exitCode = 1
      return
    }

    /**
     * ⚠️ **L'ordre n'est pas décoratif : le second facteur d'abord, le mot de passe ensuite.**
     * Il n'y a pas de transaction possible ici — `twoFactor.disable` supprime les codes de secours
     * par une requête qui sortirait de toute façon d'une transaction ouverte autour du modèle. Donc
     * c'est l'ordre qui protège : interrompue entre les deux, la commande laisse un compte au pire
     * aussi ouvrable qu'avant, et se relance. L'ordre inverse laisserait un compte au **nouveau**
     * mot de passe et toujours bloqué par son second facteur — l'ancien mot de passe perdu pour
     * rien, c'est-à-dire l'inverse exact de ce qu'on vient réparer.
     */
    await twoFactor.disable(user)

    user.password = motDePasse
    await user.save()

    /**
     * ⚠️ **La révocation vient en dernier, et elle s'ajoute à l'ordre ci-dessus sans le rouvrir**
     * (CC-176). Livrer un mot de passe neuf en laissant l'intrus dans la place vide la commande
     * de son sens : c'est le filet du compte perdu, et un cookie volé reste valable jusqu'à la
     * borne des 7 jours sans ce geste. Interrompue avant cette ligne, la commande laisse un
     * compte au pire aussi ouvrable qu'avant — l'invariant de CC-129 tient toujours.
     *
     * Aucune session à re-tamponner : une commande n'en a pas. Toutes tombent, y compris celle
     * de l'opérateur s'il en avait une — c'est le comportement voulu.
     */
    await revokeSessions(user)

    await this.#tracer(user)
    this.#rendreCompte(user, avaitSecondFacteur, enrolementEnCours)
  }

  /**
   * Y a-t-il un terminal pour taper un mot de passe sans le laisser derrière soi ?
   *
   * ⚠️ **C'est exactement la précondition du prompt masqué, pas une garde plus stricte** :
   * `enquirer` appelle `stdin.setRawMode()`, qui n'existe que sur un TTY. Cette garde ne peut donc
   * pas refuser une invocation où la saisie aurait fonctionné — elle transforme un plantage obscur
   * en refus qui explique. `docker compose run` alloue un terminal par défaut (seul `-T` le
   * retire) : la forme documentée pour le NAS passe.
   */
  #interactif(): boolean {
    return process.stdin.isTTY === true
  }

  #refuserSansTerminal() {
    this.logger.error(
      'Cette commande exige un terminal : le mot de passe se tape, il ne se passe pas.'
    )
    this.logger.info(
      'Elle ne lit aucune option ni variable d’environnement — un secret posé dans un fichier ' +
        'y resterait (CC-75). Relance-la depuis un shell interactif.'
    )
    this.logger.info(
      'Sur le NAS : sudo docker compose --env-file .env.production -f docker-compose.prod.yml ' +
        `run --rm app node ace ${ResetAccount.commandName} <email>` +
        ' — « run » alloue un terminal, « exec -T » non.'
    )
    this.exitCode = 1
  }

  /**
   * Montre le compte trouvé et demande un go.
   *
   * ⚠️ **C'est la seule garde contre l'adresse voisine.** Une faute de frappe qui ne correspond à
   * rien échoue toute seule ; une faute qui tombe sur un *autre* compte existant réinitialiserait
   * le mauvais sans rien signaler. Lire le nom à l'écran avant de valider est ce qui l'attrape.
   */
  async #confirmer(user: User, avaitSecondFacteur: boolean): Promise<boolean> {
    this.logger.info(`Compte : ${user.fullName ?? 'sans nom'} <${user.email}>`)
    this.logger.info(`Administrateur : ${user.isAdmin ? 'oui' : 'non'}`)
    this.logger.info(`Compte actif : ${user.isActive ? 'oui' : 'non'}`)
    this.logger.info(`Second facteur : ${avaitSecondFacteur ? 'actif — il sera retiré' : 'aucun'}`)

    return this.prompt.confirm('Réinitialiser ce compte ?')
  }

  /**
   * Deux saisies masquées, et la règle appliquée **ici**.
   *
   * ⚠️ **Surtout pas dans l'option `validate` du prompt.** Le prompt piégé des tests
   * (`TrapPrompt.handle`) rend la réponse de `replyWith` sans jamais appeler `validate` : la règle
   * serait tenue en production et inerte sous test, donc le test d'un mot de passe trop court ne
   * prouverait rien du chemin réel. Une seule règle, un seul endroit, le même dans les deux mondes.
   *
   * ⚠️ La valeur ne sort jamais d'ici autrement que par la valeur de retour : aucun message ne la
   * cite, pas même sa longueur — le même soin que l'écran d'installation avec son jeton (CC-138).
   */
  async #saisirMotDePasse(): Promise<string | null> {
    const motDePasse = await this.prompt.secure('Nouveau mot de passe')

    if (motDePasse.length < MIN_PASSWORD_LENGTH || motDePasse.length > MAX_PASSWORD_LENGTH) {
      this.logger.error(
        `Le mot de passe doit faire entre ${MIN_PASSWORD_LENGTH} et ${MAX_PASSWORD_LENGTH} ` +
          'caractères — la même règle que le formulaire d’invitation. Rien n’a été modifié.'
      )
      return null
    }

    const confirmation = await this.prompt.secure('Retape le mot de passe')

    // Une saisie masquée ne se relit pas : sans ce second passage, une faute de frappe poserait un
    // mot de passe que personne ne connaît, et la commande annoncerait un succès.
    if (confirmation !== motDePasse) {
      this.logger.error('Les deux saisies diffèrent. Rien n’a été modifié.')
      return null
    }

    return motDePasse
  }

  /**
   * Le registre, et le journal.
   *
   * ⚠️ **Les deux, parce qu'ils ne servent pas au même moment.** Le journal parle à qui lance la
   * commande, maintenant ; sur le NAS, il meurt avec le conteneur jetable de `run --rm`. La ligne
   * en base est ce qui reste dans six mois — la seule chose qui distingue « je l'ai fait » de
   * « quelqu'un d'autre l'a fait ». Ni l'un ni l'autre ne cite le mot de passe.
   */
  async #tracer(user: User) {
    /**
     * ⚠️ **Le registre s'écrit après le geste, donc son échec ne doit JAMAIS se lire comme l'échec
     * du geste.** Sans ce filet, une table absente — le cas d'une base de développement en retard
     * d'une migration, exactement le piège du point 2 des « choses qui cassent sans lever
     * d'erreur » — remonterait une exception nue **après** que le mot de passe a été reposé.
     * L'opérateur lirait « ça a planté » d'un compte qui vient bel et bien d'être réinitialisé, et
     * son second facteur déjà retiré. Ce n'est pas un `catch` qui avale : il dit ce qui est arrivé,
     * dit ce qui a quand même eu lieu, et la commande sort en échec.
     */
    try {
      await AccountResetEvent.create({ userId: user.id, userEmail: user.email })
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)

      this.logger.error(
        `⚠️ LE COMPTE EST BIEN RÉINITIALISÉ — mot de passe posé, second facteur retiré — mais le ` +
          `registre « account_reset_events » n'a pas pu être écrit : ${cause}`
      )
      this.logger.error(
        'Ne relance pas la commande en croyant qu’elle a échoué. Si la table manque, joue les ' +
          'migrations en attente : node ace migration:run'
      )
      this.exitCode = 1
    }

    logger.warn(
      `auth:reset-account — mot de passe reposé et second facteur retiré sur le compte ` +
        `« ${user.email} » (id ${user.id}).`
    )
  }

  #rendreCompte(user: User, avaitSecondFacteur: boolean, enrolementEnCours: boolean) {
    this.logger.success(`Mot de passe reposé sur « ${user.email} ».`)

    this.logger.success(
      'Sessions ouvertes ailleurs fermées : elles seront refusées à leur requête suivante. ' +
        'Sans ce geste, un cookie volé restait valable jusqu’à 7 jours après sa connexion.'
    )

    if (avaitSecondFacteur) {
      this.logger.success(
        'Second facteur retiré : secret, codes de secours et anti-rejeu. Le compte se reconnecte ' +
          'avec le seul mot de passe, et peut réenrôler depuis /reglages.'
      )
    } else if (enrolementEnCours) {
      this.logger.info('Un enrôlement commencé mais jamais confirmé a été effacé.')
    }

    // ⚠️ Signalé, pas corrigé : sans ça, l'opérateur croirait avoir réparé le compte et le verrait
    // refuser la connexion sans comprendre pourquoi.
    if (!user.isActive) {
      this.logger.warning(
        'Ce compte est DÉSACTIVÉ : le mot de passe est bien posé, mais la connexion sera refusée ' +
          'tant qu’un administrateur ne l’aura pas réactivé depuis /admin/users.'
      )
    }

    this.logger.info('Ce passage est enregistré dans la table « account_reset_events ».')
  }
}
