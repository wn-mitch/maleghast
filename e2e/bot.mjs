// A scripted player for the browser tests: it takes one action through the
// page's own buttons and its test handle, choosing simply but legally.

const clickFirstOption = (p, last = false) => p.evaluate((last) => {
  const opts = window.maleghast.options();
  const c = (last ? opts.at(-1) : opts[0])[0];
  window.maleghast.pick({ kind: "cell", cell: c });
}, last);

/** Take one action as the player on `page`, who must be the one to act. */
export async function step(page) {
  const s = await page.evaluate(() => window.maleghast.state());
  const g = s.game;
  if (g.pending) {
    if (g.pending.request.kind === "yesno") await page.click(".request button >> text=No");
    else await clickFirstOption(page);
  } else if (g.phase === "deploy") {
    await page.click(".reserve button >> nth=0");
    await clickFirstOption(page);
  } else if (!g.active.length) {
    // Picking a unit readies it; its first MOVE (or ending its turn) starts its turn.
    const u = g.units.find((v) => v.side === s.you && !v.done);
    await page.evaluate((id) => window.maleghast.pick({ kind: "unit", id }), u.id);
    if (await page.evaluate(() => window.maleghast.options().length)) await clickFirstOption(page, true);
    else await page.click("button.primary >> text=End turn");
  } else {
    // A targeted ACT if one is offered, else one MOVE, else end the turn.
    const a = g.active[0];
    const act = page.locator(".ability-btn:not([disabled])").first();
    if (!a.acted && (await act.count())) {
      const before = await page.evaluate(progress);
      await act.click();
      // A self-targeted ability fires at once and may ask a question; give the state a moment to arrive.
      await page.waitForTimeout(150);
      if ((await page.evaluate(progress)) !== before) return;
      if (await page.evaluate(() => window.maleghast.options().length)) {
        // Aim (a self ability is already aimed, so this click fires it), then fire.
        await clickFirstOption(page);
        await page.waitForTimeout(150);
        if ((await page.evaluate(progress)) !== before) return;
        const fire = page.locator("button.fire");
        if (await fire.count()) await fire.click();
      } else await page.click("button.primary >> text=End turn");
    } else if (a.moves === 0 && (await page.evaluate(() => window.maleghast.options().length))) {
      await clickFirstOption(page, true);
    } else {
      await page.click("button.primary >> text=End turn");
    }
  }
}

/** A fingerprint of the battle that changes whenever anyone acts. */
export const progress = () => {
  const g = window.maleghast.state()?.game;
  return g ? JSON.stringify([g.log.length, g.phase, g.side, g.active, g.pending?.request]) : "";
};
