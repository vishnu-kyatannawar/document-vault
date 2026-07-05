import {
  IonButton,
  IonContent,
  IonIcon,
  IonPage,
  IonSpinner,
  IonText,
} from '@ionic/react';
import { logoGoogle, lockClosed, shieldCheckmark } from 'ionicons/icons';
import { useAuthStore } from '../../store/authStore';
import './SignInPage.css';

export default function SignInPage() {
  const { signIn, status, error } = useAuthStore();
  const busy = status === 'signing-in';

  return (
    <IonPage>
      <IonContent fullscreen className="signin">
        <div className="signin__wrap">
          <div className="signin__brand">
            <div className="signin__logo">
              <IonIcon icon={lockClosed} />
            </div>
            <h1>Document Vault</h1>
            <p>Your documents, secured in your own Google Drive.</p>
          </div>

          <ul className="signin__points">
            <li>
              <IonIcon icon={shieldCheckmark} /> Stored only in your Drive — never on our servers
            </li>
            <li>
              <IonIcon icon={shieldCheckmark} /> Minimal access: the app sees only what it creates
            </li>
          </ul>

          <IonButton
            expand="block"
            className="signin__btn"
            onClick={signIn}
            disabled={busy}
          >
            {busy ? (
              <IonSpinner name="crescent" />
            ) : (
              <>
                <IonIcon slot="start" icon={logoGoogle} />
                Continue with Google
              </>
            )}
          </IonButton>

          {error && (
            <IonText color="danger" className="signin__error">
              {error}
            </IonText>
          )}

          <p className="signin__legal">
            We only request access to files this app creates in your Drive.
          </p>
        </div>
      </IonContent>
    </IonPage>
  );
}
