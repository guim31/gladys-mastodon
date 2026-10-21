# Mastodon

Relie un compte Mastodon à Gladys : les scènes peuvent publier sur Mastodon et écrire en privé aux personnes
que vous connaissez, et elles peuvent démarrer quand le compte est mentionné, reçoit une mention privée, gagne
un abonné, ou voit un message partagé ou mis en favori. Un appareil suit les compteurs du compte (abonnés,
abonnements, messages publiés, notifications non lues), et un widget du tableau de bord montre les dernières
notifications.

Elle fonctionne avec tout serveur qui parle l'API de Mastodon : Mastodon, GoToSocial, Akkoma, Pleroma.

> Testée contre un vrai serveur GoToSocial, pas encore contre Mastodon lui-même ni un vrai Gladys : vos retours
> sont les bienvenus sur [GitHub](https://github.com/guim31/gladys-mastodon/issues).

## Ce qu'il vous faut

- Gladys 5.1 ou plus récent.
- Un compte Mastodon. Un compte dédié à la maison (marqué comme robot dans son profil) est préférable : tout ce
  que publient les scènes l'est en son nom.
- Un jeton d'accès de ce compte : sur le serveur, ouvrez **Préférences → Développement → Nouvelle
  application**, donnez-lui un nom (Gladys), cochez les portées **read** et **write:statuses** (et
  **write:media** pour joindre des images), enregistrez, ouvrez l'application et copiez **Votre jeton
  d'accès**. Sur GoToSocial : **Paramètres → Applications**, puis demandez un jeton pour l'application.

## Mise en place

1. Installez l'intégration : **Intégrations → Installer depuis GitHub**, adresse
   `https://github.com/guim31/gladys-mastodon`.
2. Dans son onglet **Configuration**, remplissez :
   - **Adresse du serveur** : l'adresse de votre serveur, ex. `https://mastodon.social`.
   - **Jeton d'accès** : le jeton copié plus haut.
   - **Comptes autorisés** : les comptes dont les mentions démarrent des scènes, séparés par des
     virgules, ex. `alice@mastodon.social, bob` (`bob` est un compte de votre propre serveur). Vide : aucune
     mention ne démarre de scène. Ces comptes peuvent aussi recevoir des mentions privées des scènes.
   - **Langue des noms** : la langue des fonctionnalités de l'appareil et des erreurs rendues aux scènes.
3. Enregistrez. L'état passe à « connecté », et le compte apparaît dans l'onglet **Découverte** : ajoutez-le
   pour obtenir ses compteurs.
4. **Tester la connexion** vérifie le jeton et affiche le compte, ses abonnés et ses notifications non lues.

## L'appareil

Un appareil par compte, nommé `Mastodon @compte@serveur`, avec quatre compteurs : **Abonnés**,
**Abonnements**, **Messages publiés** et **Notifications non lues**. Ils sont lus toutes les 5 minutes, et
juste après une notification. Les notifications non lues sont celles qui suivent le marqueur de lecture des
applications Mastodon : les lire dans l'interface web de Mastodon ou dans une application compatible les remet
à 0. Sur les serveurs sans le décompte de Mastodon 4.3 (GoToSocial, Mastodon plus ancien), 40 au plus sont
comptées.

## Tableau de bord

Le widget **Mastodon** montre si le compte est connecté, ses abonnés et ses notifications non lues, et les cinq
dernières notifications (mentions, abonnés, partages, favoris). Les mentions privées n'y figurent jamais : le
tableau de bord est vu par toute la maison. Deux boutons : **Marquer comme lu** (quand des notifications sont
non lues) déplace le marqueur de lecture sur la notification la plus récente, **Tester la connexion** lance le
test ci-dessus.

## Scènes

### Déclencheurs

- **Mention Mastodon reçue** : un message public, non listé ou réservé aux abonnés mentionne le compte.
  Filtres : **Auteur** (une adresse comme `alice@mastodon.social`) et **Visibilité**. Variables : l'auteur
  (adresse et nom affiché), le texte sans les mentions de tête, la visibilité, l'identifiant du message et son
  adresse.
- **Mention privée Mastodon reçue** : une mention privée (un message direct) est arrivée sur le compte. Filtre :
  **Auteur**. Mêmes variables, sans la visibilité.
- **Nouvel abonné Mastodon** : quelqu'un s'abonne au compte, ou le demande quand le compte est verrouillé.
  Variables : l'auteur et s'il s'agit d'une demande d'abonnement à valider.
- **Message Mastodon partagé ou mis en favori** : quelqu'un a partagé ou mis en favori un message du compte.
  Filtre : **Type**. Variables : le type (`boost` pour un partage, `favourite` pour un favori), l'auteur, le
  texte et l'adresse du message.

Seules les mentions des **Comptes autorisés** démarrent une scène : liste vide, aucune (les abonnés, partages et
favoris déclenchent pour tout le monde). Le compte lui-même ne démarre jamais de déclencheur, et les notifications de plus de
10 minutes (reçues pendant que Gladys était arrêté) ne démarrent rien.

### Actions

- **Publier sur Mastodon** : publie un message. **Visibilité** : non listé par défaut (sur le profil, pas dans
  les fils publics), public ou abonnés seulement. **Avertissement de contenu** facultatif, et une image
  facultative : une **Adresse de l'image** en http(s) que l'intégration peut joindre (l'adresse d'instantané
  d'une caméra, par exemple `http://utilisateur:motdepasse@192.168.1.30/snapshot.jpg` ; JPEG, PNG, GIF ou WebP,
  8 Mo au plus) avec sa **Description de l'image** pour les lecteurs d'écran. Le texte est coupé à la longueur
  permise par le serveur (500 caractères par défaut sur Mastodon).
- **Envoyer une mention privée Mastodon** : écrit en privé à un compte. Le **Destinataire** doit être un compte
  autorisé ou suivi par le compte : l'intégration n'écrit jamais à un inconnu. **En réponse à (identifiant)**
  prend la variable identifiant du message d'un déclencheur, pour répondre dans la même conversation. Les
  autres `@` du message sont neutralisés (suivis d'un caractère invisible) : un texte repris d'un déclencheur
  n'ajoute jamais de destinataire.

Les deux actions rendent **Envoyé**, l'**Identifiant du message**, l'**Adresse du message** et l'**Erreur**,
pour les actions suivantes de la scène. Les scènes publient 30 messages par heure au plus : au-delà, ils sont
ignorés.

### Idées de scènes

- **On a sonné** : quand le bouton de la sonnette est pressé → Publier sur Mastodon, abonnés seulement,
  « Quelqu'un a sonné à la porte », avec l'adresse d'instantané de la caméra de l'entrée.
- **Une commande par mention privée** : Mention privée Mastodon reçue, auteur `alice@mastodon.social` → si le
  texte est « garage », fermer le garage, puis Envoyer une mention privée Mastodon à l'auteur, en réponse à
  l'identifiant du message : « Le garage se ferme. »
- **Un nouvel abonné** : Nouvel abonné Mastodon → une notification sur le téléphone de la maison, avec
  l'auteur.

## Dépannage

- **« jeton d'accès refusé »** : le jeton a été révoqué ou mal recopié ; créez-en un nouveau.
- **« refusé : le jeton a-t-il les portées read et write:statuses ? »** : il manque une portée à
  l'application ; cochez-la et utilisez le nouveau jeton.
- **Aucun déclencheur alors que les compteurs marchent** : l'API de streaming est peut-être bloquée par un
  proxy inverse (passage en WebSocket). L'intégration lit alors les notifications chaque minute : les
  déclencheurs arrivent en retard, mais ils arrivent. Vérifiez que votre proxy transmet `/api/v1/streaming` en
  WebSocket.
- **Une mention ne démarre rien** : vérifiez que son auteur figure dans **Comptes autorisés** (adresse complète, ex.
  `alice@mastodon.social`) et le filtre **Auteur** du déclencheur ; réglez `LOG_LEVEL=debug` pour voir les
  mentions ignorées dans les journaux.
- **L'image manque** : l'adresse doit être joignable depuis le conteneur de l'intégration, et répondre par un
  type d'image.

## Limites

- Un compte par Gladys. Le jeton donne à l'intégration les droits du compte : utilisez un compte dédié.
- Les mentions prennent effet en une seconde environ grâce à l'API de streaming ; les notifications manquées
  pendant une coupure sont relues ensuite, mais celles de plus de 10 minutes ne démarrent aucune scène, et 200
  au plus sont relues.
- Gladys ne donne pas ses images de caméra à une intégration d'appareils : l'image d'un message vient d'une
  adresse.
- Mastodon limite un compte à 300 messages en 3 heures et 300 requêtes en 5 minutes ; l'intégration fait
  environ 3 requêtes toutes les 5 minutes, davantage quand des notifications arrivent.
- Les sondages, modifications et notifications d'administration ne sont pas des déclencheurs. Texte seul : le
  HTML des messages devient du texte brut.
- Sans lien avec Mastodon gGmbH. Mastodon est une marque de Mastodon gGmbH.
