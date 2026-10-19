# Correcciones de fuentes y lector — Andes 0.6.1

El catálogo sumaba las seis fuentes originales y las instancias de Horizon. Eso mostraba dos Hacker News y una segunda Genbeta con su identificador técnico. La API ahora entrega una sola identidad por fuente y conserva la procedencia de cada captura. Los identificadores anteriores se envían como alias para trasladar las preferencias del teléfono; prevalece el interruptor de la fuente principal si ya existía. Los feeds distintos no se fusionan por compartir nombre.

En el Compose con Horizon, `HORIZON_MANAGED_SOURCES=hn,genbeta,github` evita que el colector anterior vuelva a consultar esas tres fuentes. Deben estar habilitadas en la configuración de Horizon; si se modifica esa configuración, ajustar la lista de fuentes gestionadas. El Compose básico continúa disponible para instalaciones sin Horizon.

Para arXiv, el extractor consulta la ficha oficial y conserva los enlaces HTML/PDF anunciados para el mismo documento y versión. Prefiere extraer el HTML cuando existe y se puede recuperar respetando robots y las restricciones de red. Si falla o no existe, identifica la lectura como ficha/resumen y cobertura parcial. El lector ofrece ambos formatos originales disponibles mediante aplicaciones externas. No presupone que todo paper tenga HTML ni descarga el PDF en segundo plano. El texto matemático conserva las limitaciones de la extracción: el formato original es la referencia para fórmulas y diagramas.

Las URL de ficha, HTML y PDF de arXiv se normalizan para evitar documentos repetidos por formato; versiones explícitamente diferentes mantienen identidades diferentes. También se filtran cuerpos idénticos entre noticias preparadas recientes aunque el piloto esté en sombra. La comparación semántica sigue siendo experimental: esto no garantiza eliminar todas las noticias sobre un mismo hecho. La búsqueda de cuerpos idénticos compara hasta 100 documentos visibles preparados en las últimas 72 horas.

Las tablas dejan de crear un desplazamiento vertical seleccionable por celda, que competía con el gesto del artículo. Mantienen el movimiento horizontal y las celdas combinadas. El texto de las celdas ya no admite selección individual.

Validación local: 47 pruebas Node, 9 pruebas Python contra los modelos reales de Horizon y 24 pruebas Flutter aprobadas. Las pruebas nuevas comprueban catálogo/alias, exclusión de capturas repetidas, procedencia de Horizon, formatos y versiones de arXiv, fallos de HTML, caché de enlaces, cuerpos duplicados y gestos verticales/horizontales iniciados sobre tablas. APK Android arm64 0.6.1+7 compilado.

Para actualizar una lectura científica ya preparada, `server/scripts/upgrade_papers.mjs` acepta `DATABASE_PATH` y `--ids=id1,id2`. Ejecuta simulación por defecto; `--apply` crea primero una copia SQLite y actualiza únicamente filas preparadas que no hayan cambiado concurrentemente. Conserva el resumen previo con su alcance explícito, sustituye la lectura por el cuerpo recuperado y retira su traducción anterior. No publica noticias ni genera una traducción o resumen nuevos. La lectura recuperada queda disponible en su idioma original.

La instalación en el teléfono y la verificación del despliegue se informan por separado al concluir la comprobación real.
