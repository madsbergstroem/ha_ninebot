import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENTITY_SLOTS, VEHICLE_LABELS, batteryCandidates, batteryLevel, formatState, labelsFor,
  normalizeConfig, stateAvailable, stubConfig, vehicleEntities,
} from '../../custom_components/ninebot/frontend/vehicle-card.js';

const entity = 'sensor.synthetic_ninebot_e125s_main_battery';
const config = { type: 'custom:ninebot-vehicle-card', entity };

test('vehicle entities share only the explicit synthetic anchor prefix', () => {
  const ids = vehicleEntities(config);
  assert.equal(ids.battery, entity);
  assert.equal(ids.image, 'image.synthetic_ninebot_e125s_main_vehicle_image');
  assert.equal(ids.range, 'sensor.synthetic_ninebot_e125s_main_endurance');
  assert.equal(ids.lock, 'lock.synthetic_ninebot_e125s_main_vehicle_lock');
  assert.equal(ids.find, 'button.synthetic_ninebot_e125s_main_bell');
  assert.equal(Object.keys(ids).length, Object.keys(ENTITY_SLOTS).length + 1);
});

test('entity overrides stay domain checked and preserve unrelated card options', () => {
  const normalized = normalizeConfig({ ...config, name: 'Synthetic scooter', show_controls: false,
    entities: { range: 'sensor.custom_range', lock: 'lock.custom_vehicle' } });
  const ids = vehicleEntities(normalized);
  assert.equal(ids.range, 'sensor.custom_range');
  assert.equal(ids.lock, 'lock.custom_vehicle');
  assert.equal(normalized.show_controls, false);
  assert.throws(() => normalizeConfig({ ...config, entities: { range: 'lock.wrong_domain' } }));
  assert.throws(() => normalizeConfig({ ...config, entities: { nonsense: 'sensor.value' } }));
});

test('invalid anchors and option types never select a vehicle implicitly', () => {
  for (const candidate of [{}, { entity: 'sensor.other' }, { entity: 'lock.synthetic_battery' },
    { ...config, show_controls: 'yes' }, { ...config, name: 4 }, { ...config, entities: [] }]) {
    assert.throws(() => normalizeConfig(candidate));
  }
});

test('unknown values and numeric bounds remain honest', () => {
  for (const state of [undefined, { state: 'unknown' }, { state: 'unavailable' }, { state: 'none' }]) {
    assert.equal(stateAvailable(state), false);
    assert.equal(batteryLevel(state), null);
    assert.equal(formatState(state), '—');
  }
  assert.equal(batteryLevel({ state: '120' }), 100);
  assert.equal(batteryLevel({ state: '-2' }), 0);
  assert.equal(batteryLevel({ state: 'not-a-number' }), null);
  assert.equal(formatState({ state: '52.4', attributes: { unit_of_measurement: 'km' } }, 'de'), '52,4 km');
  assert.equal(formatState({ state: '1361', attributes: {} }, 'en', 0), '1,361');
});

test('stub only auto-selects one unambiguous Ninebot battery', () => {
  const state = { state: '79', attributes: { device_class: 'battery' } };
  assert.equal(stubConfig({ [entity]: state }).entity, entity);
  assert.equal(stubConfig({ [entity]: state, 'sensor.second_ninebot_battery': state }).entity,
    'sensor.REPLACE_WITH_MAIN_BATTERY_battery');
  assert.equal(batteryCandidates({ 'sensor.other_battery': state, [entity]: state }).length, 1);
});

test('card locales have matching keys and regional fallbacks', () => {
  for (const labels of Object.values(VEHICLE_LABELS)) {
    assert.deepEqual(Object.keys(labels).sort(), Object.keys(VEHICLE_LABELS.en).sort());
    assert.ok(Object.values(labels).every(value => typeof value === 'string' && value));
  }
  assert.equal(labelsFor('de-DE').battery, 'Akku');
  assert.equal(labelsFor('zh-Hant').battery, '电量');
  assert.equal(labelsFor('fr').battery, 'Battery');
});
