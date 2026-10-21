# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- A Mastodon account in Gladys (Mastodon, GoToSocial, Akkoma, Pleroma), with an access token: a device with
  its followers, accounts followed, posts and unread notifications.
- The _Mastodon mention received_, _Mastodon private mention received_, _New Mastodon follower_ and
  _Mastodon post boosted or favourited_ triggers, in real time through the streaming API, with the author,
  the text, the post id and address; an optional list of allowed accounts for the mentions.
- The _Post on Mastodon_ scene action (unlisted by default, content warning, optional image from an address)
  and the _Send a Mastodon private mention_ scene action (only to an allowed or followed account), with the
  outputs sent, post id, address and error.
- The _Mastodon_ dashboard widget: connection, followers, unread and last notifications, _Mark as read_.
- The _Test the connection_ action and the connection status of the Configuration screen.
- Documentation in English, French, German and Spanish.
