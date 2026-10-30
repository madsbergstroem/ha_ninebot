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

    const controlLabel = document.createElement('label'); controlLabel.className = 'check';
    const controls = document.createElement('input'); controls.type = 'checkbox'; controls.checked = this.config.show_controls !== false;
    controls.addEventListener('change', () => this.emit({ ...this.config, show_controls: controls.checked }));
    controlLabel.append(controls, document.createTextNode(labels.editor_controls)); root.append(controlLabel);
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
