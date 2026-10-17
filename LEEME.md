# Soporty Agente (Windows)

Agente para **equipos administrados**: se instala en una computadora que tú administras y la deja
disponible para soporte remoto **desatendido** (sin que nadie tenga que autorizar cada conexión
frente a la pantalla). Cada conexión la inicia un técnico desde el panel y pide el **PIN del equipo**.

Reutiliza el mismo motor de Soporty (voz, pantalla, señalización y control) que la app de Windows.
La diferencia es que no pide código: se registra una vez y queda escuchando conexiones entrantes.

## Cómo funciona

1. En el panel, **Mis equipos → Agregar un equipo**: le pones nombre y un PIN, y te da un **código de alta**.
2. Instalas este agente en el equipo y pegas ese código de alta. El equipo queda registrado
   (su id y token quedan guardados en disco) y aparece **En línea** en tu panel.
3. Para dar soporte, en el panel presionas **Conectar** y escribes el PIN del equipo.
4. El agente acepta la conexión, **comparte la pantalla automáticamente** y, cuando pides control,
   lo concede solo. Mientras controlas, en el equipo se ve una **barra roja «Un técnico está
   controlando tu equipo — Detener»** que cualquiera puede presionar para cortar.
5. El agente **arranca junto con Windows** (inicio de sesión del usuario) y se queda esperando.

## Compilar el instalador (sin instalar nada en tu PC)

El instalador `.exe` se compila gratis en **GitHub Actions**:

1. Sube este proyecto al repositorio `soporty-agent` (público).
2. Entra a la pestaña **Actions → «Compilar Agente»**. Se ejecuta solo en cada cambio, o puedes
   lanzarlo con **Run workflow**.
3. Cuando termine (en verde), abre la ejecución y descarga el artefacto **`soporty-agent-1.0.N`**.
   Dentro está `Soporty-Agente-1.0.N-instalador.exe`.
4. Sube ese `.exe` en **Super admin → Apps → Windows · equipos administrados**.

## Notas importantes (léelas)

- **Instalación con permisos de administrador.** El instalador es *perMachine* (para todo el equipo).
- **Captura de pantalla.** El agente fuerza el idioma interno del WebView a inglés y auto-selecciona
  «Entire screen» para compartir sin que nadie elija. Si en algún Windows apareciera el selector,
  el agente muestra un botón **«Autorizar captura de pantalla»** para hacerlo una vez.
- **Sesión de Windows iniciada.** Esta primera versión funciona cuando hay un usuario con sesión
  iniciada en el equipo (el agente corre en esa sesión). Dar soporte en la **pantalla de inicio de
  sesión** (sin nadie conectado) requiere instalarlo como *servicio de Windows*: es el siguiente paso.
- **SmartScreen.** Sin certificado de firma, Windows mostrará «Windows protegió tu PC» al instalar
  (Más información → Ejecutar de todas formas). Se quita con un certificado de firma de código.
- **Seguridad.** Un equipo se conecta solo si: (1) quien lo pide es un técnico de tu cuenta **y**
  (2) escribe el **PIN del equipo**. Puedes **quitar** un equipo en cualquier momento desde el panel;
  su agente deja de poder conectarse de inmediato.
