import React from 'react';
import { createRoot } from 'react-dom/client';
import { setupIonicReact } from '@ionic/react';
import App from './App';
import { initLogger, logger } from './services/logger';
import { APP_VERSION, BUILD_DATE, initAppUpdates } from './services/appUpdate';

/* Ionic core + basic CSS */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/text-alignment.css';

/* App theme */
import './theme/variables.css';

initLogger();
logger.info(`app v${APP_VERSION} (${BUILD_DATE})`);
initAppUpdates();
setupIonicReact({ mode: 'ios' });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
