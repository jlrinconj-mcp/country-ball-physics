# Configuración y grabación manual

## Requisitos y uso

Necesitas las dependencias actuales del repositorio, Node >=22.12, FFmpeg y ffprobe en PATH. No se añadieron dependencias ni se cambiaron archivos de configuración. Arranca `npm run dev` y abre la URL indicada; también funciona en el servidor Node local con `npm run build` y `npm start`. Los datos y banderas reales necesitan conexión en su primera carga.

1. Elige el modo y escenario/mapa. Los modos de carrera permiten además el editor de circuito existente.
2. Elige países con los presets o **Edit selection**. Ajusta semilla, física, eliminación por ronda si corresponde, formato, cámara, idioma, HUD y encabezado.
3. Revisa **Configuración del video** y despliega los participantes y el sorteo. **Ver vista previa** reproduce toda la competencia sin crear archivos; puedes pausarla y reanudarla. **Nueva semilla** sólo cambia el borrador.
4. Cuando te guste el resultado, pulsa **Grabar video**. Empieza desde el inicio con la misma semilla y configuración, a 1×. **Pausar grabación** detiene tanto la reproducción como la creación del archivo; **Reanudar grabación** continúa desde el mismo punto del proceso. **Eliminar grabación** cancela la creación y elimina sus archivos.
5. Abre **Mis videos**: cada grabación aparece como una carpeta dentro de la app. Despliega la carpeta para reproducir las partes con controles de video, o descargar MP4 y metadatos. Las partes terminadas se pueden ver mientras se crean las siguientes. La biblioteca se conserva al recargar y permite pausar, reanudar y eliminar también desde la carpeta.

Sólo se produce la competencia elegida. No se encola una tanda ni se publica en redes. La vista previa permite que las banderas terminen de cargar; grabar exige todas las banderas reales antes de crear una grabación. La previsualización y la grabación utilizan el mismo motor y configuración determinista; la exportación ejecuta la línea de tiempo completa en un proceso Node separado con el renderer existente, no captura los fotogramas irregulares de la pantalla. Renderizar a resolución completa puede tardar más que la reproducción: cuando termina la competencia, la pantalla se detiene y muestra **guardando video** hasta que termina la codificación. Después se liberan los controles automáticamente. La pausa de la grabación se conserva en el servidor y no agrega fotogramas ni silencios al MP4. Los efectos del MP4 siempre tienen sonido; las guías de áreas seguras sólo aparecen en la vista previa.

## Mini torneo de América

El formato de 20 requiere **exactamente 20 países soberanos de América** y **Last Place Elimination**. Rechaza 19, 21, territorios, países de otras regiones y otros modos de partida. El modo y los 20 participantes aparecen antes de iniciar.

La propuesta predeterminada es editable:

- Norte: Canadá, Estados Unidos, México.
- Centroamérica: Guatemala, Honduras, El Salvador, Costa Rica, Panamá.
- Caribe: Cuba, República Dominicana, Jamaica, Haití.
- Sudamérica: Colombia, Venezuela, Ecuador, Perú, Bolivia, Brasil, Chile, Argentina.

La semilla sortea cuatro grupos de cinco. Se juegan en orden 1, 2, 3, 4; gana y avanza exactamente uno por grupo. La final enfrenta a los cuatro ganadores, en ese orden. Cada partida utiliza la semilla derivada `semilla/r1-h1` ... `semilla/r1-h4`, y la final `semilla/r2-h1`. El panel muestra participantes, semillas, clasificación, ganadores y huellas de cada partida. `tournaments/americas-20.json` contiene la misma propuesta para las herramientas existentes de torneo.

## Cortes y continuidad

Los archivos se codifican directamente por partes a 30 FPS. El presupuesto de cada parte es **119 segundos**, dejando margen para los paquetes AAC y el contenedor. FFprobe comprueba que cada MP4 dure **como máximo 120 segundos**; FFmpeg lo decodifica completo para validar el archivo. Cada parte usa H.264, yuv420p, AAC y faststart.

Un solo `RecordingTimeline` mantiene el torneo, la partida, cuerpos físicos, generadores aleatorios y ticks durante toda la exportación. Cerrar el codificador de una parte y abrir el siguiente no reinicia la simulación, no vuelve a sortear ni crea una nueva semilla. Si el corte ocurre dentro de una partida, el primer frame siguiente continúa desde su mismo tick. La cámara, HUD y mezcla de audio continúan; se liberan las muestras antiguas conservando sonidos que crucen el corte. Entre partidas se conservan cuatro segundos de resultado; al finalizar, tres segundos y medio.

En `output/manual/<UUID>/` se guardan:

- `part-001.mp4`, `part-002.mp4`, etc., en orden. Nunca se escribe un MP4 maestro de más de dos minutos.
- `part-001.json`, etc.: título **Parte N/total**, descripción, caption, hashtags, configuración y posiciones de inicio/fin.
- `metadata.json`: manifiesto completo con solicitud, partes, duración, ticks, resultados, torneo y huella.
- `job.json` y `countries.json`: estado interno persistente y los datos de países seleccionados por el servidor.

Los cortes registran tick global, semilla de partida y tick local: el inicio de cada parte coincide con el final de la anterior. La configuración y la misma semilla reproducen los resultados existentes. La física no se modifica para cumplir el límite de video.

## Alcance local y extensiones

Mantén el servidor local encendido hasta terminar. Se admite una grabación a la vez. Si el worker se interrumpe, la biblioteca informa el fallo; puedes repetir la configuración y semilla. Las partes completas ya guardadas siguen descargables. No hay reanudación tras un cierre del proceso: la continuidad entre partes se garantiza en una exportación en curso. Existe un límite operativo de tres horas simuladas que informa un error, sin truncar silenciosamente la competencia.

`VideoExportAdapter` separa la UI del almacenamiento local y ofrece creación, consulta, pausa/reanudación y eliminación. `UploadAdapter` y `BroadcastAdapter` son puntos de extensión para futuras plataformas, sin implementación ni credenciales. El worker sólo renderiza y escribe archivos; no importa publicadores ni llama a APIs de redes. Las herramientas previas de lotes y publicación siguen separadas de la grabación manual.

## Validación

Las pruebas cubren validación de parámetros, Play y fallo de exportación, selecciones de América, grupos y final de 20, orden y semillas, continuidad de cuerpos/ticks, audio que cruza cortes, persistencia y peticiones concurrentes. La integración de FFmpeg ejecuta un torneo completo con todos sus ticks y reduce únicamente los píxeles del test: valida codecs, duración, frames, orden, metadatos y resultados frente a una ejecución sin cortes. Sus archivos temporales se eliminan al terminar.
