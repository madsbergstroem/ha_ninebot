/** Premium vehicle status card. It renders existing HA entities; no cloud calls of its own. */
import {
  batteryLevel, formatState, labelsFor, normalizeConfig, stateAvailable, stubConfig, vehicleEntities,
} from './vehicle-card.js';
import './vehicle-card-editor.js';

function element(tag, text = '', className = '') {
  const result = document.createElement(tag);
  if (text !== '') result.textContent = String(text);
  if (className) result.className = className;
  return result;
}

function icon(name) {
  const result = document.createElement('ha-icon');
  result.setAttribute('icon', `mdi:${name}`);
  result.setAttribute('aria-hidden', 'true');
  return result;
}

const CSS = `
:host{display:block;container-type:inline-size}*{box-sizing:border-box}
ha-card{display:block;overflow:hidden;border:1px solid var(--divider-color);border-radius:20px;background:var(--card-background-color);color:var(--primary-text-color)}
button{font:inherit}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 0}
.eyebrow{margin:0 0 2px;color:var(--secondary-text-color);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
h2{margin:0;font-size:18px;font-weight:650;letter-spacing:-.025em;line-height:1.2;overflow-wrap:anywhere}
.status{display:inline-flex;align-items:center;gap:5px;flex:none;border-radius:999px;padding:4px 9px;background:color-mix(in srgb,var(--success-color,#4ade80) 13%,transparent);color:var(--success-color,#4ade80);font-size:10.5px;font-weight:650}
.status::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}.status.unlocked{color:var(--warning-color,#f59e0b);background:color-mix(in srgb,var(--warning-color,#f59e0b) 13%,transparent)}
.status.off{color:var(--secondary-text-color);background:color-mix(in srgb,var(--secondary-text-color) 10%,transparent)}
.hero{display:grid;grid-template-columns:104px minmax(0,1fr);align-items:center;gap:6px;min-height:210px;padding:4px 16px 0}
.gauge-wrap{display:flex;flex-direction:column;align-items:center;min-width:0}.gauge{position:relative;width:92px;height:92px}
.gauge svg{display:block;width:100%;height:100%;transform:rotate(-90deg)}.gauge circle{fill:none;stroke-width:8}
.gauge .track{stroke:color-mix(in srgb,var(--secondary-text-color) 14%,transparent)}.gauge .level{stroke:currentColor;stroke-linecap:round;transition:stroke-dashoffset .35s ease}
.gauge.medium{color:var(--warning-color,#f59e0b)}.gauge.low{color:var(--error-color,#f43f5e)}.gauge.high{color:var(--success-color,#4ade80)}.gauge.unknown{color:var(--disabled-text-color,var(--secondary-text-color))}
.gauge-value{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:700;letter-spacing:-.055em}.gauge-value small{margin:5px 0 0 2px;font-size:13px;font-weight:600;letter-spacing:0}
.gauge-label{margin-top:0;color:var(--secondary-text-color);font-size:10px}.range{display:flex;flex-direction:column;align-items:center;margin-top:4px;line-height:1.2}
.range strong{font-size:15px;font-weight:700;letter-spacing:-.02em}.range span{margin-top:1px;color:var(--secondary-text-color);font-size:9px}
.vehicle{display:flex;align-items:center;justify-content:center;width:100%;height:194px;min-width:0;padding:0;border:0;border-radius:18px;background:radial-gradient(ellipse at 50% 65%,color-mix(in srgb,var(--primary-color) 12%,transparent),transparent 70%);color:var(--primary-color);cursor:pointer}
.vehicle img{display:block;width:100%;height:190px;object-fit:contain;transform:scaleX(-1);filter:drop-shadow(0 14px 12px rgb(0 0 0 / .22))}.vehicle ha-icon{--mdc-icon-size:64px;opacity:.5}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:8px 16px 10px}
.metric{display:flex;flex-direction:column;align-items:flex-start;min-width:0;min-height:52px;padding:8px;border:0;border-radius:13px;background:color-mix(in srgb,var(--secondary-text-color) 7%,transparent);color:var(--primary-text-color);text-align:left;cursor:pointer}
.metric ha-icon{margin-bottom:5px;color:var(--secondary-text-color);--mdc-icon-size:15px}.metric .value{display:block;max-width:100%;overflow:hidden;font-size:13px;font-weight:650;letter-spacing:-.02em;text-overflow:ellipsis;white-space:nowrap}
.metric .label{display:block;max-width:100%;margin-top:2px;overflow:hidden;color:var(--secondary-text-color);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.metric:disabled{cursor:default;opacity:.58}
.presence{display:flex;align-items:center;gap:6px;margin:0 16px 9px;color:var(--secondary-text-color);font-size:11px}.presence ha-icon{--mdc-icon-size:15px}.presence span+span::before{content:"·";margin-right:6px}
.controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--divider-color)}
.control{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;min-height:52px;padding:6px 4px;border:0;border-right:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font-size:10px;cursor:pointer}
.control:last-child{border-right:0}.control ha-icon{--mdc-icon-size:18px;color:var(--primary-color)}.control:disabled{cursor:default;opacity:.42}.control.busy{opacity:.6}
.error{margin:0;padding:9px 16px;background:color-mix(in srgb,var(--error-color) 9%,transparent);color:var(--error-color);font-size:11.5px;line-height:1.4}
button:focus-visible{outline:2px solid var(--primary-color);outline-offset:-3px}@media(prefers-reduced-motion:no-preference){.control,.metric{transition:background .16s ease}.control:hover,.metric:hover{background:color-mix(in srgb,var(--primary-color) 8%,transparent)}}
@container(max-width:430px){.hero{grid-template-columns:96px minmax(0,1fr);padding-inline:12px}.gauge{width:84px;height:84px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr));padding-inline:12px}.header{padding-inline:12px}.presence{margin-inline:12px}.vehicle{height:178px}.vehicle img{height:176px}}
@container(max-width:310px){.hero{grid-template-columns:1fr}.vehicle{order:-1;height:160px}.vehicle img{height:158px}.gauge-wrap{padding-bottom:6px}.status{padding:4px 8px}.controls{grid-template-columns:repeat(2,minmax(0,1fr))}.control:nth-child(2){border-right:0}.control:nth-child(-n+2){border-bottom:1px solid var(--divider-color)}}
@media(prefers-reduced-motion:reduce){.gauge .level{transition:none}}
`;

