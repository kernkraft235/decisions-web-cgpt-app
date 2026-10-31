import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';

const RESOURCE_URI = 'ui://jev-decisions/workspace-v1.html';

export function createMcpHandler(root, services, tools) {
  let htmlPromise;
  function widgetHtml() {
    htmlPromise ||= Promise.all([
      readFile(path.join(root, 'dist/widget/widget.js'), 'utf8'),
      readFile(path.join(root, 'dist/widget/widget.css'), 'utf8'),
    ]).then(([javascript, css]) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Decisions</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body class="widget-body"><div id="root"></div><script type="module">${javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`).catch(error => { htmlPromise = undefined; throw error; });
    return htmlPromise;
  }
  function server() {
    const mcp = new McpServer({ name: 'jev-decisions', version: '2.0.0' }, {
      instructions: 'Evaluate evidence with native decision models. Prefer the configured server default. Reuse named questions, sets, and UUID workspaces. Files should be passed as references, not transcribed into tool arguments. Widgets are optional. Save definitions only when asked. A pending run is inspected with get_run; do not start inference again to check status.',
    });
    for (const definition of tools.definitions) {
      registerAppTool(mcp, definition.name, {
        title: definition.title, description: definition.description,
        inputSchema: definition.schema.shape, annotations: definition.annotations, _meta: definition._meta,
      }, input => tools.safeCall(definition.name, input));
    }
    const frontendOrigin = services.config().frontendBaseUrl;
    const resourceMeta = {
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/widgetDescription': 'A reusable Decisions workspace with input, named question sets, direct Run controls, and probability charts. Editing and running in the widget does not need another model turn.',
      'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: [frontendOrigin] },
    };
    registerAppResource(mcp, 'decision-workspace', RESOURCE_URI, {
      title: 'Decisions workspace', description: 'Edit input, configure reusable questions, and inspect decision probability charts.',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: resourceMeta,
    }, async () => ({ contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: await widgetHtml(), _meta: resourceMeta }] }));
    return mcp;
  }
  return async (req, res, next) => {
    const frontend = new URL(services.config().frontendBaseUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: ['127.0.0.1:*', 'localhost:*', '[::1]:*', frontend.host],
      allowedOrigins: ['https://chatgpt.com', 'https://chat.openai.com', frontend.origin],
    });
    const mcp = server();
    res.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) { next(error); }
  };
}
