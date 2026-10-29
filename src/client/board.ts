// The battlefield in three.js: terrain pieces, units as standing sprites of
// their art, highlights, and picking a square or a unit with the pointer.
// Terrain uses the modelled pieces in /art/board/<name>.glb where they exist
// and plain blocks where they don't. Columns run along x, rows along z, so
// north is -z; one square is one unit, the ground is at y = 0.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { outlinedUnit } from "./unit-sprite";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cellsOf, index, isWall, terrainAt } from "../rules/board";
import { defOf } from "../rules/content";
import type { Game } from "../rules/state";
import type { Board, Cell, Unit } from "../rules/types";

export type Pick = { readonly kind: "cell"; readonly cell: Cell } | { readonly kind: "unit"; readonly id: string };

export const SIDE_COLORS = [0x4fb3bf, 0xe8622c] as const;
/** Seen by a player: their own units in cold white-blue on round bases, the enemy's in red on square ones. */
export const FRIEND = 0x8fe3ff;
export const FOE = 0xff3b30;
const PAN_SPEED = 7;
const ELEVATION = 0.5;

const gltf = new GLTFLoader();
const pieces = new Map<string, Promise<THREE.Object3D | null>>();

/** A modelled terrain piece, drawn unlit with its baked texture, or null if there is none. */
function piece(name: string): Promise<THREE.Object3D | null> {
  let p = pieces.get(name);
  if (!p) {
    p = gltf.loadAsync(`/art/board/${name}.glb`).then(
      (m) => {
        m.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const old = o.material as THREE.MeshStandardMaterial;
            o.material = new THREE.MeshBasicMaterial({ map: old.map ?? null, color: old.map ? 0xffffff : old.color });
          }
        });
        return m.scene;
      },
      () => null,
    );
    pieces.set(name, p);
  }
  return p;
}

const textures = new THREE.TextureLoader();
const art = new Map<string, THREE.Texture>();

/** A unit's standing art, or its portrait for necromancers, who have no full-body art. */
function artOf(kind: string): THREE.Texture {
  let t = art.get(kind);
  if (!t) {
    const folder = defOf(kind).type === "necromancer" ? "portraits" : "units";
    t = textures.load(`/art/${folder}/${kind}.png`);
    t.colorSpace = THREE.SRGBColorSpace;
    art.set(kind, t);
  }
  return t;
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  m.position.y = h / 2;
  return m;
}

/** The plain block standing in for a piece that hasn't been modelled. */
function fallback(name: string, dark: boolean): THREE.Object3D {
  const g = (c: number) => (dark ? c : c + 0x060606);
  switch (name) {
    case "elevated": return box(0.98, ELEVATION, 0.98, g(0x5a5650));
    case "stairs": {
      const o = box(0.98, ELEVATION / 2, 0.98, g(0x6a645a));
      o.add(Object.assign(box(0.98, ELEVATION / 2, 0.49, g(0x6a645a)), { position: new THREE.Vector3(0, ELEVATION / 4, -0.245) }));
      return o;
    }
    case "rubble": return box(0.65, 0.04, 0.65, 0x555555);
    case "wall": return box(0.9, 0.9, 0.9, 0x8a8580);
    case "wall_damaged": return box(0.9, 0.55, 0.9, 0x6e6964);
    case "hazard": return box(0.98, 0.04, 0.98, g(0x5c1a12));
    case "adverse": return box(0.98, 0.04, 0.98, g(0x3f3626));
    default: return box(0.98, 0.04, 0.98, g(0x2e2e2e));
  }
}

/** The pieces a square is built from: its ground, then anything standing on it. */
export function piecesAt(b: Board, c: Cell): string[] {
  const t = terrainAt(b, c);
  const ground = t.stairs ? "stairs" : t.elevated ? "elevated" : t.hazard ? "hazard" : t.adverse ? "adverse" : `ground_${"abc"[(c.col * 7 + c.row * 13) % 3]}`;
  const wall = b.walls[index(b, c)] ?? 0;
  return wall >= 2 ? [ground, "wall"] : wall === 1 ? [ground, "wall_damaged"] : t.rubble ? [ground, "rubble"] : [ground];
}

function heightAt(b: Board, c: Cell): number {
  const t = terrainAt(b, c);
  return t.stairs ? 0.3 : t.elevated ? ELEVATION : 0;
}

