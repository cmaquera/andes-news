# Andes News

Android en Flutter y backend de noticias de programación y tecnología para Perú y Latinoamérica. Versión 0.3: el servidor recopila fuentes cada dos horas, recupera el cuerpo de los artículos, genera abstractos en español y conserva una lectura limpia con texto original y traducción cuando hace falta.

## Arquitectura

```mermaid
flowchart TD
  RSS[RSS y APIs de seis fuentes] --> COL[Recopilador cada dos horas]
  COL --> EXT[Descarga pública y extracción del cuerpo]
  EXT --> DB[(SQLite persistente)]
  DB --> Q[Cola: una noticia a la vez]
  Q --> LLM[Qwen3 de 4B en Ollama privado]
  LLM --> DB
  DB --> API[API de Andes con token]
  API --> APP[Android: abstracto y lector nativo sin páginas web]
```

La app no consulta las fuentes ni ejecuta inferencias. Obtiene noticias y artículos preparados mediante la API. Cambiar los filtros o deslizar el feed consulta el servidor; no inicia otra recopilación.

## Procesamiento

- Recopila Gestión Tecnología, Xataka México, Genbeta, GitHub Changelog, DEV en español y Hacker News. Hasta 20 candidatos por fuente en cada ciclo; Hacker News inspecciona hasta 40 historias técnicas.
- Deduplica por URL, conserva procedencia y prioriza fuentes de Perú/Latinoamérica dentro de cada día y temas técnicos.
- Descarga el HTML público, respeta `robots.txt` y extrae el cuerpo con Mozilla Readability. Elimina scripts, publicidad identificable, navegación y diálogos de cookies. No ejecuta JavaScript ni carga páginas dentro del lector.
- Para DEV obtiene el cuerpo publicado desde su API pública de artículos, en lugar de utilizar la descripción breve del listado.
- Guarda párrafos, títulos, listas, citas y bloques de código. Las figuras, vídeos, PDF y páginas que requieren JavaScript no tienen representación completa en este lector de texto.
- Procesa **todas** las partes del texto recuperado con contexto de 2048 tokens. Combina notas de forma jerárquica y genera un abstracto de hasta 160 palabras y puntos clave. No usa el extracto del RSS para generar el abstracto.
- Traduce el titular y el cuerpo cuando el idioma detectado no es español. Traduce por bloques y conserva intactos los bloques de código. La app permite alternar español/original.
- Guarda resultados y caché de las inferencias en SQLite, en el volumen existente `andes-cache`. Conserva artículos y caché durante 60 días; recupera trabajos interrumpidos después de reiniciar.
- Descubrimiento e inferencia usan bucles separados: la consulta cada dos horas sigue funcionando aunque haya una cola de artículos pendientes. Las noticias se preparan progresivamente; no hay garantía de que toda una carga termine antes del siguiente ciclo.

`extracted` indica cuerpo recuperado por el extractor, no una garantía editorial de que la página entregó cada elemento del artículo. `partial` señala restricciones detectadas de la fuente. Los errores de acceso, robots, contenido insuficiente o formatos no soportados se registran; se reintenta hasta tres veces y nunca se inventa un artículo completo a partir del titular. Los abstractos y traducciones siguen siendo resultados de IA y pueden contener errores.

## Android

El dominio predeterminado es `https://andes-news.cmaquera.com`. En Ajustes introduce tu token `ANDES_API_TOKEN`; la URL se puede cambiar. El token se almacena con Flutter Secure Storage y no está incluido en el APK.

El lector tiene Abstracto y Artículo limpio. El enlace original queda como acción secundaria explícita. Al guardar una noticia, intenta descargar su cuerpo; si no hay conexión o el servidor aún no lo preparó, conserva los datos disponibles. El contenido abierto se guarda en caché para lectura sin conexión.

```powershell
flutter pub get
flutter analyze
flutter test
flutter build apk --release --target-platform android-arm64
```

El APK queda en `build/app/outputs/flutter-apk/app-release.apk`. Se firma con la clave de desarrollo para pruebas personales. Antes de distribuir en Play Store hace falta configurar una firma propia.

## Backend y despliegue

Sigue [server/DEPLOY.md](server/DEPLOY.md). Dokploy construye el backend Node.js 22 con sus dependencias desde `compose.yaml`. Mantén una sola instancia para compartir la cola y la base de datos con tu GPU.

```dotenv
ANDES_API_TOKEN=TU_TOKEN_ALEATORIO
ANDES_PORT=8787
OLLAMA_SERVICE_HOST=host.docker.internal
OLLAMA_SERVICE_PORT=11434
```

El contenedor llega al Ollama existente en Ubuntu por la red privada de Docker, no por un dominio público. Usa `qwen3:4b-instruct-2507-q4_K_M`, cuatro hilos de CPU y una inferencia a la vez. No instala ni descarga otro modelo.

Para desarrollo local fuera de Docker configura el token y una ruta de SQLite dentro del proyecto antes de iniciar `node server/app.mjs`. Ollama se busca por defecto en `127.0.0.1:11434`.

## API

- `GET /` y `GET /health`: estado básico sin credenciales.
- `GET /articles?limit=100&offset=0`: metadatos, abstractos preparados, estado de colección y cola.
- `GET /articles/:id`: cuerpo original y traducción, en bloques de texto.
- `GET /sources`: fuentes configuradas.
- `GET /status`: último ciclo, próximo ciclo y trabajos pendientes.

Estas rutas de datos requieren `Authorization: Bearer TOKEN`. `/summary` devuelve 410: la versión anterior resumía extractos y fue sustituida por el procesamiento de artículos en segundo plano. Es necesario actualizar backend y APK juntos.

Las solicitudes a publicaciones se limitan a HTTP/HTTPS público con DNS comprobado y fijado a la conexión. Se rechazan direcciones privadas, redirecciones inseguras, HTML de más de 2 MB y documentos de más de 30000 elementos. Ollama es la única conexión interna intencionada.

## Verificación

```powershell
npm.cmd ci --prefix server --ignore-scripts
npm.cmd test --prefix server
flutter analyze
flutter test
```

Las pruebas cubren extracción limpia, contenido parcial, robots, bloqueo de direcciones privadas, procesamiento de todas las partes, persistencia/reanudación, recopilación cada dos horas durante inferencia, exclusión de trabajadores concurrentes, autenticación y lector original/traducido en pantalla pequeña.

La extracción real se comprobó con un artículo de Genbeta de 509 palabras y un changelog de GitHub de 428 palabras. Las pruebas automáticas de inferencia usan respuestas simuladas; el procesamiento completo con tu GPU, el nuevo despliegue en Dokploy y la instalación en un teléfono físico deben verificarse al desplegar. No hay motor Docker activo en el entorno de desarrollo para construir localmente la imagen; el Compose sí se validó.

## Diseño y atribución

Interfaz adaptada de [TrendSpot News App](https://www.figma.com/community/file/1339560523860969699/trendspot-news-app), de [Hameed Shah](https://www.figma.com/@hameedshah), bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Se modificaron marca, textos, navegación, fuentes y lector. La atribución también aparece en Ajustes. No se copiaron fotografías de ejemplo.

Referencias: [Mozilla Readability](https://github.com/mozilla/readability), [API de Ollama](https://docs.ollama.com/api/generate), [API de Hacker News](https://github.com/HackerNews/API), [Forem API](https://developers.forem.com/api/v1).
