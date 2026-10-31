/** Native visual editor for the vehicle status card's common options. */
import { batteryCandidates, labelsFor, normalizeConfig } from './vehicle-card.js';

export class NinebotVehicleCardEditor extends (globalThis.HTMLElement ?? class {}) {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }
  setConfig(config) { this.config = normalizeConfig(config); this.render(); }
  set hass(value) { this._hass = value; this.render(); }

  emit(candidate) {
    const config = normalizeConfig(candidate);
    this.config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    this.render();
  }

  render() {
    if (!this.config) return;
    const labels = labelsFor(this._hass?.language ?? 'en');
    const root = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = ':host{display:block}label{display:flex;flex-direction:column;gap:6px;margin:12px 0;font-size:14px}input,select{font:inherit;color:var(--primary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:8px;padding:10px;min-width:0}.check{flex-direction:row;align-items:center}.check input{width:20px;height:20px}small{color:var(--secondary-text-color);line-height:1.5}p{color:var(--error-color)}';
    const entityLabel = document.createElement('label'); entityLabel.textContent = labels.editor_vehicle;
    const select = document.createElement('select');
    const candidates = batteryCandidates(this._hass?.states);
    if (!candidates.some(([id]) => id === this.config.entity)) candidates.unshift([this.config.entity, this.config.entity]);
    for (const [id, state] of candidates) {
      const option = document.createElement('option'); option.value = id;
      option.textContent = `${state.attributes?.friendly_name ?? id} (${id})`; select.append(option);
    }
    select.value = this.config.entity;
    select.addEventListener('change', () => this.emit({ ...this.config, entity: select.value, entities: {} }));
    entityLabel.append(select); root.append(entityLabel);

    const nameLabel = document.createElement('label'); nameLabel.textContent = labels.editor_name;
    const name = document.createElement('input'); name.type = 'text'; name.value = this.config.name ?? '';
    name.addEventListener('change', () => {
      const candidate = { ...this.config, entities: { ...this.config.entities } };
      if (name.value) candidate.name = name.value; else delete candidate.name;
      this.emit(candidate);
    });
    nameLabel.append(name); root.append(nameLabel);

    const switches = [
      ['show_controls', labels.editor_controls],
      ['show_metrics', labels.editor_metrics],
      ['show_presence', labels.editor_presence],
      ['tabs', labels.editor_tabs],
      ['map', labels.editor_map],
      ['details', labels.editor_details],
      ['show_background', labels.editor_background],
    ];
    for (const [key, text] of switches) {
      const row = document.createElement('label'); row.className = 'check';
      const box = document.createElement('input'); box.type = 'checkbox'; box.checked = this.config[key] !== false;
      box.addEventListener('change', () => this.emit({ ...this.config, [key]: box.checked }));
      row.append(box, document.createTextNode(text)); root.append(row);
    }

    const pathLabel = document.createElement('label'); pathLabel.textContent = labels.editor_image_path;
    const path = document.createElement('input'); path.type = 'text'; path.value = this.config.image_navigate ?? '';
    path.placeholder = '/lovelace/REPLACE_WITH_DETAILS_VIEW';
    path.addEventListener('change', () => {
      const candidate = { ...this.config, entities: { ...this.config.entities } };
      if (path.value.trim()) candidate.image_navigate = path.value.trim(); else delete candidate.image_navigate;
      this.emit(candidate);
    });
    pathLabel.append(path); root.append(pathLabel);

    root.append(elementSmall(labels.editor_note));
    this.shadowRoot.replaceChildren(style, root);
  }
}

function elementSmall(text) {
  const result = document.createElement('small'); result.textContent = text; return result;
}

if (globalThis.customElements && !customElements.get('ninebot-vehicle-card-editor')) {
  customElements.define('ninebot-vehicle-card-editor', NinebotVehicleCardEditor);
}
