# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-21

### Added

- A Mastodon account in Gladys (Mastodon, GoToSocial, Akkoma, Pleroma), with an access token: a device with
  its followers, accounts followed, posts and unread notifications.
- The _Mastodon mention received_, _Mastodon private mention received_, _New Mastodon follower_ and
  _Mastodon post boosted or favourited_ triggers, in real time through the streaming API, with the author,
  the text, the post id and address; the mentions only count from the allowed accounts (an empty list: nobody).
- The _Post on Mastodon_ scene action (unlisted by default, content warning, optional image from an address)
  and the _Send a Mastodon private mention_ scene action (only to an allowed or followed account), with the
  outputs sent, post id, address and error.
- The _Mastodon_ dashboard widget: connection, followers, unread and last notifications, _Mark as read_.
- The _Test the connection_ action and the connection status of the Configuration screen.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-mastodon/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-mastodon/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-mastodon/releases/tag/v1.0.0
