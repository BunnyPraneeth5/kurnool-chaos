import { btn, h, type MenuPage } from './menu';
import { saveSettings, settings, type Settings } from './settings';
import { stats } from './stats';
import { VEHICLES, VEHICLE_TYPES } from '../vehicles/params';
import { CLIP_NAMES, clipInfo, sourceUrl } from '../audio/clips';

declare const __APP_VERSION__: string;

// Settings, Stats and About pages of the menu (TASKS H.2).

/** A row of choice buttons for one setting. */
function choice<K extends keyof Settings>(label: string, key: K, options: [Settings[K], string][], note = '', after?: () => void): HTMLElement {
  const row = h('div', 'setting');
  row.append(h('span', 'label', label));
  const opts = h('div', 'choices');
  for (const [value, text] of options) {
    const b = btn(text, settings()[key] === value ? 'on' : '', () => {
      saveSettings({ [key]: value } as Partial<Settings>);
      for (const c of opts.children) c.classList.remove('on');
      b.classList.add('on');
      after?.();
    });
    opts.append(b);
  }
  row.append(opts);
  if (note) row.append(h('small', '', note));
  return row;
}

export function settingsPage(qualityNow: 'low' | 'high'): MenuPage {
  return {
    id: 'settings',
    title: 'Settings',
    render: () => {
      const reload = h('p', 'note');
      reload.hidden = true;
      const reloadBtn = btn('Reload now', '', () => location.reload());
      reload.append('Quality changes after a reload (you stay in your room). ', reloadBtn);
      return [
        h('h2', '', 'Settings'),
        choice('Graphics quality', 'quality', [[null, 'Auto'], ['low', 'Low (phones)'], ['high', 'High (laptops)']], `Now: ${qualityNow}. Low has less traffic, shorter view and no lit windows.`, () => (reload.hidden = false)),
        reload,
        choice('Camera distance', 'camera', [['near', 'Near'], ['normal', 'Normal'], ['far', 'Far']]),
        choice('Steering', 'steering', [['low', 'Gentle'], ['normal', 'Normal'], ['high', 'Quick']], 'How fast vehicles and you turn for the same stick or key.'),
        choice('Minimap', 'minimap', [[true, 'Show'], [false, 'Hide']]),
        choice('Sound', 'sound', [[true, 'On'], [false, 'Off']], 'Engine, horns, sirens and beeps. Starts after your first tap or key press.'),
        choice('Volume', 'volume', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]),
        h('p', 'note', 'Settings are saved on this device.'),
      ];
    },
  };
}

function km(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function statsPage(chaosNow: () => { total: number; best: number }): MenuPage {
  return {
    id: 'stats',
    title: 'Stats',
    render: () => {
      const mins = Math.floor((performance.now() - stats.startedAt) / 60000);
      const rows: [string, string][] = [
        ['Playing for', `${mins} min`],
        ['Chaos points', String(chaosNow().total)],
        ['Best chaos round', String(chaosNow().best)],
        ['On foot', km(stats.distance.foot)],
        ...VEHICLE_TYPES.map((t): [string, string] => [`By ${VEHICLES[t].name.toLowerCase()}`, km(stats.distance[t])]),
        ['Top speed', `${Math.round(stats.topSpeed * 3.6)} km/h`],
        ['Hard crashes', String(stats.crashes)],
        ['Vehicles borrowed from traffic', String(stats.borrowed)],
        ['Rides with friends', String(stats.rides)],
        ['Police stars earned', String(stats.stars)],
        ['Cops escaped', String(stats.copsEscaped)],
        ['Times busted', String(stats.busted)],
      ];
      const table = h('table', 'stats');
      for (const [k, v] of rows) {
        const tr = h('tr');
        tr.append(h('th', '', k), h('td', '', v));
        table.append(tr);
      }
      return [h('h2', '', 'Stats (this session)'), table, h('p', 'note', 'These reset when you close the game.')];
    },
  };
}

/** Every recording with what it is used for, its name, author and page. */
function soundList(): HTMLUListElement {
  const list = h('ul', 'sounds');
  for (const name of CLIP_NAMES) {
    const clip = clipInfo(name);
    const link = h('a', '', `freesound.org/s/${clip.source.id}`);
    link.href = sourceUrl(clip);
    link.target = '_blank';
    link.rel = 'noopener';
    const item = h('li', '', `${clip.use}: “${clip.source.title}” by ${clip.source.author}, `);
    item.append(link);
    list.append(item);
  }
  return list;
}

export function aboutPage(): MenuPage {
  return {
    id: 'about',
    title: 'About',
    render: () => {
      const p = (t: string): HTMLParagraphElement => h('p', '', t);
      return [
        h('h2', '', 'About Kurnool Chaos'),
        p(`Version ${__APP_VERSION__}. A browser game for friends, set in a low-poly Kurnool at dusk. Made by Bunny with Claude Code.`),
        p('Multiplayer: each player sends where they are about 5 times a second through Supabase Realtime, and friends are drawn a moment in the past so they move smoothly. Traffic, cops and pedestrians are your own; friends have theirs.'),
        h('h3', '', 'Data and credits'),
        p('Map © OpenStreetMap contributors (ODbL). Buildings: Overture Maps Foundation (ODbL), Google Open Buildings (CC BY 4.0). Water: Dynamic World (CC BY 4.0). Ground heights: Copernicus DEM, produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA.'),
        p('Telugu text: Noto Sans Telugu by the Noto Project Authors, SIL Open Font License 1.1. 3D: three.js (MIT). Realtime: Supabase.'),
        p('Source code: github.com/BunnyPraneeth5/kurnool-chaos'),
        h('h3', '', 'Sounds'),
        p('Recordings from Freesound, all CC0 1.0 (public domain), cut short and made smaller for the game.'),
        soundList(),
      ];
    },
  };
}
