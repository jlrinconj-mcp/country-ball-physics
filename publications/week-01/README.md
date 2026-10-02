# bolworld: primera semana

La primera tanda usa audiencia global, sin voz en off: banderas, competencia física y texto breve en inglés. La selección incluye países de América, Europa, África, Asia y Oceanía, y los tres resultados se resuelven por física.

## Orden de lanzamiento

Los días se cuentan desde la primera publicación, después de preparar las cuentas. Este calendario es un borrador; no hay publicaciones programadas.

| Día | Pieza | Canales | Hora de prueba |
| --- | --- | --- | --- |
| 1 | 32 flags. One survivor. | Shorts, TikTok, Instagram Reels, Facebook Reels | 13:00 UTC |
| 3 | Brazil vs France vs Japan | Shorts, TikTok, Instagram Reels, Facebook Reels | 20:00 UTC |
| 5 | Green survives. Red is out. | Shorts, TikTok, Instagram Reels, Facebook Reels | 13:00 UTC |
| 7 | Three Global Physics Challenges, episodio completo | YouTube, Facebook | 20:00 UTC |

Los horarios son pruebas iniciales y se ajustarán según analíticas. Cada plataforma tiene su texto en `output/launch-week-01/publication-copies.md`; también existe una versión JSON para programar y un CSV para registrar resultados.

## Producir de nuevo

Desde la raíz del proyecto:

```bash
node publications/week-01/produce.mjs
node publications/week-01/brand.mjs
```

Requiere dependencias del proyecto, ffmpeg, acceso al dataset de países y a flagcdn.com, y DejaVu Sans Bold en `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` para los textos añadidos durante la edición. Usa `node --import tsx` para las exportaciones; en el entorno restringido esto evita el servidor IPC del ejecutable `tsx`.

Para editar usando los originales ya renderizados:

```bash
node publications/week-01/produce.mjs --reuse-raw
```

El manifiesto `manifest.json` conserva países, reglas, semillas y velocidades. Las exportaciones completas están en `output/launch-week-01/raw/`; los tres cortes verticales y el episodio de 16:9 están directamente en `output/launch-week-01/`.

## Qué revisar antes de subir

Reproducir el video completo: apertura, legibilidad de las banderas, sonido y desenlace. Subir el MP4 limpio de 1080p de cada pieza, con el título y texto de su plataforma. El episodio incluye reglas y observaciones originales en pantalla; los clips cortos conservan el resultado a velocidad normal y una pregunta final.

En `production-report.json` están el ganador, el resultado físico, la duración y la huella de cada simulación; este archivo es para producción y contiene spoilers.

## Cómo decidir la segunda tanda

Registrar métricas a las 24 y 72 horas en `performance.csv`. Comparar retención, tiempo medio visto, compartidos y seguidores nuevos dentro de cada plataforma. Tomar países de audiencia y comentarios como señales para elegir próximos participantes e idiomas. Después de tres piezas, las conclusiones serán preliminares: conservar los datos y seguir probando antes de cerrar una estrategia.

Las bios y pasos para preparar las cuentas están en `profiles.md`.
