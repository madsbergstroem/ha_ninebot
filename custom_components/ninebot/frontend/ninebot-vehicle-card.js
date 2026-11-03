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

/** Single-path silhouettes drawn for this card: a find-me pin and an opened seat bench. */
const GLYPHS = Object.freeze({
  find: 'M12 3.15C8.55 3.15 5.85 5.9 5.85 9.3C5.85 13.5 12 20.8 12 20.8S18.15 13.5 18.15 9.3C18.15 5.9 15.45 3.15 12 3.15ZM12 7.1A2.15 2.15 0 1 1 12 11.4A2.15 2.15 0 1 1 12 7.1ZM4.15 4.75C2.7 7.1 2.7 10.8 4.15 13.1L2.95 14C.85 11.2.85 6.8 2.95 3.9ZM19.85 4.75C21.3 7.1 21.3 10.8 19.85 13.1L21.05 14C23.15 11.2 23.15 6.8 21.05 3.9Z',
  seat: 'M9.35 3.45 11 1.35 12.65 3.45H11.6V5.45H10.4V3.45ZM6.8 5.05 7.55 4.25 13.25 9.05Q13.8 9.5 13.2 10.05L12.9 10.35ZM12.5 9.9 13.25 10.35 12.75 12.4H11.85ZM2.7 15.8V14.25Q2.7 11.45 5.9 11.45H8.5Q11 11.45 11.7 13.65L12.7 15.4H15V17.1H8.1Q7.2 15.6 5.05 15.6Q3.5 15.6 2.7 16.55ZM15.65 6.55H19.4V7.75H17.6Q17.8 12 19.7 15.55L20.7 16.75H17.4Q15.1 14.65 14.85 11.4L15.55 7.75H15.65ZM7.5 18.5A2.5 2.5 0 1 1 2.5 18.5 2.5 2.5 0 1 1 7.5 18.5ZM5.8 18.5A.8.8 0 1 0 4.2 18.5 .8.8 0 1 0 5.8 18.5ZM21.5 18.5A2.5 2.5 0 1 1 16.5 18.5 2.5 2.5 0 1 1 21.5 18.5ZM19.8 18.5A.8.8 0 1 0 18.2 18.5 .8.8 0 1 0 19.8 18.5Z',
});

function glyph(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'glyph');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GLYPHS[name]);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

/** key, icon, label key, fraction digits */
const DETAIL_ROWS = Object.freeze([
  ['bms_voltage', 'flash-outline', 'voltage', 1],
  ['bms_cycles', 'counter', 'cycles', 0],
  ['charge_time', 'timer-outline', 'charge_time', 0],
  ['reserve', 'battery-alert', 'reserve', 0],
  ['range_ai', 'map-marker-path', 'range_ai', 1],
  ['battery_health', 'heart-pulse', 'health', 0],
  ['rides_today', 'bike-fast', 'rides_today', 0],
  ['month_mileage', 'map-marker-distance', 'month_mileage', 1],
  ['month_rides', 'bike-fast', 'month_rides', 0],
  ['charging_power', 'flash', 'charging_power', 0],
  ['month_energy', 'lightning-bolt', 'month_energy', 1],
]);

