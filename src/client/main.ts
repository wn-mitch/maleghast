// The client: draws the board with three.js. For now an empty 8x8 grid.

import * as THREE from "three";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
camera.position.set(10, 10, 10);
camera.lookAt(0, 0, 0);
scene.add(new THREE.GridHelper(8, 8, 0x880000, 0x444444));

function resize(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -6 * aspect;
  camera.right = 6 * aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
