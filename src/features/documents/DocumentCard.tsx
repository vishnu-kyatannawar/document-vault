import { IonCard, IonIcon, IonSpinner } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { documentTextOutline, layersOutline, timeOutline } from 'ionicons/icons';
import { VaultDocument, expiryInfo } from '../../services/documentsService';
import { useThumbnail } from '../../hooks/useThumbnail';
import './DocumentCard.css';

export default function DocumentCard({ doc }: { doc: VaultDocument }) {
  const history = useHistory();
  const cover = doc.parts[0];
  const { url, failed } = useThumbnail(cover);
  const info = expiryInfo(doc);
  const expired = info?.state === 'expired';
  const expiring = info?.state === 'expiring';

  return (
    <IonCard
      className={`doc-card ${expired ? 'doc-card--expired' : ''}`}
      button
      onClick={() => history.push(`/documents/${doc.id}`)}
    >
      <div className="doc-card__thumb">
        {url ? (
          <img src={url} alt={doc.title} className="doc-card__img" />
        ) : failed || !cover ? (
          <IonIcon icon={documentTextOutline} className="doc-card__icon" />
        ) : (
          <IonSpinner name="crescent" className="doc-card__spin" />
        )}
        {doc.parts.length > 1 && (
          <span className="doc-card__badge">
            <IonIcon icon={layersOutline} /> {doc.parts.length}
          </span>
        )}
        {(expired || expiring) && info && (
          <span className={`doc-card__expiry ${expired ? 'expired' : 'expiring'}`}>
            <IonIcon icon={timeOutline} />
            {expired
              ? 'Expired'
              : info.days === 0
                ? 'Today'
                : `${info.days}d left`}
          </span>
        )}
      </div>
      <div className="doc-card__body">
        <h3>{doc.title}</h3>
      </div>
    </IonCard>
  );
}
