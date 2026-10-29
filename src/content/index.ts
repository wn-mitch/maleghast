// Every house's cards, registered with the rules, and their reactive rules
// installed. Import this once before starting a game.

import { register } from "../rules/content";
import { ammoGoblin, barrelform, egisWeapon, enforcer, gunwight, installCarcass } from "./carcass";
import { berserker, carnifex, painGhoul, painwheel, warhead } from "./goregrinders";
import { installOperator, operator } from "./operator";
import { installWarlord, warlord } from "./warlord";

export const HOUSES = {
  carcass: { name: "C.A.R.C.A.S.S.", necromancer: operator, units: [gunwight, enforcer, ammoGoblin, barrelform, egisWeapon] },
  goregrinders: { name: "Goregrinders", necromancer: warlord, units: [warhead, carnifex, painGhoul, painwheel, berserker] },
} as const;

let installed = false;

export function installContent(): void {
  if (installed) return;
  installed = true;
  for (const h of Object.values(HOUSES)) register(h.necromancer, ...h.units);
  installCarcass();
  installOperator();
  installWarlord();
}
