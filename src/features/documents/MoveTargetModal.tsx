import { useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import {
  chevronBackOutline,
  chevronForward,
  closeOutline,
  folderOpenOutline,
  homeOutline,
} from 'ionicons/icons';
import { ROOT_KEY, useDocumentsStore } from '../../store/documentsStore';
import { documents as service } from '../../services/vault';
import { VaultGroup } from '../../services/documentsService';
import './MoveTargetModal.css';

interface Crumb {
  key: string; // ROOT_KEY or group id
  name: string;
}

interface Props {
  isOpen: boolean;
  /** The document or group being moved. */
  movingId: string;
  movingName: string;
  /** Level key the item currently lives in. */
  fromKey: string;
  onDidDismiss: () => void;
  /** Called with the destination level key after a successful move. */
  onMoved?: (toKey: string) => void;
}

/** Mini tree browser: navigate groups, then "Move here". */
export default function MoveTargetModal({
  isOpen,
  movingId,
  movingName,
  fromKey,
  onDidDismiss,
  onMoved,
}: Props) {
  const moveItem = useDocumentsStore((s) => s.moveItem);
  const [trail, setTrail] = useState<Crumb[]>([{ key: ROOT_KEY, name: 'Home' }]);
  const [groups, setGroups] = useState<VaultGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [presentToast] = useIonToast();

  const current = trail[trail.length - 1];

  useEffect(() => {
    if (!isOpen) return;
    setTrail([{ key: ROOT_KEY, name: 'Home' }]);
  }, [isOpen, movingId]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setGroups(null);
    service
      .listLevel(current.key === ROOT_KEY ? undefined : current.key)
      .then((level) => {
        if (!active) return;
        // A group can never be moved into itself.
        setGroups(level.groups.filter((g) => g.id !== movingId));
      })
      .catch(() => active && setGroups([]));
    return () => {
      active = false;
    };
  }, [isOpen, current.key, movingId]);

  const confirm = async () => {
    setBusy(true);
    try {
      await moveItem(movingId, fromKey, current.key);
      onMoved?.(current.key);
      onDidDismiss();
    } catch (e) {
      presentToast({ message: (e as Error).message, duration: 3000 });
    } finally {
      setBusy(false);
    }
  };

  const samePlace = current.key === fromKey;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDidDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            {trail.length > 1 ? (
              <IonButton onClick={() => setTrail((t) => t.slice(0, -1))}>
                <IonIcon slot="icon-only" icon={chevronBackOutline} />
              </IonButton>
            ) : (
              <IonButton onClick={onDidDismiss}>
                <IonIcon slot="icon-only" icon={closeOutline} />
              </IonButton>
            )}
          </IonButtons>
          <IonTitle>Move “{movingName}”</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="move-crumbs">
          <IonIcon icon={homeOutline} />
          {trail.map((c, i) => (
            <span key={c.key} className={i === trail.length - 1 ? 'active' : ''}>
              {i > 0 && ' / '}
              {c.name}
            </span>
          ))}
        </div>

        {groups === null ? (
          <div className="move-center">
            <IonSpinner name="crescent" />
          </div>
        ) : groups.length === 0 ? (
          <p className="move-empty">No subgroups here.</p>
        ) : (
          <div className="group-list">
            {groups.map((g) => (
              <div
                className="group-row"
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => setTrail((t) => [...t, { key: g.id, name: g.name }])}
                onKeyDown={(e) =>
                  e.key === 'Enter' && setTrail((t) => [...t, { key: g.id, name: g.name }])
                }
              >
                <span className="group-row__icon">
                  <IonIcon icon={folderOpenOutline} />
                </span>
                <span className="group-row__name">{g.name}</span>
                <IonIcon className="group-row__chevron" icon={chevronForward} />
              </div>
            ))}
          </div>
        )}
      </IonContent>

      <IonFooter>
        <IonToolbar>
          <IonButton
            expand="block"
            className="move-confirm"
            disabled={busy || samePlace}
            onClick={confirm}
          >
            {busy ? (
              <IonSpinner name="crescent" />
            ) : samePlace ? (
              'Already in this group'
            ) : (
              `Move here (${current.name})`
            )}
          </IonButton>
        </IonToolbar>
      </IonFooter>
    </IonModal>
  );
}
