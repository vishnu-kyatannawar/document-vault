import { useEffect } from 'react';
import { IonApp, IonRouterOutlet, IonSpinner } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Redirect, Route } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import SignInPage from './features/auth/SignInPage';
import GroupPage from './features/documents/GroupPage';
import DocumentDetailPage from './features/documents/DocumentDetailPage';
import { isConfigured } from './config';
import NotConfiguredPage from './features/auth/NotConfiguredPage';

// GitHub Pages serves the app from a subpath; the router basename must match.
const BASENAME = '/document-vault';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const renewIfStale = useAuthStore((s) => s.renewIfStale);

  // On load: pick up a returning Google redirect, reuse the cached token, or
  // renew it silently — so opening the app never means signing in again.
  useEffect(() => {
    if (isConfigured()) void restore();
  }, [restore]);

  // On resume, renew a token that is about to expire while the user is not in
  // the middle of anything — a bounce through Google mid-upload would lose work.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') renewIfStale();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Pressing Back on Google's page can restore this page from the browser's
    // back/forward cache mid-"signing-in"/"restoring". Start over cleanly.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [renewIfStale]);

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
          <Route exact path="/documents" component={GroupPage} />
          <Route exact path="/g/:groupId" component={GroupPage} />
          <Route exact path="/documents/:id" component={DocumentDetailPage} />
          <Route exact path="/">
            <Redirect to="/documents" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}
