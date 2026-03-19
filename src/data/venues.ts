import type { Venue } from '../types'

// ── Registered venue list ──────────────────────────────────────────────────
//
// Venues are the INTERNAL layer of the activity model.
// Each venue belongs to exactly one nightlife area (areaId → AnchorZone.id).
//
// Privacy rule: venue identity and coordinates are NEVER sent to the UI.
// The map only shows the parent area cluster — never individual venue positions.
//
// GPS matching rule: on join, the user's browser position is matched against
// venue coords (not zone centre coords) so the nearest registered venue is
// detected, then that venue's areaId determines which area cluster is updated.
//
// Aggregation rule: area cluster.count = Σ(venue.count) for all venues in area.

export const VENUES: Venue[] = [

  // ── Bùi Viện Walking Street ──────────────────────────────────────────────
  { id: 'crazy-buffalo',    name: 'Crazy Buffalo',          areaId: 'bui-vien',    coords: [106.6922, 10.7679] },
  { id: 'boheme',           name: 'Bohème',                 areaId: 'bui-vien',    coords: [106.6931, 10.7673] },
  { id: 'hair-of-dog',      name: 'Hair of the Dog',        areaId: 'bui-vien',    coords: [106.6935, 10.7668] },
  { id: 'go-bar',           name: 'Go! Bar',                areaId: 'bui-vien',    coords: [106.6920, 10.7684] },

  // ── Bến Thành Market ─────────────────────────────────────────────────────
  { id: 'ben-thanh-night',  name: 'Bến Thành Night Market', areaId: 'ben-thanh',   coords: [106.6983, 10.7722] },
  { id: 'hard-rock-sgn',    name: 'Hard Rock Cafe Saigon',  areaId: 'ben-thanh',   coords: [106.6990, 10.7715] },
  { id: 'pho-2000',         name: 'Phở 2000',               areaId: 'ben-thanh',   coords: [106.6975, 10.7730] },

  // ── Thảo Điền ────────────────────────────────────────────────────────────
  { id: 'the-deck',         name: 'The Deck',               areaId: 'thao-dien',   coords: [106.7348, 10.8022] },
  { id: 'broma-bar',        name: 'Broma Not A Bar',        areaId: 'thao-dien',   coords: [106.7335, 10.8033] },
  { id: 'waterfront',       name: 'Waterfront',             areaId: 'thao-dien',   coords: [106.7341, 10.8017] },

  // ── Phạm Ngũ Lão ─────────────────────────────────────────────────────────
  { id: 'pasteur-brewing',  name: 'Pasteur Street Brewing', areaId: 'pham-ngu-lao', coords: [106.6944, 10.7710] },
  { id: 'the-shelter',      name: 'The Shelter',            areaId: 'pham-ngu-lao', coords: [106.6936, 10.7702] },
  { id: 'lac-canh',         name: 'Lạc Cảnh BBQ',           areaId: 'pham-ngu-lao', coords: [106.6949, 10.7700] },

  // ── District 3 Café Strip ─────────────────────────────────────────────────
  { id: 'workshop-coffee',  name: 'The Workshop Coffee',    areaId: 'dist3-cafe',  coords: [106.6869, 10.7800] },
  { id: 'l-usine',          name: "L'Usine",                areaId: 'dist3-cafe',  coords: [106.6875, 10.7793] },
  { id: 'cafe-apartment',   name: 'Café Apartment',         areaId: 'dist3-cafe',  coords: [106.6861, 10.7808] },

  // ── Bình Thạnh Riverside ─────────────────────────────────────────────────
  { id: 'saigon-outcast',   name: 'Saigon Outcast',         areaId: 'binh-thanh',  coords: [106.7147, 10.8010] },
  { id: 'observatory',      name: 'The Observatory',        areaId: 'binh-thanh',  coords: [106.7155, 10.8005] },
  { id: 'arkana',           name: 'Arkana',                 areaId: 'binh-thanh',  coords: [106.7140, 10.8017] },

  // ── An Phú / Thảo Điền East ──────────────────────────────────────────────
  { id: 'cargo-bar',        name: 'Cargo Bar',              areaId: 'an-phu',      coords: [106.7453, 10.7981] },
  { id: 'the-foundry',      name: 'The Foundry',            areaId: 'an-phu',      coords: [106.7460, 10.7975] },
  { id: 'lily-bar',         name: "Lily's",                 areaId: 'an-phu',      coords: [106.7447, 10.7988] },

  // ── Nguyễn Huệ Walking Street ────────────────────────────────────────────
  { id: 'caravelle-roof',   name: 'Caravelle Rooftop',      areaId: 'nguyen-hue',  coords: [106.7040, 10.7776] },
  { id: 'rex-rooftop',      name: 'Rex Hotel Rooftop',      areaId: 'nguyen-hue',  coords: [106.7032, 10.7773] },
  { id: 'nguyen-hue-night', name: 'Nguyễn Huệ Night Market', areaId: 'nguyen-hue', coords: [106.7037, 10.7768] },

  // ── Turtle Lake ───────────────────────────────────────────────────────────
  { id: 'ho-con-rua',       name: 'Hồ Con Rùa Café',        areaId: 'turtle-lake', coords: [106.6858, 10.7742] },
  { id: 'the-lab',          name: 'The Lab Coffee',          areaId: 'turtle-lake', coords: [106.6864, 10.7748] },
  { id: 'pasteur-turtle',   name: 'Pasteur Street Brewing Co', areaId: 'turtle-lake', coords: [106.6851, 10.7738] },
]

// Lookup helper
export const getVenuesByArea = (areaId: string): Venue[] =>
  VENUES.filter(v => v.areaId === areaId)
