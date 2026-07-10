import { useState } from 'react';
import {
  IonIcon,
  IonModal,
  IonSpinner,
  useIonToast,
} from '@ionic/react';
import {
  archiveOutline,
  bugOutline,
  chevronForward,
  cloudDownloadOutline,
  logOutOutline,
  refreshOutline,
} from 'ionicons/icons';
import { useAuthStore } from '../../store/authStore';
import { APP_VERSION, BUILD_DATE, checkForUpdate } from '../../services/appUpdate';
import { downloadLogs } from '../../services/logger';
import './ProfileSheet.css';

interface Props {
  isOpen: boolean;
  onDidDismiss: () => void;
  onBackup: () => void;
  onImport: () => void;
  onSignOut: () => void;
}

/** Bottom sheet shown from the avatar: account, data actions, app info. */
export default function ProfileSheet({
  isOpen,
  onDidDismiss,
  onBackup,
  onImport,
  onSignOut,
}: Props) {
  const profile = useAuthStore((s) => s.profile);
  const [checking, setChecking] = useState(false);
  const [presentToast] = useIonToast();

  // Dismiss the sheet first so the follow-up modal isn't stacked behind it.
  const runAfterClose = (action: () => void) => {
    onDidDismiss();
    setTimeout(action, 250);
  };

  const onCheckUpdate = async () => {
    setChecking(true);
    const outcome = await checkForUpdate();
    setChecking(false);
    presentToast({
      message:
        outcome === 'updating'
          ? 'New version found — updating…'
          : outcome === 'current'
            ? 'You’re on the latest version.'
            : 'Updates apply automatically when installed.',
      duration: 2500,
    });
  };

  const rows: Array<{
    icon: string;
    label: string;
    note?: string;
    danger?: boolean;
    busy?: boolean;
    onClick: () => void;
  }> = [
    {
      icon: archiveOutline,
      label: 'Back up everything',
      note: 'Export all documents as one file',
      onClick: () => runAfterClose(onBackup),
    },
    {
      icon: cloudDownloadOutline,
      label: 'Import backup',
      note: 'Restore or receive shared documents',
      onClick: () => runAfterClose(onImport),
    },
    {
      icon: refreshOutline,
      label: 'Check for updates',
      note: `Version ${APP_VERSION} · ${BUILD_DATE}`,
      busy: checking,
      onClick: () => void onCheckUpdate(),
    },
    {
      icon: bugOutline,
      label: 'Download logs',
      note: 'For troubleshooting',
      onClick: () => downloadLogs(),
    },
    {
      icon: logOutOutline,
      label: 'Sign out',
      danger: true,
      onClick: () => runAfterClose(onSignOut),
    },
  ];

  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={onDidDismiss}
      initialBreakpoint={0.62}
      breakpoints={[0, 0.62, 0.9]}
      className="profile-sheet"
    >
      <div className="profile-sheet__body">
        <div className="profile-sheet__header">
          <div className="profile-sheet__avatar">
            {profile?.picture ? (
              <img src={profile.picture} alt={profile.name} referrerPolicy="no-referrer" />
            ) : (
              <span>{profile?.name?.[0] ?? '?'}</span>
            )}
          </div>
          <div className="profile-sheet__who">
            <strong>{profile?.name ?? 'Signed in'}</strong>
            <small>{profile?.email}</small>
          </div>
        </div>

        <div className="profile-sheet__list">
          {rows.map((row) => (
            <button
              key={row.label}
              className={`profile-sheet__row ${row.danger ? 'danger' : ''}`}
              onClick={row.onClick}
              disabled={row.busy}
            >
              <span className="profile-sheet__row-icon">
                {row.busy ? <IonSpinner name="crescent" /> : <IonIcon icon={row.icon} />}
              </span>
              <span className="profile-sheet__row-text">
                <span>{row.label}</span>
                {row.note && <small>{row.note}</small>}
              </span>
              <IonIcon className="profile-sheet__row-chevron" icon={chevronForward} />
            </button>
          ))}
        </div>

        <p className="profile-sheet__version">
          Document Vault v{APP_VERSION} · built {BUILD_DATE}
        </p>
      </div>
    </IonModal>
  );
}
