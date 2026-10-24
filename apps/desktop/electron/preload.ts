import { contextBridge, ipcRenderer } from 'electron';
import { ipcContract, type IpcChannel, type PetraApi, type Wire } from '@petra/core';

const api: PetraApi = {
  async invoke(channel, ...args) {
    if (!(channel in ipcContract)) throw new Error(`Unknown channel: ${String(channel)}`);
    const c = channel as IpcChannel;
    const parsed = ipcContract[c].input.parse(args[0]);
    const res = (await ipcRenderer.invoke('petra:invoke', c, parsed)) as Wire<unknown>;
    // Custom error classes do not survive contextBridge, so the structured error travels inside the message.
    if (!res.ok) throw new Error(`PETRA_ERR:${JSON.stringify(res.error)}`);
    return res.data as never;
  }
};

contextBridge.exposeInMainWorld('petra', api);
