# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and where:

- The configuration (server address, access token, allowed accounts, language) is stored by Gladys; the
  token is a `secret` field.
- `/data/mastodon-state.json` holds the id of the last notification handled (so a restart replays nothing)
  and the last 5 public notifications shown by the widget (author, kind, short text, date). No private
  mention is stored, nor the token.
- The integration talks to the configured server (HTTPS or HTTP, REST and WebSocket; the token in the
  `Authorization` and `Sec-WebSocket-Protocol` headers, never in an address), to Gladys, and to the image
  addresses typed in the scenes (credentials of such an address are sent as Basic authentication, never
  logged; 8 MB at most, image types only). It never logs the token.

The token gives the integration the rights of the account: a dedicated account is advised. Private mentions
are only sent to an allowed account or one the account follows, and scenes post 30 times an hour at most.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), and the third-party services
the integration talks to (the Mastodon server, the cameras).
