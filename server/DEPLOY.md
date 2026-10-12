# Andes en Dokploy con Ollama privado en Ubuntu

La app llama a la API pública de Andes. La versión 0.4 recopila fuentes cada dos horas, recupera cuerpos de artículos con imágenes, tablas y videos compatibles y procesa abstractos y traducciones en una cola automática. El contenedor consulta al Ollama existente en Ubuntu por la red interna. No se inicia un segundo Ollama ni se descargan otros modelos.

## Actualizar desde versiones anteriores

La versión 0.4.3 organiza el backend en `src`, `tests` y `scripts`, con Fastify 5. Redespliega `main` para reconstruir la imagen con el nuevo Dockerfile: copia `src` y `scripts` y arranca `node src/server.mjs`. Conserva `ANDES_API_TOKEN`, los puertos y el volumen `andes-cache`; no hay cambios de esquema de SQLite ni de acceso a Ollama. El APK 0.4 instalado sigue siendo compatible y no necesita reinstalarse. La ruta pública `/` mostrará `version: "0.4.3"` tras el despliegue.

Para el filtro de desarrollo de software e IA del backend 0.4.1, redespliega `main` conservando el volumen y el token. El APK 0.4 es compatible y no requiere reinstalarse. Al arrancar, el servidor revisa las noticias existentes y aparta del feed/cola las irrelevantes sin borrar su detalle. Actualiza el feed del celular al terminar el despliegue.

Vuelve a desplegar desde `main`, construyendo la imagen nueva, e instala el APK 0.4. Conserva el token, las variables de puertos y el volumen `andes-cache`. El contenedor crea `/data/andes.db` para artículos, cola y caché. El antiguo `cache.json` de 0.2 no se reutiliza porque no corresponde al contenido completo. Si vienes de 0.3, las noticias capturadas se ponen una sola vez en la cola para recuperar multimedia y tablas, conservando su lectura y abstracto mientras esperan. Este trabajo es progresivo; no borres el volumen.

Usa una sola réplica. No borres el volumen al volver a desplegar: conserva los artículos y los trabajos pendientes.

El primer arranque descubre hasta 20 candidatos de cada fuente y los procesa uno a la vez. El feed muestra los estados de espera y las noticias preparadas progresivamente. La traducción de artículos completos y sus abstractos puede tardar bastante más que las pruebas anteriores con textos de unas pocas líneas.

Si falla la extracción o el modelo, se reintenta hasta tres veces con dos horas de espera entre intentos. Las partes de inferencia ya procesadas se reutilizan desde caché. Los fallos se registran en los logs y en el estado de la noticia.

## Variables y puerto configurable

Crea un servicio Docker Compose en Dokploy con el repositorio `cmaquera/andes-news`, rama `main` y archivo `compose.yaml`. Usa Docker Compose, no Stack, porque se construye la imagen con `build`.

En Environment configura:

```dotenv
ANDES_API_TOKEN=TU_TOKEN_ALEATORIO
ANDES_PORT=8787
```

Genera el token en Ubuntu con `openssl rand -hex 32` y guárdalo en tu gestor de contraseñas. No lo incluyas en Git ni lo pegues en el chat. La app y Andes deben tener el mismo token.

`ANDES_PORT` controla el puerto **dentro del contenedor** y su healthcheck. Si quieres usar 9090, define `ANDES_PORT=9090` y pon también **9090** en Domains de Dokploy. El acceso público pasa por el dominio HTTPS de Dokploy.

### Probar directamente desde la red local

El Compose publica también el puerto en `127.0.0.1` del servidor por defecto. Para acceder desde otro equipo por la dirección de tu servidor, configura:

```dotenv
ANDES_BIND_IP=192.168.0.200
ANDES_HOST_PORT=8787
ANDES_PORT=8787
```

