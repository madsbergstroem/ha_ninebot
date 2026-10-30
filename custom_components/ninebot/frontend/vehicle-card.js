/** Entity discovery and display helpers for the bundled vehicle status card. */

export const ENTITY_SLOTS = Object.freeze({
  image: { domain: 'image', suffix: 'vehicle_image' },
  range: { domain: 'sensor', suffix: 'endurance' },
  odometer: { domain: 'sensor', suffix: 'odometer' },
  battery_temperature: { domain: 'sensor', suffix: 'batt_temp' },
  battery_health: { domain: 'sensor', suffix: 'health_score' },
  today_distance: { domain: 'sensor', suffix: 'today_mileage' },
  location: { domain: 'device_tracker', suffix: 'location' },
  lock: { domain: 'lock', suffix: 'vehicle_lock' },
  charging: { domain: 'binary_sensor', suffix: 'charging' },
  power: { domain: 'binary_sensor', suffix: 'power' },
  find: { domain: 'button', suffix: 'bell' },
  seat: { domain: 'button', suffix: 'bucket' },
  refresh: { domain: 'button', suffix: 'refresh' },
});

export const VEHICLE_LABELS = {
  en: {
    battery: 'Battery', range: 'Range', odometer: 'Odometer', today: 'Today',
    temperature: 'Battery temp.', health: 'Health score', locked: 'Locked',
    unlocked: 'Unlocked', charging: 'Charging', power_on: 'Power on', power_off: 'Power off',
    home: 'Home', away: 'Away', unavailable: 'Unavailable', unlock: 'Unlock', lock: 'Lock',
    find: 'Find', seat: 'Seat', refresh: 'Refresh', confirm_unlock: 'Unlock the vehicle remotely?',
    confirm_seat: 'Open the seat compartment remotely?', action_error: 'The action could not be completed. Try again.',
    vehicle_image: 'Vehicle image', editor_vehicle: 'Main battery entity', editor_name: 'Card title (optional)',
    editor_controls: 'Show vehicle controls', editor_note: 'Related Ninebot entities are discovered from the shared entity-ID prefix. Advanced overrides remain YAML-editable.',
  },
  de: {
    battery: 'Akku', range: 'Reichweite', odometer: 'Kilometerstand', today: 'Heute',
    temperature: 'Akku-Temperatur', health: 'Health-Score', locked: 'Verriegelt',
    unlocked: 'Entriegelt', charging: 'Lädt', power_on: 'Eingeschaltet', power_off: 'Ausgeschaltet',
    home: 'Zuhause', away: 'Unterwegs', unavailable: 'Nicht verfügbar', unlock: 'Entriegeln', lock: 'Verriegeln',
    find: 'Finden', seat: 'Sitzfach', refresh: 'Aktualisieren', confirm_unlock: 'Fahrzeug aus der Ferne entriegeln?',
    confirm_seat: 'Sitzfach aus der Ferne öffnen?', action_error: 'Die Aktion konnte nicht ausgeführt werden. Bitte erneut versuchen.',
    vehicle_image: 'Fahrzeugbild', editor_vehicle: 'Hauptbatterie-Entity', editor_name: 'Kartentitel (optional)',
    editor_controls: 'Fahrzeugsteuerung anzeigen', editor_note: 'Die zugehörigen Ninebot-Entities werden über den gemeinsamen Entity-ID-Präfix gefunden. Erweiterte Overrides bleiben in YAML möglich.',
  },
  'zh-Hans': {
    battery: '电量', range: '续航', odometer: '总里程', today: '今日',
    temperature: '电池温度', health: '健康评分', locked: '已上锁',
    unlocked: '已解锁', charging: '充电中', power_on: '已上电', power_off: '已断电',
    home: '在家', away: '外出', unavailable: '不可用', unlock: '解锁', lock: '上锁',
    find: '寻车', seat: '座桶', refresh: '刷新', confirm_unlock: '确定远程解锁车辆吗？',
    confirm_seat: '确定远程打开座桶吗？', action_error: '操作未完成，请重试。',
    vehicle_image: '车辆图片', editor_vehicle: '主电池实体', editor_name: '卡片标题（可选）',
    editor_controls: '显示车辆控制', editor_note: '通过实体 ID 的共同前缀发现相关九号实体。高级覆盖仍可在 YAML 中编辑。',
  },
};

export function labelsFor(language = 'en') {
  return VEHICLE_LABELS[language] ?? (language.startsWith('zh') ? VEHICLE_LABELS['zh-Hans'] : VEHICLE_LABELS[language.split('-')[0]]) ?? VEHICLE_LABELS.en;
}

export function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid card configuration');
  if (typeof config.entity !== 'string' || !/^sensor\..+_battery$/.test(config.entity)) {
    throw new Error('Select the main battery sensor ending in _battery');
  }
  if (config.name !== undefined && typeof config.name !== 'string') throw new Error('Card title must be text');
  if (config.show_controls !== undefined && typeof config.show_controls !== 'boolean') throw new Error('show_controls must be boolean');
  if (config.entities !== undefined && (!config.entities || typeof config.entities !== 'object' || Array.isArray(config.entities))) {
    throw new Error('entities must be a mapping');
  }
  const entities = {};
  for (const [key, value] of Object.entries(config.entities ?? {})) {
    const slot = ENTITY_SLOTS[key];
    if (!slot) throw new Error(`Unknown entity override: ${key}`);
    if (typeof value !== 'string' || !value.startsWith(`${slot.domain}.`)) throw new Error(`Invalid ${key} entity`);
    entities[key] = value;
  }
  return { ...config, entities };
}

export function vehicleEntities(config) {
  const normalized = normalizeConfig(config);
  const objectPrefix = normalized.entity.slice('sensor.'.length, -'battery'.length);
  const result = { battery: normalized.entity };
  for (const [key, slot] of Object.entries(ENTITY_SLOTS)) {
    result[key] = normalized.entities[key] ?? `${slot.domain}.${objectPrefix}${slot.suffix}`;
  }
  return result;
}

export function stateAvailable(state) {
  return Boolean(state && !['unknown', 'unavailable', 'none'].includes(String(state.state).toLowerCase()));
}

export function numericState(state) {
  if (!stateAvailable(state)) return null;
  const value = Number(state.state);
  return Number.isFinite(value) ? value : null;
}

export function batteryLevel(state) {
  const value = numericState(state);
  return value === null ? null : Math.max(0, Math.min(100, value));
}

export function formatState(state, language = 'en', maximumFractionDigits = 1) {
  const value = numericState(state);
  if (value === null) return '—';
  const formatted = new Intl.NumberFormat(language, { maximumFractionDigits }).format(value);
  const unit = state.attributes?.unit_of_measurement;
  return unit ? `${formatted} ${unit}` : formatted;
}

export function batteryCandidates(states = {}) {
  return Object.entries(states).filter(([id, state]) =>
    /^sensor\..+_battery$/.test(id) && id.includes('ninebot') && state.attributes?.device_class === 'battery');
}

export function stubConfig(states = {}) {
  const candidates = batteryCandidates(states);
  return { entity: candidates.length === 1 ? candidates[0][0] : 'sensor.REPLACE_WITH_MAIN_BATTERY_battery' };
}
