# Mastodon for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **Mastodon** and the servers speaking its
API (GoToSocial, Akkoma, Pleroma): post from your scenes, write privately to people you know, start scenes
when the account is mentioned, gets a private mention or a new follower, and follow the counters of the
account.

> Tested against a real GoToSocial 0.22 server in Docker, not yet against Mastodon itself nor a real Gladys:
> feedback welcome in the [issues](https://github.com/guim31/gladys-mastodon/issues).

## Features

- **A device per account** with four counters: followers, accounts followed, posts and unread notifications
  (after the read marker of the Mastodon apps).
- **Scene triggers**: _Mastodon mention received_ (author and visibility filters), _Mastodon private mention
  received_, _New Mastodon follower_ (follow requests included), _Mastodon post boosted or favourited_. The
  author, the text (HTML turned into plain text, leading mentions removed), the post id and address are
  passed to the scene.
- **Scene actions**: _Post on Mastodon_ (unlisted by default, public or followers only, content warning,
  optional image read from an http(s) address such as a camera snapshot, with its description) and _Send a
  Mastodon private mention_ (only to an allowed account or one the account follows, optionally in reply to a
  post). Both return sent, post id, address and error.
- **Safety**: an optional list of allowed accounts for the mention triggers, never a trigger on the account
  itself (no scene loop), nothing fired for notifications older than 10 minutes, at most 30 posts an hour
  from scenes.
- **Dashboard widget**: connection, followers, unread notifications, the last five notifications (never the
  private ones), _Mark as read_ and _Test the connection_ buttons.
- Real-time through the streaming API (WebSocket, the token in the `Sec-WebSocket-Protocol` header, never in
  the address), with a REST catch-up every 5 minutes and after each cut; polling every minute when a proxy
  blocks the WebSocket.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- A Mastodon (or compatible) account and an access token with the `read` and `write:statuses` scopes
  (`write:media` for images): **Preferences → Development → New application**.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter `https://github.com/guim31/gladys-mastodon`.
Then fill in the server address and the access token in the **Configuration** tab, and add the account from
the **Discovery** tab. The full guide is in [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The integration reads `GET /api/v1/accounts/verify_credentials` and `/api/v2/instance` (v1 as a fallback),
then opens `wss://<server>/api/v1/streaming?stream=user:notification`. Each notification is handled once
(deduplicated by id, the last one kept in `/data`) and mapped to a trigger. The counters come from
`verify_credentials` and `GET /api/v1/notifications/unread_count` (Mastodon 4.3+), or from the
notifications marker elsewhere. Posts go through `POST /api/v2/media` and `POST /api/v1/statuses` with an
idempotency key.

## Limits

- One account per Gladys; use a dedicated account, the token gives its rights.
- Gladys gives a device integration no access to its camera images: the image of a post comes from an
  address the container can reach.
- Notifications missed during a cut are read back (200 at most); those older than 10 minutes start no scene.
- Polls, edits and admin notifications are not triggers.
- Not checked against Mastodon itself (only its documented API) nor Akkoma/Pleroma.

## Development

```bash
npm install
npm test            # node --test, against the fake Gladys of the SDK and a fake Mastodon
npm run lint
npm run format:check
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

## Credits

- The [Mastodon API documentation](https://docs.joinmastodon.org/api/). The test fixtures are answers
  recorded from a real [GoToSocial](https://codeberg.org/superseriousbusiness/gotosocial) server (AGPL-3.0)
  running in Docker (domain replaced, no token).
- The [Home Assistant `mastodon` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/mastodon)
  (Apache-2.0), built on [Mastodon.py](https://github.com/halcy/Mastodon.py) (MIT): the choice of the account
  counters and of the post options. No code was copied.
- The logo on the cover is the Mastodon logo from
  [Wikimedia Commons](<https://commons.wikimedia.org/wiki/File:Mastodon_logotype_(simple)_new_hue.svg>)
  (public domain; a trademark of Mastodon gGmbH), recolored white.
- The architecture, the `/data` store and the quiet logs come from
  [gladys-mattermost](https://github.com/guim31/gladys-mattermost) and
  [gladys-matrix](https://github.com/guim31/gladys-matrix); the tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Mastodon gGmbH. Mastodon is a trademark of
Mastodon gGmbH.

## License

Apache-2.0
