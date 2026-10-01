# Torre Idle

Juego idle/clicker para móvil (PWA) con minijuegos. Está hecho con React, Vite y TypeScript, usa Firebase (Auth anónima, Firestore y Analytics) y se despliega en Vercel.

## Minijuegos

| Juego | Entrada | Premio |
|---|---|---|
| 🌃 **Apagón diario**: enciende todas las ventanas | Gratis, uno al día | Gemas, racha y ranking del día |
| 🛣️ **Conecta las calles**: gira tramos hasta unir las casas con el ayuntamiento | Gratis, uno al día | Gemas, racha y ranking del día |
| 🌳 **Plan verde**: reparte casas y parques (mitad y mitad en cada fila y columna, sin tres iguales seguidos) | Gratis, uno al día | Gemas, racha y ranking del día |
| 🎡 **Rueda de la fortuna** | 1 giro gratis al día, luego 🎟️ | Monedas, gemas, boosts o edificios raros |
| 🦹 **Atrapa al ladrón**: 30 s de reflejos | 🎟️ | Monedas y gemas |
| 🏗️ **Stack Tower**: apila pisos | 🎟️ | Monedas y boost de producción |
| 🚦 **Semáforo**: cambia el semáforo sin que choquen los coches | 🎟️ | Monedas y boost de producción (se multiplica con el de Stack) |
| 🧠 **Memoria de ventanas**: repite la secuencia de luces | 🎟️ | Monedas y hasta 4 🎟️ (sin pasar del máximo) |
| 🚒 **Bomberos**: apaga incendios antes de que se propaguen, con agua limitada | 🎟️ | Monedas y gemas |
| 🚇 **Metro**: traza hasta 3 líneas entre estaciones y lleva a cada viajero a su destino | 🎟️ | Monedas y boost de producción (fuente propia) |
| 🧱 **Fusión** (tipo 2048) | 🎟️ | Gemas y edificios raros |
| 📈 **Bolsa de la ciudad** | Libre | Ganancias que no cuentan para estrellas ni rankings |

Los tres retos diarios generan el mismo tablero para todos a partir de la fecha. El Plan verde siempre tiene una única solución. En Semáforo, un coche que espera demasiado en rojo pierde la paciencia y se lo salta, así que no se puede dejar el semáforo fijo.

## Copa de Alcaldes (torneo semanal)

Va en hora de Costa Rica (UTC-6) para que los cortes sean iguales para todos.

- **Lunes a viernes: inscripción** gratuita en Juegos → Copa de Alcaldes. Desde el lunes se conocen las tres pruebas del sábado (minijuegos de arcade que rotan cada semana), así que se pueden practicar.
- **Sábado: fase de grupos.** Al cerrar la inscripción, los inscritos se reparten en grupos de hasta 8 de nivel parecido. Todos los móviles calculan los mismos grupos, porque la lista ya no puede cambiar.
  - Tres pruebas con 3 intentos cada una, sin gastar tickets. Cuenta el mejor intento.
  - Cada prueba da puntos por puesto en el grupo (10, 8, 6, 5, 4, 3, 2, 1).
  - El **rival directo** es quien va justo por delante, con una barra que compara los puntos.
- **Domingo: final** entre los 2 primeros de cada grupo (4 si solo hay un grupo), con una prueba sorpresa y 3 intentos.
- **Lunes: ceremonia** con podio y premios: gemas y tickets para todos los que juegan, más copas de oro, plata o bronce para el podio. Las copas se ven en la plaza de tu ciudad, en tu vitrina del Perfil y junto a tu nombre en la Copa.
- **Preparación** (pestaña 🏋️ de la Copa):
  - **Centro de entrenamiento**: se mejora con monedas (el coste depende de tu producción), hasta el nivel 5. Cada nivel da +2% en las marcas de la Copa, y los niveles 2 y 4 añaden un hueco de carta (de 1 a 3).
  - **Cartas de ventaja**: 🎟️ intento extra, 🛡️ escudo (si el intento no mejora tu marca, no se gasta), ⚡ impulso (+15%) y ⭐ estrella (+30%, solo en la final).
    - Se consiguen con el cofre del día, las misiones semanales, a veces con los retos diarios y al jugar cada Copa.
    - Se equipan de lunes a viernes y se usan el fin de semana. Las que no se usan vuelven a la colección.
  - **Afición**: con 3 días jugados entre semana tienes +1 intento en cada prueba del sábado; con 5, también en la final. Ese fin de semana tu ciudad se llena de gente con banderines.
