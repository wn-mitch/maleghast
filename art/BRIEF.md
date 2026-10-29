# Maleghast board and terrain kit: art brief

The terrain kit for a browser version of Maleghast, a grimdark skirmish game played on a square grid. The game renders in three.js. Units are flat 2D cutout sprites standing on the board. This kit is everything under them.

## Look

- Match the unit art: black ink outlines, greyscale halftone shading, gritty grimdark-comic texture.
- Keep the board mostly desaturated. The units carry spot colors (orange for one faction, magenta for the other) that must pop against it.
- Use at most one restrained accent of your own, such as dried-blood red, and only on hazards.
- Bake shading, halftone and outlines into the textures. The game draws the board unlit, so scene lighting in Blender won't carry over.

## Readability

- The camera looks down at roughly 55° in perspective, from either player's end of the board, so every piece must read from both the north and the south.
- Unit sprites stand about 1.3 squares tall, so keep pieces low and quiet enough not to hide them.
- A player must tell each terrain type apart at a glance by shape and value, not color alone.
- Square edges must stay visible. The game draws its own grid lines and highlights on top.

## Pieces

Deliver modular pieces, not whole maps. Maps are data (a grid of terrain per square), and the game assembles them from these pieces. Each piece fills one square.

| File | Rule it shows | Notes |
|---|---|---|
| `ground_a`, `ground_b`, `ground_c` | Open ground | 3 variants of flagstone, bone-dust floor or similar, so a board doesn't look tiled |
| `elevated` | Raised one level; gives cover to units below it | Top surface at y = 0.5 |
| `stairs` | Lets units climb onto elevation for free | Rises from ground level toward −Z (north) to y = 0.5 |
| `wall` | A wall fills its whole square and blocks movement and sight | Intact, 2 hp |
| `wall_damaged` | The same wall at 1 hp | Visibly cracked or broken, but still standing |
| `rubble` | A destroyed wall | Open ground in play, so low and walkable |
| `hazard` | 1 damage to units that enter or start there | Hellfire vents, blood pit or similar. Must read as dangerous |
| `adverse` | Costs extra movement to leave | Mud, bone mire or similar. Must read as slow |
| `corpse_1`, `corpse_2`, `corpse_3` | Bodies piled in a square (1, 2, or 3+) | Small props or flat decals that sit on top of any ground tile |
| `frame_6`, `frame_8`, `frame_10` | Board edge for 6, 8 and 10-square maps | Optional dressing just outside the grid |
| `backdrop` | Optional | A ruined-chapel or charnel-pit horizon |

## Technical

- Export glTF binary (`.glb`), one file per piece, named as in the table, Y-up.
- 1 Blender unit = 1 square.
- Put each piece's origin at the center of its square, at ground level (y = 0).
  - The ground surface sits at y = 0 and elevated tops at y = 0.5.
  - Walls, corpses and rubble also have their origin at ground level and sit on top of a ground piece. The game places a ground tile under them.
- Keep each piece under about 2k triangles.
- Use 1024px PNG textures, ideally one shared atlas. Use base color only: the game ignores normal, roughness and metal maps.
- Deliver the `.glb` files to `public/art/board/` in the repo, and keep the `.blend` sources in `art/blender/`.

The game uses each piece as soon as its file exists and draws a plain block in its place otherwise, so the pieces can arrive one at a time.
