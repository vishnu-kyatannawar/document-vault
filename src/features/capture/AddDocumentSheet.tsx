import { useState } from 'react';
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
  IonText,
  IonTitle,
  IonToolbar,
  useIonActionSheet,
} from '@ionic/react';
import {
  cameraOutline,
  closeOutline,
  documentAttachOutline,
  imagesOutline,
  trashOutline,
} from 'ionicons/icons';
import { CaptureSource, pickFiles, suggestFilename } from './capture';
import { useDocumentsStore } from '../../store/documentsStore';
import './AddDocumentSheet.css';

const CATEGORIES = ['ID / License', 'Financial', 'Medical', 'Education', 'Vehicle', 'Other'];

interface StagedPart {
  label: string;
  file: File;
  previewUrl: string;
}

interface Props {
  isOpen: boolean;
  onDidDismiss: () => void;
}

export default function AddDocumentSheet({ isOpen, onDidDismiss }: Props) {
  const create = useDocumentsStore((s) => s.create);
  const [presentActionSheet] = useIonActionSheet();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [parts, setParts] = useState<StagedPart[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    parts.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setTitle('');
    setCategory(CATEGORIES[0]);
    setParts([]);
    setSaving(false);
    setError(null);
  };

  const close = () => {
    reset();
    onDidDismiss();
  };

  const addFrom = (source: CaptureSource) => {
    pickFiles(source, source === 'files').then((files) => {
      const staged = files.map((file, i) => ({
        label: defaultLabel(parts.length + i),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      }));
      if (staged.length) setParts((prev) => [...prev, ...staged]);
    });
  };

  const openPicker = () =>
    presentActionSheet({
      header: 'Add a page',
      buttons: [
        { text: 'Take photo', icon: cameraOutline, handler: () => addFrom('camera') },
        { text: 'Choose from gallery', icon: imagesOutline, handler: () => addFrom('gallery') },
        { text: 'Upload file (PDF/image)', icon: documentAttachOutline, handler: () => addFrom('files') },
        { text: 'Cancel', role: 'cancel' },
      ],
    });

  const setLabel = (i: number, label: string) =>
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, label } : p)));

  const removePart = (i: number) =>
    setParts((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });

  const save = async () => {
    if (!title.trim() || parts.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await create(
        title.trim(),
        category,
        parts.map((p) => ({
          label: p.label || 'Page',
          filename: suggestFilename(p.label || 'page', p.file),
          blob: p.file,
        })),
      );
      close();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const canSave = title.trim().length > 0 && parts.length > 0 && !saving;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={close}>
              <IonIcon slot="icon-only" icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>New document</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={!canSave} onClick={save}>
              {saving ? <IonSpinner name="crescent" /> : 'Save'}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonList inset>
          <IonItem>
            <IonInput
              label="Title"
              labelPlacement="stacked"
              placeholder="e.g. Driving License"
              value={title}
              onIonInput={(e) => setTitle(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonSelect
              label="Category"
              labelPlacement="stacked"
              value={category}
              onIonChange={(e) => setCategory(e.detail.value)}
            >
              {CATEGORIES.map((c) => (
                <IonSelectOption key={c} value={c}>
                  {c}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
        </IonList>

        <div className="add-parts">
          {parts.map((p, i) => (
            <div className="add-part" key={i}>
              <div className="add-part__preview">
                {p.previewUrl ? (
                  <img src={p.previewUrl} alt={p.label} />
                ) : (
                  <IonIcon icon={documentAttachOutline} />
                )}
              </div>
              <IonInput
                className="add-part__label"
                aria-label="Page label"
                value={p.label}
                onIonInput={(e) => setLabel(i, e.detail.value ?? '')}
              />
              <IonButton fill="clear" color="danger" onClick={() => removePart(i)}>
                <IonIcon slot="icon-only" icon={trashOutline} />
              </IonButton>
            </div>
          ))}
        </div>

        <IonButton expand="block" fill="outline" onClick={openPicker} className="add-more">
          <IonIcon slot="start" icon={cameraOutline} />
          {parts.length === 0 ? 'Add page' : 'Add another page'}
        </IonButton>

        <IonText color="medium" className="add-hint">
          <p>Tip: add a front and back as separate pages for cards like licenses.</p>
        </IonText>

        {error && (
          <IonText color="danger">
            <p className="ion-text-center">{error}</p>
          </IonText>
        )}
      </IonContent>
    </IonModal>
  );
}

function defaultLabel(index: number): string {
  if (index === 0) return 'Front';
  if (index === 1) return 'Back';
  return `Page ${index + 1}`;
}
