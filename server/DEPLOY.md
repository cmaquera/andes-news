# Desplegar Andes en Dokploy

El APK 0.2 consulta un servicio de Andes (`POST /summary`). La URL de Ollama se configura únicamente en ese servicio. No pongas el dominio de Ollama en Ajustes del APK: sus rutas y respuestas son diferentes.

## 1. Preparar el código

El paquete contiene `server/Dockerfile`, `server/summary.mjs` y `compose.yaml`. Sube esos archivos a un repositorio accesible para tu Dokploy. No subas archivos `.env` con secretos.

## 2. Crear el servicio

En Dokploy crea un proyecto o servicio **Docker Compose**, conecta el repositorio y selecciona `compose.yaml`. Usa el modo Docker Compose, no Stack: el archivo construye la imagen con `build`.

En Environment configura:

```dotenv
ANDES_API_TOKEN=TU_TOKEN_ALEATORIO
OLLAMA_URL=https://ollama-qwen.cmaquera.com
```

Genera el token en tu servidor y guárdalo en tu gestor de contraseñas:

```bash
openssl rand -hex 32
```

El mismo token se introduce después en el APK. No lo pegues en el chat ni lo incluyas en Git. El servidor no arranca si no hay un token de al menos 32 caracteres. El modelo está fijado a `qwen3:4b-instruct-2507-q4_K_M` en Compose.

Despliega. El contenedor se une a la red externa `dokploy-network`, expone internamente el puerto 8787 y conserva hasta 500 resultados durante siete días en el volumen `andes-cache`. No carga otro modelo: consulta el Ollama que ya tienes.

## 3. Configurar un dominio para Andes

En Domains añade un subdominio que elijas para **el servicio andes-api**, puerto **8787**, ruta `/`, con HTTPS. Su DNS debe llegar a tu servidor. No configures otra vez el dominio público de Ollama para este servicio.

Comprueba `https://TU_DOMINIO_DE_ANDES/health`: devuelve `{"status":"ok"}`. Es una comprobación de vida del servicio, no una comprobación de que Ollama esté disponible. Sin token, una petición a `/summary` devuelve 401.

## 4. Conectar el celular

Instala el APK 0.2 y abre Ajustes:

- URL del servicio de Andes: `https://TU_DOMINIO_DE_ANDES`.
- Token de acceso: el valor que configuraste en Dokploy.
- Guarda la conexión y abre una noticia → Resumir en español.

La app guarda el token usando Flutter Secure Storage. No se incluye ninguna credencial en el APK. La traducción se muestra como título; el original sigue en Extracto original. Al volver al feed, las noticias procesadas muestran su titular en español. Los resultados del teléfono se conservan para lectura sin conexión.

## 5. Restringir el acceso directo a Ollama

El token de Andes **no protege** el dominio público de Ollama que ya existe. La configuración inicial lo usa porque comprobamos esa URL, pero antes de dejarlo funcionando de forma permanente conviene que Andes consulte Ollama por una dirección privada y retirar su exposición pública sin autenticación.

Si Ollama está en un contenedor de la misma red, cambia `OLLAMA_URL` por `http://NOMBRE_DEL_SERVICIO_OLLAMA:11434`. Si se ejecuta directamente en Ubuntu, configura una ruta privada accesible desde la red Docker antes de retirar el dominio; `localhost` dentro de andes-api representa el propio contenedor, no Ubuntu. No cambies la URL a ciegas: primero comprueba la conectividad interna. El acceso móvil desde Wi-Fi y datos móviles seguirá pasando por el dominio HTTPS de Andes.

## Límites y diagnóstico

- Una inferencia simultánea para compartir la GTX 1650 con tus servicios. Si está ocupado devuelve 429 y la app permite reintentar.
- Hasta 30 peticiones autenticadas por minuto; entrada limitada a titular de 500 caracteres y extracto de 1800.
- Contexto 2048, salida hasta 300 tokens, cuatro hilos de CPU, modelo retenido diez minutos.
- 401: revisar el token; 404: revisar el dominio/ruta de Andes; 503: verificar Ollama, el modelo y conectividad.
- No se extrae el artículo completo. Sin extracto se traduce solo el título y se aclara la limitación.
- No hay traducción automática de todo el feed todavía: cada noticia se procesa al solicitarla y se reutiliza desde caché.

La prueba real desde el entorno de desarrollo contra Ollama obtuvo JSON válido en 6,94 segundos. La rapidez depende del texto, carga del servidor y estado del modelo. El despliegue en tu Dokploy y el acceso desde un teléfono físico están pendientes de verificar.

Referencias: [Docker Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose), [API de Ollama](https://docs.ollama.com/api/generate).
