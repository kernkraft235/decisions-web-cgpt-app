import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import WorkspaceApp from './WorkspaceApp.jsx';
import { createHttpTransport } from './transports.js';
import './styles.css';
import './workspaces.css';

const route = window.location.pathname;
const byId = /^\/workspace\/by-id\/([^/]+)\/?$/.exec(route);
const byName = /^\/workspace\/([^/]+)\/?$/.exec(route);
const ref = byId ? { workspaceId: decodeURIComponent(byId[1]) } : byName ? { workspaceName: decodeURIComponent(byName[1]) } : null;
createRoot(document.getElementById('root')).render(ref ? <WorkspaceApp transport={createHttpTransport()} initialRef={ref} /> : <App />);
