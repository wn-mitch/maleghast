// One player against the computer in a headless browser: the computer's
// side must keep acting by itself until the battle ends. Expects the built
// client served at BASE (wrangler dev, or any static server of dist/).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { progress, step } from "./bot.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = process.env.OUT ?? "e2e/out";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(BASE);
await page.fill('input[placeholder="Name"]', "Ann");
await page.click("text=Play the computer");
await page.waitForSelector(".muster");
await page.click(".house-goregrinders");
for (const u of ["Warhead", "Warhead", "Carnifex", "Pain Ghoul"]) await page.click(`.tile:has-text("${u}")`);
await page.click(".ready");
await page.waitForSelector("canvas");

let mine = 0, theirs = 0;
for (let i = 0; i < 600; i++) {
  const s = await page.evaluate(() => window.maleghast.state());
  const g = s.game;
  if (g.phase === "over") break;
  const before = await page.evaluate(progress);
  const side = g.pending ? g.pending.request.side : g.side;
  if (side === s.you) {
    try {
      await step(page);
    } catch (e) {
      await page.screenshot({ path: `${OUT}/solo-stuck.png` });
      errors.push(`player step ${i}: ${e.message.split("\n").slice(0, 3).join(" | ")} ${JSON.stringify({ side: g.side, active: g.active, pending: g.pending?.request, phase: g.phase })}`);
      break;
    }
    mine++;
  } else theirs++;
  // The computer's moves arrive on their own; wait for any change.
  await page.waitForFunction((b) => {
    const g = window.maleghast.state().game;
    return JSON.stringify([g.log.length, g.phase, g.side, g.active, g.pending?.request]) !== b;
  }, before, { timeout: 15000 }).catch(() => errors.push(`stuck after ${i} steps (${side === s.you ? "player" : "computer"} to act)`));
  if (errors.length) break;
  if (i === 30) await page.screenshot({ path: `${OUT}/solo-mid.png` });
}
const g = (await page.evaluate(() => window.maleghast.state())).game;
await page.screenshot({ path: `${OUT}/solo-end.png` });
console.log(JSON.stringify({ phase: g.phase, round: g.round, winner: g.winner, playerSteps: mine, computerWaits: theirs, fallen: g.fallen.map((u) => u.id), errors }, null, 1));
await browser.close();
process.exit(errors.length || g.phase !== "over" ? 1 : 0);
