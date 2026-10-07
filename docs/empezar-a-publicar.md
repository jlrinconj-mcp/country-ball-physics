# Empezar a publicar bolworld

El flujo inicial es elegir una carrera o torneo en la aplicación, probar **Ver vista previa**, pulsar **Grabar video**, revisar sus MP4 en **Mis videos** y subirlos manualmente a Instagram, TikTok y YouTube.

## 1. Configurar y generar un video

Desde este repositorio:

```bash
npm run dev
```

Abre la URL que indique Next.js. La vista previa empieza pausada. Elige el modo, los participantes, mapa o circuito, semilla, física, formato y español o inglés. Puedes usar **América** o **América · 20**, o abrir **Edit selection** para elegir países individualmente.

Para el mini torneo, selecciona **Mini torneo · 20 países de América**. Revisa sus cuatro grupos de cinco antes de empezar; cada ganador avanza a la final de cuatro. Puedes reemplazar cualquiera de sus 20 países por otro país soberano de América.

Pulsa **Ver vista previa** para ver la competencia antes de crear archivos. Puedes pausarla, reanudarla y ajustar la configuración. Cuando esté lista, pulsa **Grabar video**: la aplicación empieza desde el inicio y guarda una exportación con sonido. Durante la creación puedes **Pausar grabación**, **Reanudar grabación** o **Eliminar grabación**.

Abre **Mis videos** y despliega la carpeta de la grabación para reproducir sus partes dentro de la app. También puedes descargar cada parte MP4 y su **Texto JSON**, que incluye título, descripción y hashtags. Descarga el manifiesto completo si quieres guardar configuración, resultados y huella reproducible.

Consulta [la guía de grabación manual](grabacion-manual.md) para requisitos, cortes, archivos y reproducibilidad. Los MP4 anteriores de lanzamiento fueron eliminados; [esta lista identifica los 11 archivos](videos-eliminados.md). Sus portadas, reportes y recursos siguen disponibles.

## 2. Revisar y subir

Reproduce cada parte completa y revisa el inicio, las banderas, los textos, el sonido y el desenlace. Si hay varias partes, súbelas en el orden numerado y usa el título de cada parte de su JSON.

1. **Instagram:** abre la creación de un Reel en tu cuenta, selecciona el MP4 y usa su descripción o caption. Revisa la portada y la vista previa.
2. **TikTok:** selecciona el mismo MP4 en la pantalla de subida de tu cuenta y pega su texto.
3. **YouTube:** abre [YouTube Studio](https://studio.youtube.com/), sube el MP4 y usa el título y descripción. Completa audiencia y visibilidad según tu contenido.

La aplicación no conecta las cuentas ni publica automáticamente. No requiere tokens de redes sociales para este flujo.

## 3. Elegir el siguiente video

Registra el enlace y los resultados de cada publicación. Compara vistas, tiempo visto, compartidos y comentarios dentro de cada red y usa los países que pidan tus espectadores para configurar la siguiente carrera. Conserva el JSON y la semilla para repetir una competencia.

La integración futura tiene contratos de exportación, subida y transmisión en `src/export/types.ts`. Los adaptadores de redes se podrán añadir cuando se configure su autorización; el flujo manual actual no los invoca.
