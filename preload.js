const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Configuración
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),

  // Transcripción (devuelve promesa con el texto)
  transcribe: (uint8Array) => ipcRenderer.invoke('transcribe', uint8Array),

  // Acciones desde el renderer al main
  showResult: (text) => ipcRenderer.send('show-result', text),
  openSettings: () => ipcRenderer.send('open-settings'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  quitApp: () => ipcRenderer.send('quit-app'),

  // Escuchar texto de transcripción (ventana de resultado)
  onTranscriptionText: (callback) => {
    ipcRenderer.on('transcription-text', (_, text) => callback(text));
  },

  // Atajo global / auto-arranque: el main pide toggle de grabación
  onTriggerRecording: (callback) => {
    ipcRenderer.on('trigger-recording', () => callback());
  },

  // Escape: cancelar grabación o cerrar app
  onTriggerEscape: (callback) => {
    ipcRenderer.on('trigger-escape', () => callback());
  },
});
