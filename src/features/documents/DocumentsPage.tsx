import { useEffect, useMemo, useState } from 'react';
import {
  IonAvatar,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonPage,
  IonPopover,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  RefresherCustomEvent,
} from '@ionic/react';
import { add, documentsOutline, logOutOutline } from 'ionicons/icons';
import { useAuthStore } from '../../store/authStore';
import { useDocumentsStore } from '../../store/documentsStore';
import DocumentCard from './DocumentCard';
import AddDocumentSheet from '../capture/AddDocumentSheet';
import './DocumentsPage.css';

export default function DocumentsPage() {
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const { items, loading, error, load } = useDocumentsStore();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (items.length === 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (d) =>
        d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q),
    );
  }, [items, search]);

  const handleRefresh = async (e: RefresherCustomEvent) => {
    await load();
    e.detail.complete();
  };

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonTitle>Documents</IonTitle>
          <IonButtons slot="end">
            <IonButton id="profile-trigger">
              <IonAvatar className="topbar-avatar">
                {profile?.picture ? (
                  <img src={profile.picture} alt={profile.name} referrerPolicy="no-referrer" />
                ) : (
                  <span>{profile?.name?.[0] ?? '?'}</span>
                )}
              </IonAvatar>
            </IonButton>
            <IonPopover trigger="profile-trigger" dismissOnSelect>
              <div className="profile-pop">
                <strong>{profile?.name}</strong>
                <small>{profile?.email}</small>
                <IonButton fill="clear" size="small" onClick={signOut}>
                  <IonIcon slot="start" icon={logOutOutline} />
                  Sign out
                </IonButton>
              </div>
            </IonPopover>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="Search documents"
            debounce={150}
          />
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {loading && items.length === 0 && (
          <div className="docs-center">
            <IonSpinner name="crescent" />
          </div>
        )}

        {error && (
          <div className="docs-center">
            <IonText color="danger">{error}</IonText>
          </div>
        )}

        {!loading && filtered.length === 0 && !error && (
          <div className="docs-center docs-empty">
            <IonIcon icon={documentsOutline} />
            <h2>No documents yet</h2>
            <p>Tap the + button to add your first document.</p>
          </div>
        )}

        <div className="docs-grid">
          {filtered.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      </IonContent>

      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton onClick={() => setAddOpen(true)}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>

      <AddDocumentSheet isOpen={addOpen} onDidDismiss={() => setAddOpen(false)} />
    </IonPage>
  );
}
