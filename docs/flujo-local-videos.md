# bolworld: generación y publicación desde Linux

## Qué reutiliza

El simulador, los países, las banderas, `HeadlessRenderer`, `OfflineMix` y el exportador existente `scripts/generate.ts`. Se renderiza una simulación una vez. FFmpeg crea variantes cambiando hook, velocidad/duración, audio original o silencio y formato. El resultado de la física y el ganador se conservan; un cambio de formato añade márgenes y evita recortar la partida. No se incorpora música sin licencia.

La publicación usa las APIs oficiales de TikTok y Meta. Instagram y Facebook aceptan el archivo local mediante sus protocolos de subida; no es necesario alojarlo en una URL pública intermedia.

## Instalar en tu computador

Esta implementación se preparó en el entorno remoto de Codex. Eso no significa que ya esté instalada en tu computador. Para llevar el proyecto completo a tu Linux, clona la rama de trabajo:

```bash
git clone --branch codex/bolworld-local-video-pipeline https://github.com/jlrinconj-mcp/country-ball-physics.git bolworld
cd bolworld
```

Requisitos: Git, Node.js **22.12 o posterior** (recomendado Node 24 LTS), npm, `flock` (habitualmente incluido con Linux) y FFmpeg con `libx264`, AAC y `ffprobe`. En Debian/Ubuntu, FFmpeg se instala con `sudo apt install ffmpeg`. Instala Node desde su distribuidor habitual; el Node de algunas versiones de Ubuntu es demasiado antiguo.

```bash
npm run setup:local -- --services
```

El instalador ejecuta `npm ci`, crea `.env.local` si falta, compila el proyecto e instala servicios **del usuario**, sin sobrescribir unidades existentes. El simulador abre en **http://localhost:3000**. El temporizador revisa la cola cada cinco minutos. Requiere una sesión de Linux con `systemd --user` disponible. Alternativa sin servicios: `npm run setup:local`, luego `npm run start -- --hostname 127.0.0.1` y ejecutar `npm run pipeline -- work` periódicamente.

Los servicios del usuario arrancan al iniciar sesión. Para que el temporizador arranque al encender el computador aunque no hayas iniciado sesión, habilita el servicio de usuario persistente con `loginctl enable-linger "$USER"` si la política de tu distribución lo permite. Si el computador está apagado o suspendido, la limpieza pendiente se realiza al volver a ejecutarse el temporizador; no se puede borrar mientras está apagado.

## Conectar las tres cuentas

Edita **`.env.local` en tu computador**; no compartas contraseñas ni tokens en el chat. Este archivo no se sube a Git. El proceso carga sus valores al arrancar, incluido en las ejecuciones del temporizador.

| Red | Configuración | Requisitos de la API |
| --- | --- | --- |
| TikTok | `TIKTOK_OPEN_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_PRIVACY_LEVEL` | Aplicación con Content Posting / Direct Post y permisos `video.publish` y `user.info.basic`, autorizada por la cuenta. Se consulta `creator_info` para comprobar privacidad y duración. |
| Instagram | `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN` | Cuenta profesional vinculada a una página para el flujo de Facebook Login utilizado aquí; permisos `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `pages_show_list` según la configuración de tu aplicación. |
| Facebook | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` | Página de Facebook y token de página con permisos de publicación, incluidos `pages_manage_posts` y `pages_read_engagement`. No publica en perfiles personales. |
| Meta | `META_GRAPH_VERSION` | Versión habilitada en tu aplicación de Meta, por ejemplo `v25.0` si corresponde. Se configura explícitamente. |

Las aplicaciones y los permisos deben estar aprobados cuando la plataforma lo requiera. En particular, TikTok limita las aplicaciones sin auditoría a publicaciones privadas (`SELF_ONLY`); no basta con tener una cuenta para habilitar publicación pública automática. Los tokens caducados producen un error y conservan el archivo hasta renovar la autorización. Este flujo no obtiene ni renueva tokens OAuth automáticamente.

