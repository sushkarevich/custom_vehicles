import type { VehicleVariantDefinition } from '../../../shared/schema'

export function VariantSummary({
  variant
}: {
  variant: VehicleVariantDefinition
}): React.JSX.Element {
  const references =
    variant.model === undefined ? Object.entries(variant.models ?? {}) : [['model', variant.model]]
  return (
    <aside className="left-panel panel variant-summary">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Конфигурация</span>
          <h2>Вариант</h2>
        </div>
        <span className="behavior-badge">{variant.behavior}</span>
      </div>
      <div className="variant-card">
        <span className="variant-icon" aria-hidden="true">▦</span>
        <strong>{variant['display-name'] || 'Без названия'}</strong>
        <small>{variant.id || 'без_id'}</small>
      </div>
      <section className="summary-section">
        <h3>Ссылки на модели</h3>
        {references.length === 0 ? (
          <p className="empty-state">Модели пока не указаны</p>
        ) : (
          references.map(([role, modelId]) => (
            <div className="reference-row" key={role}>
              <span>{role}</span>
              <code>{modelId}</code>
            </div>
          ))
        )}
      </section>
      <section className="summary-section hint-card">
        <h3>Как использовать</h3>
        <p>
          Экспортируйте файл в каталог <code>vehicles</code> плагина, затем выполните
          <code>/cv reload</code>.
        </p>
      </section>
    </aside>
  )
}
