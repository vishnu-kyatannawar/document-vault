import { useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonList,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import {
  DEFAULT_REMIND_DAYS,
  DocMeta,
  REMIND_OPTIONS,
  VaultDocument,
} from '../../services/documentsService';

interface Props {
  isOpen: boolean;
  doc: VaultDocument;
  onDidDismiss: () => void;
  /** Persist and report the new metadata; may throw. */
  onSave: (meta: DocMeta) => Promise<void>;
}

/** Edit a document's expiry date, reminder window and notes. */
export default function EditDetailsModal({ isOpen, doc, onDidDismiss, onSave }: Props) {
  const [expiresAt, setExpiresAt] = useState('');
  const [remindDays, setRemindDays] = useState(DEFAULT_REMIND_DAYS);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setExpiresAt(doc.expiresAt ?? '');
    setRemindDays(doc.remindDays ?? DEFAULT_REMIND_DAYS);
    setNotes(doc.notes ?? '');
    setSaving(false);
    setError(null);
  }, [isOpen, doc]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        expiresAt: expiresAt || undefined,
        remindDays: expiresAt ? remindDays : undefined,
        notes: notes.trim() || undefined,
      });
      onDidDismiss();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDidDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onDidDismiss}>
              <IonIcon slot="icon-only" icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Edit details</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={saving} onClick={save}>
              {saving ? <IonSpinner name="crescent" /> : 'Save'}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonList inset>
          <IonItem>
            <IonInput
              label="Expiry date"
              labelPlacement="stacked"
              type="date"
              value={expiresAt}
              onIonInput={(e) => setExpiresAt(e.detail.value ?? '')}
            />
          </IonItem>
          {expiresAt && (
            <IonItem>
              <IonSelect
                label="Remind me before"
                labelPlacement="stacked"
                value={remindDays}
                onIonChange={(e) => setRemindDays(e.detail.value)}
              >
                {REMIND_OPTIONS.map((d) => (
                  <IonSelectOption key={d} value={d}>
                    {d} days
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          )}
          <IonItem>
            <IonTextarea
              label="Notes"
              labelPlacement="stacked"
              placeholder="e.g. policy number, renewal contact…"
              autoGrow
              rows={3}
              value={notes}
              onIonInput={(e) => setNotes(e.detail.value ?? '')}
            />
          </IonItem>
        </IonList>
        {error && <p className="ion-text-center ion-padding-top" style={{ color: 'var(--ion-color-danger)' }}>{error}</p>}
      </IonContent>
    </IonModal>
  );
}
