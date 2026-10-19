# Política editorial candidata v4

`editorial_v4.mjs` conserva la variante experimental evaluada con el feedback humano. No la importa el servidor ni está habilitada mediante variables de producción. El servidor conserva la política v3; las mejoras de alcance léxico se evalúan por separado como `FOCUS_VERSION=2`.

La candidata amplía los criterios de utilidad, separa incertidumbre de rechazo y reduce el peso de los detalles técnicos y de la evidencia en la puntuación. La primera validación detectó una aceptación no deseada y pérdida de aceptación en controles. Por ello **no está aprobada para producción**. Conservarla permite reproducir el resultado y evitar presentar solo los experimentos favorables.

Para ejecutar una comparación aislada desde la raíz del proyecto:

```powershell
node server/scripts/evaluate_feedback.mjs build/review/dataset-full.json build/review/manifest-final.json build/review/replay-stable.json
node server/scripts/evaluate_feedback.mjs build/review/dataset-full.json build/review/manifest-final.json build/review/replay-candidate.json server/experiments/editorial_v4.mjs
```

El evaluador requiere acceso al servicio Laya configurado por `LAYA_URL`, `LAYA_REVISION` y, si corresponde, `LAYA_API_KEY`; no imprimir ni guardar credenciales en los informes. Ejecutar en serie: la instancia actual de Laya admite una solicitud concurrente y devuelve 503 cuando está ocupada. Los errores de servicio no son etiquetas editoriales. Los resultados fallidos pueden reintentarse con el mismo comando; los éxitos quedan conservados.

Los archivos de captura, etiquetas, predicciones y resultados son privados y deben permanecer en `build/review`. El evaluador usa archivos de entrada y caché aislada: no abre ni modifica una base de producción. Registra huellas del conjunto, manifiesto y código de política/alcance, y rechaza reutilizar un informe con entradas distintas. Conserva el cuerpo completo por ventanas, sin basarse en los extractos truncados del panel. La elegibilidad informada solo combina alcance y decisión editorial: aún faltan deduplicación, calidad del resumen, versión, fuente, cuota y puntuación mínima del piloto.

La muestra proviene de descartes elegidos por el usuario; contiene versiones históricas de IA, preferencias ambiguas y casos sin valoración por idioma o texto ausente. Se utilizan las últimas valoraciones y se excluyen las ambiguas de la evaluación binaria. La división de ajuste/validación agrupa textos repetidos. Sus etiquetas ya fueron inspeccionadas: no es una validación ciega ni una estimación de precisión/recall de producción. Los controles sin etiqueta humana miden continuidad de comportamiento, no verdad editorial.