- **Pronósticos**: el sábado cualquiera (también los no inscritos) puede apostar 5, 10 o 25 💎 a quién ganará la Copa. Pagan ×5 si acierta el campeón, ×2 si sube al podio, y se recupera la apuesta si llega a la final.
- **Temporadas de 4 semanas**:
  - Cada Copa da puntos: jugar 5, puesto en el grupo hasta 20, finalista 30 y podio 50, 70 o 100.
  - Al terminar, el 1º gana 100 💎 y una 🚩 bandera en su ayuntamiento; el 2º, 60 💎; el 3º, 40 💎; y del 4º al 10º, 15 💎.
  - El **salón de la fama** guarda a los campeones de cada temporada y de cada Copa. Las Copas terminadas ya no cambian, así que su resumen se guarda en el dispositivo y no se vuelve a descargar.
- Las reglas de Firestore no aceptan inscripciones ni marcas fuera de su día, y las marcas solo pueden subir. El administrador puede quitar las marcas de un tramposo (y su inscripción, antes del sábado).

## Visitar ciudades

- Cada jugador publica una foto pública de su ciudad en `cities/{uid}`: nombre, era, edificios, monedas ganadas, estrellas y el tamaño de cada tipo de edificio. Se actualiza sola, como mucho una vez por minuto.
- En cualquier ranking, al tocar a un jugador se abre su ciudad, dibujada con el mismo clima y la misma hora. Tocarla no recauda; solo saluda.
- En Logros → Perfil → **Tu ciudad** puedes ver cómo la ven los demás y compartir un enlace (`?ciudad=UID`) que abre tu ciudad directamente.
- El panel de administración también puede abrir la ciudad de cualquier jugador.

## Misiones y liga semanal

- **Misiones diarias**: 3 al día, iguales para todos (una de ciudad, una de minijuego y una libre). Cada una da 💎, 🎟️ y puntos de liga. Completar las tres abre el **cofre del día** (gemas, boost x2 de 15 min y más puntos).
- **Misiones semanales**: 3 por semana, más largas y con más premio.
- **Liga semanal**: ranking que se reinicia cada lunes. Los puntos salen solo de misiones y retos diarios, así que un jugador nuevo compite en igualdad con uno veterano. Al terminar la semana se cobra el premio de la división alcanzada: 🥉 Bronce, 🥈 Plata (150), 🥇 Oro (300) o 💎 Diamante (450).

## Progresión (sin final)

- **Ciudad viva**:
  - Se dibuja en canvas a partir de tus edificios y sigue la hora real (día, atardecer y noche).
  - El clima (despejado, nublado, lluvia, tormenta o nieve) es el mismo para todos a la misma hora y cambia según el mes.
  - Hay peatones (con paraguas si llueve) y fechas especiales: 🎄 Navidad, 🎆 Año Nuevo y 🎃 Halloween.
  - Hay fuegos artificiales al refundar, al abrir el cofre del día, al cobrar la liga o al batir un récord.
- **Música por era**:
  - Se compone en el momento con WebAudio, sin archivos de audio, así que funciona sin conexión y no pesa.
  - Cada era tiene su estilo: flauta en la Aldea, jazz en Metrópolis, sintetizadores en Megalópolis, ambiente espacial en la Colonia lunar… Pasado el Multiverso cambia de tonalidad en cada era.
  - Las canciones tienen forma AABA y cambian cada 16 compases.
  - De noche suena más lenta y suave, con lluvia más apagada, y con nieve o en Navidad lleva campanitas.
  - En los minijuegos baja de volumen. Durante las pruebas de la Copa suena un tema propio.
  - En Logros → Perfil se puede apagar y ajustar el volumen, aparte de los efectos.