export class NinebotVehicleCard extends (globalThis.HTMLElement ?? class {}) {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.busy = false;
    this.actionError = false;
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
    this.ids = vehicleEntities(this.config);
    this.render();
  }

  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (!this.config) return;
    const changed = !previous || previous.language !== hass.language || previous.locale?.language !== hass.locale?.language ||
      Object.values(this.ids).some(id => previous.states?.[id] !== hass.states?.[id]);
    if (changed) this.render();
  }

  get hass() { return this._hass; }
  connectedCallback() { this.render(); }
  getCardSize() { return 5; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  static getConfigElement() { return document.createElement('ninebot-vehicle-card-editor'); }
  static getStubConfig(hass) { return { type: 'custom:ninebot-vehicle-card', ...stubConfig(hass.states) }; }

  labels() { return labelsFor(this._hass?.language ?? 'en'); }
  state(key) { return this._hass?.states?.[this.ids?.[key]]; }

  openMoreInfo(key) {
    const entityId = this.ids[key];
    if (!this._hass?.states?.[entityId]) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  controlAvailable(key) {
    const state = this.state(key);
    if (!state || state.state === 'unavailable') return false;
    return key !== 'lock' || ['locked', 'unlocked'].includes(state.state);
  }

  async runAction(key) {
    if (this.busy || !this.controlAvailable(key)) return;
    const labels = this.labels();
    let domain = 'button', service = 'press';
    if (key === 'lock') {
      const unlocking = this.state('lock').state === 'locked';
      if (unlocking && globalThis.confirm && !globalThis.confirm(labels.confirm_unlock)) return;
      domain = 'lock'; service = unlocking ? 'unlock' : 'lock';
    } else if (key === 'seat' && globalThis.confirm && !globalThis.confirm(labels.confirm_seat)) return;
    this.busy = true; this.actionError = false; this.render();
    try {
      await this._hass.callService(domain, service, { entity_id: this.ids[key] });
    } catch {
      this.actionError = true;
    } finally {
      this.busy = false; this.render();
    }
  }

  title() {
    if (this.config.name) return this.config.name;
    for (const key of ['location', 'image', 'battery']) {
      const name = this.state(key)?.attributes?.friendly_name;
      if (name) return name;
    }
    return 'Ninebot';
  }

  status(labels) {
    if (this.state('charging')?.state === 'on') return { text: labels.charging, className: 'charging' };
    if (this.state('lock')?.state === 'locked') return { text: labels.locked, className: 'locked' };
    if (this.state('lock')?.state === 'unlocked') return { text: labels.unlocked, className: 'unlocked' };
    if (this.state('power')?.state === 'off') return { text: labels.power_off, className: 'off' };
    return null;
  }

  gauge(labels) {
    const wrap = element('div', '', 'gauge-wrap');
    const level = batteryLevel(this.state('battery'));
    const gauge = element('div', '', `gauge ${level === null ? 'unknown' : level < 15 ? 'low' : level < 35 ? 'medium' : 'high'}`);
    gauge.setAttribute('role', 'img');
    gauge.setAttribute('aria-label', `${labels.battery}: ${level === null ? '—' : `${Math.round(level)}%`}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('aria-hidden', 'true');
    for (const className of ['track', 'level']) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '60'); circle.setAttribute('cy', '60'); circle.setAttribute('r', '52');
      circle.setAttribute('pathLength', '100'); circle.setAttribute('class', className);
      circle.setAttribute('stroke-dasharray', '100');
      if (className === 'level') circle.setAttribute('stroke-dashoffset', String(100 - (level ?? 0)));
      svg.append(circle);
    }
    const value = element('div', '', 'gauge-value');
    value.append(element('span', level === null ? '—' : Math.round(level)));
    if (level !== null) value.append(element('small', '%'));
    gauge.append(svg, value);
    const range = element('div', '', 'range');
    range.append(element('strong', formatState(this.state('range'), this._hass?.language)), element('span', labels.range));
    wrap.append(gauge, element('div', labels.battery, 'gauge-label'), range);
    return wrap;
  }

  navigate(path) {
    globalThis.history?.pushState?.(null, '', path);
    globalThis.dispatchEvent?.(new CustomEvent('location-changed', { bubbles: true, composed: true, detail: { replace: false } }));
  }

  vehicleImage(labels) {
    const button = element('button', '', 'vehicle'); button.type = 'button';
    button.setAttribute('aria-label', labels.vehicle_image);
    const state = this.state('image');
    const picture = state?.attributes?.entity_picture;
    if (typeof picture === 'string' && picture.startsWith('/')) {
      const image = document.createElement('img'); image.src = picture; image.alt = labels.vehicle_image;
      image.addEventListener('error', () => { image.replaceWith(icon('scooter')); }, { once: true });
      button.append(image);
    } else button.append(icon('scooter'));
    button.disabled = !state;
    button.addEventListener('click', () => {
      if (this.config.image_navigate) this.navigate(this.config.image_navigate);
      else this.openMoreInfo('image');
    });
    return button;
  }

  metric(key, label, iconName, maximumFractionDigits = 1) {
    const state = this.state(key);
    const button = element('button', '', 'metric'); button.type = 'button';
    button.append(icon(iconName), element('span', formatState(state, this._hass?.language, maximumFractionDigits), 'value'), element('span', label, 'label'));
    button.disabled = !stateAvailable(state);
    button.addEventListener('click', () => this.openMoreInfo(key));
    return button;
  }

  presence(labels) {
    const row = element('div', '', 'presence'); row.append(icon('map-marker'));
    const location = this.state('location');
    if (location) {
      const text = location.state === 'home' ? labels.home : location.state === 'not_home' ? labels.away :
        stateAvailable(location) ? location.state : labels.unavailable;
      row.append(element('span', text));
    }
    const power = this.state('power');
    if (stateAvailable(power)) row.append(element('span', power.state === 'on' ? labels.power_on : labels.power_off));
    if (!row.querySelector('span')) row.append(element('span', labels.unavailable));
    return row;
  }

  controls(labels) {
    const row = element('div', '', 'controls');
    const lockState = this.state('lock')?.state;
    const definitions = [
      ['lock', lockState === 'locked' ? labels.unlock : labels.lock, lockState === 'locked' ? 'lock-open-outline' : 'lock-outline'],
      ['find', labels.find, 'bullhorn'], ['seat', labels.seat, ''], ['refresh', labels.refresh, 'refresh'],
    ];
    for (const [key, label, iconName] of definitions) {
      const button = element('button', '', `control${this.busy ? ' busy' : ''}`); button.type = 'button';
      if (iconName) button.append(icon(iconName));
      button.append(element('span', label));
      button.disabled = this.busy || !this.controlAvailable(key);
      button.addEventListener('click', () => void this.runAction(key));
      row.append(button);
    }
    return row;
  }

  render() {
    if (!this.config || !this._hass || !this.shadowRoot) return;
    const labels = this.labels(), card = element('ha-card'), header = element('header', '', 'header');
    const heading = element('div'); heading.append(element('p', 'Ninebot', 'eyebrow'), element('h2', this.title()));
    header.append(heading);
    const status = this.status(labels); if (status) header.append(element('span', status.text, `status ${status.className}`));
    const hero = element('div', '', 'hero'); hero.append(this.gauge(labels), this.vehicleImage(labels));
    const metrics = element('div', '', 'metrics');
    metrics.append(
      this.metric('odometer', labels.odometer, 'counter', 0),
      this.metric('today_distance', labels.today, 'map-marker-distance'),
      this.metric('battery_temperature', labels.temperature, 'thermometer'),
      this.metric('battery_health', labels.health, 'heart-pulse', 0),
    );
    card.append(header, hero);
    if (this.config.show_metrics !== false) card.append(metrics);
    if (this.config.show_presence !== false) card.append(this.presence(labels));
    if (this.config.show_controls !== false) card.append(this.controls(labels));
    if (this.actionError) { const error = element('p', labels.action_error, 'error'); error.setAttribute('role', 'alert'); card.append(error); }
    this.shadowRoot.replaceChildren(element('style', CSS), card);
  }
}

if (globalThis.customElements && !customElements.get('ninebot-vehicle-card')) {
  customElements.define('ninebot-vehicle-card', NinebotVehicleCard);
  globalThis.customCards ??= [];
  globalThis.customCards.push({
    type: 'ninebot-vehicle-card', name: 'Ninebot Vehicle',
    description: 'Vehicle image, battery, range, live details and controls', preview: true,
  });
}
