# Module Veille — RSS · bookmarks · notes

Route `/veille` · page Inertia `modules/veille/index` · table `veille_items`.

```
controllers/veille_controller.ts    index (filtres type/tag/readingQueue/search) · store · toggleQueue
models/veille_item.ts               types rss · bookmark · note
validators/veille.ts                captureValidator
```

## Recherche full-text — colonne générée

`search_vector` est une colonne **`GENERATED ALWAYS AS ... STORED`** (tsvector, dictionnaire
`french`, sur `title` + `content`), avec index GIN. Postgres la maintient tout seul :
**l'application ne l'écrit jamais**, et elle n'existe pas sur le modèle Lucid. Ne l'ajoute pas au
modèle, ne tente pas de la remplir dans un seeder.

La recherche passe par `whereRaw("search_vector @@ plainto_tsquery('french', ?)", [search])`.
Tout `whereRaw` **doit rester paramétré** (bindings `?`), jamais concaténé.

## Pièges techniques

- **`tags` est un `text[]` Postgres, pas du JSON.** Colonne `@column()` nue, **sans**
  `prepare: JSON.stringify` — le driver `pg` gère le tableau nativement. Filtrage :
  `whereRaw('? = ANY(tags)', [tag])`.
  En revanche `metadata` est du `jsonb` et porte bien, lui, `prepare: JSON.stringify`.
- `captureValidator` ne couvre **pas** `tags` : ils ne sont donc pas renseignables depuis le
  formulaire de capture aujourd'hui (seulement par seeder). Ajouter le champ = étendre le validateur.
- `index()` recharge **toute la table** (`VeilleItem.all()`) pour calculer la bande de stats, en plus
  de la requête filtrée. Volumétrie personnelle : assumé.
