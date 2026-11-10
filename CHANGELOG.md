# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-10

### Added

- `zotero_status`: probe the Local API, then a copied `zotero.sqlite`; report
  the active mode and read-only policy.
- `zotero_search` / `zotero_item`: normalized items (title, creators, year,
  DOI, abstract, tags, collections, attachment metadata) from the Local API or
  a temporary database copy.
- `zotero_to_rep`: capture one item as a REP evidence snapshot, or write
  `<root>/items/<key>.json` when the REP service is not mounted.
- Loopback-only Local API URL; no write path, no sync, no cloud call.
