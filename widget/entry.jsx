import React from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceApp from '../src/WorkspaceApp.jsx';
import { createWidgetTransport } from './transport.js';
import '../src/styles.css';
import '../src/workspaces.css';

const transport = createWidgetTransport();
createRoot(document.getElementById('root')).render(<WorkspaceApp transport={transport} />);