const CSS = `
:host{display:block;container-type:inline-size}*{box-sizing:border-box}
ha-card{position:relative;isolation:isolate;display:block;overflow:hidden;border:1px solid var(--divider-color);border-radius:20px;background:var(--card-background-color);color:var(--primary-text-color)}
.backdrop{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.backdrop img{width:100%;height:100%;object-fit:cover;object-position:78% 42%;opacity:.32;filter:blur(7px) saturate(1.15);transform:scale(1.15)}
.backdrop::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--card-background-color) 35%,transparent) 0%,color-mix(in srgb,var(--card-background-color) 88%,transparent) 62%,var(--card-background-color) 100%)}
.header,.tabs,.panel,.controls,.error{position:relative;z-index:1}
button{font:inherit}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 0}
.eyebrow{margin:0 0 2px;color:var(--secondary-text-color);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
h2{margin:0;font-size:18px;font-weight:650;letter-spacing:-.025em;line-height:1.2;overflow-wrap:anywhere}
.status{display:inline-flex;align-items:center;gap:5px;flex:none;border-radius:999px;padding:4px 9px;background:color-mix(in srgb,var(--success-color,#4ade80) 13%,transparent);color:var(--success-color,#4ade80);font-size:10.5px;font-weight:650}
.status::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}.status.unlocked{color:var(--warning-color,#f59e0b);background:color-mix(in srgb,var(--warning-color,#f59e0b) 13%,transparent)}
.status.off{color:var(--secondary-text-color);background:color-mix(in srgb,var(--secondary-text-color) 10%,transparent)}
.tabs{display:flex;gap:2px;margin:10px 12px 0;padding:3px;border-radius:999px;background:color-mix(in srgb,var(--secondary-text-color) 14%,var(--card-background-color))}
.tab{flex:1 1 0;min-width:0;padding:6px 8px;border:0;border-radius:999px;background:transparent;color:var(--secondary-text-color);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.tab[aria-selected="true"]{background:color-mix(in srgb,var(--primary-color) 22%,var(--card-background-color));color:var(--primary-text-color)}
.panel[hidden]{display:none}
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
.metric{display:flex;flex-direction:column;align-items:flex-start;min-width:0;min-height:52px;padding:8px;border:0;border-radius:13px;background:color-mix(in srgb,var(--secondary-text-color) 9%,var(--card-background-color));color:var(--primary-text-color);text-align:left;cursor:pointer}
.metric ha-icon{margin-bottom:5px;color:var(--secondary-text-color);--mdc-icon-size:15px}.metric .value{display:block;max-width:100%;overflow:hidden;font-size:13px;font-weight:650;letter-spacing:-.02em;text-overflow:ellipsis;white-space:nowrap}
.metric .label{display:block;max-width:100%;margin-top:2px;overflow:hidden;color:var(--secondary-text-color);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.metric:disabled{cursor:default;opacity:.58}
.presence{display:flex;align-items:center;gap:6px;margin:0 16px 9px;color:var(--secondary-text-color);font-size:11px}.presence ha-icon{--mdc-icon-size:15px}.presence span+span::before{content:"·";margin-right:6px}
.map{height:210px;margin:8px 12px 10px;border-radius:14px;overflow:hidden;background:color-mix(in srgb,var(--secondary-text-color) 8%,var(--card-background-color))}
.map hui-map-card{display:block;height:100%}.map-note{margin:0;padding:14px;color:var(--secondary-text-color);font-size:11.5px;line-height:1.5}
.details{margin:8px 12px 10px;border-radius:14px;overflow:hidden;background:color-mix(in srgb,var(--secondary-text-color) 8%,var(--card-background-color))}
.row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:9px 11px;border:0;border-bottom:1px solid color-mix(in srgb,var(--divider-color) 65%,transparent);background:transparent;color:var(--primary-text-color);font-size:12px;text-align:left;cursor:pointer}
.row:last-child{border-bottom:0}.row ha-icon{flex:none;--mdc-icon-size:15px;color:var(--secondary-text-color)}
.row-label{flex:1 1 auto;min-width:0;overflow:hidden;color:var(--secondary-text-color);text-overflow:ellipsis;white-space:nowrap}
.row-value{flex:none;font-weight:650;letter-spacing:-.01em;white-space:nowrap}.row:disabled{cursor:default;opacity:.5}
.controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--divider-color)}
.control{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;min-height:52px;padding:6px 4px;border:0;border-right:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font-size:10px;cursor:pointer}
.control:last-child{border-right:0}.control ha-icon{--mdc-icon-size:18px;color:var(--primary-color)}
.control .glyph{width:18px;height:18px;color:var(--primary-color)}.control:disabled{cursor:default;opacity:.42}.control.busy{opacity:.6}
.error{margin:0;padding:9px 16px;background:color-mix(in srgb,var(--error-color) 9%,transparent);color:var(--error-color);font-size:11.5px;line-height:1.4}
button:focus-visible{outline:2px solid var(--primary-color);outline-offset:-3px}@media(prefers-reduced-motion:no-preference){.control,.metric,.tab,.row{transition:background .16s ease}.control:hover,.metric:hover,.row:hover{background:color-mix(in srgb,var(--primary-color) 8%,transparent)}}
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
    this.activeTab = 'overview';
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
    this.ids = vehicleEntities(this.config);
    this.activeTab = 'overview';
    this.ui = undefined;
    this.render();
  }

  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (!this.config) return;
    const languageChanged = !previous || previous.language !== hass.language || previous.locale?.language !== hass.locale?.language;
    const stateChanged = !previous || Object.values(this.ids).some(id => previous.states?.[id] !== hass.states?.[id]);
    if (!languageChanged && !stateChanged) return;
    if (languageChanged || !this.ui) this.render();
    else this.update();
  }

  get hass() { return this._hass; }
  connectedCallback() { this.render(); }
  getCardSize() { return 5; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  static getConfigElement() { return document.createElement('ninebot-vehicle-card-editor'); }
  static getStubConfig(hass) { return { type: 'custom:ninebot-vehicle-card', ...stubConfig(hass.states) }; }

  labels() { return labelsFor(this._hass?.language ?? 'en'); }
  state(key) { return this._hass?.states?.[this.ids?.[key]]; }

  value(key, digits = 1) {
    const state = this.state(key);
    if (!stateAvailable(state)) return '—';
    const formatted = formatState(state, this._hass?.language, digits);
    return formatted === '—' ? String(state.state) : formatted;
  }

  openMoreInfo(key) {
    const entityId = this.ids[key];
    if (!this._hass?.states?.[entityId]) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  navigate(path) {
    globalThis.history?.pushState?.(null, '', path);
    globalThis.dispatchEvent?.(new CustomEvent('location-changed', { bubbles: true, composed: true, detail: { replace: false } }));
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
    this.busy = true; this.actionError = false; this.refresh();
    try {
      await this._hass.callService(domain, service, { entity_id: this.ids[key] });
    } catch {
      this.actionError = true;
    } finally {
      this.busy = false; this.refresh();
    }
  }

  refresh() {
    if (this.ui) this.update(); else this.render();
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

  tabList(labels) {
    const tabs = [{ id: 'overview', label: labels.tab_overview }];
    if (this.config.map !== false && this.state('location')) tabs.push({ id: 'map', label: labels.tab_map });
    if (this.config.details !== false) tabs.push({ id: 'details', label: labels.tab_details });
    return tabs;
  }

  selectTab(id) {
    this.activeTab = id;
    this.syncTabs();
  }

  syncTabs() {
    const tabs = this.tabList(this.labels());
    if (!tabs.some(tab => tab.id === this.activeTab)) this.activeTab = 'overview';
    for (const [id, button] of Object.entries(this.ui.tabs ?? {})) {
      const selected = id === this.activeTab;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('active', selected);
    }
    for (const [id, panel] of Object.entries(this.ui.panels ?? {})) panel.hidden = id !== this.activeTab;
    if (this.activeTab === 'map') this.ensureMap();
  }

  ensureMap() {
    const host = this.ui.mapHost;
    if (!host) return;
    const entity = this.ids.location;
    if (this.ui.mapEntity === entity) return;
    this.ui.mapEntity = entity;
    this.ui.map = null;
    host.replaceChildren();
    if (globalThis.customElements?.get('hui-map-card')) {
      const map = document.createElement('hui-map-card');
      map.setConfig({ entities: [{ entity }] });
      map.hass = this._hass;
      host.append(map);
      this.ui.map = map;
    } else {
      host.append(element('p', this.labels().map_placeholder, 'map-note'));
    }
  }

  buildGauge(labels) {
    const wrap = element('div', '', 'gauge-wrap');
    const gauge = element('div', '', 'gauge');
    gauge.setAttribute('role', 'img');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('aria-hidden', 'true');
    let level = null;
    for (const className of ['track', 'level']) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '60'); circle.setAttribute('cy', '60'); circle.setAttribute('r', '52');
      circle.setAttribute('pathLength', '100'); circle.setAttribute('class', className);
      circle.setAttribute('stroke-dasharray', '100');
      if (className === 'level') level = circle;
      svg.append(circle);
    }
    const value = element('div', '', 'gauge-value');
    const number = element('span'), percent = element('small', '%');
    value.append(number, percent);
    gauge.append(svg, value);
    const range = element('div', '', 'range');
    const rangeValue = element('strong');
    range.append(rangeValue, element('span', labels.range));
    wrap.append(gauge, element('div', labels.battery, 'gauge-label'), range);
    this.ui.gauge = { gauge, level, number, percent, range: rangeValue };
    return wrap;
  }

  buildVehicle(labels) {
    const button = element('button', '', 'vehicle'); button.type = 'button';
    button.setAttribute('aria-label', labels.vehicle_image);
    button.addEventListener('click', () => {
      if (this.config.image_navigate) this.navigate(this.config.image_navigate);
      else this.openMoreInfo('image');
    });
    this.ui.vehicle = button;
    this.ui.vehicleSrc = undefined;
    return button;
  }

  buildMetrics(labels) {
    const grid = element('div', '', 'metrics');
    this.ui.metrics = {};
    const rows = [
      ['odometer', labels.odometer, 'counter', 0],
      ['today_distance', labels.today, 'map-marker-distance', 1],
      ['battery_temperature', labels.temperature, 'thermometer', 1],
      ['battery_health', labels.health, 'heart-pulse', 0],
    ];
    for (const [key, label, iconName, digits] of rows) {
      const button = element('button', '', 'metric'); button.type = 'button';
      const value = element('span', '', 'value');
      button.append(icon(iconName), value, element('span', label, 'label'));
      button.addEventListener('click', () => this.openMoreInfo(key));
      grid.append(button);
      this.ui.metrics[key] = { button, value, digits };
    }
    return grid;
  }

  buildPresence() {
    const row = element('div', '', 'presence');
    const location = element('span'), power = element('span');
    row.append(icon('map-marker'), location, power);
    this.ui.presence = { row, location, power };
    return row;
  }

  buildDetails(labels) {
    const list = element('div', '', 'details');
    this.ui.details = {};
    for (const [key, iconName, labelKey, digits] of DETAIL_ROWS) {
      const row = element('button', '', 'row'); row.type = 'button';
      const value = element('span', '', 'row-value');
      row.append(icon(iconName), element('span', labels[labelKey], 'row-label'), value);
      row.addEventListener('click', () => this.openMoreInfo(key));
      list.append(row);
      this.ui.details[key] = { row, value, digits };
    }
    return list;
  }

  buildControls(labels) {
    const row = element('div', '', 'controls');
    this.ui.controls = {};
    const definitions = [
      ['lock', 'lock-outline', null], ['find', null, 'find'], ['seat', null, 'seat'], ['refresh', 'refresh', null],
    ];
    for (const [key, iconName, glyphName] of definitions) {
      const button = element('button', '', 'control'); button.type = 'button';
      const mark = iconName ? icon(iconName) : glyph(glyphName);
      const label = element('span');
      button.append(mark, label);
      button.addEventListener('click', () => void this.runAction(key));
      row.append(button);
      this.ui.controls[key] = { button, label, mark };
    }
    return row;
  }

  render() {
    if (!this.config || !this._hass || !this.shadowRoot) return;
    const labels = this.labels();
    this.ui = {};
    const card = element('ha-card');

    if (this.config.show_background !== false) {
      const backdrop = element('div', '', 'backdrop');
      const picture = document.createElement('img');
      picture.alt = ''; picture.setAttribute('aria-hidden', 'true');
      backdrop.append(picture);
      card.append(backdrop);
      this.ui.backdrop = picture;
    }

    const header = element('header', '', 'header');
    const heading = element('div');
    heading.append(element('p', 'Ninebot', 'eyebrow'), element('h2', this.title()));
    header.append(heading);
    const status = element('span', '', 'status'); status.hidden = true;
    header.append(status);
    this.ui.status = status;
    card.append(header);

    const tabs = this.tabList(labels);
    const showTabs = this.config.tabs !== false && tabs.length > 1;
    if (showTabs) {
      const bar = element('nav', '', 'tabs'); bar.setAttribute('role', 'tablist');
      this.ui.tabs = {};
      for (const tab of tabs) {
        const button = element('button', tab.label, 'tab'); button.type = 'button';
        button.setAttribute('role', 'tab');
        button.addEventListener('click', () => this.selectTab(tab.id));
        bar.append(button);
        this.ui.tabs[tab.id] = button;
      }
      card.append(bar);
    }

    const panels = {};
    const overview = element('div', '', 'panel');
    const hero = element('div', '', 'hero');
    hero.append(this.buildGauge(labels), this.buildVehicle(labels));
    overview.append(hero);
    if (this.config.show_metrics !== false) overview.append(this.buildMetrics(labels));
    if (this.config.show_presence !== false) overview.append(this.buildPresence());
    panels.overview = overview;

    if (showTabs && tabs.some(tab => tab.id === 'map')) {
      const panel = element('div', '', 'panel');
      const host = element('div', '', 'map');
      panel.append(host);
      this.ui.mapHost = host;
      panels.map = panel;
    }
    if (showTabs && tabs.some(tab => tab.id === 'details')) {
      const panel = element('div', '', 'panel');
      panel.append(this.buildDetails(labels));
      panels.details = panel;
    }
    for (const panel of Object.values(panels)) card.append(panel);
    this.ui.panels = panels;

    if (this.config.show_controls !== false) card.append(this.buildControls(labels));
    const error = element('p', labels.action_error, 'error');
    error.setAttribute('role', 'alert'); error.hidden = true;
    card.append(error);
    this.ui.error = error;

    this.shadowRoot.replaceChildren(element('style', CSS), card);
    this.ui.tabIds = tabs.map(tab => tab.id).join();
    this.syncTabs();
    this.update();
  }

  update() {
    if (!this.config || !this._hass) return;
    if (!this.ui) { this.render(); return; }
    const labels = this.labels();
    if (this.ui.tabIds !== this.tabList(labels).map(tab => tab.id).join()) { this.render(); return; }

    const status = this.status(labels), pill = this.ui.status;
    pill.hidden = !status;
    if (status) { pill.textContent = status.text; pill.className = `status ${status.className}`; }

    this.updateGauge();
    this.updateVehicle();
    this.updateMetrics();
    this.updatePresence();
    this.updateDetails();
    this.updateControls();

    const backdrop = this.ui.backdrop;
    if (backdrop) {
      const picture = this.state('image')?.attributes?.entity_picture;
      const src = typeof picture === 'string' && picture.startsWith('/') ? picture : '';
      if (backdrop.getAttribute('src') !== src) {
        if (src) backdrop.setAttribute('src', src); else backdrop.removeAttribute('src');
      }
      backdrop.parentElement.hidden = !src;
    }
    this.ui.error.hidden = !this.actionError;
    if (this.ui.map) this.ui.map.hass = this._hass;
  }

  updateGauge() {
    const ui = this.ui.gauge;
    if (!ui) return;
    const level = batteryLevel(this.state('battery'));
    ui.gauge.className = `gauge ${level === null ? 'unknown' : level < 15 ? 'low' : level < 35 ? 'medium' : 'high'}`;
    ui.gauge.setAttribute('aria-label', `${this.labels().battery}: ${level === null ? '—' : `${Math.round(level)}%`}`);
    ui.level.setAttribute('stroke-dashoffset', String(100 - (level ?? 0)));
    ui.number.textContent = level === null ? '—' : String(Math.round(level));
    ui.percent.hidden = level === null;
    ui.range.textContent = formatState(this.state('range'), this._hass?.language);
  }

  updateVehicle() {
    const button = this.ui.vehicle;
    if (!button) return;
    const state = this.state('image');
    const picture = state?.attributes?.entity_picture;
    const src = typeof picture === 'string' && picture.startsWith('/') ? picture : null;
    if (src !== this.ui.vehicleSrc) {
      this.ui.vehicleSrc = src;
      button.replaceChildren();
      if (src) {
        const image = document.createElement('img');
        image.src = src; image.alt = this.labels().vehicle_image;
        image.addEventListener('error', () => { image.replaceWith(icon('scooter')); }, { once: true });
        button.append(image);
      } else button.append(icon('scooter'));
    }
    button.disabled = !state;
  }

  updateMetrics() {
    for (const [key, entry] of Object.entries(this.ui.metrics ?? {})) {
      entry.value.textContent = this.value(key, entry.digits);
      entry.button.disabled = !stateAvailable(this.state(key));
    }
  }

  updatePresence() {
    const ui = this.ui.presence;
    if (!ui) return;
    const labels = this.labels(), location = this.state('location');
    ui.location.hidden = !location;
    ui.location.textContent = location ?
      (location.state === 'home' ? labels.home : location.state === 'not_home' ? labels.away :
        stateAvailable(location) ? location.state : labels.unavailable) : '';
    const power = this.state('power'), available = stateAvailable(power);
    ui.power.hidden = !available;
    ui.power.textContent = available ? (power.state === 'on' ? labels.power_on : labels.power_off) : '';
  }

  updateDetails() {
    for (const [key, entry] of Object.entries(this.ui.details ?? {})) {
      entry.value.textContent = this.value(key, entry.digits);
      entry.row.disabled = !stateAvailable(this.state(key));
    }
  }

  updateControls() {
    const labels = this.labels(), ui = this.ui.controls;
    if (!ui) return;
    const locked = this.state('lock')?.state === 'locked';
    ui.lock.label.textContent = locked ? labels.unlock : labels.lock;
    ui.lock.mark?.setAttribute('icon', `mdi:${locked ? 'lock-open-outline' : 'lock-outline'}`);
    ui.find.label.textContent = labels.find;
    ui.seat.label.textContent = labels.seat;
    ui.refresh.label.textContent = labels.refresh;
    for (const [key, entry] of Object.entries(ui)) {
      entry.button.disabled = this.busy || !this.controlAvailable(key);
      entry.button.classList.toggle('busy', this.busy);
    }
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
