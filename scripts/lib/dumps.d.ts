/*
| Types de `dumps.js`, pour `tsc` uniquement.
|
| `tsconfig.json` n'active pas `allowJs` (il hérite de `@adonisjs/tsconfig`), donc un
| spec `.ts` qui importe ce module lèverait TS2307 : « Cannot find module ». Même motif
| que `vue-shim.d.ts`, et même contrepartie — ces signatures sont écrites à la main, rien
| ne vérifie qu'elles suivent le `.js`.
|
| Le module reste en `.js` parce que `npm run db:backup` l'exécute par `node`, sans
| transpilation.
*/

export declare const MOTIF_DUMP: RegExp
export declare const GARDER_PAR_DEFAUT: number

export declare function verifierDump(chemin: string): { ok: boolean; raison?: string }
export declare function listerDumps(dossier: string): string[]
export declare function lireGarder(valeur: string | undefined): number
export declare function dumpsAPurger(noms: string[], garder: number): string[]
