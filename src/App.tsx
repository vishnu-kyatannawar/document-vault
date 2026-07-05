import { useEffect } from 'react';
import { IonApp, IonRouterOutlet, IonSpinner } from '@ionic/react';
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
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);

  // On load, silently restore the session (no popup) so a refresh doesn't force
  // a fresh Google sign-in when the user still has an active Google session.
  useEffect(() => {
    if (isConfigured()) restore();
  }, [restore]);

  // Render sign-in / setup screens OUTSIDE the router. Mounting conditional
  // routes inside a single IonRouterOutlet stops it from swapping views when
  // auth state changes, which left users stuck on the sign-in page.
  if (!isConfigured()) {
    return (
      <IonApp>
        <NotConfiguredPage />
      </IonApp>
    );
  }

  if (status === 'restoring') {
    return (
      <IonApp>
        <div className="app-splash">
          <IonSpinner name="crescent" />
        </div>
      </IonApp>
    );
  }

  if (status !== 'authenticated') {
    return (
      <IonApp>
        <SignInPage />
      </IonApp>
    );
  }

  return (
    <IonApp>
      <IonReactRouter basename={BASENAME}>
        <IonRouterOutlet>
          <Route exact path="/documents" component={DocumentsPage} />
          <Route exact path="/documents/:id" component={DocumentDetailPage} />
          <Route exact path="/">
            <Redirect to="/documents" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}
