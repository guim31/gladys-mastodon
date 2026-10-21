# Mastodon

Conecta una cuenta de Mastodon a Gladys: las escenas pueden publicar en Mastodon y escribir en privado a las
personas que usted conoce, y pueden iniciarse cuando la cuenta es mencionada, recibe una mención privada,
consigue un nuevo seguidor o ve una publicación impulsada o marcada como favorita. Un dispositivo sigue los
contadores de la cuenta (seguidores, cuentas seguidas, publicaciones, notificaciones sin leer), y un widget del
panel muestra las últimas notificaciones.

Funciona con cualquier servidor que hable la API de Mastodon: Mastodon, GoToSocial, Akkoma, Pleroma.

> Probada con un servidor GoToSocial real, todavía no con el propio Mastodon ni con un Gladys real: sus
> comentarios son bienvenidos en [GitHub](https://github.com/guim31/gladys-mastodon/issues).

## Lo que necesita

- Gladys 5.1 o posterior.
- Una cuenta de Mastodon. Es preferible una cuenta dedicada a la casa (marcada como bot en su perfil): todo lo
  que publican las escenas se publica en su nombre.
- Un token de acceso de esta cuenta: en el servidor, abra **Preferencias → Desarrollo → Nueva aplicación**,
  dele un nombre (Gladys), marque los permisos **read** y **write:statuses** (y **write:media** para adjuntar
  imágenes), guarde, abra la aplicación y copie **Su token de acceso**. En GoToSocial: **Ajustes →
  Aplicaciones**, y después solicite un token para la aplicación.

## Configuración inicial

1. Instale la integración: **Integraciones → Instalar desde GitHub**, dirección
   `https://github.com/guim31/gladys-mastodon`.
2. En su pestaña **Configuración**, rellene:
   - **Dirección del servidor**: la dirección de su servidor, p. ej. `https://mastodon.social`.
   - **Token de acceso**: el token copiado arriba.
   - **Cuentas autorizadas** (opcional): las cuentas cuyas menciones inician escenas, separadas por comas,
     p. ej. `alice@mastodon.social, bob` (`bob` es una cuenta de su propio servidor). Vacío: cuentan las
     menciones de todo el mundo. Estas cuentas también pueden recibir menciones privadas de las escenas.
   - **Idioma de los nombres**: el idioma de las funciones del dispositivo y de los errores devueltos a las
     escenas.
3. Guarde. El estado pasa a «conectado», y la cuenta aparece en la pestaña **Descubrir**: añádala para obtener
   sus contadores.
4. **Probar la conexión** comprueba el token y muestra la cuenta, sus seguidores y sus notificaciones sin leer.

## El dispositivo

Un dispositivo por cuenta, llamado `Mastodon @cuenta@servidor`, con cuatro contadores: **Seguidores**,
**Siguiendo**, **Publicaciones** y **Notificaciones sin leer**. Se leen cada 5 minutos, y justo después de una
notificación. Las notificaciones sin leer son las posteriores al marcador de lectura de las aplicaciones de
Mastodon: leerlas en la interfaz web de Mastodon o en una aplicación compatible las devuelve a 0. En los
servidores sin el recuento de Mastodon 4.3 (GoToSocial, Mastodon más antiguo), se cuentan 40 como máximo.

## Panel

El widget **Mastodon** muestra si la cuenta está conectada, sus seguidores y notificaciones sin leer, y las
cinco últimas notificaciones (menciones, seguidores, impulsos, favoritos). Las menciones privadas nunca
aparecen: el panel lo ve toda la casa. Dos botones: **Marcar como leído** (cuando hay notificaciones sin leer)
mueve el marcador de lectura a la notificación más reciente, **Probar la conexión** lanza la prueba de arriba.

## Escenas

### Disparadores

- **Mención de Mastodon recibida**: una publicación pública, no listada o solo para seguidores menciona la
  cuenta. Filtros: **Autor** (una dirección como `alice@mastodon.social`) y **Visibilidad**. Variables: el autor
  (dirección y nombre visible), el texto sin las menciones iniciales, la visibilidad, el identificador del
  mensaje y su dirección.
- **Mención privada de Mastodon recibida**: una mención privada (un mensaje directo) ha llegado a la cuenta.
  Filtro: **Autor**. Las mismas variables, sin la visibilidad.
- **Nuevo seguidor de Mastodon**: alguien sigue la cuenta, o lo solicita cuando la cuenta está bloqueada.
  Variables: el autor y si se trata de una solicitud de seguimiento por aprobar.
- **Publicación de Mastodon impulsada o favorita**: alguien ha impulsado o marcado como favorita una
  publicación de la cuenta. Filtro: **Tipo**. Variables: el tipo (`boost` para un impulso, `favourite` para un
  favorito), el autor, el texto y la dirección de la publicación.

Cuando **Cuentas autorizadas** está rellenado, las menciones de las demás cuentas no inician nada (los
seguidores, impulsos y favoritos, sí). La propia cuenta nunca inicia un disparador, y las notificaciones de más
de 10 minutos (recibidas mientras Gladys estaba detenido) no inician nada.

### Acciones

- **Publicar en Mastodon**: publica un mensaje. **Visibilidad**: no listada por defecto (en el perfil, no en
  las líneas públicas), pública o solo seguidores. **Advertencia de contenido** opcional, y una imagen
  opcional: una **Dirección de la imagen** en http(s) que la integración pueda alcanzar (la dirección de
  instantánea de una cámara, por ejemplo `http://usuario:contraseña@192.168.1.30/snapshot.jpg`; JPEG, PNG, GIF
  o WebP, 8 MB como máximo) con su **Descripción de la imagen** para los lectores de pantalla. El texto se
  corta a la longitud que permite el servidor (500 caracteres por defecto en Mastodon).
- **Enviar una mención privada de Mastodon**: escribe en privado a una cuenta. El **Destinatario** debe ser una
  cuenta autorizada o seguida por la cuenta: la integración nunca escribe a un desconocido. **En respuesta a
  (identificador)** toma la variable identificador del mensaje de un disparador, para responder en la misma
  conversación. Las demás `@` del mensaje se neutralizan (les sigue un carácter invisible): un texto tomado de
  un disparador nunca añade un destinatario.

Ambas acciones devuelven **Enviado**, el **Identificador del mensaje**, la **Dirección del mensaje** y el
**Error**, para las acciones siguientes de la escena. Las escenas publican 30 mensajes por hora como máximo:
por encima, se omiten.

### Ideas de escenas

- **Han llamado a la puerta**: cuando se pulsa el timbre → Publicar en Mastodon, solo seguidores, «Alguien ha
  llamado a la puerta», con la dirección de instantánea de la cámara de la entrada.
- **Una orden por mención privada**: Mención privada de Mastodon recibida, autor `alice@mastodon.social` → si
  el texto es «garaje», cerrar el garaje, y después Enviar una mención privada de Mastodon al autor, en
  respuesta al identificador del mensaje: «El garaje se está cerrando.»
- **Un nuevo seguidor**: Nuevo seguidor de Mastodon → una notificación en el teléfono de la casa, con el autor.

## Solución de problemas

- **«token de acceso rechazado»**: el token se revocó o se copió mal; cree uno nuevo.
- **«rechazado: ¿tiene el token los permisos read y write:statuses?»**: a la aplicación le falta un permiso;
  márquelo y utilice el nuevo token.
- **Ningún disparador aunque los contadores funcionan**: puede que un proxy inverso bloquee la API de
  streaming (paso a WebSocket). La integración lee entonces las notificaciones cada minuto: los disparadores
  llegan con retraso, pero llegan. Compruebe que su proxy transmite `/api/v1/streaming` como WebSocket.
- **Una mención no inicia nada**: compruebe **Cuentas autorizadas** (dirección completa, p. ej.
  `alice@mastodon.social`) y el filtro **Autor** del disparador; ajuste `LOG_LEVEL=debug` para ver las
  menciones ignoradas en los registros.
- **Falta la imagen**: la dirección debe ser accesible desde el contenedor de la integración y responder con un
  tipo de imagen.

## Límites

- Una cuenta por Gladys. El token da a la integración los derechos de la cuenta: utilice una cuenta dedicada.
- Las menciones surten efecto en un segundo aproximadamente gracias a la API de streaming; las notificaciones
  perdidas durante un corte se releen después, pero las de más de 10 minutos no inician ninguna escena, y se
  releen 200 como máximo.
- Gladys no da sus imágenes de cámara a una integración de dispositivos: la imagen de una publicación viene de
  una dirección.
- Mastodon limita una cuenta a 300 publicaciones en 3 horas y 300 solicitudes en 5 minutos; la integración
  hace unas 3 solicitudes cada 5 minutos, más cuando llegan notificaciones.
- Las encuestas, ediciones y notificaciones de administración no son disparadores. Solo texto: el HTML de las
  publicaciones se convierte en texto plano.
- Sin relación con Mastodon gGmbH. Mastodon es una marca de Mastodon gGmbH.
