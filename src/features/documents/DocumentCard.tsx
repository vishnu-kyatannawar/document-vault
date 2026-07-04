import { IonCard, IonIcon } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { documentTextOutline, layersOutline } from 'ionicons/icons';
import { VaultDocument } from '../../services/documentsService';
import AuthedImage from '../../components/AuthedImage';
import './DocumentCard.css';

export default function DocumentCard({ doc }: { doc: VaultDocument }) {
  const history = useHistory();
  const cover = doc.parts.find((p) => p.thumbnailLink);

  return (
    <IonCard
      className="doc-card"
      button
      onClick={() => history.push(`/documents/${doc.id}`)}
    >
      <div className="doc-card__thumb">
        {cover ? (
          <AuthedImage src={cover.thumbnailLink} alt={doc.title} className="doc-card__img" />
        ) : (
          <IonIcon icon={documentTextOutline} className="doc-card__icon" />
        )}
        {doc.parts.length > 1 && (
          <span className="doc-card__badge">
            <IonIcon icon={layersOutline} /> {doc.parts.length}
          </span>
        )}
      </div>
      <div className="doc-card__body">
        <h3>{doc.title}</h3>
        <span className="doc-card__cat">{doc.category}</span>
      </div>
    </IonCard>
  );
}
