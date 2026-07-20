import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import {
  canonicalizeUrl,
  dedupKeyFor,
  FeedParseError,
  htmlToText,
  parseFeed,
} from '#modules/veille/services/feed_parser'

function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/feeds/${name}.xml`, import.meta.url), 'utf8')
}

test.group('Veille / parseur de flux', () => {
  test('un flux Atom et un flux RSS 2.0 donnent le même résultat', async ({ assert }) => {
    const rss = await parseFeed(await fixture('rss2'))
    const atom = await parseFeed(await fixture('atom'))

    assert.lengthOf(rss.entries, 2)
    assert.lengthOf(atom.entries, 2)

    // Champ par champ, sauf le `guid` : RSS le tire de `<guid>`, Atom de `<id>`. C'est
    // irréductible — et c'est exactement pourquoi la clé de dédup part de l'URL.
    for (const [index, rssEntry] of rss.entries.entries()) {
      const atomEntry = atom.entries[index]
      assert.equal(atomEntry.title, rssEntry.title)
      assert.equal(atomEntry.url, rssEntry.url)
      assert.equal(atomEntry.content, rssEntry.content)
      assert.equal(atomEntry.publishedAt?.toISO(), rssEntry.publishedAt?.toISO())
    }
  })

  test('le même article vu par les deux flux ne fait qu’une clé de dédup', async ({ assert }) => {
    const rss = await parseFeed(await fixture('rss2'))
    const atom = await parseFeed(await fixture('atom'))

    // Deux sources différentes (1 et 2), deux `guid` différents — et pourtant la même clé.
    // C'est la propriété que le lot achète : un article qui arrive par le blog ET par un
    // agrégateur n'apparaît qu'une fois. Une clé fondée sur le `guid` échouerait ici.
    assert.equal(dedupKeyFor(rss.entries[0], 1), dedupKeyFor(atom.entries[0], 2))
  })

  test('le HTML du flux est réduit à du texte, script compris', async ({ assert }) => {
    const rss = await parseFeed(await fixture('rss2'))
    const content = rss.entries[0].content!

    assert.equal(content, 'Monter un pipeline & le tenir.')
    // Le corps du script est supprimé, pas seulement ses balises. `contentSnippet` de
    // rss-parser, lui, laisserait « alert(1) » dans le texte — d'où le fait qu'on ne s'en
    // serve pas.
    assert.notInclude(content, 'alert')
  })

  test('INVARIANT : le texte stocké ne contient jamais < ni >', ({ assert }) => {
    // C'est ce qui rend un futur `v-html` inoffensif — et ça se vérifie, plutôt que de se
    // promettre. Les entités qui pourraient reformer une balise ne sont pas redécodées.
    for (const hostile of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '&amp;lt;script&amp;gt;',
      '<p>a</p><p>b</p>',
    ]) {
      const text = htmlToText(hostile)
      assert.notInclude(text, '<', `« ${hostile} » a laissé un < dans « ${text} »`)
      assert.notInclude(text, '>', `« ${hostile} » a laissé un > dans « ${text} »`)
    }
  })

  test('les entités sans danger sont décodées, en une seule passe', ({ assert }) => {
    assert.equal(htmlToText('Caf&eacute; &amp; th&eacute;'), 'Café & thé')
    assert.equal(htmlToText('R&amp;D'), 'R&D')
    // `&amp;lt;` est le texte littéral « &lt; ». Une seconde passe de décodage en ferait un
    // « < » — c'est précisément le bug que le `replace` unique évite.
    assert.equal(htmlToText('&amp;lt;'), '&lt;')
  })

  test('une entrée sans titre est ignorée plutôt qu’inventée', async ({ assert }) => {
    const feed = await parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel>
      <title>F</title>
      <item><link>https://exemple.dev/a</link></item>
      <item><title>Vrai titre</title><link>https://exemple.dev/b</link></item>
    </channel></rss>`)

    assert.lengthOf(feed.entries, 1)
    assert.equal(feed.entries[0].title, 'Vrai titre')
  })

  test('un corps illisible lève FeedParseError', async ({ assert }) => {
    await assert.rejects(() => parseFeed('<rss><channel><item></oops>'), FeedParseError)
    await assert.rejects(() => parseFeed('pas du xml du tout'), FeedParseError)
  })

  test('un flux vide n’est pas une erreur — il rend zéro entrée', async ({ assert }) => {
    // Le cas piégeux : 200 + XML valide + aucune entrée. C'est `last_item_count` qui le
    // signale à l'écran, pas une exception.
    const feed = await parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Vide</title></channel></rss>`
    )
    assert.lengthOf(feed.entries, 0)
  })
})

test.group('Veille / canonicalisation d’URL', () => {
  test('les paramètres de campagne ne créent pas un second article', ({ assert }) => {
    const nu = canonicalizeUrl('https://exemple.dev/article')
    assert.equal(canonicalizeUrl('https://exemple.dev/article?utm_source=hn'), nu)
    assert.equal(canonicalizeUrl('https://exemple.dev/article?fbclid=abc'), nu)
    assert.equal(canonicalizeUrl('https://exemple.dev/article?utm_medium=rss&utm_campaign=x'), nu)
  })

  test('schéma, www, slash final et fragment ne distinguent rien', ({ assert }) => {
    const nu = canonicalizeUrl('https://exemple.dev/article')
    assert.equal(canonicalizeUrl('http://exemple.dev/article'), nu)
    assert.equal(canonicalizeUrl('https://www.exemple.dev/article'), nu)
    assert.equal(canonicalizeUrl('https://exemple.dev/article/'), nu)
    assert.equal(canonicalizeUrl('https://exemple.dev/article#lire'), nu)
    assert.equal(canonicalizeUrl('https://EXEMPLE.dev/article'), nu)
  })

  test('l’ordre des paramètres utiles n’a pas d’importance, leur valeur si', ({ assert }) => {
    assert.equal(
      canonicalizeUrl('https://exemple.dev/a?b=2&a=1'),
      canonicalizeUrl('https://exemple.dev/a?a=1&b=2')
    )
    // Deux pages différentes doivent le rester : `?p=1` et `?p=2` ne se confondent pas.
    assert.notEqual(
      canonicalizeUrl('https://exemple.dev/a?p=1'),
      canonicalizeUrl('https://exemple.dev/a?p=2')
    )
  })

  test('une URL illisible ou non http(s) rend null', ({ assert }) => {
    assert.isNull(canonicalizeUrl('pas une url'))
    assert.isNull(canonicalizeUrl('mailto:a@b.c'))
  })
})

test.group('Veille / clé de déduplication', () => {
  const entry = {
    title: 'Titre',
    url: null as string | null,
    content: null,
    publishedAt: null,
    guid: null as string | null,
  }

  test('l’URL prime sur le guid, y compris entre deux sources', ({ assert }) => {
    const a = { ...entry, url: 'https://exemple.dev/a', guid: 'guid-de-la-source-1' }
    const b = { ...entry, url: 'https://exemple.dev/a', guid: 'guid-de-la-source-2' }

    assert.equal(dedupKeyFor(a, 1), dedupKeyFor(b, 2))
    assert.equal(dedupKeyFor(a, 1), 'url:https://exemple.dev/a')
  })

  test('sans URL, le guid sert — et il est cadré par sa source', ({ assert }) => {
    const sansUrl = { ...entry, guid: '42' }

    assert.equal(dedupKeyFor(sansUrl, 1), 'guid:1:42')
    // Un `guid` n'est unique qu'à l'intérieur d'un flux : « 42 » dans deux flux, deux items.
    assert.notEqual(dedupKeyFor(sansUrl, 1), dedupKeyFor(sansUrl, 2))
  })

  test('sans URL ni guid, le titre évite l’accumulation infinie', ({ assert }) => {
    // Cas dégénéré : sans clé, l'entrée serait réinsérée à chaque passe et remplirait la
    // boîte toute seule.
    const nu = { ...entry, title: '  Le  Titre  ' }
    assert.equal(dedupKeyFor(nu, 3), 'title:3:le titre')
  })

  test('un préfixe empêche un guid qui ressemble à une URL de collisionner', ({ assert }) => {
    const parUrl = { ...entry, url: 'https://exemple.dev/a' }
    const parGuid = { ...entry, guid: 'https://exemple.dev/a' }

    assert.notEqual(dedupKeyFor(parUrl, 1), dedupKeyFor(parGuid, 1))
  })
})
