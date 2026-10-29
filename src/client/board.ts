// The battlefield in three.js: terrain pieces, units as standing sprites of
// their art, highlights, and picking a square or a unit with the pointer.
// Terrain uses the modelled pieces in /art/board/<name>.glb where they exist
// and plain blocks where they don't. Columns run along x, rows along z, so
// north is -z; one square is one unit, the ground is at y = 0.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cellsOf, index, terrainAt } from "../rules/board";
import { defOf } from "../rules/content";
import type { Game } from "../rules/state";
import type { Board, Cell, Unit } from "../rules/types";

export type Pick = { readonly kind: "cell"; readonly cell: Cell } | { readonly kind: "unit"; readonly id: string };

export const SIDE_COLORS = [0x4fb3bf, 0xe8622c] as const;
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
    case "wall": return box(0.9, 0.9, 0.9, 0x8a8580);
    case "wall_damaged": return box(0.9, 0.55, 0.9, 0x6e6964);
    case "hazard": return box(0.98, 0.04, 0.98, g(0x5c1a12));
    case "adverse": return box(0.98, 0.04, 0.98, g(0x3f3626));
    default: return box(0.98, 0.04, 0.98, g(0x2e2e2e));
  }
}

/** The pieces a square is built from: its ground, then anything standing on it. */
function piecesAt(b: Board, c: Cell): string[] {
  const t = terrainAt(b, c);
  const ground = t.stairs ? "stairs" : t.elevated ? "elevated" : t.hazard ? "hazard" : t.adverse ? "adverse" : `ground_${"abc"[(c.col * 7 + c.row * 13) % 3]}`;
  const wall = b.walls[index(b, c)] ?? 0;
  return wall >= 2 ? [ground, "wall"] : wall === 1 ? [ground, "wall_damaged"] : [ground];
}

function heightAt(b: Board, c: Cell): number {
  return terrainAt(b, c).elevated ? ELEVATION : 0;
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
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly terrain = new THREE.Group();
  private readonly units = new THREE.Group();
  private readonly marks = new THREE.Group();
  private game: Game | null = null;
  private facing: number | null = null;
  private built = "";
  private selected: string | null = null;
  onPick: (p: Pick) => void = () => {};

  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x111111);
    this.scene.add(this.terrain, this.units, this.marks);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enablePan: false, minPolarAngle: 0.2, maxPolarAngle: 1.25, minDistance: 5, maxDistance: 25, enableDamping: true });
    this.pointer(host);
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(host);
    resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** The world position of a square's centre on the ground. */
  private world(b: Board, col: number, row: number): THREE.Vector3 {
    return new THREE.Vector3(col - b.size / 2 + 0.5, 0, row - b.size / 2 + 0.5);
  }

  /** Show `g`, seen from `side`'s end of the board (south for side 0). */
  show(g: Game, side: number | null): void {
    this.game = g;
    const facing = side ?? 0;
    if (facing !== this.facing) {
      this.facing = facing;
      // Far enough back to fit the board across a narrow view too.
      const d = g.board.size * 1.3 * Math.max(1, 1.3 / this.camera.aspect);
      this.camera.position.set(0, d, facing === 0 ? d * 0.75 : -d * 0.75);
      this.controls.target.set(0, 0, 0);
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
    const jobs: Promise<void>[] = [];
    for (let row = 0; row < b.size; row++) {
      for (let col = 0; col < b.size; col++) {
        const at = this.world(b, col, row);
        const dark = (col + row) % 2 === 0;
        for (const name of piecesAt(b, { col, row })) {
          jobs.push(piece(name).then((m) => {
            const o = m ? m.clone() : fallback(name, dark);
            o.position.add(at);
            o.userData.cell = { col, row };
            group.add(o);
          }));
        }
        const bodies = b.corpses[index(b, { col, row })] ?? 0;
        if (bodies > 0) {
          jobs.push(piece(`corpse_${Math.min(bodies, 3)}`).then((m) => {
            const o = m ? m.clone() : new THREE.Mesh(new THREE.CylinderGeometry(0.12 + 0.05 * bodies, 0.18 + 0.05 * bodies, 0.06, 12), new THREE.MeshBasicMaterial({ color: 0x4a1410 }));
            o.position.copy(at).setY(heightAt(b, { col, row }) + 0.05);
            o.position.x += 0.25;
            o.position.z += 0.25;
            group.add(o);
          }));
        }
      }
    }
    // The grid lines, so squares stay countable whatever the pieces look like.
    const grid = new THREE.GridHelper(b.size, b.size, 0x000000, 0x000000);
    grid.position.y = 0.045;
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    group.add(grid);
    await Promise.all(jobs);
    if (key !== this.built) return;
    this.terrain.clear();
    this.terrain.add(...group.children);
  }

  private drawUnits(g: Game): void {
    this.units.clear();
    for (const u of g.units) this.units.add(this.unitSprite(g, u));
  }

  private unitSprite(g: Game, u: Unit): THREE.Group {
    const b = g.board, d = defOf(u.kind);
    const cells = cellsOf(u);
    const pos = this.world(b, u.col + (u.size - 1) / 2, u.row + (u.size - 1) / 2);
    pos.y = Math.max(...cells.map((c) => heightAt(b, c)));
    const o = new THREE.Group();
    o.position.copy(pos);
    o.userData.unit = u.id;
    const active = g.active.some((a) => a.id === u.id);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36 * u.size, (u.id === this.selected ? 0.5 : 0.44) * u.size, 32),
      new THREE.MeshBasicMaterial({ color: SIDE_COLORS[u.side] ?? 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: u.done ? 0.4 : 1 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    o.add(ring);
    const tex = artOf(u.kind);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: u.done && !active ? 0x777777 : 0xffffff, alphaTest: 0.5 }));
    sprite.center.set(0.5, 0);
    const h = (d.type === "thrall" ? 1.0 : d.type === "necromancer" ? 1.0 : 1.25) * u.size;
    const fit = () => {
      const img = tex.image as { width?: number; height?: number } | undefined;
      const aspect = img?.width && img.height ? img.width / img.height : 0.75;
      sprite.scale.set(h * aspect, h, 1);
    };
    fit();
    if (!(tex.image as { width?: number } | undefined)?.width) {
      const was = tex.onUpdate;
      tex.onUpdate = (t: THREE.Texture) => { was?.call(t, t); fit(); };
    }
    sprite.userData.unit = u.id;
    o.add(sprite);
    const max = d.hp;
    const hp = label(u.raging ? "RAGE" : `${u.hp}/${max}`, u.raging ? "#ff5a3c" : u.hp <= Math.ceil(max / 3) ? "#ffb347" : "#ffffff");
    hp.position.y = h + 0.15;
    o.add(hp);
    return o;
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
      m.position.copy(this.world(b, c.col, c.row)).setY(heightAt(b, c) + 0.08);
      m.userData.cell = c;
      this.marks.add(m);
    }
  }

  clearMarks(): void {
    this.marks.clear();
  }

  private pointer(host: HTMLElement): void {
    const ray = new THREE.Raycaster(), at = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    host.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    host.addEventListener("pointerup", (e) => {
      // A drag turns the camera; only a click picks.
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = this.renderer.domElement.getBoundingClientRect();
      at.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(at, this.camera);
      const p = this.hit(ray);
      if (p) this.onPick(p);
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

