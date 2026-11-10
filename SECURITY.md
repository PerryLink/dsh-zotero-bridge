# Security

## Read-only by construction

This plugin has no write verb: it only performs `GET` requests against the
Zotero Local API and `SELECT` queries against a **temporary copy** of
`zotero.sqlite`. It never opens the live database for writing, never deletes
rows, never syncs and never calls the Zotero Web API.

## Network

- The Local API URL must be loopback (`127.0.0.1`, `localhost`, `::1`); any
  other host fails config validation.
- Requests are `GET` only, with a timeout and `redirect: error`.
- No telemetry, no upload, no cloud.

## Files

- The sqlite fallback copies the database into a fresh `mkdtemp` directory,
  opens the copy read-only, and removes the directory afterwards.
- `zotero_to_rep` writes only under the configured plugin root when the REP
  service is not mounted.
- Attachment bytes are not downloaded; only their metadata is recorded.

## Reporting

Open an issue at <https://github.com/PerryLink/dsh-zotero-bridge/issues>
without including library contents or personal data.
