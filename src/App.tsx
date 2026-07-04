import { IonApp, IonRouterOutlet } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Redirect, Route } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import SignInPage from './features/auth/SignInPage';
import DocumentsPage from './features/documents/DocumentsPage';
import DocumentDetailPage from './features/documents/DocumentDetailPage';
import { isConfigured } from './config';
import NotConfiguredPage from './features/auth/NotConfiguredPage';

// GitHub Pages serves the app from a subpath; the router basename must match.
const BASENAME = '/document-vault';

export default function App() {
  const authenticated = useAuthStore((s) => s.status === 'authenticated');

  return (
    <IonApp>
      <IonReactRouter basename={BASENAME}>
        <IonRouterOutlet>
          {!isConfigured() ? (
            <Route render={() => <NotConfiguredPage />} />
          ) : !authenticated ? (
            <Route render={() => <SignInPage />} />
          ) : (
            <>
              <Route exact path="/documents" component={DocumentsPage} />
              <Route exact path="/documents/:id" component={DocumentDetailPage} />
              <Route exact path="/">
                <Redirect to="/documents" />
              </Route>
            </>
          )}
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}