```bash
npm run pipeline -- doctor
```

`doctor` comprueba ejecutables, espacio libre y variables requeridas. No afirma que un token tenga permisos válidos; la API lo comprueba durante el proceso real. Las credenciales ausentes impiden publicar, pero no impiden conservar la generación pendiente.

## Primer trabajo automático

```bash
cp publications/pipeline.example.json publications/mi-primer-video.json
# Edita países, hooks, captions y destinos en mi-primer-video.json.
npm run pipeline -- enqueue --spec=publications/mi-primer-video.json
npm run pipeline -- work
npm run pipeline -- status
```

El ejemplo crea tres variantes diferentes: TikTok a velocidad normal, Instagram a 1.25× y Facebook a 1.5×. Sus hooks también cambian. Cada variante se publica en el destino indicado. Puedes asignar varios destinos a una variante; necesita confirmación de todos ellos. `publishAt` permite fijar una fecha ISO explícita, por ejemplo `"2026-10-10T18:00:00Z"`. Si se omite, la publicación comienza al procesar la cola: en las cuentas reales, esto produce publicaciones reales una vez configuradas las credenciales.

`enqueue` guarda el trabajo sin generar inmediatamente. `work` limpia lo que corresponda, genera los pendientes y avanza las subidas. El temporizador hace esto automáticamente después de encolar; no crea trabajos nuevos por su cuenta. La semilla queda guardada y permite repetir el contenido.

```text
generación → variantes → validación técnica completa → subida
→ consulta de procesamiento/publicación → confirmación de todos los destinos
→ conservación de al menos 24 h → verificación de propiedad/hashes → limpieza
```

## Almacenamiento temporal y seguridad de limpieza

```text
output/pipeline/
  owner.json                     # Marca exclusiva del sistema
  worker.lock                    # Exclusión de trabajadores simultáneos
  logs/AAAA-MM-DD.jsonl           # Registro sencillo por día
  jobs/<UUID>/
    job.json                     # Estado, propiedad, hashes y confirmaciones
    request.json                 # Solicitud reproducible
    raw/<seed>/                  # Fuente y archivos internos del exportador
    <variant>.mp4                # Variantes listas para cada red
    <variant>-hook.png           # Texto visual generado
```

`output/` ya era el directorio de exportación y ya está excluido de Git. El sistema nuevo sólo gestiona **`output/pipeline`**. No adopta videos anteriores de `output/launch-week-01`, `output/runs` ni archivos copiados manualmente.

Se esperan **24 horas desde la última confirmación de publicación de todas las variantes en todos sus destinos**. Esta regla conserva cada archivo al menos 24 horas y permite retirar también la fuente y los intermediarios cuando ya no son necesarios. Si una variante falla, queda sin confirmar o está programada para más adelante, se conservan todos los archivos de ese trabajo. No se cuenta desde la creación: una subida retrasada no reduce la ventana de conservación.

La eliminación exige los comprobantes de publicación guardados de todos los destinos, vinculados al hash de cada variante. Sólo acepta archivos registrados previamente como propios, en su carpeta de UUID, con la misma identidad de archivo, tamaño y SHA-256. Rechaza symlinks, hardlinks, rutas externas, archivos sustituidos y contenido modificado. No utiliza `rm -rf`, limpieza general por extensión ni antigüedad de directorios. Los archivos manuales, configuraciones, código y assets permanecen intactos. Los manifiestos y logs pequeños permanecen para poder auditar el proceso; los MP4, WAV y overlays propios se retiran.

