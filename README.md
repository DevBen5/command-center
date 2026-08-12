# Command Center

A self-hosted personal dashboard: Docker service supervision, AI agent launchers, a reading/media
feed, and a Leitner-box flashcard trainer with LLM-assisted card creation. One installation, one
database, one household — not a SaaS.

Built with [AdonisJS 6](https://adonisjs.com) (ESM, strict TypeScript), [Inertia 2](https://inertiajs.com),
Vue 3, Tailwind v4 and PostgreSQL 16.

> **The interface and the documentation are in French.** This README is the exception, not the rule:
> everything it links to — the deployment guide, the architecture notes, the UI itself — is French
> first. English translations fall back to French key by key rather than breaking. If that is a
> blocker for you, it is a real one, and this file is the only place you will not hit it.

---

## What you get

| Module | What it does | What it needs |
|---|---|---|
| **Core** (always on) | Dashboard, per-account settings, user/role/invitation administration, backup schedule | Nothing beyond the database |
| `leitner` | Flashcards on Leitner boxes: categories → themes, review sessions, statistics, per-person progress, JSON import/export | Optional: an OpenAI-compatible LLM server for card ingestion from a text. Without it, cards are typed by hand |
| `veille` | A feed of RSS/Atom articles, bookmarks, notes, plus media pulled from an Immich album or a YouTube playlist. Read-later queue, tags, bulk actions | Optional: an Immich instance and/or a YouTube Data API key. Without either, RSS and manual entries still work |
| `agents` | Launchers for scripted agents, declared in a mounted JSON file and run on demand | A mounted `agents.json` (see `agents.json.example`). Absent: the module is simply empty |
| `services` | Start/stop/restart Docker containers from the browser | ⚠️ **The Docker socket**, which is root-equivalent on the host. **Off by default.** Read [`docs/deploiement-nas.md` §11](docs/deploiement-nas.md) in full before enabling it — the tradeoff is not "the module stays broken", it is "a container breakout owns the machine" |

Modules are chosen per installation with the `MODULES` variable. A module that is off has **no
routes, no capabilities, no sidebar entry, and its migrations never run** — so no tables and no
data. Turning one on later is a variable change and a restart.

⚠️ `MODULES` absent or empty means **core only**: you get a dashboard with nothing on it. That is
the safe default, not a bug.

Sample flashcard decks (Linux commands, OWASP Top 10, this codebase's own architecture) live in
[`decks/`](decks/) and import from `/revision/settings`. They are generic content, never executed by
anything — see [`decks/README.md`](decks/README.md).

---

## Requirements

- Docker with Compose v2 (`docker compose`, not `docker-compose`)
- `linux/amd64` or `linux/arm64` — every release tag publishes a manifest carrying both

No Node.js, no clone, no build on your machine. PostgreSQL comes with the compose file. Resource
needs are modest: one Node process, and PostgreSQL is the heavier of the two.

⚠️ The `arm64` layer is built under emulation and smoke-tested the same way. It has never been run
on real ARM hardware by the author. If you are that first person and it breaks, an issue with the
output is genuinely useful.

---

## Install

**1. Get the compose file.**

```bash
mkdir command-center && cd command-center
curl -fLO https://raw.githubusercontent.com/DevBen5/command-center/master/docker-compose.install.yml
```

**2. Write a `.env` next to it.** ⚠️ **That exact filename, in that directory** — Compose reads it
automatically to resolve the database credentials. Call it anything else and every command below
needs `--env-file <path>`. This is the whole minimum:

```dotenv
# Generate once, then never change it: it encrypts sessions and stored TOTP secrets.
APP_KEY=<paste the output of: openssl rand -base64 32>

# The public URL you will actually open. The session cookie's `secure` flag derives
# from it — see the warning below.
APP_URL=http://localhost:8080

# Login throttle counters. `database` survives restarts, so a restart does not
# reopen a brute-force window.
LIMITER_STORE=database

DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=app
DB_USER=command_center
DB_PASSWORD=<pick a long random one>

# Pick your modules. Omit `services` unless you have read its warning above.
MODULES=leitner,veille,agents
```

⚠️ **`APP_URL` is not decoration and it is required at boot.** Set it to `https://…` and the
session cookie is marked `secure`; a browser then refuses to send that cookie over plain HTTP, and
the login page **reloads with no error message at all**. If you serve over HTTP on a LAN, say so:
`APP_URL=http://192.168.1.50:8080`.

⚠️ **Reaching it from another machine takes a second change, in the compose file.** The port is
published on `127.0.0.1:8080` — this machine only. Setting `APP_URL` to a LAN address does not move
it, so the browser on your laptop gets a connection timeout with nothing to read anywhere. To
actually serve the LAN, edit the `ports:` line to `'8080:8080'` — and know what you are trading:
Docker then publishes on `0.0.0.0`, and **passwords and session cookies travel your network in the
clear**, to everyone on it. A reverse proxy terminating TLS in front of `127.0.0.1:8080` is the
option that does not make that trade.

The full annotated list of variables is [`.env.production.example`](.env.production.example) (in
French, one comment per line, including every optional integration).

**3. Start it.**

```bash
docker compose -f docker-compose.install.yml up -d
```

Migrations run at container start; the container stops instead of serving an incomplete schema if
one fails.

⚠️ If that command aborts with *"required variable DB_DATABASE is missing a value"*, your `.env` is
not where Compose looks: it must be named `.env`, in the directory you run the command from. The
error names the variable rather than starting a database with empty credentials — that is deliberate.

**4. Create the first account.** With an empty `users` table, every route redirects to
`/installation`. That screen asks for a name, an email, a password (12 characters minimum) and an
**installation token**, printed to the logs at every boot for as long as no account exists:

```bash
docker compose -f docker-compose.install.yml logs app | grep "Jeton d'installation"
```

Then open <http://localhost:8080>. The account you create is an administrator — without that, nobody
could reach the screen that hands out permissions afterwards.

⚠️ **The token is why this screen is safe to expose.** Between "the port is open" and "an account
exists", "whoever connects first" would otherwise be the first scanner that comes along. It lives in
memory only, changes on every restart, is compared in constant time, is never rendered in an HTTP
response — not even in an error — and its failures are rate-limited like `/login`.

---

## Environment variables

Two families, both living in the same `.env`, and the difference matters.

**Read by the application** (injected into the container). Required unless stated otherwise; the
image already sets `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL` and `SESSION_DRIVER` to production
values. The authority for this list is [`start/env.ts`](start/env.ts), which validates them at boot
and refuses to start on a bad one.

| Variable | Default | What it does |
|---|---|---|
| `APP_KEY` | — | Encryption key. Changing it invalidates every session **and makes stored TOTP secrets unreadable** |
| `APP_URL` | — | Public URL. Derives the `secure` flag of session and CSRF cookies |
| `LIMITER_STORE` | — | `database` or `memory`. Use `database` |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_DATABASE` | — | Connection. `DB_PASSWORD` is optional but you want it |
| `MODULES` | core only | Comma-separated: `services`, `agents`, `veille`, `leitner`. An unknown name aborts startup rather than being ignored |
| `TZ` | `UTC` | Process timezone — the one your `timestamp` columns are written in. Read by Node itself, so it is the one variable here that `start/env.ts` does **not** validate |
| `APP_TIMEZONE` | `Europe/Paris` | *A different thing entirely*: which timezone a daily feed collection means by "7 a.m.". An invalid IANA name aborts startup — otherwise the collection would keep happening, just never when you think |
| `TRUST_PROXY` | `loopback` | Which proxies may set `X-Forwarded-For`. Behind a reverse proxy, set it, or every request carries the proxy's IP and one attacker locks everyone out. Too wide is the opposite failure: a direct client forges its own |
| `ADMIN_2FA_REQUIRED` | `false` | Forces administrators through TOTP. ⚠️ Opt-in on purpose: closing it by default would lock the sole administrator of an existing installation out on their first update |
| `AGENTS_CONFIG_PATH` | `agents.json` | Where the `agents` module reads its declarations, inside the container |
| `DOCKER_AVAILABLE` | on in dev, off in prod | Declares whether this deployment mounted the Docker socket. Only set it to contradict the default |
| `APP_COMMIT` | — | Set by the image build. Displayed on `/reglages`; never set it by hand |
| `LLM_BASE_URL` `LLM_MODEL` `LLM_API_KEY` `LLM_TIMEOUT_MS` | unset | OpenAI-compatible server for Leitner card ingestion. All optional; unset means the feature is idle |
| `IMMICH_BASE_URL` `IMMICH_API_KEY` `IMMICH_ALBUM_ID` `IMMICH_TIMEOUT_MS` | unset | One Immich **album** as a feed source — never a whole library |
| `YOUTUBE_API_KEY` `YOUTUBE_PLAYLIST_ID` `YOUTUBE_TIMEOUT_MS` | unset | One YouTube playlist as a feed source |

⚠️ **LLM, Immich and YouTube configuration comes from the environment and never from the database,
deliberately.** That is what makes it impossible for an HTTP request to change which host the server
calls. There is, by design, no form for these values.

**Read by Compose, not by the application** — they decide where host directories are mounted:

| Variable | Default | What it does |
|---|---|---|
| `PGDATA_PATH` | `./pgdata` | PostgreSQL's live data directory on the host |
| `BACKUP_DIR_PATH` | `./backups` | Where dumps land on the host |
| `BACKUP_MIRROR_DIR_PATH` | *(none)* | An off-disk copy of every verified dump. No default on purpose — see below. Requires uncommenting its line in the compose file |
| `AGENTS_CONFIG_PATH_HOST` | *(none)* | Host path of your `agents.json`. Same, no default, and for a sharper reason: a bind mount whose source file does not exist creates an empty **directory** there |

---

## Backups — read this before you have content worth losing

Content is typed by hand and there is no seeder: **the database is the only copy.** Three
protections, and none replaces another.

**1. `pgdata` is a bind mount, not a named volume.** `docker compose down -v` does not touch it —
`-v` only removes Docker-managed volumes. That is the entire reason for the choice. It is **not a
backup**: it is PostgreSQL's live, binary, major-version-bound data directory. Corruption or an
`rm -rf` takes it.

**2. `db:backup` is the real net.**

```bash
docker compose -f docker-compose.install.yml exec app node ace db:backup    # → /data/backups
docker compose -f docker-compose.install.yml exec app node ace db:restore   # newest dump
```

A timestamped SQL dump of **everything**: content, settings, accounts. It is **verified before being
announced** (`pg_dump` header, at least one `CREATE TABLE`, end marker) and **re-read before being
restored**. On backup, a file that fails is deleted on the spot rather than left to pass for a
backup. On restore, it is refused and **never** deleted — it may be the only one left.

⚠️ `db:restore` uses `--clean`, which **drops** tables before recreating them. That is exactly why
it re-reads the dump first: on a truncated file it would stop halfway, leaving a half-destroyed
database and a dump unable to rebuild it.

⚠️ **Verification catches truncation, not uselessness.** A complete but logically wrong dump passes.
The only proof a dump reloads is reloading it — the replayable procedure is
[`docs/restauration-verifiee.md`](docs/restauration-verifiee.md) (French).

A **daily automatic backup** is switchable per installation from `/admin/sauvegarde`, along with how
many dumps to keep. Restoring stays a command, never a route.

**3. `BACKUP_MIRROR_DIR_PATH` — the copy that is not on this disk.** Backups sit next to the live
database by default, so one disk failure, one theft or one ransomware takes both. Point this at a
NAS or a second drive and every verified dump is copied there, written as `.part` then renamed, then
**re-read from the destination** — comparing sizes only proves length, and the off-disk copy is the
one that has to survive.

⚠️ **The mirror directory must already exist; it is never created.** A `mkdir -p` on an unmounted
share would silently make a directory on the local disk: you would believe you were protected while
you were not, which is worse than not copying at all. ⚠️ **Dumps travel in the clear** — the
destination is assumed to be trusted storage. ⚠️ Only dumps made **after** you set the variable are
mirrored; existing ones need one manual copy.

The order of operations — dump → close → verify → mirror → prune — is not decorative. Pruning is the
only destructive step, so it comes last: if the mirror copy fails, **nothing is deleted**.

---

## Updating

```bash
docker compose -f docker-compose.install.yml exec app node ace db:backup   # first, always
docker compose -f docker-compose.install.yml pull
docker compose -f docker-compose.install.yml up -d
```

⚠️ **An update can be a schema change on your database**, applied at container start before the
server accepts a request. Back up first, and prefer pinning an explicit version tag in the compose
file over following `latest` if you would rather decide when that happens. Release notes live in the
[GitHub releases](https://github.com/DevBen5/command-center/releases).

---

## Locked out of your own installation

```bash
docker compose -f docker-compose.install.yml run --rm app node ace auth:reset-account you@example.org
```

Resets a password **and** disarms two-factor authentication — secret, recovery codes, replay guard.
It is the net under TOTP, whose documented last resort ("another administrator") does not exist on a
single-account installation.

- It **creates no account**: `/installation` remains the only path to a *first* one.
- It **does not** reactivate a disabled account and makes nobody an administrator — it reports those
  instead. Acting on them would turn it into a privilege-escalation tool.
- It asks for the password interactively and **refuses to run without a terminal**, rather than
  falling back to an environment variable. There is no `--password` flag and no variable. Use
  `run --rm` (which allocates a terminal), not `exec -T` (which does not).
- Every run leaves a row in `account_reset_events`. ⚠️ That is a record for the legitimate owner, not
  an alarm: whoever has a shell can delete the row too.
- It **closes no open session.** Sessions are cookie-based with no server-side list; a stolen cookie
  stays valid until its 7-day bound, reset or not.
- ⚠️ **Deploy it before you need it.** The day you are locked out, the image running is the one from
  before.

---

## Security, honestly

What is in place: session cookies bounded to **7 days** regardless of activity; invitation links
valid 48 h; `POST /login` throttled (10 failures / 15 min per IP, 5 per email — only failures count,
and a *complete* success clears them); optional TOTP two-factor authentication per account, with
encrypted secret and hashed recovery codes; CSP active with a strict `script-src`; every route
required to declare its access condition, so a forgotten one answers 403 rather than opening;
capability checks in middleware, never in the UI alone.

What is **not**:

- **This is not multi-tenant.** One installation is one database and one trust boundary. Everyone
  with an account can be given access to everything; the feed's media proxy in particular serves any
  account holding the matching capability.
- **The `services` module wants the Docker socket**, which is root on the host, in the same container
  that runs agent shell commands. Off by default, and that default is the recommendation.
- **Agent commands are shell commands, executed as-is.** That is deliberate (a "cron entry" model)
  and rests on one guarantee only: the field is writable by **no form in the application** — solely
  by the mounted declaration file. Treat `agents.json` as trusted code, because it is.
- **`ADMIN_2FA_REQUIRED` defaults to open**, unlike everything else here, for the reason given in the
  table above.
- Nothing proves a phone reads the enrollment QR code. Before turning `ADMIN_2FA_REQUIRED` on: try it
  in a browser with a real authenticator app, and write the recovery codes down.

Found something? [Open an issue](https://github.com/DevBen5/command-center/issues). This is a
one-person project: there is no security team and no response-time promise, and pretending otherwise
would be worse than saying so.

---

## Development

```bash
git clone https://github.com/DevBen5/command-center.git && cd command-center
npm install
cp .env.example .env          # then set APP_KEY: node ace generate:key
docker compose up -d          # PostgreSQL (and Adminer, behind the `tools` profile)
node ace migration:run
npm run dev                   # http://localhost:3333
```

Gates, all three of which run in CI on every pull request:

```bash
npm run typecheck
npm run lint
npm test                      # Japa (back) then Vitest (components)
```

Architecture is **feature-based**: every feature is a full vertical slice, and the default AdonisJS
folders (`app/models/`, `app/controllers/`, `database/migrations/`, `inertia/pages/`) do not exist.
Read [`CLAUDE.md`](CLAUDE.md) before your first change — in French, and it is where the traps that
break without raising an error are written down. Each module has its own next to its code.

---

## Documentation

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Architecture, conventions, and the things that break silently. Start here |
| [`app/modules/*/CLAUDE.md`](app/modules/) | One per module: files, decisions, trust boundaries |
| [`docs/deploiement-nas.md`](docs/deploiement-nas.md) | A full Synology DSM deployment: reverse proxy, Let's Encrypt, backup cron, and §11 on the Docker socket tradeoff |
| [`docs/restauration-verifiee.md`](docs/restauration-verifiee.md) | How to actually prove a dump reloads |
| [`.env.production.example`](.env.production.example) | Every variable, annotated line by line |

All French, as warned at the top.

---

## License

[MIT](LICENSE) — © 2026 DevBen5.
