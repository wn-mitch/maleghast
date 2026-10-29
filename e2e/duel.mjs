// Two players in headless browsers join a room, build lists, deploy, and
// play turns through the real client and Worker. Expects `wrangler dev` on
// BASE (default http://127.0.0.1:8787) serving a fresh `vite build`.
// Screenshots land in OUT (default e2e/out).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = process.env.OUT ?? "e2e/out";
mkdirSync(OUT, { recursive: true });
const room = "E2E" + Math.floor(Math.random() * 1e5);
const browser = await chromium.launch();
const errors = [];

async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${BASE}/#${room}`);
  await page.fill('input[placeholder="Your name"]', name);
  await page.click("text=Join");
  await page.waitForSelector("text=Room " + room);
  return page;
}

const state = (p) => p.evaluate(() => window.maleghast.state());
const toastText = (p) => p.evaluate(() => document.getElementById("toast")?.classList.contains("show") ? document.getElementById("toast").textContent : null);

async function build(p, seat, house, units) {
  await p.click(`.seat.side${seat} >> text=Sit here`);
  await p.waitForSelector(".builder");
  await p.selectOption(".builder select >> nth=0", house);
  for (const u of units) await p.click(`.unit-row:has-text("${u}") >> text=+`);
  await p.click(".builder button.primary");
}

const ann = await player("Ann"), bo = await player("Bo");
await build(ann, 0, "carcass", ["Gunwight", "Gunwight", "Enforcer"]);
await build(bo, 1, "goregrinders", ["Warhead", "Carnifex"]);
await ann.waitForSelector("canvas");
await bo.waitForSelector("canvas");
const pages = [ann, bo];

/** The page whose player must act now, or null when no one can. */
async function actor() {
  const g = (await state(ann)).game;
  if (g.phase === "over") return null;
  const side = g.pending ? g.pending.request.side : g.side;
  return pages[side];
}

let steps = 0;
for (; steps < 400; steps++) {
  const p = await actor();
  if (!p) break;
  const s = await state(p);
  const g = s.game;
  const before = JSON.stringify([g.log.length, g.phase, g.side, g.active, g.pending?.request]);
  if (g.pending) {
    const r = g.pending.request;
    if (r.kind === "yesno") await p.click(".request button >> text=No");
    else await p.evaluate(() => { const c = window.maleghast.options()[0][0]; window.maleghast.pick({ kind: "cell", cell: c }); });
  } else if (g.phase === "deploy") {
    await p.click(".reserve button >> nth=0");
    await p.evaluate(() => { const c = window.maleghast.options()[0][0]; window.maleghast.pick({ kind: "cell", cell: c }); });
  } else if (!g.active.length) {
    const u = g.units.find((v) => v.side === s.you && !v.done);
    await p.evaluate((id) => window.maleghast.pick({ kind: "unit", id }), u.id);
    await p.click(".actions button >> text=Activate");
  } else {
    // Use a targeted ACT if one is offered, else MOVE once, else end the turn.
    const act = p.locator(".ability-btn:not([disabled])").first();
    const a = g.active.find(() => true);
    if (!a.acted && (await act.count())) {
      await act.click();
      const opts = await p.evaluate(() => window.maleghast.options());
      if (opts.length) await p.evaluate(() => { const c = window.maleghast.options()[0][0]; window.maleghast.pick({ kind: "cell", cell: c }); });
      else await p.click("button.primary >> text=End turn");
    } else if (a.moves === 0 && (await p.evaluate(() => window.maleghast.options().length))) {
      await p.evaluate(() => { const c = window.maleghast.options().at(-1)[0]; window.maleghast.pick({ kind: "cell", cell: c }); });
    } else {
      await p.click("button.primary >> text=End turn");
    }
  }
  await p.waitForFunction((b) => {
    const g = window.maleghast.state().game;
    return !g || JSON.stringify([g.log.length, g.phase, g.side, g.active, g.pending?.request]) !== b;
  }, before, { timeout: 5000 }).catch(async () => errors.push(`stuck at step ${steps}: ${await toastText(p)}`));
  if (errors.length) break;
  if (steps === 12) for (const [i, q] of pages.entries()) await q.screenshot({ path: `${OUT}/deployed-${i}.png` });
}

const g = (await state(ann)).game;
for (const [i, q] of pages.entries()) await q.screenshot({ path: `${OUT}/end-${i}.png` });
console.log(JSON.stringify({ steps, phase: g.phase, round: g.round, winner: g.winner, units: g.units.length, fallen: g.fallen.length, log: g.log.length, errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
