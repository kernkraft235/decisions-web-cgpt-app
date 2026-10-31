import { api } from './shared.js';

export function unpackResult(result) {
  if (result.isError) {
    const data = result.structuredContent || {};
    throw Object.assign(new Error(data.error || result.content?.find(item => item.type === 'text')?.text || 'The operation failed.'), { code: data.code, details: data.details });
  }
  return result;
}

export function createHttpTransport() {
  let currentProvider = 'llama';
  function browserKey(provider = currentProvider) {
    try { return JSON.parse(localStorage.getItem('jev-session-v1'))?.settings?.keys?.[provider] || ''; } catch { return ''; }
  }
  return {
    kind: 'http', ready: async () => {}, subscribe: () => () => {}, initial: () => null,
    setProvider(provider) { currentProvider = provider; },
    async call(name, args = {}) {
      return unpackResult(await api(`/api/tools/${name}`, { method: 'POST', body: JSON.stringify(args), key: browserKey(args.provider) }));
    },
    async attachFiles(workspace, files) {
      let current = workspace;
      let output;
      for (const file of files) {
        const response = await fetch(`/api/workspaces/${current.id}/assets?${new URLSearchParams({ name: file.name })}`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': file.type || 'application/octet-stream', 'X-Workspace-Revision': String(current.revision) }, body: file,
        });
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(data.error || 'Could not attach the file.'), { code: data.code, details: data.details });
        output = unpackResult(data);
        current = output._meta.workspace;
      }
      return output;
    },
    canSelectLibrary: () => false,
    openLink: url => { window.location.assign(url); },
    persist: () => {}, updateContext: () => {}, expand: null,
  };
}
