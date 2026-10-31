import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { unpackResult } from '../src/transports.js';

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('This file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function createWidgetTransport() {
  const app = new App({ name: 'JEV Decisions', version: '2.0.0' }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: true });
  const listeners = new Set();
  let latest;
  let connected = false;
  let readyPromise;
  function publish(output) {
    if (!output?._meta?.workspace) return;
    latest = output;
    for (const listener of listeners) listener(output);
  }
  function compatibilityResult() {
    const openai = window.openai;
    return openai?.toolResponseMetadata?.workspace ? { structuredContent: openai.toolOutput, _meta: openai.toolResponseMetadata } : null;
  }
  function hostTheme(context) {
    context = { ...app.getHostContext(), ...context };
    const theme = context.theme || window.openai?.theme || 'dark';
    applyDocumentTheme(theme);
    if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
    for (const side of ['top', 'right', 'bottom', 'left']) if (typeof context.safeAreaInsets?.[side] === 'number') document.documentElement.style.setProperty(`--jev-safe-${side}`, `${context.safeAreaInsets[side]}px`);
  }
  app.ontoolresult = publish;
  app.onhostcontextchanged = hostTheme;
  window.addEventListener('openai:set_globals', () => { hostTheme(); if (!connected) publish(compatibilityResult()); });
  hostTheme();
  const transport = {
    kind: 'mcp',
    async ready() {
      readyPromise ||= (async () => {
        try {
          await app.connect(undefined, { timeout: 5000 });
          connected = true;
          hostTheme(app.getHostContext());
        } catch (error) {
          if (!window.openai?.callTool) throw new Error('This host could not connect the widget to its MCP tools. Use the ordinary tools or open the workspace in Decisions.');
        }
        publish(compatibilityResult());
      })();
      return readyPromise;
    },
    initial: () => latest || compatibilityResult(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setProvider: () => {},
    async call(name, args = {}) {
      await transport.ready();
      const output = connected ? await app.callServerTool({ name, arguments: args }, { timeout: 110000 }) : await window.openai.callTool(name, args);
      return unpackResult(output);
    },
    async attachFiles(workspace, files) {
      if (files.length > 16) throw new Error('Add up to 16 files at a time.');
      const openai = window.openai;
      if (openai?.uploadFile && openai?.getFileDownloadUrl) {
        const references = [];
        for (const file of files) {
          const { fileId } = await openai.uploadFile(file);
          const { downloadUrl } = await openai.getFileDownloadUrl({ fileId });
          references.push({ file_id: fileId, download_url: downloadUrl, file_name: file.name, mime_type: file.type || 'application/octet-stream' });
        }
        return transport.call('update_workspace', { workspaceId: workspace.id, expectedRevision: workspace.revision, files: references });
      }
      let current = workspace;
      let output;
      for (const file of files) {
        if (file.size * 4 / 3 > 9 * 1024 * 1024) throw new Error('This host has no native file upload. Use a file smaller than 6.5 MiB or attach it in the Decisions frontend.');
        output = await transport.call('attach_inline_file', { workspaceId: current.id, expectedRevision: current.revision, name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: await fileBase64(file) });
        current = output._meta.workspace;
      }
      return output;
    },
    canSelectLibrary: () => Boolean(window.openai?.selectFiles && window.openai?.getFileDownloadUrl),
    async selectLibrary(workspace) {
      const openai = window.openai;
      if (!transport.canSelectLibrary()) throw new Error('ChatGPT Library is not available in this client. Use Add files instead.');
      const selected = await openai.selectFiles();
      if (!selected?.length) return null;
      if (selected.length > 16) throw new Error('Select up to 16 files at a time.');
      const files = [];
      for (const file of selected) {
        const { downloadUrl } = await openai.getFileDownloadUrl({ fileId: file.fileId });
        files.push({ file_id: file.fileId, download_url: downloadUrl, file_name: file.fileName, mime_type: file.mimeType });
      }
      return transport.call('update_workspace', { workspaceId: workspace.id, expectedRevision: workspace.revision, files });
    },
    async openLink(url) {
      if (window.openai?.openExternal) return window.openai.openExternal({ href: url });
      await transport.ready();
      const output = await app.openLink({ url });
      if (output.isError) throw new Error('This client could not open the frontend link. Copy it and open it on a device that can reach Decisions.');
    },
    persist(workspace, view) {
      window.openai?.setWidgetState?.({
        modelContent: `Decisions workspace ${workspace.id}${workspace.name ? ` (${workspace.name})` : ''}; ${workspace.questions.length} questions.`,
        privateContent: { workspaceId: workspace.id, view },
      });
    },
    updateContext(summary) {
      if (connected) app.updateModelContext({ structuredContent: summary }).catch(() => {});
    },
    async expand() {
      if (window.openai?.requestDisplayMode) return window.openai.requestDisplayMode({ mode: 'fullscreen' });
      await transport.ready();
      return app.requestDisplayMode({ mode: 'fullscreen' });
    },
  };
  return transport;
}
