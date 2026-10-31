/** Isolated synthetic vehicle-card render and interaction smoke test. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(join(process.env.BROWSER_TEST_DEPS, 'node_modules/playwright'));
const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = resolve(root, 'custom_components/ninebot/frontend');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let path;
    if (url.pathname === '/') path = resolve(root, 'tests/frontend/vehicle-card-fixture.html');
    else if (url.pathname === '/synthetic-scooter.svg') path = resolve(root, 'tests/frontend/synthetic-scooter.svg');
    else if (url.pathname.startsWith('/ninebot-static/')) {
      path = resolve(assets, url.pathname.slice('/ninebot-static/'.length));
      if (!path.startsWith(assets + sep)) throw new Error('Not an asset');
    } else throw new Error('Not a fixture');
    const bytes = await readFile(path);
    const type = path.endsWith('.js') ? 'application/javascript' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    response.writeHead(200, { 'Content-Type': type }); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, colorScheme: 'dark' });
  const errors = [], external = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Synthetic vehicle card error:', error.stack); });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(origin);
  await page.getByRole('img', { name: 'Akku: 79%', exact: true }).waitFor();
  await page.getByText('Segway E125S', { exact: true }).waitFor();
  assert.equal((await page.locator('ninebot-vehicle-card .range strong').textContent()).trim(), '52,4 km');
  assert.equal((await page.locator('ninebot-vehicle-card .metric .value').first().textContent()).trim(), '1.361');
  await page.getByText('Zuhause', { exact: true }).waitFor();
  assert.equal(await page.locator('ninebot-vehicle-card .vehicle img').getAttribute('src'), '/synthetic-scooter.svg');
  assert.equal(await page.locator('ninebot-vehicle-card .backdrop img').getAttribute('src'), '/synthetic-scooter.svg');
  assert.equal(await page.evaluate(() => fixtureServiceCalls.length), 0);

  const output = process.env.BROWSER_TEST_OUTPUT;
  if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'vehicle-card-dark.png'), fullPage: true }); }
  await page.getByRole('tab', { name: 'Karte', exact: true }).click();
  await page.getByText('Karte · device_tracker.synthetic_ninebot_e125s_location', { exact: true }).waitFor();
  if (output) await page.screenshot({ path: join(output, 'vehicle-card-map.png'), fullPage: true });
  assert.equal(await page.locator('ninebot-vehicle-card .metrics').isVisible(), false, 'the map tab replaces the overview');
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.getByText('BMS-Spannung', { exact: true }).waitFor();
  await page.getByText('50,8 V', { exact: true }).waitFor();
  await page.getByText('Ladezyklen', { exact: true }).waitFor();
  if (output) await page.screenshot({ path: join(output, 'vehicle-card-details.png'), fullPage: true });
  assert.equal(await page.locator('ninebot-vehicle-card .hero').isVisible(), false);
  await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  await page.getByRole('img', { name: 'Akku: 79%', exact: true }).waitFor();

  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(250);
  if (output) await page.screenshot({ path: join(output, 'vehicle-card-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });

  await page.evaluate(() => {
    window.fixtureRenders = 0;
    window.fixtureUpdates = 0;
    const originalRender = fixtureCard.render.bind(fixtureCard);
    const originalUpdate = fixtureCard.update.bind(fixtureCard);
    fixtureCard.render = () => { fixtureRenders += 1; originalRender(); };
    fixtureCard.update = () => { fixtureUpdates += 1; originalUpdate(); };
    for (let index = 0; index < 25; index += 1) fixtureCard.hass = { ...fixtureHass };
  });
  assert.equal(await page.evaluate(() => fixtureRenders), 0, 'unrelated HA updates do not rebuild the card');
  assert.equal(await page.evaluate(() => fixtureUpdates), 0, 'unrelated HA updates do not redraw the card');
  await page.evaluate(() => {
    const id = 'sensor.synthetic_ninebot_e125s_battery';
    fixtureHass.states = { ...fixtureHass.states, [id]: { ...fixtureHass.states[id], state: '78' } };
    fixtureCard.hass = { ...fixtureHass };
  });
  await page.getByRole('img', { name: 'Akku: 78%', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fixtureRenders), 0, 'a state change only refreshes values');
  assert.equal(await page.evaluate(() => fixtureUpdates), 1);
  assert.equal(await page.evaluate(() => fixtureServiceCalls.length), 0);
  assert.equal(await page.evaluate(() => fixtureCard.ui.map?.dataset.location), 'home',
    'the map keeps its instance and still receives hass');

  await page.getByRole('button', { name: 'Fahrzeugbild', exact: true }).click();
  await page.getByRole('button', { name: /1\.361 Kilometerstand/ }).click();
  assert.deepEqual(await page.evaluate(() => fixtureMoreInfo), [
    'image.synthetic_ninebot_e125s_vehicle_image', 'sensor.synthetic_ninebot_e125s_odometer',
  ]);

  await page.getByRole('button', { name: 'Entriegeln', exact: true }).click();
  await page.waitForFunction(() => fixtureServiceCalls.some(call => call.domain === 'lock' && call.service === 'unlock'));
  assert.equal(await page.evaluate(() => fixtureConfirmations[0]), 'Fahrzeug aus der Ferne entriegeln?');
  await page.getByRole('button', { name: 'Verriegeln', exact: true }).click();
  await page.waitForFunction(() => fixtureServiceCalls.filter(call => call.domain === 'lock').length === 2);
  await page.getByRole('button', { name: 'Finden', exact: true }).click();
  await page.getByRole('button', { name: 'Sitzfach', exact: true }).click();
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await page.waitForFunction(() => fixtureServiceCalls.length === 5);
  assert.equal(await page.locator('ninebot-vehicle-card .control').nth(2).locator('ha-icon').count(), 0,
    'the seat control uses the drawn glyph instead of an icon font');
  assert.equal(await page.locator('ninebot-vehicle-card .control').nth(1).locator('svg.glyph').count(), 1,
    'find uses the drawn pin glyph');
  assert.equal(await page.locator('ninebot-vehicle-card .control').nth(2).locator('svg.glyph').count(), 1,
    'the seat control uses the drawn bench glyph');
  assert.equal(await page.locator('ninebot-vehicle-card .control').nth(0).locator('ha-icon').count(), 1);
  assert.deepEqual(await page.evaluate(() => fixtureServiceCalls.slice(2).map(call => [call.domain, call.service, call.data.entity_id])), [
    ['button', 'press', 'button.synthetic_ninebot_e125s_bell'],
    ['button', 'press', 'button.synthetic_ninebot_e125s_bucket'],
    ['button', 'press', 'button.synthetic_ninebot_e125s_refresh'],
  ]);
  const rejectedBefore = await page.evaluate(() => fixtureServiceCalls.length);
  await page.evaluate(() => { fixtureConfirm = false; });
  await page.getByRole('button', { name: 'Sitzfach', exact: true }).click();
  assert.equal(await page.evaluate(() => fixtureServiceCalls.length), rejectedBefore, 'cancelled seat confirmation sends nothing');
  await page.evaluate(() => { fixtureConfirm = true; fixtureFail = true; });
  await page.getByRole('button', { name: 'Finden', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.evaluate(() => { fixtureFail = false; });
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await page.waitForFunction(() => !fixtureCard.actionError && !fixtureCard.busy);

  await page.evaluate(() => {
    const id = 'sensor.synthetic_ninebot_e125s_battery';
    fixtureHass.states = { ...fixtureHass.states, [id]: { ...fixtureHass.states[id], state: 'unknown' } };
    fixtureCard.hass = { ...fixtureHass };
  });
  await page.getByRole('img', { name: 'Akku: —', exact: true }).waitFor();
  assert.equal((await page.locator('ninebot-vehicle-card').textContent()).includes('NaN'), false);
  await page.evaluate(() => {
    const id = 'sensor.synthetic_ninebot_e125s_battery';
    fixtureHass.states = { ...fixtureHass.states, [id]: { ...fixtureHass.states[id], state: '79' } };
    fixtureCard.hass = { ...fixtureHass };
  });

  await page.evaluate(async () => {
    const { NinebotVehicleCard } = await import('/ninebot-static/ninebot-vehicle-card.js');
    window.fixtureEditor = NinebotVehicleCard.getConfigElement(); fixtureEditor.hass = fixtureHass;
    fixtureEditor.setConfig(fixtureConfig);
    fixtureEditor.addEventListener('config-changed', event => { window.editedConfig = event.detail.config; });
    document.querySelector('main').append(fixtureEditor);
  });
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Kartentitel (optional)', { exact: true }).fill('Synthetic E125S');
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Kartentitel (optional)', { exact: true }).press('Tab');
  await page.waitForFunction(() => editedConfig?.name === 'Synthetic E125S');
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Fahrzeugsteuerung anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.show_controls === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Kennzahlen anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.show_metrics === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Standort und Status anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.show_presence === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Tabs anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.tabs === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Karten-Tab anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.map === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Details-Tab anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.details === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Fahrzeug-Hintergrund anzeigen', { exact: true }).uncheck();
  await page.waitForFunction(() => editedConfig?.show_background === false);
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Fahrzeugbild öffnet diesen Dashboard-Pfad (optional)', { exact: true })
    .fill('/lovelace/synthetic-details');
  await page.locator('ninebot-vehicle-card-editor').getByLabel('Fahrzeugbild öffnet diesen Dashboard-Pfad (optional)', { exact: true }).press('Tab');
  await page.waitForFunction(() => editedConfig?.image_navigate === '/lovelace/synthetic-details');
  await page.evaluate(() => fixtureEditor.remove());

  await page.evaluate(async () => {
    const card = document.createElement('ninebot-vehicle-card');
    card.id = 'plain';
    card.setConfig({
      type: 'custom:ninebot-vehicle-card', entity: 'sensor.synthetic_ninebot_e125s_battery',
      tabs: false, show_background: false, show_metrics: false,
    });
    card.hass = fixtureHass;
    document.querySelector('main').append(card);
  });
  const plain = page.locator('#plain');
  await plain.getByRole('img', { name: 'Akku: 79%', exact: true }).waitFor();
  assert.equal(await plain.locator('.tabs').count(), 0, 'tabs: false keeps a single panel');
  assert.equal(await plain.locator('.map, .details').count(), 0);
  assert.equal(await plain.locator('.backdrop').count(), 0, 'show_background: false drops the image');
  assert.equal(await plain.locator('.metrics').count(), 0);
  assert.equal(await plain.locator('.controls').count(), 1);
  await page.evaluate(() => document.querySelector('#plain').remove());

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (output) await page.screenshot({ path: join(output, 'vehicle-card-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 280, height: 760 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.getByRole('button', { name: 'Aktualisieren', exact: true }).isVisible(), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Synthetic vehicle card passed: dark/light/mobile render, backdrop, tabs, map reuse, details, entity discovery, efficient updates, confirmations, editor and action failures.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
