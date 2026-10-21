# Mastodon

Connects one Mastodon account to Gladys: scenes can post on Mastodon and write privately to people you
know, and they can start when the account is mentioned, receives a private mention, gets a new follower,
or has a post boosted or favourited. A device follows the counters of the account (followers, accounts
followed, posts, unread notifications), and a dashboard widget shows the last notifications.

It works with any server speaking the Mastodon API: Mastodon, GoToSocial, Akkoma, Pleroma.

> Tested against a real GoToSocial server, not yet against Mastodon itself nor a real Gladys: feedback
> welcome on [GitHub](https://github.com/guim31/gladys-mastodon/issues).

## What you need

- Gladys 5.1 or later.
- A Mastodon account. A dedicated account for the house (marked as a bot in its profile) is best: everything
  the scenes post is posted under its name.
- An access token of this account: on the server, open **Preferences → Development → New application**,
  give it a name (Gladys), tick the **read** and **write:statuses** scopes (and **write:media** to attach
  images), save, open the application and copy **Your access token**. On GoToSocial:
  **Settings → Applications**, then request a token for the application.

## Set up

1. Install the integration: **Integrations → Install from GitHub**, address
   `https://github.com/guim31/gladys-mastodon`.
2. In its **Configuration** tab, fill in:
   - **Server address**: the address of your server, e.g. `https://mastodon.social`.
   - **Access token**: the token copied above.
   - **Allowed accounts** (optional): the accounts whose mentions start scenes, separated by commas, e.g.
     `alice@mastodon.social, bob` (`bob` is an account of your own server). Empty: everyone's mentions count.
     These accounts may also receive private mentions from the scenes.
   - **Language of the names**: the language of the device features and of the errors returned to the
     scenes.
3. Save. The status turns to "connected", and the account appears in the **Discovery** tab: add it to get
   its counters.
4. **Test the connection** checks the token and shows the account, its followers and unread notifications.

## The device

One device per account, named `Mastodon @account@server`, with four counters: **Followers**, **Following**,
**Posts** and **Unread notifications**. They are read every 5 minutes, and right after a notification. The
unread notifications are those after the read marker of the Mastodon apps: reading them in the Mastodon web
interface or in a compatible app sets them back to 0. On servers without the count of Mastodon 4.3
(GoToSocial, older Mastodon), at most 40 are counted.

## Dashboard

The **Mastodon** widget shows whether the account is connected, its followers and unread notifications, and
the last five notifications (mentions, followers, boosts, favourites). Private mentions are never shown: the
dashboard is seen by everyone at home. Two buttons: **Mark as read** (when notifications are unread) moves
the read marker to the newest notification, **Test the connection** runs the test above.

## Scenes

### Triggers

- **Mastodon mention received**: a public, unlisted or followers-only post mentions the account. Filters:
  **Author** (an address such as `alice@mastodon.social`) and **Visibility**. Variables: the author (address
  and display name), the text without the leading mentions, the visibility, the post id and its address.
- **Mastodon private mention received**: a private mention (a direct message) reached the account. Filter:
  **Author**. Same variables, without the visibility.
- **New Mastodon follower**: someone follows the account, or asks to when the account is locked. Variables:
  the author and whether it is a follow request to approve.
- **Mastodon post boosted or favourited**: someone boosted or favourited a post of the account. Filter:
  **Kind**. Variables: the kind (`boost` or `favourite`), the author, the text and the address of the post.

When **Allowed accounts** is filled in, the mentions of other accounts start nothing (followers, boosts and
favourites still do). The account itself never starts a trigger, and notifications older than 10 minutes
(received while Gladys was stopped) start nothing.

### Actions

- **Post on Mastodon**: publishes a post. **Visibility**: unlisted by default (on the profile, not in the
  public timelines), public or followers only. Optional **Content warning**, and an optional image: an
  **Image address** in http(s) the integration can reach (the snapshot address of a camera, for instance
  `http://user:password@192.168.1.30/snapshot.jpg`; JPEG, PNG, GIF or WebP, 8 MB at most) with its **Image
  description** for screen readers. The text is cut at the length the server allows (500 characters on
  Mastodon by default).
- **Send a Mastodon private mention**: writes privately to an account. The **Recipient** must be an allowed
  account or one the account follows: the integration never writes to a stranger. **In reply to** takes the
  post id variable of a trigger, to answer in the same conversation. The other `@` of the message are
  neutralised (an invisible character follows them): a text taken from a trigger never adds a recipient.

Both actions return **Sent**, the **Post id**, the **Post address** and the **Error**, for the following
actions of the scene. At most 30 posts an hour come from the scenes: beyond, they are skipped.

### Scene ideas

- **The doorbell rang**: when the doorbell button is pressed → Post on Mastodon, followers only, "Someone
  rang at the door", with the snapshot address of the door camera.
- **A command by private mention**: Mastodon private mention received, author `alice@mastodon.social` → if
  the text is "garage", close the garage, then Send a Mastodon private mention to the author, in reply to the
  post id: "The garage is closing."
- **A new follower**: New Mastodon follower → a notification to the phone of the house, with the author.

## Troubleshooting

- **"access token refused"**: the token was revoked or mistyped; create a new one.
- **"refused: does the token have the read and write:statuses scopes?"**: the application lacks a scope;
  tick it and use the new token.
- **No trigger while the counters work**: the streaming API may be blocked by a reverse proxy (WebSocket
  upgrade). The integration then reads the notifications every minute: triggers come late but come. Check
  that your proxy forwards `/api/v1/streaming` as a WebSocket.
- **A mention starts nothing**: check **Allowed accounts** (full address, e.g. `alice@mastodon.social`) and
  the **Author** filter of the trigger; set `LOG_LEVEL=debug` to see the ignored mentions in the logs.
- **The image is missing**: the address must be reachable from the container of the integration, and
  answer with an image type.

## Limits

- One account per Gladys. The token gives the integration the rights of the account: use a dedicated one.
- Mentions take effect in about a second through the streaming API; notifications missed during a cut are
  read back afterwards, but those older than 10 minutes start no scene, and at most 200 are read back.
- Gladys does not give a device integration its camera images: the image of a post comes from an address.
- Mastodon limits an account to 300 posts in 3 hours and 300 requests in 5 minutes; the integration makes
  about 3 requests every 5 minutes, more when notifications arrive.
- Polls, edits and admin notifications are not triggers. Text only: the HTML of posts becomes plain text.
- Not affiliated with Mastodon gGmbH. Mastodon is a trademark of Mastodon gGmbH.
