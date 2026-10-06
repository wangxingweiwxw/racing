// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Port of Open Street Kart scripts/player_item_slots_state.gd and prefabs/items/air_bomb.gd.
import * as THREE from "three";

export enum SlotItem {
  DISABLED,
  EMPTY,
  AIR_BOMB,
}

export enum GameMode {
  AGAINST_CLOCK,
  VERSUS,
  FREE,
}

const SLOTS_COUNT = 3;
const ITEM_LIFETIME_SECONDS = 30;
const MIN_REFILL_TIME_SECONDS = 8;
const MAX_REFILL_TIME_SECONDS = 15;
const DISTANCE_FOR_MIN_REFILL = 200;

class Slot {
  private type: SlotItem = SlotItem.DISABLED;
  private updatedOn = 0;
  lifetime = 0;
  infinite = false;
  constructor(private parent: PlayerItemSlotsState) {
    this.setType(SlotItem.DISABLED);
  }
  getType() {
    return this.type;
  }
  setType(t: SlotItem) {
    this.type = t;
    this.updatedOn = this.parent.now;
  }
  timeIsUp() {
    return this.parent.now - this.updatedOn > this.lifetime && !this.infinite;
  }
  isDisabledOrEmpty() {
    return this.type === SlotItem.DISABLED || this.type === SlotItem.EMPTY;
  }
  progress() {
    if (this.infinite || this.type === SlotItem.DISABLED) return 0;
    return (this.parent.now - this.updatedOn) / Math.max(0.1, this.lifetime);
  }
}

export interface SlotDisplay {
  item: SlotItem;
  progress: number;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class PlayerItemSlotsState {
  now = 0;
  private slots: Slot[] = [];

  constructor(private maxSpeed: number, private mode: GameMode) {
    for (let i = 0; i < SLOTS_COUNT; i++) {
      const s = new Slot(this);
      this.slots.push(s);
      if (i === 0 && mode === GameMode.VERSUS) {
        s.setType(SlotItem.EMPTY);
        s.lifetime = MIN_REFILL_TIME_SECONDS;
      }
    }
  }

  private consumeFirst(): SlotItem {
    const t = this.slots[0].getType();
    this.slots.shift();
    this.slots.push(new Slot(this));
    return t;
  }

  /** returns the item used this tick (EMPTY when none) */
  tick(dt: number, distanceToFirst: number, useItem: boolean): SlotItem {
    this.now += dt;
    if (useItem && !this.slots[0].isDisabledOrEmpty()) return this.consumeFirst();
    const norm = distanceToFirst / this.maxSpeed;
    for (let i = 0; i < SLOTS_COUNT; i++) {
      if (this.mode !== GameMode.VERSUS) break;
      const s = this.slots[i];
      if (i > 0) {
        const prev = this.slots[i - 1];
        if (!prev.isDisabledOrEmpty() && s.getType() === SlotItem.DISABLED) {
          s.setType(SlotItem.EMPTY);
          const ratio = smoothstep(0, DISTANCE_FOR_MIN_REFILL, norm);
          s.lifetime = MIN_REFILL_TIME_SECONDS + (1 - ratio) * (MAX_REFILL_TIME_SECONDS - MIN_REFILL_TIME_SECONDS);
        }
      }
      if (s.getType() === SlotItem.EMPTY && s.timeIsUp()) {
        s.setType(SlotItem.AIR_BOMB);
        s.lifetime = ITEM_LIFETIME_SECONDS;
      }
      if (!s.isDisabledOrEmpty() && s.timeIsUp()) {
        this.consumeFirst();
        i--;
      }
    }
    return SlotItem.EMPTY;
  }

  display(): SlotDisplay[] {
    return this.slots.map((s) => ({ item: s.getType(), progress: s.progress() }));
  }

  first(): SlotItem {
    return this.slots[0].getType();
  }
}

// ---------------------------------------------------------------- air bomb
export const EXPLOSION_DURATION_SECONDS = 0.2;
export const EXPLOSION_RADIUS = 16;

export class AirBomb {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  age = 0;
  exploding = -1;
  done = false;
  readonly mesh: THREE.Group;
  readonly aura: THREE.Mesh;
  readonly hit = new Set<object>();

  constructor(from: THREE.Vector3, velocity: THREE.Vector3, readonly owner: object) {
    this.pos.copy(from);
    this.vel.copy(velocity);
    this.mesh = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.35, metalness: 0.6 }));
    shell.castShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 6, 20), new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff2010, emissiveIntensity: 1.2 }));
    band.rotation.x = Math.PI / 2;
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0xc0a060 }));
    fuse.position.y = 0.36;
    this.mesh.add(shell, band, fuse);
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.aura.visible = false;
    this.mesh.add(this.aura);
  }
}
