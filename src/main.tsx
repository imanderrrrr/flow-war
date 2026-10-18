import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
