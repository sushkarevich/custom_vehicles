import type { VehicleVariantDefinition } from '../../../shared/schema'
import { serializeVariantYaml } from '../../../shared/yaml'

export function VariantWorkspace({
  variant
}: {
  variant: VehicleVariantDefinition
}): React.JSX.Element {
  return (
    <main className="variant-workspace">
      <div className="variant-hero">
        <div className="vehicle-mark" aria-hidden="true">
          <span className="vehicle-body" />
          <span className="vehicle-window" />
          <span className="vehicle-wheel left" />
          <span className="vehicle-wheel right" />
        </div>
        <span className="eyebrow">Vehicle Variant YAML</span>
        <h1>{variant['display-name'] || 'Новый вариант транспорта'}</h1>
        <p>
          Поведение <strong>{variant.behavior}</strong> использует визуальные модели по стабильным ID.
          Физика и управление остаются в соответствующем семействе плагина.
        </p>
      </div>
      <section className="yaml-preview">
        <div className="yaml-preview-heading">
          <div>
            <span className="status-dot" />
            <strong>Предпросмотр YAML</strong>
          </div>
          <small>Обновляется автоматически</small>
        </div>
        <pre><code>{serializeVariantYaml(variant)}</code></pre>
      </section>
    </main>
  )
}
