// The Black Mass the computer fields for each house: five full slots.

import type { SideSetup } from "../rules/setup";

export const AI_LISTS: Record<string, SideSetup> = {
  carcass: { necromancer: "operator", picks: ["gunKata", "devilBullet", "overwatch"], units: ["gunwight", "gunwight", "enforcer", "ammoGoblin", "barrelform", "egisWeapon"] },
  goregrinders: { necromancer: "warlord", picks: ["bloodRush", "pilebunker", "hellriderKick"], units: ["warhead", "warhead", "carnifex", "painGhoul", "painwheel", "berserker"] },
};
