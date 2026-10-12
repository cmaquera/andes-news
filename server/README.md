# Backend de Andes News

Node.js 22.16+ y Fastify 5. El punto de entrada es `src/server.mjs`.

```text
server/
├── src/
│   ├── app.mjs                       # Construye Fastify y centraliza errores
│   ├── server.mjs                    # Arranque, trabajador y cierre
│   ├── config/
│   │   ├── env.mjs                   # Puertos, Ollama y configuración del servidor
│   │   └── sources.mjs               # Fuentes disponibles
│   ├── routes/articles.mjs           # Endpoints y respuestas de la API
│   ├── schemas/articles.mjs          # Validación de paginación e IDs
│   ├── plugins/authentication.mjs    # Token y política de rutas públicas
│   ├── services/
│   │   ├── article_extractor.mjs      # Texto, imágenes, tablas y videos
│   │   ├── focus.mjs                 # Filtro de desarrollo de software e IA
│   │   ├── ollama.mjs                # Resúmenes y traducciones
│   │   ├── public_http.mjs           # Descarga segura y robots
│   │   └── sources.mjs               # Lectura de RSS y APIs
│   ├── jobs/collector.mjs            # Recopilación cada dos horas y cola
│   └── repositories/sqlite_store.mjs # Persistencia, consulta y caché
├── tests/                           # API, configuración, filtro, cola y arranque
├── scripts/                         # Diagnóstico y recopilación manual
├── package.json
├── package-lock.json
├── .prettierrc.json
└── Dockerfile
```

`createApi()` recibe el repositorio y el trabajador como dependencias: registra rutas sin abrir un puerto, iniciar tareas ni crear una base de datos. `startServer()` crea los recursos, escucha el puerto, inicia el trabajador y gestiona su cierre. Esto permite comprobar rutas con `fastify.inject()` y el arranque con servicios simulados, sin consumir GPU.

Para añadir un endpoint modifica `routes` y define sus parámetros en `schemas`; la autenticación se aplica por defecto. Solo las rutas marcadas explícitamente con `config.public` son públicas. Mantén las operaciones de SQLite en `repositories` y la extracción/inferencia en `services`. La recopilación automática pertenece a `jobs`, no a las solicitudes de Android.

Desde esta carpeta:

```bash
npm ci --ignore-scripts
npm run format:check
npm test
npm start
```

Antes de iniciar configura `ANDES_API_TOKEN` y, fuera de Docker, `DATABASE_PATH` con una ruta escribible, por ejemplo `./build/andes.db`. `PORT` admite 1–65535; por defecto utiliza 8787. `HOST` por defecto es `127.0.0.1`; Docker establece `0.0.0.0`. No hay carga automática de `.env`: Dokploy/Compose o el shell deben proporcionar las variables.

Comandos de mantenimiento:

```bash
npm run format
npm run check:articles -- https://ejemplo.com/articulo
npm run check:ollama
npm run collect
```

Los últimos tres comandos consultan servicios reales. `collect` descubre candidatos; el trabajador del servidor prepara el contenido. Prettier es una dependencia de desarrollo y no se instala en la imagen de producción. El Dockerfile copia las carpetas de ejecución, conserva SQLite en `/data` y utiliza el usuario `node`.

Las pruebas cubren compatibilidad de la API, autenticación, validación, extracción, traducción simulada, filtrado, persistencia, periodicidad, exclusión de trabajadores y limpieza de recursos al fallar el arranque. No sustituyen la comprobación con Ollama en tu Ubuntu. Sigue [DEPLOY.md](DEPLOY.md) para desplegar y conserva el volumen y token existentes.