- **16 edificios**. Los 6 últimos se desbloquean en eras avanzadas.
- **Hitos infinitos**: cada edificio produce x2 al llegar a 25, 50, 100… y después cada 100, sin límite.
- **Eras y prestigio**: al refundar la ciudad ganas ⭐ estrellas de legado (raíz cúbica de lo ganado en total) que dan +3% de producción cada una. Se gastan en el árbol de legado, que tiene niveles infinitos.
- **Logros**: 20 categorías, casi todas sin nivel máximo. Cada logro da +2% de producción y gemas.
- **Decretos del consejo**: cada pocos minutos eliges entre dos ventajas (festival, lotería, horas extra…).
- **Boosts combinables**: fuentes distintas se multiplican entre sí; la misma fuente solo se alarga.
- Los números usan K, M, B… y luego aa, ab, ac… hasta ~1e308.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests de la lógica (economía y minijuegos)
npm run build    # build de producción en dist/
```

La configuración de Firebase está en `.env.local`, que no se sube al repositorio. `.env.example` sirve de plantilla.

### Probar sin tocar la base de datos real

`npm run emulators` arranca los emuladores locales de Auth y Firestore (necesita Java). Con `VITE_EMULATORS=1` en `.env.development.local`, `npm run dev` se conecta a ellos en lugar de a Firebase. En ese modo, `window.__emuGoogle('correo@gmail.com')` en la consola simula vincular una cuenta de Google, lo que sirve, por ejemplo, para probar el panel de administración.

## Sugerencias y panel de administración

- **Reportar sugerencias** (Logros → Perfil): cualquier jugador envía una idea, un error u otro comentario. Se guarda en `suggestions/` con su nombre, era y tipo de dispositivo. Las reglas solo aceptan una por minuto por jugador.
- **Panel de administración**: solo aparece si has entrado con la cuenta de Google de administrador. Las reglas de Firestore lo comprueban con el hash SHA-256 del correo verificado, así que el correo no aparece en el repositorio. El código del panel se descarga aparte y solo para el administrador. Tiene tres pestañas:
  - **Resumen**: jugadores, activos, altas por día, última conexión, uso de cada minijuego, participación en los retos diarios, eras, economía y récords.
  - **Jugadores**: búsqueda y detalle de cada partida, con la opción de quitar a alguien de los rankings (la partida no se toca).
  - **Sugerencias**: marcar como leída, hecha o descartada, o borrar.
- Las sesiones y eventos de Analytics se ven en la consola de Firebase; el panel enlaza a ella.

## Configurar Firebase (una sola vez)

En la [consola de Firebase](https://console.firebase.google.com/project/game-f5ffa):

1. **Authentication → Sign-in method**:
   - Activa **Anónimo** (obligatorio: así juega cualquiera sin registrarse).
   - Activa **Google** (para el botón "Vincular con Google" del perfil).
   - En **Settings → Authorized domains**, añade tu dominio de Vercel (por ejemplo `torre-idle.vercel.app`).
2. **Firestore Database → Crear base de datos** en modo producción.
3. **Reglas de Firestore**: copia el contenido de `firestore.rules` en la pestaña *Reglas* y publícalas. También puedes hacerlo desde la terminal:
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules
   ```

## Desplegar en Vercel

1. Sube el proyecto a GitHub.
2. En Vercel, **Add New → Project** e importa el repositorio. Vercel detecta Vite automáticamente.
3. En **Settings → Environment Variables**, añade las 7 variables `VITE_FIREBASE_*` de `.env.local`.
4. Pulsa **Deploy**. Cada `git push` vuelve a desplegar.

## Seguridad

### Qué protege el juego
- **Reglas de Firestore** ([firestore.rules](firestore.rules)):
  - Cada jugador solo puede leer y escribir sus propios datos.
  - Solo el servidor pone las marcas de tiempo.
  - El progreso total no puede bajar: un dispositivo con una partida vieja no sobrescribe la buena, y el juego carga la más avanzada.
  - Las puntuaciones tienen límites realistas y solo pueden subir, con un máximo de una subida cada 5 s.
  - Los nombres solo aceptan letras, números y `_ . -`.
  - Los retos diarios solo admiten resultados del día actual y con tiempos humanos.
- **Reloj de confianza**: se ancla a la hora del servidor y nunca retrocede con el juego abierto, así que cambiar la hora o la zona horaria del móvil no da ventaja.
- **Guardado robusto**:
  - Hay una copia de seguridad local, y una partida corrupta se aparta sin borrarla.
  - Solo puede haber una pestaña abierta a la vez.
  - No se sube nada a la nube hasta haber leído la nube.
  - Si la interfaz falla, aparece una pantalla de error que guarda la partida.
- **Bolsa**: tiene un límite de inversión, y sus ganancias no cuentan para estrellas ni rankings.

### Pruebas de las reglas
`npm run test:rules` ejecuta [tests/firestore.rules.test.mjs](tests/firestore.rules.test.mjs) contra el emulador local de Firestore, sin tocar la base de datos real. Son 130 casos, permitidos y de ataque. Las ventanas de la Copa dependen del día, así que la prueba comprueba la fase del día en que se ejecuta. Con `CUP_SHIFT_DAYS=2.5` (o el número de días que haga falta) se simula el sábado o el domingo en una copia de las reglas en memoria. Necesita Java instalado.