Vuelve a desplegar. Abre `http://192.168.0.200:8787/health`: debe devolver `{"status":"ok"}`. La raíz `http://192.168.0.200:8787/` devuelve información de la API; no es una página web de noticias. `ANDES_HOST_PORT` es el puerto del servidor y puede diferir de `ANDES_PORT`, el puerto del contenedor. La IP debe existir en Ubuntu y el puerto debe estar disponible.

Esta publicación permite comprobar la API en la LAN. La app Android requiere el dominio HTTPS de Andes para usar el token fuera del emulador; no introduzcas la URL HTTP de prueba en el APK. El acceso público continúa mediante Dokploy. El healthcheck confirma la API, no la conexión con Ollama.

Si después de desplegar no responde, ejecuta en Ubuntu:

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -i --connect-timeout 5 http://192.168.0.200:8787/health
```

Busca el contenedor de Andes y el mapeo `192.168.0.200:8787->8787/tcp`. Si el contenedor no está activo, revisa los logs de despliegue de Dokploy. Si responde en Ubuntu pero no desde otro equipo, revisa el acceso de red y las reglas de firewall.

El Compose añade automáticamente el alias `host.docker.internal` hacia `host-gateway`, de forma que el contenedor encuentra Ubuntu sin una IP fija escrita en el proyecto. Estos valores opcionales ya tienen defaults:

```dotenv
OLLAMA_SERVICE_HOST=host.docker.internal
OLLAMA_SERVICE_PORT=11434
```

Elimina la variable antigua `OLLAMA_URL` de Dokploy. El servicio ya no la usa. Cambiar `ANDES_PORT` no cambia el puerto de Ollama.

## Permitir acceso a Ollama desde Docker

Ollama puede estar escuchando solo en `127.0.0.1`. Docker identifica el host, pero no puede acceder a un servicio que escucha únicamente en el loopback de Ubuntu. Configura Ollama para escuchar en la interfaz **privada de Docker**, sin abrirlo en todas las interfaces públicas.

1. En Ubuntu consulta la dirección de la interfaz bridge de Docker:

   ```bash
   sudo docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
   ```

2. Edita la configuración del servicio:

   ```bash
   sudo systemctl edit ollama.service
   ```

   Añade lo siguiente, sustituyendo `172.17.0.1` por la dirección que obtuviste. Es una dirección de ejemplo, no asumas que coincide con tu servidor:

   ```ini
   [Service]
   Environment="OLLAMA_HOST=172.17.0.1:11434"
   After=docker.service
   Wants=docker.service
   ```

   `OLLAMA_HOST` pertenece al proceso Ollama en Ubuntu. `OLLAMA_SERVICE_HOST` pertenece a Andes: son configuraciones distintas.

3. Recarga y reinicia Ollama. Esto interrumpe brevemente las inferencias en curso:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   sudo ss -lntp '( sport = :11434 )'
   ```

   Debe escuchar en la dirección privada elegida. No necesitas cambiar el modelo ni configurar el token de Andes en Ollama.

   Para usar la CLI de Ollama en la misma sesión SSH después de cambiar la dirección, configura también `export OLLAMA_HOST=172.17.0.1:11434`, sustituyendo la IP real, antes de `ollama list` o `ollama ps`.

## Desplegar y comprobar

Despliega Andes. Se une a `dokploy-network` y guarda la caché en el volumen `andes-cache`.

En la terminal del contenedor **andes-api** de Dokploy, comprueba la comunicación interna:

```bash
node -e 'fetch("http://"+process.env.OLLAMA_SERVICE_HOST+":"+process.env.OLLAMA_SERVICE_PORT+"/api/tags").then(async r=>{if(!r.ok)throw Error("HTTP "+r.status);console.log(await r.text())}).catch(e=>{console.error(e.message);process.exit(1)})'
```

