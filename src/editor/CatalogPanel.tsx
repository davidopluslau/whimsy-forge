import { useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '../api/catalog';
import { assetHref, type CatalogAsset, type Category, CATEGORY_LABELS, categoriesIn, filterCatalog } from '../model/catalog';
import { formatLength, type LengthUnit } from '../model/units';
import { AssetPreview } from '../scene/AssetPreview';

function formatSize(meters: readonly number[], unit: LengthUnit) {
  return meters.map((side) => formatLength(side, unit)).join(' × ');
}

type PreviewDialogProps = {
  asset: CatalogAsset;
  unit: LengthUnit;
  onClose: () => void;
};

function PreviewDialog({ asset, unit, onClose }: PreviewDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [measured, setMeasured] = useState<[number, number, number] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="asset-preview"
      aria-label={asset.name}
      data-testid="asset-preview"
      data-measured-size={measured?.join(' ')}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <div className="asset-preview__stage">
        {asset.kind === 'model' ? (
          failed ? (
            <p className="asset-preview__message" role="alert">
              This model couldn't be loaded.
            </p>
          ) : (
            <AssetPreview url={assetHref(asset.url)} onMeasured={setMeasured} onError={() => setFailed(true)} />
          )
        ) : (
          <img className="asset-preview__image" src={assetHref(asset.url)} alt="" />
        )}
      </div>
      <div className="asset-preview__details">
        <h2>{asset.name}</h2>
        <p>
          {CATEGORY_LABELS[asset.category]} · {formatSize(asset.dimensions, unit)} (W × H × D)
        </p>
        <p>
          {asset.license} ·{' '}
          <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        </p>
        <button type="button" className="button-quiet" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}

type CatalogPanelProps = {
  unit: LengthUnit;
};

export function CatalogPanel({ unit }: CatalogPanelProps) {
  const { catalog, retry } = useCatalog();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [previewing, setPreviewing] = useState<CatalogAsset | null>(null);

  const assets = useMemo(() => (catalog.status === 'ready' ? catalog.assets : []), [catalog]);
  const categories = useMemo(() => categoriesIn(assets), [assets]);
  const matches = useMemo(() => filterCatalog(assets, { query, category }), [assets, query, category]);

  return (
    <aside className="catalog" aria-label="Catalog" data-testid="catalog" data-status={catalog.status}>
      <input
        type="search"
        className="catalog__search"
        placeholder="Search furniture"
        aria-label="Search furniture"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="catalog__categories" role="group" aria-label="Category">
        <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>
          All
        </button>
        {categories.map((option) => (
          <button key={option} type="button" aria-pressed={category === option} onClick={() => setCategory(option)}>
            {CATEGORY_LABELS[option]}
          </button>
        ))}
      </div>

      {catalog.status === 'loading' && <p className="catalog__message">Loading the catalog…</p>}
      {catalog.status === 'error' && (
        <div className="catalog__message" role="alert">
          <p>The catalog couldn't be loaded.</p>
          <button type="button" className="button-quiet" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {catalog.status === 'ready' && matches.length === 0 && (
        <p className="catalog__message">{assets.length === 0 ? 'The catalog is empty.' : 'Nothing matches that search.'}</p>
      )}

      <ul className="catalog__grid">
        {matches.map((asset) => (
          <li key={asset.id}>
            <button type="button" className="catalog__tile" data-asset-id={asset.id} onClick={() => setPreviewing(asset)}>
              <img src={assetHref(asset.thumbnailUrl)} alt="" width={256} height={256} loading="lazy" decoding="async" />
              <span className="catalog__name">{asset.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {previewing && <PreviewDialog key={previewing.id} asset={previewing} unit={unit} onClose={() => setPreviewing(null)} />}
    </aside>
  );
}