### Pasos recomendados en la consola (una vez)
1. **Restringir la API key**:
   - Dónde: Google Cloud Console → APIs y servicios → Credenciales → *Browser key (auto created by Firebase)*.
   - Qué hacer: en *Restricciones de aplicaciones*, elige *Sitios web* y añade `https://TU-DOMINIO.vercel.app/*`, `http://localhost:5173/*` y `https://game-f5ffa.firebaseapp.com/*`.
   - Resultado: la clave solo funciona desde tu web.
2. **App Check** (opcional, frena bots que llenen el ranking):
   - Crea una clave de reCAPTCHA v3.
   - Regístrala en Firebase → App Check.
   - Pon `VITE_RECAPTCHA_SITE_KEY` en Vercel.
   - Cuando veas que el tráfico está verificado, activa *Aplicar* para Firestore.
3. **Google en iPhone** (Safari bloquea el inicio de sesión si el dominio de autenticación es otro). [vercel.json](vercel.json) ya redirige `/__/auth/*` a Firebase. Para usarlo:
   - En Vercel, pon `VITE_FIREBASE_AUTH_DOMAIN=TU-DOMINIO.vercel.app`.
   - En Google Cloud → Credenciales → *Web client (auto created by Google Service)* → *URIs de redireccionamiento autorizados*, añade `https://TU-DOMINIO.vercel.app/__/auth/handler`.
4. **Cabeceras**: [vercel.json](vercel.json) incluye una política CSP en modo *solo informe*.
   - Después de publicar, abre la consola del navegador (F12) y juega un rato.
   - Si no aparece ningún aviso `Content-Security-Policy`, cambia `Content-Security-Policy-Report-Only` por `Content-Security-Policy` para aplicarla.

### Límites conocidos
El juego corre en el navegador del jugador, así que alguien con conocimientos puede modificar su propia partida. Las reglas bloquean lo imposible y lo que afecta a otros jugadores, pero no pueden verificar que una puntuación "posible" se consiguió jugando. Para eso haría falta validar en servidor con Cloud Functions (plan Blaze).

## Estructura

```
src/
  game/          economía, estado, store (zustand), reloj del servidor, nube y rankings
  minigames/     stack/, traffic/ y metro/ (canvas), merge/ (2048), daily/ (Apagón), roads/ (Calles),
                 parks/ (Plan verde), memory/, thief/, fire/ (Bomberos), wheel/, stocks/
  ui/            pestañas, barra superior, modales, globo dorado, sugerencias
  ui/music/      música generativa: compose.ts (estilos y melodías) y engine.ts (WebAudio)
  admin/         panel de administración (métricas, jugadores, sugerencias)
firestore.rules  seguridad: cada jugador solo escribe lo suyo; los rankings solo suben
```

## Datos en Firestore

| Ruta | Contenido |
|---|---|
| `users/{uid}` | partida guardada (solo la lee y escribe su dueño) |
| `leaderboards/{stack\|merge\|city\|stars\|thief\|traffic\|memory\|fire\|metro}/scores/{uid}` | mejor puntuación de cada jugador |
| `daily/{AAAA-MM-DD}/scores/{uid}` | resultado del Apagón diario (un intento registrado) |
| `roads/{AAAA-MM-DD}/scores/{uid}` | resultado de Conecta las calles (un intento registrado) |
| `parks/{AAAA-MM-DD}/scores/{uid}` | resultado del Plan verde (un intento registrado) |
| `cities/{uid}` | ciudad pública para las visitas, con su vitrina de copas y temporadas (cualquiera la lee; solo su dueño la escribe) |
| `cup/{lunes}/entries/{uid}` | inscripción en la Copa de esa semana (solo de lunes a viernes) |
| `cup/{lunes}/results/{uid}` | mejores marcas de la Copa: `g1`–`g3` el sábado y `f` el domingo |
| `league/{lunes AAAA-MM-DD}/scores/{uid}` | puntos de liga de cada jugador en esa semana (solo suben, máximo 1000) |
| `suggestions/{id}` | sugerencias de los jugadores (solo las lee el administrador) |
| `suggestionMeta/{uid}` | hora del último envío de sugerencia (limita a una por minuto) |

La partida se guarda en `localStorage` cada 5 s y en Firestore cada 60 s, y también al minimizar la app. Las ganancias offline y los tickets usan la hora del servidor, así que adelantar el reloj del móvil no da ventaja.

> Las puntuaciones las envía el cliente. Las reglas bloquean los valores imposibles y la escritura en datos ajenos, pero no un tramposo decidido. Para validar en servidor hacen falta Cloud Functions (plan Blaze).
