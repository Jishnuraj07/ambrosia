// The window's only door to the main process. The renderer gets these few
// calls and nothing else from Node or Electron.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ambrosia", {
  init: () => ipcRenderer.invoke("ambrosia:init"),
  submit: (line) => ipcRenderer.invoke("ambrosia:submit", String(line)),
  interrupt: () => ipcRenderer.send("ambrosia:interrupt"),
  approve: (id, answer) => ipcRenderer.send("ambrosia:approve", id, answer),
  pickFolder: () => ipcRenderer.invoke("ambrosia:pickFolder"),
  onEvent: (fn) => {
    const listener = (_e, name, payload) => fn(name, payload);
    ipcRenderer.on("ambrosia:event", listener);
    return () => ipcRenderer.off("ambrosia:event", listener);
  },
  onApproval: (fn) => {
    const listener = (_e, id, req) => fn(id, req);
    ipcRenderer.on("ambrosia:approval", listener);
    return () => ipcRenderer.off("ambrosia:approval", listener);
  },
});
