// -----------------------------------------------------------------------------
// From a Mastodon notification to a scene event of Gladys: which trigger, and
// its flat data (declared fields and variables of the manifest, strings of
// 1000 characters at most). Statuses arrive as HTML: the scenes get text.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  MENTION: 'mention_received',
  DIRECT: 'direct_message_received',
  FOLLOWER: 'new_follower',
  INTERACTION: 'post_interaction',
};

export const VISIBILITIES = ['public', 'unlisted', 'private', 'direct'];
export const INTERACTIONS = { reblog: 'boost', favourite: 'favourite' };

const MAX_DATA_TEXT = 1000;

const clip = (text, max = MAX_DATA_TEXT) => {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : text;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The text of a status: paragraphs and line breaks kept, tags dropped, entities decoded. */
export function htmlToText(html) {
  if (typeof html !== 'string') {
    return '';
  }
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code[0] === '#') {
        const point =
          code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isInteger(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** "@gladys @bob@other.social open the garage" → "open the garage". */
export function withoutLeadingMentions(text) {
  return text.replace(/^(?:@[\w.-]+(?:@[\w.-]+)?[\s,:]*)+/u, '').trim();
}

/** "alice" → "alice@example.social": the address of an account, always with its domain. */
export function fullAcct(account, domain) {
  const acct = String(account?.acct ?? account?.username ?? '').toLowerCase();
  if (acct === '') {
    return '';
  }
  return acct.includes('@') || !domain ? acct : `${acct}@${domain}`;
}

const nameOf = (account) => clip(String(account?.display_name || account?.username || ''), 200);

/**
 * The scene event of a notification, or null when none applies.
 * @param {object} notification as the API returns it
 * @param {{ selfId: string, domain: string }} context
 * @returns {{ key: string, author: string, data: object } | null}
 */
export function sceneEventOf(notification, { selfId, domain }) {
  const account = notification?.account;
  if (!account || account.id === selfId) {
    return null; // our own account: never a trigger, no loop through a scene
  }
  const author = fullAcct(account, domain);
  const status = notification.status ?? null;
  const base = { author: clip(author), author_name: nameOf(account) };
  switch (notification.type) {
    case 'mention': {
      if (!status) {
        return null;
      }
      const text = clip(withoutLeadingMentions(htmlToText(status.content)));
      const common = {
        ...base,
        text,
        status_id: String(status.id ?? ''),
        url: clip(String(status.url ?? status.uri ?? '')),
      };
      if (status.visibility === 'direct') {
        return { key: TRIGGERS.DIRECT, author, data: common };
      }
      return {
        key: TRIGGERS.MENTION,
        author,
        data: {
          ...common,
          visibility: VISIBILITIES.includes(status.visibility) ? status.visibility : 'public',
        },
      };
    }
    case 'follow':
    case 'follow_request':
      return {
        key: TRIGGERS.FOLLOWER,
        author,
        data: { ...base, requested: notification.type === 'follow_request' },
      };
    case 'reblog':
    case 'favourite':
      return {
        key: TRIGGERS.INTERACTION,
        author,
        data: {
          ...base,
          kind: INTERACTIONS[notification.type],
          text: clip(htmlToText(status?.content)),
          url: clip(String(status?.url ?? status?.uri ?? '')),
        },
      };
    default:
      return null; // poll, update, status, admin.*: not offered as triggers
  }
}
