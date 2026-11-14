# Reloj gratuito de avisos

Este paquete solo llama a un endpoint HTTPS firmado. No contiene la app, datos de la casa, configuración Firebase ni claves de Google o VAPID. No instala dependencias npm. No enviará avisos hasta configurar y habilitar el servidor privado y aprobar la activación.

## Configuración tras aprobación

1. Crear un repositorio público genérico con estos archivos. GitHub Actions usa un runner Linux estándar gratuito; no contratar runners grandes ni recursos adicionales. En un repositorio privado no asumir que los minutos incluidos están disponibles: mantener el gasto extra bloqueado.
2. Crear exclusivamente los secretos `FREGAPP_HTTP_PUSH_URL` (URL HTTPS exacta terminada en `/api/internal/push/tick`) y `FREGAPP_HTTP_PUSH_HMAC_SECRET` (secreto aleatorio de al menos 32 bytes compartido únicamente con el servidor). No introducir valores reales en archivos, comandos con historial ni logs. No cargar claves Firebase/Google/VAPID.
3. Mantener la variable `FREGAPP_FREE_DELIVERY_APPROVED` sin definir hasta verificar servidor, reglas, cliente y capacidad de deudas. La variable debe valer `1` para ejecutar el trabajo.
4. Tras aprobar el corte, activar la variable y ejecutar manualmente el workflow; comprobar el resultado y después la recepción en un teléfono autorizado con la app cerrada. Un HTTP 200 acredita que el servidor terminó, no que el teléfono mostró el aviso.

El objetivo diario es 09:00 Europe/Madrid; otro tick horario permite cerrar revisiones tras 72 horas. GitHub puede retrasar u omitir ejecuciones y desactiva cron de repositorios públicos tras 60 días sin actividad. Hay que comprobar que Actions sigue activo; este paquete no crea commits artificiales para evitar esa política. El reparto administrativo existente sigue igual: el reloj no genera turnos nuevos.

## Pruebas locales sin conexión a servicios

Con Node 22:

```
node --test scheduler/call-endpoint.test.mjs
```

No ejecutar directamente `call-endpoint.mjs` con secretos reales antes de autorizar una invocación del servidor: el endpoint puede cerrar revisiones y enviar avisos. Los tests inyectan un transporte falso y nunca usan secretos ni datos reales.

## Detener y revertir

Primero retirar la variable de aprobación o deshabilitar el workflow. Para parada inmediata, apagar `FREGAPP_HTTP_PUSH_ENABLED` en el servidor existente. Rotar el secreto HMAC si se expone. No volver a un cliente/worker antiguo mientras siga activo el emisor. Borrar este repositorio no revoca por sí solo un secreto comprometido.

Las firmas caducan y cada intento usa un nonce nuevo y timestamp creciente. Hay tres intentos como máximo, sin redirecciones y con timeout. La disponibilidad de GitHub, Cloud Run y el proveedor push sigue siendo externa; no se ofrece entrega exactamente una vez ni puntualidad garantizada.
