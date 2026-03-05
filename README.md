# MyWhisper

> **⚠️ Este programa ha sido escrito íntegramente por Inteligencia Artificial (GitHub Copilot / Claude Sonnet) sin intervención humana en el código.**

Herramienta de escritorio para Windows que graba tu voz con el micrófono, transcribe el audio a texto usando la API de Whisper de OpenAI, y pega el resultado donde tengas el cursor — todo con un atajo de teclado.

---

## ¿Qué hace?

1. Vive silenciosamente en el **icono del tray** (esquina inferior derecha) sin consumir recursos.
2. Al pulsar **Ctrl+F1** aparece una pastilla flotante en la parte superior de la pantalla y comienza a grabar.
3. Al pulsar **Ctrl+F1** de nuevo se detiene la grabación y el audio se manda a **Whisper de OpenAI** para transcribirlo.
4. El texto transcrito aparece:
   - En un **popup** con el texto seleccionado y un botón para copiarlo (modo por defecto), o
   - **Pegado directamente** en la aplicación que tenías activa, como si hubieras pulsado Ctrl+V (modo pegado automático).

---

## Requisitos

- **Windows 10/11**
- **Node.js** v18 o superior → [nodejs.org](https://nodejs.org)
- Una **API Key de OpenAI** con acceso a la API de audio (Whisper) → [platform.openai.com](https://platform.openai.com)

---

## Instalación y uso en desarrollo

```bash
# 1. Clona el repositorio
git clone https://github.com/tu-usuario/my-whisper.git
cd my-whisper

# 2. Instala las dependencias
npm install

# 3. Arranca la aplicación
npm start
```

Al arrancar por primera vez, si no hay API Key configurada, se abrirá automáticamente la ventana de configuración.

---

## Compilar el ejecutable (.exe)

```bash
npm run build
```

Genera un archivo `MyWhisper.exe` portable en la carpeta `dist/`. No requiere instalación, se ejecuta directamente.

---

## Atajos de teclado

| Atajo | Acción |
|---|---|
| **Ctrl+F1** | Iniciar / detener grabación |
| **Escape** | Cancelar grabación (descarta el audio) u ocultar el overlay |

Funcionan globalmente desde cualquier aplicación, sin necesidad de tener MyWhisper en primer plano.

---

## Menú del tray (clic derecho sobre el icono)

| Opción | Descripción |
|---|---|
| Grabar / Parar | Mismo efecto que Ctrl+F1 |
| Pegar automáticamente | Activa/desactiva el modo de pegado directo |
| Configuración | Abre la ventana para cambiar la API Key |
| Salir | Cierra la aplicación |

---

## Configuración

La API Key y las preferencias se guardan en:

```
%APPDATA%\my-whisper\config.json
```

Nunca se suben a ningún servidor externo más allá de las llamadas necesarias a la API de OpenAI.

---

## Cómo funciona por dentro

```
main.js          →  Proceso principal de Electron. Gestiona el tray, los
                    atajos globales, las ventanas y las llamadas a la API.

preload.js       →  Puente seguro entre el proceso principal y las páginas
                    (contextBridge). El renderer nunca toca Node directamente.

renderer/
  overlay.html   →  Pastilla flotante que muestra el estado de la grabación.
                    Captura el audio con MediaRecorder (WebM/Opus).
  result.html    →  Ventana con el texto transcrito y botón de copia.
  settings.html  →  Formulario para introducir y guardar la API Key.
```

El audio se procesa completamente en memoria (nunca se escribe en disco) y se envía directamente a `https://api.openai.com/v1/audio/transcriptions` con el modelo `gpt-4o-transcribe` y el idioma fijado a español (`language: es`).

La grabación se corta automáticamente a los **10 minutos** como medida de seguridad, para no superar el límite de tamaño de fichero de la API de OpenAI (~25 MB).

---

## Tecnologías

- [Electron](https://www.electronjs.org/) — Framework de escritorio con Chromium + Node.js
- [OpenAI Whisper API](https://platform.openai.com/docs/api-reference/audio) — Transcripción de voz a texto
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) — Captura de audio en el navegador
- PowerShell / `SendKeys` — Pegado automático en la ventana activa

---

## Licencia

MIT