/** Corpse piles stay inside a square and rest on a tread or the ground surface. */
export function corpsePlacement(b: Board, c: Cell): { x: number; y: number; z: number; depth: number } {
  const t = terrainAt(b, c);
  if (t.stairs) return { x: 0.12, y: 0.105, z: 0.4, depth: 0.25 };
  return { x: 0.12, y: t.elevated ? 0.505 : t.hazard ? 0.055 : t.adverse ? 0.03 : 0.005, z: 0.12, depth: 1 };
}

/** A small text sprite, for hit points over a unit's head. */
function label(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "rgba(0,0,0,0.75)";
  c.beginPath();
  c.roundRect(8, 8, 112, 48, 12);
  c.fill();
  c.fillStyle = color;
  c.font = "bold 34px system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 64, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(0.5, 0.25, 1);
  s.renderOrder = 10;
  return s;
}

export class BoardView {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  /** Which corner the isometric view looks from, in quarter turns. */
  private quarter = 0;
  private aspect = 1;
  /** Each square's surface height, from the pieces as built. */
  private tops = new Map<number, number>();
  private readonly controls: OrbitControls;
  private readonly terrain = new THREE.Group();
  private readonly units = new THREE.Group();
  private readonly backdrop = new THREE.Group();
  private readonly marks = new THREE.Group();
  private game: Game | null = null;
  private facing: number | null = null;
  private built = "";
  private selected: string | null = null;
  /** The side looking at the board, for friend and foe colors; null for a watcher. */
  private you: number | null = null;
  /** The camera's turn round the board, eased toward `angleTo`. */
  private angle = Math.PI / 4;
  private angleTo = Math.PI / 4;
  /** Where the camera looks, eased toward `aimTo`. */
  private aimTo: THREE.Vector3 | null = null;
  private readonly held = new Set<string>();
  private readonly overlay = new THREE.Group();
  private hovered = "";
  onPick: (p: Pick) => void = () => {};
  /** The pointer moved onto a different square or unit, or off the board. */
  onHover: (p: Pick | null) => void = () => {};
  /** A right click, or Escape: put down whatever is in hand. */
  onCancel: () => void = () => {};

  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x111111);
    this.scene.add(this.terrain, this.units, this.marks, this.backdrop, this.overlay);
    // A fixed isometric angle. The left button only ever picks; right or middle drag pans,
    // WASD and the arrows pan, the wheel zooms, Q and E turn the board, F recentres it.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableRotate: false, enablePan: true, screenSpacePanning: true, minZoom: 0.6, maxZoom: 3, enableDamping: true });
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    this.pointer(host);
    const turn = (d: number) => this.turn(d);
    host.append(
      Object.assign(document.createElement("div"), { className: "turn-buttons" }),
    );
    const bar = host.lastElementChild!;
    for (const [label, d] of [["⟲", -1], ["⟳", 1]] as const) {
      bar.append(Object.assign(document.createElement("button"), { textContent: label, title: d < 0 ? "Turn left (Q)" : "Turn right (E)", onclick: () => turn(d) }));
    }
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey;
    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === "q") turn(-1);
      else if (k === "e") turn(1);
      else if (k === "f") this.recentre();
      else if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        this.held.add(k);
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.held.clear());
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      this.renderer.setSize(w, h);
      this.aspect = w / h;
      this.frame();
    };
    new ResizeObserver(resize).observe(host);
    resize();
    let last = performance.now();
    this.renderer.setAnimationLoop((now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.ease(dt);
      this.controls.update();
      // Keep tall scenery beyond the far edge, including while orbiting.
      if (this.game) {
        const d = this.game.board.size * 0.72 + 0.4;
        const angle = Math.atan2(this.camera.position.x, this.camera.position.z);
        this.backdrop.position.set(-Math.sin(angle) * d, 0, -Math.cos(angle) * d);
        this.backdrop.rotation.y = angle;
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** The world position of a square's centre on the ground. */
  private world(b: Board, col: number, row: number): THREE.Vector3 {
    return new THREE.Vector3(col - b.size / 2 + 0.5, 0, row - b.size / 2 + 0.5);
  }

  /** Turn the view a quarter round the board, easing there. */
  turn(d: number): void {
    this.quarter = (this.quarter + d + 4) % 4;
    this.angleTo += (d * Math.PI) / 2;
  }

  /** Look at the board's centre again, at the starting zoom. */
  recentre(): void {
    this.aimTo = new THREE.Vector3(0, 0, 0);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
  }

  /** Bring a square into the middle of the view, easing there. */
  focus(c: Cell): void {
    if (this.game) this.aimTo = this.world(this.game.board, c.col, c.row);
  }

  /** One frame of camera easing: turning, gliding to a square, and keyboard panning. */
  private ease(dt: number): void {
    const target = this.controls.target;
    const move = new THREE.Vector3();
    if (this.held.size) {
      // Screen right and screen up, flattened onto the board.
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).setY(0).normalize();
      const k = (PAN_SPEED * dt) / this.camera.zoom;
      if (this.held.has("a") || this.held.has("arrowleft")) move.addScaledVector(right, -k);
      if (this.held.has("d") || this.held.has("arrowright")) move.addScaledVector(right, k);
      if (this.held.has("w") || this.held.has("arrowup")) move.addScaledVector(up, k);
      if (this.held.has("s") || this.held.has("arrowdown")) move.addScaledVector(up, -k);
      this.aimTo = null;
    } else if (this.aimTo) {
      move.subVectors(this.aimTo, target).multiplyScalar(Math.min(1, dt * 10));
      if (target.distanceTo(this.aimTo) < 0.01) this.aimTo = null;
    }
    target.add(move);
    this.camera.position.add(move);
    if (Math.abs(this.angleTo - this.angle) > 1e-3) {
      this.angle += (this.angleTo - this.angle) * Math.min(1, dt * 12);
      this.place();
    }
  }

  /** Put the camera at its isometric angle round the point it looks at. */
  private place(): void {
    const n = this.game?.board.size ?? 8, r = n * 2, t = this.controls.target;
    // The true isometric angle: the camera sits along (1, 1, 1) from what it looks at.
    this.camera.position.set(t.x + Math.sin(this.angle) * r * Math.SQRT2, t.y + r, t.z + Math.cos(this.angle) * r * Math.SQRT2);
    this.camera.lookAt(t);
  }

  /** Place the camera at its isometric corner and fit the board in view. */
  private frame(): void {
    const n = this.game?.board.size ?? 8;
    this.angle = this.angleTo = Math.PI / 4 + (this.quarter * Math.PI) / 2;
    this.controls.target.set(0, 0, 0);
    this.place();
    // The board's diagonal spans n√2 across; leave room for units standing on the far edge.
    const half = Math.max((n * Math.SQRT2 * 0.56) / this.aspect, n * 0.62);
    Object.assign(this.camera, { left: -half * this.aspect, right: half * this.aspect, top: half, bottom: -half });
    this.camera.updateProjectionMatrix();
  }

  /** Show `g`, seen from `side`'s end of the board (south for side 0). */
  show(g: Game, side: number | null): void {
    const first = !this.game;
    this.game = g;
    this.you = side;
    const facing = side ?? 0;
    if (facing !== this.facing || first) {
      this.facing = facing;
      this.quarter = facing === 0 ? 0 : 2;
      this.frame();
    }
    const key = JSON.stringify([g.board.size, g.board.terrain, g.board.walls, g.board.corpses]);
    if (key !== this.built) {
      this.built = key;
      void this.buildTerrain(g.board, key);
    }
    this.drawUnits(g);
  }

  private async buildTerrain(b: Board, key: string): Promise<void> {
    const group = new THREE.Group();
    const tops = new Map<number, number>();
    const jobs: Promise<void>[] = [];
    for (let row = 0; row < b.size; row++) {
      for (let col = 0; col < b.size; col++) {
        const at = this.world(b, col, row);
        const dark = (col + row) % 2 === 0;
        for (const [i, name] of piecesAt(b, { col, row }).entries()) {
          jobs.push(piece(name).then((m) => {
            const o = m ? m.clone() : fallback(name, dark);
            o.position.add(at);
            if (name === "wall" || name === "wall_damaged" || name === "rubble") o.position.y += heightAt(b, { col, row });
            o.userData.cell = { col, row };
            group.add(o);
            // The first piece is the ground; its top is where units and highlights stand.
            if (i === 0) tops.set(index(b, { col, row }), new THREE.Box3().setFromObject(o).max.y);
          }));
        }
        const bodies = b.corpses[index(b, { col, row })] ?? 0;
        if (bodies > 0) {
          jobs.push(piece(`corpse_${Math.min(bodies, 3)}`).then((m) => {
            const o = m ? m.clone() : new THREE.Mesh(new THREE.CylinderGeometry(0.12 + 0.04 * Math.min(bodies, 3), 0.15 + 0.04 * Math.min(bodies, 3), 0.06, 12), new THREE.MeshBasicMaterial({ color: 0x292929 }));
            const placement = corpsePlacement(b, { col, row });
            o.position.copy(at).add(new THREE.Vector3(placement.x, placement.y + (m ? 0 : 0.03), placement.z));
            o.scale.z *= placement.depth;
            o.userData.cell = { col, row };
            group.add(o);
          }));
        }
      }
    }
    // Optional dressing has no fallback and never participates in cell picking.
    jobs.push(piece(`frame_${b.size}`).then((m) => { if (m) group.add(m.clone()); }));
    const backdrop = piece("backdrop");
    await Promise.all(jobs);
    const horizon = await backdrop;
    if (key !== this.built) return;
    // The grid: each square's outline just above its own surface, so it reads on any piece.
    const pts: number[] = [];
    for (let row = 0; row < b.size; row++) {
      for (let col = 0; col < b.size; col++) {
        if (isWall(b, { col, row })) continue;
        const c = this.world(b, col, row), y = (tops.get(index(b, { col, row })) ?? 0) + 0.01, h = 0.5;
        const corners = [[-h, -h], [h, -h], [h, h], [-h, h]] as const;
        for (let k = 0; k < 4; k++) {
          const [x0, z0] = corners[k]!, [x1, z1] = corners[(k + 1) % 4]!;
          pts.push(c.x + x0, y, c.z + z0, c.x + x1, y, c.z + z1);
        }
      }
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 }),
    );
    group.add(grid);
    this.tops = tops;
    this.backdrop.clear();
    if (horizon) {
      const distant = horizon.clone();
      distant.scale.setScalar(0.55);
      this.backdrop.add(distant);
    }
    this.terrain.clear();
    this.terrain.add(...group.children);
    if (this.game) this.drawUnits(this.game);
  }

  private drawUnits(g: Game): void {
    this.units.clear();
    for (const u of g.units) this.units.add(this.unitSprite(g, u));
  }

  private unitSprite(g: Game, u: Unit): THREE.Group {
    const b = g.board, d = defOf(u.kind);
    const cells = cellsOf(u);
    const pos = this.world(b, u.col + (u.size - 1) / 2, u.row + (u.size - 1) / 2);
    pos.y = Math.max(...cells.map((c) => this.top(b, c)));
    const o = new THREE.Group();
    o.position.copy(pos);
    o.userData.unit = u.id;
    const active = g.active.some((a) => a.id === u.id);
    const color = this.colorOf(u.side);
    const mine = this.you !== null ? u.side === this.you : u.side === 0;
    const spent = u.done && !active;
    // Round bases for the viewer's units, square for the enemy's: the shape tells them apart without color.
    const chosen = u.id === this.selected || active;
    const outer = (chosen ? 0.5 : 0.44) * u.size, inner = (chosen ? 0.34 : 0.38) * u.size;
    const base = mine
      ? new THREE.RingGeometry(inner, outer, 40)
      : new THREE.RingGeometry(inner * Math.SQRT2, outer * Math.SQRT2 * 0.92, 4, 1, Math.PI / 4);
    const ring = new THREE.Mesh(base, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: spent ? 0.35 : 1, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 2;
    o.add(ring);
    if (!spent) {
      // A tinted floor under a unit that can still act this round.
      const fill = new THREE.Mesh(mine ? new THREE.CircleGeometry(inner, 40) : new THREE.CircleGeometry(inner * Math.SQRT2, 4, Math.PI / 4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: chosen ? 0.35 : 0.18, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.045;
      o.add(fill);
    }
    const tex = artOf(u.kind);
    const h = (d.type === "thrall" ? 1.0 : d.type === "necromancer" ? 1.0 : 1.25) * u.size;
    const sprite = outlinedUnit(tex, h, color, spent);
    sprite.userData.unit = u.id;
    o.add(sprite);
    const max = d.hp;
    const hp = label(u.raging ? "RAGE" : `${u.hp}/${max}`, u.raging ? "#ff5a3c" : u.hp <= Math.ceil(max / 3) ? "#ffb347" : "#ffffff");
    hp.position.y = h + 0.15;
    o.add(hp);
    return o;
  }

  /** A side's color as this viewer sees it. */
  private colorOf(side: number): number {
    if (this.you === null) return SIDE_COLORS[side] ?? 0xffffff;
    return side === this.you ? FRIEND : FOE;
  }

  /** Outline the square under the pointer. */
  hover(c: Cell | null, color = 0xffffff): void {
    this.overlay.getObjectByName("hover")?.removeFromParent();
    const b = this.game?.board;
    if (!c || !b) return;
    const y = this.top(b, c) + 0.04, h = 0.47, w = this.world(b, c.col, c.row);
    const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, z]) => new THREE.Vector3(w.x + x!, y, w.z + z!));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.name = "hover";
    line.renderOrder = 5;
    this.overlay.add(line);
  }

  /** Show the path a MOVE would take: a dot on each square, a diamond where it ends. */
  path(cells: readonly Cell[] | null, color: number = FRIEND): void {
    this.overlay.getObjectByName("path")?.removeFromParent();
    const b = this.game?.board;
    if (!cells?.length || !b) return;
    const g = new THREE.Group();
    g.name = "path";
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    cells.forEach((c, i) => {
      const end = i === cells.length - 1;
      const m = new THREE.Mesh(end ? new THREE.CircleGeometry(0.2, 4) : new THREE.CircleGeometry(0.08, 16), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(this.world(b, c.col, c.row)).setY(this.top(b, c) + 0.06);
      m.renderOrder = 6;
      g.add(m);
    });
    this.overlay.add(g);
  }

  /** A square's surface height: measured from its piece once built, else from its terrain. */
  private top(b: Board, c: Cell): number {
    return this.tops.get(index(b, c)) ?? heightAt(b, c);
  }

  /** Mark the unit the player is working with. */
  select(id: string | null): void {
    this.selected = id;
    if (this.game) this.drawUnits(this.game);
  }

  /** Tint `cells`; each call adds to what's shown until `clearMarks`. */
  mark(cells: readonly Cell[], color: number, opacity = 0.4): void {
    const b = this.game?.board;
    if (!b) return;
    for (const c of cells) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.copy(this.world(b, c.col, c.row)).setY(this.top(b, c) + 0.02);
      m.userData.cell = c;
      this.marks.add(m);
    }
  }

  clearMarks(): void {
    this.marks.clear();
  }

  private pointer(host: HTMLElement): void {
    const ray = new THREE.Raycaster(), at = new THREE.Vector2();
    let down: { x: number; y: number; button: number } | null = null;
    const pickAt = (e: PointerEvent): Pick | null => {
      const r = this.renderer.domElement.getBoundingClientRect();
      at.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(at, this.camera);
      return this.hit(ray);
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, button: e.button }));
    canvas.addEventListener("pointerup", (e) => {
      // A drag pans the camera; only a click picks, and a right click cancels.
      const click = down && down.button === e.button && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6;
      down = null;
      if (!click) return;
      if (e.button === 2) return this.onCancel();
      if (e.button !== 0) return;
      const p = pickAt(e);
      if (p) this.onPick(p);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down) return;
      const p = pickAt(e);
      const key = p ? JSON.stringify(p) : "";
      if (key === this.hovered) return;
      this.hovered = key;
      this.onHover(p);
    });
    canvas.addEventListener("pointerleave", () => {
      this.hovered = "";
      this.onHover(null);
    });
  }

  private hit(ray: THREE.Raycaster): Pick | null {
    for (const h of ray.intersectObjects([this.units, this.marks, this.terrain], true)) {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (typeof o.userData.unit === "string") return { kind: "unit", id: o.userData.unit };
        if (o.userData.cell) return { kind: "cell", cell: o.userData.cell as Cell };
      }
    }
    return null;
  }
}

