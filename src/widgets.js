// -----------------------------------------------------------------------------
// Dashboard widget "Mastodon" (manifest `widgets`, key `mastodon`): is the
// account connected, its followers and unread notifications, the last
// notifications (mentions, follows, boosts, favourites), and two buttons:
// mark the notifications as read, test the connection.
//
// Budget of the core: 8 components, 2 texts, 4 buttons. Here: 1 status,
// 1 card-list (or 1 caption when empty), 1 or 2 buttons.
// Private mentions are never listed: the widget is seen by everyone who sees
// the dashboard.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { pick } from './texts.js';

export const WIDGET_KEY = 'mastodon';
export const TEST_ACTION = 'test';
export const READ_ACTION = 'mark_read';
export const RECENT_SHOWN = 5;

export const CONNECTION = {
  NOT_CONFIGURED: 'not_configured',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
};

// Short texts of the widget: labels and values of status rows (≤ 40), button
// (≤ 24), badge (≤ 16), caption (≤ 80).
export const TEXT = {
  connection: { en: 'Mastodon', fr: 'Mastodon', de: 'Mastodon', es: 'Mastodon' },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  disconnected: { en: 'Disconnected', fr: 'Déconnecté', de: 'Getrennt', es: 'Desconectado' },
  connecting: { en: 'Connecting…', fr: 'Connexion…', de: 'Verbinde…', es: 'Conectando…' },
  notConfigured: {
    en: 'Not configured',
    fr: 'Non configuré',
    de: 'Nicht konfiguriert',
    es: 'Sin configurar',
  },
  followers: { en: 'Followers', fr: 'Abonnés', de: 'Follower', es: 'Seguidores' },
  unread: { en: 'Unread', fr: 'Non lues', de: 'Ungelesen', es: 'Sin leer' },
  mention: { en: 'Mention', fr: 'Mention', de: 'Erwähnung', es: 'Mención' },
  follow: { en: 'Follower', fr: 'Abonné', de: 'Follower', es: 'Seguidor' },
  request: { en: 'Request', fr: 'Demande', de: 'Anfrage', es: 'Solicitud' },
  boost: { en: 'Boost', fr: 'Partage', de: 'Geteilt', es: 'Impulso' },
  favourite: { en: 'Favourite', fr: 'Favori', de: 'Favorit', es: 'Favorito' },
  empty: {
    en: 'No notification received yet.',
    fr: 'Aucune notification reçue pour l’instant.',
    de: 'Noch keine Benachrichtigung erhalten.',
    es: 'Todavía no se ha recibido ninguna notificación.',
  },
  markRead: {
    en: 'Mark as read',
    fr: 'Marquer comme lu',
    de: 'Als gelesen markieren',
    es: 'Marcar como leído',
  },
  test: {
    en: 'Test the connection',
    fr: 'Tester la connexion',
    de: 'Verbindung testen',
    es: 'Probar la conexión',
  },
};

const clip = (text, max) => {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : text;
};

function connectionRow(connection, language) {
  const label = pick(TEXT.connection, language);
  switch (connection) {
    case CONNECTION.CONNECTED:
      return {
        label,
        value: pick(TEXT.connected, language),
        color: WIDGET_COLORS.SUCCESS,
        icon: 'check-circle',
      };
    case CONNECTION.DISCONNECTED:
      return {
        label,
        value: pick(TEXT.disconnected, language),
        color: WIDGET_COLORS.DANGER,
        icon: 'alert-triangle',
      };
    case CONNECTION.CONNECTING:
      return { label, value: pick(TEXT.connecting, language), color: WIDGET_COLORS.NEUTRAL };
    default:
      return { label, value: pick(TEXT.notConfigured, language), color: WIDGET_COLORS.WARNING };
  }
}

/**
 * The content of the widget.
 * @param {object} state
 * @param {string} state.connection one of CONNECTION
 * @param {string|null} state.account user@domain
 * @param {{ followers: number, unread: number } | null} state.counters
 * @param {Array<{ kind: string, author: string, text: string, at: string }>} state.recent newest first
 * @param {string} language
 */
export function buildWidgetContent({ connection, account, counters, recent }, language) {
  const items = [connectionRow(connection, language)];
  if (account) {
    items[0].value = clip(`@${account}`, 40);
  }
  if (counters) {
    items.push(
      {
        label: pick(TEXT.followers, language),
        value: counters.followers,
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: pick(TEXT.unread, language),
        value: counters.unread,
        color: counters.unread > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
      },
    );
  }
  const components = [{ type: 'status', items }];
  if (recent.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: recent.slice(0, RECENT_SHOWN).map((entry) => ({
        title: clip(`@${entry.author}`, 60),
        ...(entry.text ? { description: clip(entry.text, 200) } : {}),
        date: entry.at,
        badge: {
          text: clip(pick(TEXT[entry.kind] ?? TEXT.mention, language), 16),
          color: WIDGET_COLORS.NEUTRAL,
        },
      })),
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.empty, language) });
  }
  if (connection === CONNECTION.CONNECTED && counters?.unread > 0) {
    components.push({
      type: 'button',
      label: pick(TEXT.markRead, language),
      icon: 'check-circle',
      style: 'secondary',
      action: { key: READ_ACTION },
    });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.test, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: TEST_ACTION },
  });
  return { ttl_seconds: 120, components };
}
