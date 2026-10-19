# Revisión de desarrollo y feedback humano

El panel se ejecuta fuera de la app, solo en `127.0.0.1`. Lee una captura privada del inventario y guarda las valoraciones en una base local independiente. Guardar feedback **no publica, descarta, modifica noticias ni entrena automáticamente el modelo**.

Desde la raíz del repositorio:

```powershell
# Exportar donde esté disponible la base del backend (Node 22.16+).
node server/scripts/export_review_snapshot.mjs RUTA_A_ANDES_DB build/review/snapshot.json
# Abrir http://127.0.0.1:8791
node server/src/review/server.mjs build/review
```

Para producción, ejecutar el exportador dentro del contenedor, con la base `/data/andes.db`, y copiar el JSON por SSH a `build/review/snapshot.json`. No abrir SQLite mediante `Store`: su constructor realiza migraciones y recupera trabajos. El exportador utiliza `DatabaseSync` en modo de solo lectura. No requiere token de API ni credenciales en el navegador. La captura contiene títulos, resúmenes y extractos de hasta 16.000 caracteres; mantenerla privada. No exponer este servidor mediante proxy, túnel o red pública.

## Cómo revisar

1. Filtrar por descartadas, revisión/error, duplicados, piloto, preparadas o pendientes. Buscar por título, URL o motivo y elegir una fuente.
2. Contrastar la decisión, los motivos, el resumen, el extracto y el original. En un duplicado, comparar ambas noticias. Un candidato semántico **no** es un duplicado confirmado. Varias apariciones de la misma URL tampoco son varias noticias.
3. Marcar **Está bien / Está mal**, indicar opcionalmente qué debería hacer Andes, la fidelidad del resumen y si el par trata del mismo hecho. Escribir qué corregir y guardar.
4. Repetir con ejemplos buenos y malos. Exportar el feedback en JSON para analizarlo durante el desarrollo.

El inventario incluye registros ocultos y filtrados, sin el límite de 1.000 de `/evaluations`. “Preparada para feed” describe el estado técnico: no prueba que se haya mostrado en un dispositivo. “Filtrada” no implica por sí sola rechazo por IA. Se muestra el estado final del artículo junto con el registro de evaluación, que puede ser anterior al estado final. Los contadores describen esta captura; no son medidas de precisión de producción.

## Persistencia y ajustes

`build/review/snapshot.json` es la captura. `build/review/feedback.db` conserva cada valoración y corrección con fecha, noticia, evaluación observada y huella de versión. Ambos quedan ignorados por Git. Conservar una copia privada de la base o exportar antes de cambiar de equipo. No borrar `feedback.db` al actualizar la captura. Reiniciar el proceso para cargar una nueva captura; el feedback de una evaluación que cambió se marca como anterior y se conserva en el historial. La exportación incluye todo el historial: para evaluar resultados se utiliza la última valoración de cada noticia y huella, evitando contar correcciones como votos independientes.

Los ajustes posteriores deben partir de patrones y casos contrastados: falsos descartes, aceptaciones irrelevantes, falsos duplicados y resúmenes infieles. Después se reevalúan los casos etiquetados, separando ejemplos usados para ajustar de ejemplos reservados para validar. El feedback no se convierte automáticamente en reglas ni en acciones sobre producción.

El panel no tiene sincronización remota ni gestión multiusuario. El feedback identifica una revisión local del desarrollador. En “Noticia para comparar” se puede elegir cualquier otra noticia de la captura para señalar duplicados omitidos o comparar un candidato automático. La exportación conserva la identidad y huella de ambas noticias; si cambia cualquiera de ellas, la interfaz marca ese feedback como anterior.
