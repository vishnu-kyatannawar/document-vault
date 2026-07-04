import { IonContent, IonPage, IonText } from '@ionic/react';

/** Shown when VITE_GOOGLE_CLIENT_ID is missing so the app fails loudly, not silently. */
export default function NotConfiguredPage() {
  return (
    <IonPage>
      <IonContent fullscreen className="ion-padding">
        <div style={{ maxWidth: 480, margin: '10vh auto', textAlign: 'center' }}>
          <h1>Setup required</h1>
          <IonText color="medium">
            <p>
              This build has no Google OAuth Client ID. Set{' '}
              <code>VITE_GOOGLE_CLIENT_ID</code> (see the README) and rebuild.
            </p>
          </IonText>
        </div>
      </IonContent>
    </IonPage>
  );
}
