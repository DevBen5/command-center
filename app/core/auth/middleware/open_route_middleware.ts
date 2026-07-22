import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Marque une route comme **intentionnellement** sans capacité.
 *
 * Ce middleware ne fait rien, et c'est tout son intérêt : il transforme une absence en
 * déclaration. Sans lui, une route ouverte et une route dont on a oublié la capacité se
 * ressembleraient — le garde-barrière ne pourrait pas distinguer les deux, et il faudrait
 * lui donner une liste d'exceptions à tenir à jour ailleurs qu'à côté de la route concernée.
 *
 * ⚠️ À réserver aux routes qui ne peuvent structurellement pas porter de capacité : celles
 * qu'on emprunte avant d'avoir une identité (`/login`, l'acceptation d'une invitation), et
 * celles qui ne donnent accès à rien (`/logout`, le changement de langue). Chaque usage se
 * justifie sur la ligne d'à côté.
 */
export default class OpenRouteMiddleware {
  async handle(_ctx: HttpContext, next: NextFn) {
    return next()
  }
}