El temporizador elimina los archivos elegibles en su siguiente revisión, normalmente dentro de los cinco minutos posteriores al plazo. La limpieza funciona con los comprobantes persistentes aunque no haya red o un token haya caducado; los trabajos todavía sin confirmar conservan todos sus archivos. La publicación remota debe mantenerse si deseas conservar el contenido después de eliminar la copia local. Un bloqueo exclusivo y JSON guardado mediante sustitución atómica permiten retomar el trabajo después de un reinicio. Las respuestas ambiguas se conservan para revisión y se consultan de nuevo sin crear una segunda publicación. No es posible garantizar exactamente una publicación si una API pierde la respuesta de creación y no ofrece una clave idempotente; se prefiere detener ese destino y conservar el archivo.

Se pausa la generación cuando quedan menos de 2 GiB libres. Se aceptan hasta diez trabajos activos por defecto; ambos valores se configuran en `.env.local`. Si una red permanece desconectada, se bloquean nuevos trabajos al alcanzar ese límite en lugar de borrar los pendientes.

## Logs y recuperación

Los logs son JSONL legible, una línea por evento, con hora UTC. Eventos principales:

| Evento | Información |
| --- | --- |
| `job_queued`, `generation_started` | Trabajo, semilla, variantes y comienzo |
| `file_generated`, `variant_validated` | Archivo, hora, hash, tamaño, duración, hook, velocidad y destinos |
| `upload_attempt` | Red, cuenta e intento |
| `upload_pending_confirmation` | Subida todavía no confirmada |
| `upload_confirmed` | Identificador y URL remota si está disponible, hora de confirmación |
| `deletion_scheduled` | Fecha de eliminación y lista de archivos propios |
| `file_deleted`, `file_deleted_recovered` | Hora y archivo eliminado, incluyendo recuperación tras reinicio |
| `generation_error`, `upload_error`, `cleanup_error` | Error y, cuando corresponde, siguiente intento |

Los tokens no se imprimen. Las URLs de subida firmadas se guardan sólo en el manifiesto privado para recuperar la sesión, y se omiten en `status` y logs. El directorio del sistema tiene permisos privados del usuario.

```bash
systemctl --user status bolworld-app.service bolworld-pipeline.timer
journalctl --user -u bolworld-pipeline.service
npm run pipeline -- status
npm run pipeline -- retry --job=<UUID>
npm run pipeline -- work
npm run pipeline -- cleanup
```

Las subidas fallidas se reintentan con esperas crecientes, hasta seis horas. Un fallo de generación necesita `retry`, para evitar renderizados caros repetidos. `retry` retoma las sesiones existentes y **no borra ni reinicia identificadores remotos**. Si una publicación queda ambigua, revisa el identificador existente en la red antes de resolverla; no vuelvas a encolar a ciegas. Si cambias la cuenta de destino tras iniciar una subida, el trabajo se detiene para proteger sus confirmaciones.

Para detener los servicios: `systemctl --user disable --now bolworld-app.service bolworld-pipeline.timer`. Si cambias el directorio del repositorio, revisa o sustituye explícitamente las unidades anteriores antes de reinstalar.

## Verificación

```bash
npm run typecheck
npm run test:pipeline
PIPELINE_E2E=1 PIPELINE_E2E_SCALE=1 npm run test:pipeline
```

La prueba completa renderiza una simulación real, produce tres MP4, los decodifica con FFmpeg, transmite sus bytes mediante HTTP a un servidor de prueba de las tres APIs y compara SHA-256. Simula estados de procesamiento, reinicio, avance del reloj de 24 horas y eliminación selectiva, comprobando que un archivo manual sobrevive. Usa credenciales ficticias y no publica en cuentas reales. La prueba real en TikTok/Instagram/Facebook requiere conectar las cuentas y sus permisos en el computador; esa comprobación no se sustituye por el servidor de prueba.

Referencias de protocolos: [muestra oficial de Meta](https://github.com/fbsamples/reels_publishing_apis), [publicación de contenido de Instagram](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [publicación de Reels de Facebook](https://developers.facebook.com/docs/video-api/guides/reels-publishing/), [Direct Post de TikTok](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/), [estado de publicación de TikTok](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status/).
