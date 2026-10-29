// Two players in headless browsers join a room, build lists, deploy, and
// play turns through the real client and Worker. Expects `wrangler dev` on
// BASE (default http://127.0.0.1:8787) serving a fresh `vite build`.
// Screenshots land in OUT (default e2e/out).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { progress, step } from "./bot.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = process.env.OUT ?? "e2e/out";
mkdirSync(OUT, { recursive: true });
const room = "E2E" + Math.floor(Math.random() * 1e5);
const browser = await chromium.launch();
const errors = [];
const warnings = [];

async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("console", (m) => m.type() === "warning" && !m.text().includes("GL Driver") && warnings.push(`${name}: ${m.text()}`));
  await page.goto(`${BASE}/#${room}`);
  await page.fill('input[placeholder="Name"]', name);
  await page.click("button >> text=Join");
  await page.waitForSelector(".muster");
  return page;
}

const state = (p) => p.evaluate(() => window.maleghast.state());
const toastText = (p) => p.evaluate(() => document.getElementById("toast")?.classList.contains("show") ? document.getElementById("toast").textContent : null);

/** Muster a list: pick the house, count units in on their cards, and declare ready. */
async function build(p, house, units) {
  await p.waitForSelector(".muster");
  await p.click(`.house-${house}`);
  for (const u of units) await p.click(`.tile:has-text("${u}")`);
  await p.click(".ready");
}

const ann = await player("Ann"), bo = await player("Bo");
await build(ann, "carcass", ["Gunwight", "Gunwight", "Enforcer"]);
await build(bo, "goregrinders", ["Warhead", "Carnifex"]);
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
  const before = await p.evaluate(progress);
  await step(p);
  await p.waitForFunction((b) => {
    const g = window.maleghast.state().game;
    return !g || JSON.stringify([g.log.length, g.phase, g.side, g.active, g.pending?.request]) !== b;
  }, before, { timeout: 5000 }).catch(async () => {
    await p.screenshot({ path: `${OUT}/duel-stuck.png` });
    const g = (await state(p)).game;
    errors.push(`stuck at step ${steps}: ${await toastText(p)} ${JSON.stringify({ side: g.side, active: g.active, pending: g.pending?.request })}`);
  });
  if (errors.length) break;
  if (steps === 12) for (const [i, q] of pages.entries()) await q.screenshot({ path: `${OUT}/deployed-${i}.png` });
}

const g = (await state(ann)).game;
for (const [i, q] of pages.entries()) await q.screenshot({ path: `${OUT}/end-${i}.png` });
console.log(JSON.stringify({ steps, phase: g.phase, round: g.round, winner: g.winner, units: g.units.length, fallen: g.fallen.length, log: g.log.length, errors, warnings }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
