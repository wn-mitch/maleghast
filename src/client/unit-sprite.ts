import * as THREE from "three";

/** A camera-facing cutout with a two-CSS-pixel team border, including at image edges. */
export function outlinedUnit(texture: THREE.Texture, height: number, teamColor: number, dimmed: boolean): THREE.Sprite {
  const team = { value: new THREE.Color(teamColor) };
  const width = { value: 2 };
  const padding = { value: new THREE.Vector2() };
  const material = new THREE.SpriteMaterial({ map: texture, color: dimmed ? 0x777777 : 0xffffff, alphaTest: 0.5 });
  material.customProgramCacheKey = () => "team-outline-v1";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.teamColor = team;
    shader.uniforms.outlineWidth = width;
    shader.uniforms.outlinePadding = padding;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `
      uniform vec3 teamColor;
      uniform float outlineWidth;
      uniform vec2 outlinePadding;
      vec4 cutout(vec2 uv) {
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
        return texture2D(map, uv);
      }
      void main() {
    `).replace("#include <map_fragment>", `
      vec2 uv = vMapUv * (vec2(1.0) + 2.0 * outlinePadding) - outlinePadding;
      vec4 original = cutout(uv);
      vec2 stepSize = fwidth(uv) * outlineWidth;
      float edge = 0.0;
      for (int i = 0; i < 16; i++) {
        float angle = float(i) * 6.28318530718 / 16.0;
        edge = max(edge, cutout(uv + vec2(cos(angle), sin(angle)) * stepSize).a);
      }
      if (original.a >= 0.5) {
        diffuseColor *= original;
      } else if (edge >= 0.5) {
        diffuseColor = vec4(teamColor, opacity);
      } else {
        discard;
      }
    `);
  };
  const sprite = new THREE.Sprite(material);
  sprite.name = "team-outlined-unit";
  const viewport = new THREE.Vector2(), position = new THREE.Vector3();
  sprite.onBeforeRender = (renderer, _scene, camera) => {
    const image = texture.image as { width?: number; height?: number } | undefined;
    const aspect = image?.width && image.height ? image.width / image.height : 0.75;
    renderer.getSize(viewport);
    sprite.getWorldPosition(position).applyMatrix4(camera.matrixWorldInverse);
    const distance = camera instanceof THREE.PerspectiveCamera ? Math.max(0.01, -position.z) : 1;
    const pixelsHigh = height * camera.projectionMatrix.elements[5]! * viewport.y / (2 * distance);
    const pixelsWide = height * aspect * camera.projectionMatrix.elements[0]! * viewport.x / (2 * distance);
    // Three pixels of padding leave room for the two-pixel border and filtering.
    const px = 3 / Math.max(1, pixelsWide), py = 3 / Math.max(1, pixelsHigh);
    padding.value.set(px, py);
    width.value = 2 * renderer.getPixelRatio();
    sprite.scale.set(height * aspect * (1 + 2 * px), height * (1 + 2 * py), 1);
    sprite.center.set(0.5, py / (1 + 2 * py));
    sprite.updateMatrixWorld();
  };
  return sprite;
}
