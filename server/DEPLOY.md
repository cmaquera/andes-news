# Andes en Dokploy con Ollama privado en Ubuntu

La app llama a la API pública de Andes. El contenedor de Andes consulta al Ollama que ya tienes instalado en Ubuntu por la red interna. No se inicia un segundo Ollama ni se descargan otros modelos.

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

En el APK → Ajustes introduce ese dominio de Andes y el token. Abre una noticia y solicita su resumen. Una vez comprobado este recorrido, retira el dominio/proxy público de Ollama. Ollama continúa funcionando dentro del servidor.

## Si Ollama se mueve a otro contenedor en el futuro

Conecta ambos contenedores a `dokploy-network` y define `OLLAMA_SERVICE_HOST` con el nombre DNS del servicio Ollama, por ejemplo `ollama`, y `OLLAMA_SERVICE_PORT=11434`. No es necesario añadir un dominio público. El cambio actual usa el Ollama existente en Ubuntu; no descubre ni mueve otros servicios automáticamente.

## Límites y diagnóstico

- `POST /summary` exige `Authorization: Bearer TOKEN`; el token se guarda de forma segura en Android.
- Una inferencia simultánea, contexto 2048, máximo 300 tokens de salida, cuatro hilos de CPU y modelo retenido diez minutos.
- Hasta 30 peticiones autenticadas por minuto; titular máximo de 500 caracteres y extracto de 1800.
- Caché de hasta 500 resultados durante siete días, persistente entre reinicios del contenedor.
- 401: token incorrecto; 404: dominio/ruta de Andes incorrectos; 429: modelo ocupado; 503: revisar conexión interna y modelo.
- Sin extracto se traduce solo el titular; no se extrae el artículo completo.

El cambio de red se verificó con pruebas del servidor y validación del Compose. La conexión privada en tu Ubuntu debe comprobarse con los pasos anteriores; no se ha modificado remotamente tu servidor.

Referencias: [host-gateway de Docker](https://docs.docker.com/reference/cli/docker/container/run/#add-entries-to-container-hosts-file---add-host), [variables de Ollama en Linux](https://docs.ollama.com/faq#setting-environment-variables-on-linux), [Docker Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose).