Debe mostrar los modelos instalados, incluido `qwen3:4b-instruct-2507-q4_K_M`. Si falla, revisa el servicio Ollama, la dirección de escucha y las reglas de firewall para el tráfico privado de Docker. No abras 11434 a Internet. Si tu daemon usa un `host-gateway` personalizado, la dirección de escucha debe coincidir con ese gateway en lugar del bridge por defecto.

En Domains configura un dominio HTTPS para **andes-api**, ruta `/` y el puerto elegido en `ANDES_PORT`. `https://TU_DOMINIO_DE_ANDES/health` devuelve `{"status":"ok"}`; esto confirma la vida de la API, no la disponibilidad del modelo.

En el APK 0.4 → Ajustes introduce ese dominio de Andes y el token. La URL predeterminada ya es `https://andes-news.cmaquera.com`. Abre una noticia preparada: su abstracto llega listo desde el backend y Artículo limpio permite leer original/traducción con imágenes y tablas sin abrir la página del medio. Los videos directos se reproducen bajo demanda; YouTube/Vimeo abren su reproductor externo. Una vez comprobado este recorrido, retira el dominio/proxy público de Ollama. Ollama continúa funcionando dentro del servidor.

`GET /status`, con el token, muestra el último ciclo y los contadores `queued`, `processing`, `ready` y `unavailable`. `GET /articles`, también autenticado, entrega el feed. La raíz y `/health` siguen siendo públicos y solo indican que la API está activa. El endpoint `/summary` anterior devuelve 410.

```bash
curl --fail-with-body -sS "https://andes-news.cmaquera.com/status" -H "Authorization: Bearer TU_API_KEY"
```

Sustituye `TU_API_KEY` por el valor de `ANDES_API_TOKEN`. Si quieres formatear el JSON y tienes `jq`, añade `| jq`. En PowerShell usa `curl.exe` con los mismos argumentos.

## Si Ollama se mueve a otro contenedor en el futuro

Conecta ambos contenedores a `dokploy-network` y define `OLLAMA_SERVICE_HOST` con el nombre DNS del servicio Ollama, por ejemplo `ollama`, y `OLLAMA_SERVICE_PORT=11434`. No es necesario añadir un dominio público. El cambio actual usa el Ollama existente en Ubuntu; no descubre ni mueve otros servicios automáticamente.

## Límites y diagnóstico

- `GET /articles`, `/articles/:id`, `/sources` y `/status` exigen `Authorization: Bearer TOKEN`; el token se guarda de forma segura en Android.
- Una inferencia simultánea, contexto 2048, notas por fragmentos, reducción jerárquica y traducción por bloques. Las respuestas largas permiten hasta 850 tokens de salida; cuatro hilos de CPU y modelo retenido diez minutos.
- SQLite persistente, con artículos y caché conservados durante 60 días. La API no inicia inferencias por cada lectura.
- Cuerpos públicos de hasta 2 MB de HTML y 30000 elementos. Respeta robots y rechaza direcciones privadas/redirecciones inseguras para las fuentes.
- 401: token incorrecto; 404: ruta o noticia inexistente; 410 en `/summary`: actualizar el APK. Los fallos del modelo y las fuentes aparecen en los logs, `/status` y el estado de la noticia.
- Si no se recupera un cuerpo suficiente, no se fabrica un abstracto con el extracto del RSS. Las restricciones detectadas se marcan como contenido parcial.

El contenedor tiene límite de 768 MB de RAM y una CPU para la extracción y la API. Ollama continúa fuera del contenedor con su propia GPU/RAM. Las pruebas validan extracción, procesamiento completo por fragmentos, almacenamiento, programación y lector. La conexión privada y el procesamiento real en tu Ubuntu deben comprobarse al desplegar; no se ha modificado remotamente tu servidor.

Referencias: [host-gateway de Docker](https://docs.docker.com/reference/cli/docker/container/run/#add-entries-to-container-hosts-file---add-host), [variables de Ollama en Linux](https://docs.ollama.com/faq#setting-environment-variables-on-linux), [Docker Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose).
