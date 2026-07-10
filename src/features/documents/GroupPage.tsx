import { useEffect, useState } from 'react';
import {
  IonAvatar,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  RefresherCustomEvent,
  useIonActionSheet,
  useIonAlert,
  useIonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  add,
  alertCircleOutline,
  documentOutline,
  documentsOutline,
  folderOpenOutline,
  folderOutline,
  pencilOutline,
  shareOutline,
  shieldCheckmark,
  swapHorizontalOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { RouteComponentProps, useHistory } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { ROOT_KEY, useDocumentsStore } from '../../store/documentsStore';
import { documents as service } from '../../services/vault';
import { VaultDocument, VaultGroup, expiryInfo } from '../../services/documentsService';
import { resetLocalData } from '../../services/session';
import { logger } from '../../services/logger';
import DocumentCard from './DocumentCard';
import AddDocumentSheet from '../capture/AddDocumentSheet';
import MoveTargetModal from './MoveTargetModal';
import ExportSheet from '../transfer/ExportSheet';
import ImportModal from '../transfer/ImportModal';
import ProfileSheet from '../profile/ProfileSheet';
import type { ExportSource } from '../../services/transferService';
import './DocumentsPage.css';

type Props = RouteComponentProps<{ groupId?: string }>;

export default function GroupPage({ match }: Props) {
  const levelKey = match.params.groupId ?? ROOT_KEY;
  const isRoot = levelKey === ROOT_KEY;
  const history = useHistory();

  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const level = useDocumentsStore((s) => s.levels[levelKey]);
  const groupName = useDocumentsStore((s) =>
    isRoot ? undefined : s.groupNames[levelKey],
  );
  const { loadLevel, createGroup, renameGroup, deleteGroup, setGroupName } =
    useDocumentsStore();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<VaultDocument[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moving, setMoving] = useState<VaultGroup | null>(null);
  const [exportSource, setExportSource] = useState<ExportSource | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [presentActionSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();

  const [attention, setAttention] = useState<VaultDocument[]>([]);

  const loadAttention = () => {
    if (!isRoot) return;
    service
      .listExpiring()
      .then(setAttention)
      .catch((e) => logger.error('Expiring check failed', e as Error));
  };

  const ensureLoaded = () => {
    const l = useDocumentsStore.getState().levels[levelKey];
    if (!l?.loaded && !l?.loading) void loadLevel(levelKey);
    loadAttention();
  };

  useEffect(ensureLoaded, [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useIonViewWillEnter(ensureLoaded, [levelKey]);

  // Header name for deep-linked groups not seen via their parent level yet.
  useEffect(() => {
    if (isRoot || groupName) return;
    service
      .getGroup(levelKey)
      .then((g) => g && setGroupName(levelKey, g.name))
      .catch(() => undefined);
  }, [isRoot, groupName, levelKey, setGroupName]);

  // Global search across all groups.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let active = true;
    setSearching(true);
    service
      .searchDocuments(q)
      .then((docs) => active && setResults(docs))
      .catch((e) => logger.error('Search failed', e as Error))
      .finally(() => active && setSearching(false));
    return () => {
      active = false;
    };
  }, [search]);

  const handleRefresh = async (e: RefresherCustomEvent) => {
    loadAttention();
    await loadLevel(levelKey);
    e.detail.complete();
  };

  const handleSignOut = () => {
    signOut();
    void resetLocalData();
  };

  const promptNewGroup = () =>
    presentAlert({
      header: 'New group',
      inputs: [{ name: 'name', type: 'text', placeholder: 'e.g. Car, House, Vishnu' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Create',
          handler: (values: { name?: string }) => {
            const name = values.name?.trim();
            if (!name) return false;
            createGroup(levelKey, name).catch((e) =>
              presentToast({ message: `Create failed: ${(e as Error).message}`, duration: 3000 }),
            );
            return true;
          },
        },
      ],
    });

  const openAdd = () =>
    presentActionSheet({
      header: 'Add to this group',
      buttons: [
        { text: 'Add document', icon: documentOutline, handler: () => setAddOpen(true) },
        { text: 'New group', icon: folderOutline, handler: promptNewGroup },
        { text: 'Cancel', role: 'cancel' },
      ],
    });

  const promptRenameGroup = (group: VaultGroup) =>
    presentAlert({
      header: 'Rename group',
      inputs: [{ name: 'name', type: 'text', value: group.name }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Rename',
          handler: (values: { name?: string }) => {
            const name = values.name?.trim();
            if (!name) return false;
            renameGroup(levelKey, group.id, name).catch((e) =>
              presentToast({
                message: `Rename failed: ${(e as Error).message}`,
                duration: 3000,
              }),
            );
            return true;
          },
        },
      ],
    });

  // Deletes the whole subtree — warn with what's inside before committing.
  const confirmDeleteGroup = async (group: VaultGroup) => {
    const counts = await service.countContents(group.id).catch(() => null);
    const hasContents = counts !== null && counts.docs + counts.groups > 0;
    const contentsLine = !counts
      ? 'Everything inside will be deleted too.'
      : hasContents
        ? `It contains ${counts.docs} document${counts.docs === 1 ? '' : 's'}` +
          (counts.groups > 0
            ? ` and ${counts.groups} group${counts.groups === 1 ? '' : 's'}`
            : '') +
          '. Everything inside will be deleted.'
        : 'This group is empty.';
    presentAlert({
      header: `Delete “${group.name}”?`,
      message: `${contentsLine} This cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: hasContents ? 'Delete everything' : 'Delete',
          role: 'destructive',
          handler: () =>
            void deleteGroup(levelKey, group.id).catch((e) =>
              presentToast({ message: (e as Error).message, duration: 3500 }),
            ),
        },
      ],
    });
  };

  const showSearch = results !== null;
  const groups = level?.groups ?? [];
  const docs = level?.documents ?? [];
  const isEmpty = level?.loaded && groups.length === 0 && docs.length === 0;

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          {!isRoot && (
            <IonButtons slot="start">
              <IonBackButton defaultHref="/documents" />
            </IonButtons>
          )}
          <IonTitle>
            {isRoot ? (
              <span className="app-title">
                <span className="app-title__badge">
                  <IonIcon icon={shieldCheckmark} />
                </span>
                Your Documents
              </span>
            ) : (
              groupName ?? 'Group'
            )}
          </IonTitle>
          {isRoot && (
            <IonButtons slot="end">
              <IonButton onClick={() => setProfileOpen(true)}>
                <IonAvatar className="topbar-avatar">
                  {profile?.picture ? (
                    <img src={profile.picture} alt={profile.name} referrerPolicy="no-referrer" />
                  ) : (
                    <span>{profile?.name?.[0] ?? '?'}</span>
                  )}
                </IonAvatar>
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
        <IonToolbar className="search-toolbar">
          <IonSearchbar
            className="app-search"
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="Search all documents"
            inputmode="search"
            showClearButton="focus"
            debounce={250}
          />
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} disabled={showSearch}>
          <IonRefresherContent />
        </IonRefresher>

        {showSearch ? (
          <>
            <p className="search-hint">
              {searching ? 'Searching all groups…' : `${results.length} result${results.length === 1 ? '' : 's'} across all groups`}
            </p>
            {searching && results.length === 0 ? (
              <div className="docs-center">
                <IonSpinner name="crescent" />
              </div>
            ) : (
              <div className="docs-grid">
                {results.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {isRoot && attention.length > 0 && (
              <div className="attn">
                <p className="attn__title">
                  <IonIcon icon={alertCircleOutline} />
                  Needs attention
                </p>
                {attention.map((d) => {
                  const info = expiryInfo(d)!;
                  const expired = info.state === 'expired';
                  return (
                    <div
                      key={d.id}
                      className={`attn__row ${expired ? 'expired' : 'expiring'}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => history.push(`/documents/${d.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && history.push(`/documents/${d.id}`)}
                    >
                      <IonIcon icon={expired ? alertCircleOutline : timeOutline} />
                      <span className="attn__name">{d.title}</span>
                      <span className="attn__badge">
                        {expired
                          ? info.days === 0
                            ? 'Expired today'
                            : `Expired ${info.days}d ago`
                          : info.days === 0
                            ? 'Expires today'
                            : `${info.days}d left`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {level?.loading && !level.loaded && (
              <div className="docs-grid" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <div className="doc-skel" key={i} />
                ))}
              </div>
            )}

            {level?.error && (
              <div className="docs-center">
                <IonText color="danger">{level.error}</IonText>
              </div>
            )}

            {groups.length > 0 && (
              <div className="group-list">
                {groups.map((group) => (
                  <div
                    className="group-row"
                    key={group.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => history.push(`/g/${group.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && history.push(`/g/${group.id}`)}
                  >
                    <span className="group-row__icon">
                      <IonIcon icon={folderOpenOutline} />
                    </span>
                    <span className="group-row__name">{group.name}</span>
                    <span className="group-row__actions">
                      <button
                        aria-label={`Rename ${group.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void promptRenameGroup(group);
                        }}
                      >
                        <IonIcon icon={pencilOutline} />
                      </button>
                      <button
                        aria-label={`Move ${group.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMoving(group);
                        }}
                      >
                        <IonIcon icon={swapHorizontalOutline} />
                      </button>
                      <button
                        aria-label={`Export ${group.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExportSource({ kind: 'group', id: group.id, name: group.name });
                        }}
                      >
                        <IonIcon icon={shareOutline} />
                      </button>
                      <button
                        className="danger"
                        aria-label={`Delete ${group.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void confirmDeleteGroup(group);
                        }}
                      >
                        <IonIcon icon={trashOutline} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {docs.length > 0 && (
              <div className="docs-grid">
                {docs.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} />
                ))}
              </div>
            )}

            {isEmpty && !level?.error && (
              <div className="docs-center docs-empty">
                <div className="docs-empty__badge">
                  <IonIcon icon={documentsOutline} />
                </div>
                <h2>Nothing here yet</h2>
                <p>Tap + to add a document or create a group.</p>
              </div>
            )}
          </>
        )}
      </IonContent>

      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton onClick={openAdd}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>

      <AddDocumentSheet
        isOpen={addOpen}
        parentKey={levelKey}
        onDidDismiss={() => setAddOpen(false)}
      />

      <MoveTargetModal
        isOpen={moving !== null}
        movingId={moving?.id ?? ''}
        movingName={moving?.name ?? ''}
        fromKey={levelKey}
        onDidDismiss={() => setMoving(null)}
      />

      <ExportSheet
        isOpen={exportSource !== null}
        source={exportSource}
        onDidDismiss={() => setExportSource(null)}
      />

      <ImportModal isOpen={importOpen} onDidDismiss={() => setImportOpen(false)} />

      <ProfileSheet
        isOpen={profileOpen}
        onDidDismiss={() => setProfileOpen(false)}
        onBackup={() => setExportSource({ kind: 'vault' })}
        onImport={() => setImportOpen(true)}
        onSignOut={handleSignOut}
      />
    </IonPage>
  );
}
