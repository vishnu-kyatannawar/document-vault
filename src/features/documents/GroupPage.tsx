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
  logoGoogle,
  pencilOutline,
  peopleOutline,
  shareOutline,
  shieldCheckmark,
  swapHorizontalOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { RouteComponentProps, useHistory } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { ROOT_KEY, SHARED_KEY, useDocumentsStore } from '../../store/documentsStore';
import { documents as service } from '../../services/vault';
import { VaultDocument, VaultGroup, expiryInfo } from '../../services/documentsService';
import { resetLocalData } from '../../services/session';
import { logger } from '../../services/logger';
import { driveFolderUrl, openInDrive } from '../../services/driveLinks';
import DocumentCard from './DocumentCard';
import AddDocumentSheet from '../capture/AddDocumentSheet';
import MoveTargetModal from './MoveTargetModal';
import ExportSheet from '../transfer/ExportSheet';
import SharePeopleSheet from '../share/SharePeopleSheet';
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
  const shared = useDocumentsStore((s) => (isRoot ? s.levels[SHARED_KEY] : undefined));
  const groupName = useDocumentsStore((s) =>
    isRoot ? undefined : s.groupNames[levelKey],
  );
  // The group we are inside — needed to know whether it was shared with us
  // (read-only: no adding, renaming, moving or deleting anything in it).
  const [group, setGroup] = useState<VaultGroup | null>(null);
  const readOnly = !isRoot && group?.access === 'reader';
  const { loadLevel, createGroup, renameGroup, deleteGroup, setGroupName } =
    useDocumentsStore();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<VaultDocument[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moving, setMoving] = useState<VaultGroup | null>(null);
  const [exportSource, setExportSource] = useState<ExportSource | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [presentActionSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();

  const [attention, setAttention] = useState<VaultDocument[]>([]);
  // Root folder id for the profile sheet's "Open in Google Drive" row. Resolved
  // up front so the link opens synchronously inside the tap (popup blockers).
  const [rootId, setRootId] = useState<string | null>(null);

  useEffect(() => {
    if (!isRoot) return;
    let active = true;
    service
      .ensureRoot()
      .then((id) => active && setRootId(id))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isRoot]);

  const loadAttention = () => {
    if (!isRoot) return;
    service
      .listExpiring()
      .then(setAttention)
      .catch((e) => logger.error('Expiring check failed', e as Error));
  };

  const ensureLoaded = () => {
    const { levels } = useDocumentsStore.getState();
    const l = levels[levelKey];
    if (!l?.loaded && !l?.loading) void loadLevel(levelKey);
    if (isRoot) {
      const sh = levels[SHARED_KEY];
      if (!sh?.loaded && !sh?.loading) void loadLevel(SHARED_KEY);
    }
    loadAttention();
  };

  useEffect(ensureLoaded, [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useIonViewWillEnter(ensureLoaded, [levelKey]);

  // Fetch the group itself: header name for deep links, and whether it was
  // shared with us (read-only mode).
  useEffect(() => {
    setGroup(null);
    if (isRoot) return;
    let active = true;
    service
      .getGroup(levelKey)
      .then((g) => {
        if (!active || !g) return;
        setGroup(g);
        setGroupName(levelKey, g.name);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isRoot, levelKey, setGroupName]);

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
    await Promise.all([loadLevel(levelKey), isRoot ? loadLevel(SHARED_KEY) : null]);
    e.detail.complete();
  };

  // One "share" entry point per group: live sharing with people, or a file export.
  const openShareMenu = (g: VaultGroup) =>
    presentActionSheet({
      header: `Share “${g.name}”`,
      buttons: [
        {
          text: 'Share with people…',
          icon: peopleOutline,
          handler: () => setShareTarget({ id: g.id, name: g.name }),
        },
        {
          text: 'Export as file…',
          icon: shareOutline,
          handler: () => setExportSource({ kind: 'group', id: g.id, name: g.name }),
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });

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
  const hasShared =
    isRoot && !!shared && (shared.groups.length > 0 || shared.documents.length > 0);
  const isEmpty = level?.loaded && groups.length === 0 && docs.length === 0 && !hasShared;

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
            ) : readOnly ? (
              <span className="group-title">
                {groupName ?? 'Group'}
                <small>Shared by {group?.ownerName ?? 'someone'}</small>
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
                      {!readOnly && (
                        <>
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
                            aria-label={`Share ${group.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openShareMenu(group);
                            }}
                          >
                            <IonIcon icon={shareOutline} />
                          </button>
                        </>
                      )}
                      <button
                        aria-label={`Open ${group.name} in Google Drive`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openInDrive(driveFolderUrl(group.id));
                        }}
                      >
                        <IonIcon icon={logoGoogle} />
                      </button>
                      {!readOnly && (
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
                      )}
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

            {hasShared && shared && (
              <section className="shared">
                <p className="shared__title">
                  <IonIcon icon={peopleOutline} />
                  Shared with me
                </p>
                {shared.groups.length > 0 && (
                  <div className="group-list group-list--shared">
                    {shared.groups.map((g) => (
                      <div
                        className="group-row"
                        key={g.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => history.push(`/g/${g.id}`)}
                        onKeyDown={(e) => e.key === 'Enter' && history.push(`/g/${g.id}`)}
                      >
                        <span className="group-row__icon group-row__icon--shared">
                          <IonIcon icon={peopleOutline} />
                        </span>
                        <span className="group-row__name">
                          {g.name}
                          <small className="group-row__sub">Shared by {g.ownerName ?? 'someone'}</small>
                        </span>
                        <span className="group-row__actions">
                          <button
                            aria-label={`Open ${g.name} in Google Drive`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openInDrive(driveFolderUrl(g.id));
                            }}
                          >
                            <IonIcon icon={logoGoogle} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {shared.documents.length > 0 && (
                  <div className="docs-grid">
                    {shared.documents.map((doc) => (
                      <DocumentCard key={doc.id} doc={doc} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {isEmpty && !level?.error && (
              <div className="docs-center docs-empty">
                <div className="docs-empty__badge">
                  <IonIcon icon={documentsOutline} />
                </div>
                <h2>Nothing here yet</h2>
                <p>{readOnly ? 'The owner hasn’t added anything here.' : 'Tap + to add a document or create a group.'}</p>
              </div>
            )}
          </>
        )}
      </IonContent>

      {!readOnly && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton onClick={openAdd}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}

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

      <SharePeopleSheet
        isOpen={shareTarget !== null}
        target={shareTarget}
        onDidDismiss={() => setShareTarget(null)}
      />

      <ProfileSheet
        isOpen={profileOpen}
        onDidDismiss={() => setProfileOpen(false)}
        onBackup={() => setExportSource({ kind: 'vault' })}
        onImport={() => setImportOpen(true)}
        onOpenInDrive={rootId ? () => openInDrive(driveFolderUrl(rootId)) : undefined}
        onSignOut={handleSignOut}
      />
    </IonPage>
  );
}
