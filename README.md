# GRIMHOLD

A first-person medieval fantasy **PvE loot-extraction slasher** prototype.
Dark gothic castle, weighty melee, dismemberment, and a simple rule:
**fill your pockets, open the gate, get out alive — or lose everything.**

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173).

Build for production:

```bash
npm run build
```

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look (click the game once to lock the pointer) |
| LMB (tap) | Light attack — chains **1-2-3**; the 3rd hit is +60% damage with a wider sweep |
| LMB (hold) | Charged/heavy attack — flick the mouse to pick the direction (&larr;/&rarr; slash, &darr; overhead, &uarr; stab), release to strike. Heavies break the combo chain |
| New flick mid-windup | **Morph** — change the attack direction during the first half of the charge. Costs stamina |
| RMB mid-windup | **Feint** — cancel your own attack into a short recovery. Costs stamina |
| RMB (tap, timed) | **Parry** — raise the guard within **0.18s** before the hit lands: the attacker is staggered for 2.2s, drained of stamina, and your next attack within **1.5s** is a guaranteed 2x crit with a big sever bonus. Taps have a short recovery |
| RMB (hold) | **Block** — heavy chip reduction, but each blocked hit drains stamina; at 0 stamina your guard **BREAKS** (long stagger). F also holds a plain block |
| Mirrored swing | **Chamber** — start a swing that mirrors an incoming strike's direction just before it lands: both blades clash, no damage, both recover fast |
| Mouse during swing | **Drag / accel** — sway with the swing to land sooner (softer), against it to land later (harder) |
| G | **Kick** — 6 damage, huge stagger, breaks enemy blocks. Costs 15 stamina |
| Heavy attack | **Execute** — any enemy staggered for 0.9s+ shows an EXECUTE prompt; a heavy hit triggers slow-mo and a guaranteed sever of the aimed part |
| Shift (hold) | Sprint (drains stamina) |
| E | Pick up loot / use extraction gate |
| M | Mute / unmute all audio |
| 1 / 2 / 3 | Switch weapon slot |
| Esc | Release pointer (pauses the run) |

## The loop

1. **Loadout screen** — pick a preset (Knight / Raider / Penitent), optionally equip a stashed weapon and armor piece from previous runs.
2. **Run** — fight through courtyard → great hall → dungeon (or the corridor loop), sever limbs, grab loot.
3. **Extraction gate** (spawn room, north side) opens when your carried loot value reaches **100** (gold + item values). Reach the rune circle and press E to bank everything.
4. **Death** = lose all gold and items carried this run. Extraction = everything goes to the persistent vault (localStorage).

## File structure

```
index.html      HUD DOM (incl. boss nameplate, screen blood, floating damage
                numbers, kill popups, kill counter), screens, CSS
src/main.js     boot, renderer, game state machine, melee hit sweep (combo arc,
                riposte crits), parry resolution, kick, execution slow-mo,
                ambush triggers, interaction (E), gate logic, hit-stop & shake
src/player.js   pointer-lock FPS controller, stamina, block/parry timing,
                combo chain state, kick, procedural viewmodel swing + trail
                ribbon, camera juice (strafe roll, landing dip, sway, FOV punch)
src/audio.js    100% procedural WebAudio synth (zero asset files): swings,
                flesh/armor/bone impacts, decapitation, block/parry, heartbeat,
                footsteps, dungeon drone + torch crackle, gate rumble, pickups
src/combat.js   pure tuning constants & rules (parry window, combo timing,
                execution, wounds, hit-stop scaling) — unit-tested headlessly
src/weapons.js  sword/axe/mace stats, rarity (common/rare/cursed), viewmodels
src/models.js   Synty asset layer: loads static body-part FBXs + weapon FBXs +
                texture atlas, assembles per-enemy visual sets that parent onto
                the hitboxes (sever = hide part visuals, swings = hitbox
                rotations); graceful box fallback when assets are missing
src/enemy.js    body-part system (6 parts, per-part HP, sever/destroy/wound
                states), crawl state, flinch/stagger/parry-stagger, FSM AI,
                knight blocking, rogue sidestep, skeleton lunge, 2-phase boss
src/gore.js     blood particle pool, persistent severed limbs & gib chunks
                (gravity+tumble+bounce+landing decals), growing blood pools,
                arterial wall splats, neck fountains, crawl smear trails
src/level.js    castle blockout, AABB colliders, floor-height query, wall
                raycast (blood splats), torches, extraction gate, loot/enemy
                spawn tables, ambush trigger volumes
src/loot.js     world loot, enemy drops, pickups, run inventory
src/ui.js       HUD updates, notifications, hitmarkers, crosshair pulse,
                floating damage numbers, kill popups, parry flash, screen
                blood splatter, boss nameplate, kill counter, loadout/result
                screens
src/meta.js     localStorage persistence (gold + stash + equips), presets, stats
```

## Key numbers

- **Movement** — walk 4.9 m/s, sprint 8.2 m/s, 0.25s acceleration / 0.18s stop slide (sprint 0.32s)
- Falls: thud + movement lock 0.15-0.35s above ~3m drop speed; fall damage beyond ~6m
- **Sword** — slash, 22 dmg, 0.50s cooldown, sever 35%, stagger 0.35
- **Axe** — chop, 34 dmg, 0.77s cooldown, sever 55%, stagger 0.55 (heaviest aim drag)
- **Mace** — blunt, 26 dmg, 0.63s cooldown, sever 8%, stagger 1.5, **bypasses armor & deflection**
- **Glancing blows** — connecting past 85% of range, or against a fast-sliding target, halves damage (grey number, dull thud)
- **Armor zones (knight)** — torso/helmet deflect light slash & chop for 25% damage (spark + clang); limbs, heavies, and blunt hits go through
- **Bleeding** — every opened limb wound drains 2 HP/s for 6s and drips a blood trail; legless crawlers bleed 3 HP/s until they die
- **Interrupts** — hits taken during your windup can cancel the swing (20% from light hits, 50% from heavy)
- **Block** — 15% chip damage through; stamina cost scales with the blow (8 + dmg x 0.5, cap 30); whiffed heavies cost +8 stamina
- **Encumbrance** — armor with 20+ HP: -8% move speed, +15% stagger resist
- **Domino knockback** — bodies knocked faster than 1.5 m/s bowl into the next enemy and stagger both
- Heavy attacks: ~2x damage, +50% sever chance; head hits crit x2
- **Combo chain** — light attacks chain 1-2-3 (reset after 1.0s idle or on heavy); 3rd hit = x1.6 damage + 0.35 wider sweep arc
- **Parry** — block raised ≤ 0.18s before impact; enemy staggered 2.2s; riposte window 1.5s = x2 crit + 0.6 sever bonus
- **Kick (G)** — 15 stamina, 6 dmg, 1.1s stagger, breaks blocks; enough stagger to enable EXECUTE
- **Execute** — target needs 0.9s+ stagger remaining; x3 damage, ignores armor/block, guaranteed sever, 0.3x slow-mo for 0.6s
- **Slow-mo** — decapitation 0.35x for 0.5s; parry flash 0.4x for 0.22s
- Rarity: common x1.0 / rare x1.35 / cursed x1.65 damage (cursed drains 1.5 HP/s while wielded)
- Enemies: Knight (armor 35%, blocks — 3.7x more often when your stamina is low), Bandit (fast, strafes, 45% chance to sidestep your heavy windups), Skeleton (crawls, lunges), plus the Gate Warden boss in the great hall (phase 2 at 50% HP: drops block, ~2x faster attacks)
- Body parts: head 30 / torso 80 / arms 35 / legs 40 HP (x type multiplier); part below 50% HP = wounded (dark tint, arm hangs); one leg destroyed = crawl, both = bleed-out kill
- **Torso burst** — heavy-axe kill dealing 60+ damage explodes the corpse into 3-5 gib chunks
- 3 ambush trigger volumes (corridor C elbow, great hall entrance, dungeon stair base) spawn rising skeletons; allies within 6m flinch 0.6s when one of their own is decapitated
- 13 enemies per run (8 static + boss + ambush spawns)

## Contact feel (Batch 1)

The hit-feedback layer. Everything below is tunable live in the panel (`` ` `` or F1)
under **CONTACT FEEL** and **ZONAL ARMOR** — the code reads `CFG.feel` / `CFG.armor`
at use-time, and the exported `*_DEFAULTS` consts (`HITSTOP_TABLE`,
`CAMERA_FEEL_DEFAULTS`, `ARMOR_DEFAULTS`, `ARMOR_ABSORB`, `KNOCKBACK_DEFAULTS`,
`SWING_WHOOSH_DEFAULTS`, `MATERIAL_SFX_DEFAULTS`) stay as fallbacks.

- **Hit-stop** (`feel.hitstop`) — the world freezes for a few ms on CONTACT,
  never on whiff: sword 40/80, axe 90/90, mace 70/70 (light/heavy), +60 when
  the blow severs, 150 for executions (overrides), 50 when armor shatters;
  grazes freeze at x0.5. Logic: `hitstopMs()` in `src/combat.js`, freeze clock
  `game.hitstop(ms)` in `src/main.js`.
- **Zonal armor** (`armor`) — knights & the Gate Warden carry per-part plate
  pools (knight head 50 / torso 90, limbs bare; boss 80 / 140 / 40 per limb).
  While a pool holds, it soaks a fraction of each blow by damage type
  (slash 0.6, pierce 0.5, chop 0.4, blunt 0.2) and wears down 1:1 — blunt
  wears x1.6, so the **mace cracks plate fast** (two hits vs the sword's
  three). Broken plate is permanent: hits go to flesh at full damage and
  light slashes stop deflecting on that part. API: `enemy.armorAt /
  damageArmor`, hook `game.onArmorBreak(enemy, part, pos)` (fires once).
- **Materials** — every landed blow resolves a contact material
  (flesh / bone / armor / shield) with a 0..1 severity:
  `audio.materialHit(pos, material, severity)`, `audio.armorBreak(pos)`,
  charge/drag-aware `audio.swingWhoosh(charge01, timingOff)`; spark tints
  `bone` (ivory) and `armor` (blue-white) in `src/sparks.js`.
- **Camera** (`feel.camKick`, `feel.fovPunch`) — your own hits nudge the
  camera along the blade's travel (weapon-mass scaled, clamped, decaying);
  heavy connects, guard breaks and armor breaks punch the FOV wider; getting
  parried jolts the viewmodel + rebounds the camera (`parryJolt`).
  Resolver: `cameraFeel()` in `src/player.js`.
- **Knockback** (`armor.knockbackMax/knockbackFriction/dummyMult`) — a
  cosmetic shove on the enemy's visual body that springs back; never touches
  the logical position (MP-safe). Dummies take half.

## Assets (Synty)

Real models from the user's licensed Synty packs, served from `public/assets/`:

- **POLYGON Modular Fantasy Hero** — static body-part meshes
  (`Chr_*_Static.fbx`, male variants) assembled onto the hitbox skeleton:
  knight (armored set + helmet + pauldrons + shield), bandit (light set),
  skeleton (base set with bone-pale untextured material), Gate Warden (armored
  set + red tint + helmet crest). Weapon FBXs: sword / axe / mace / dagger /
  shield — used both as first-person viewmodels and enemy hand weapons.
  Texture: `PolygonFantasyHero_Texture_01_A.png` atlas.
- Part index choices live in `src/models.js` (`SETS`) and are easy to retune.
- `tools/rebuild.py` + `tools/copy_parts.py` re-extract parts from the
  original `.unitypackage` files if different variants are wanted.
- If assets fail to load, the game silently falls back to the box-men.

## What is real vs faked

**Real:**
- **All audio is real procedural synthesis** — oscillators, filtered noise buffers, and gain envelopes generated in WebAudio at runtime. Zero asset files. Swings, flesh thuds, armor clangs, bone crunches, decapitation spray, parry pings, graze thuds, heartbeat under 30% HP, footsteps, dungeon drone, torch crackle, gate rumble, rarity-pitched pickup chimes
- Per-body-part HP with locational damage, crit heads, arm/leg debuffs, crawl state, wound states (visual tint + dangling arm below 50% part HP), accumulating wound decals (max 3/part), exposed bone on destroyed limbs, sever rolls
- **Armor zones**: knight torso/helmet deflect light slash/chop (25% dmg, spark + clang); limbs unarmored; blunt and heavy attacks penetrate — SPARK vs BLOOD tells you what you hit
- **Bleeding**: open limb wounds drain HP and drip trails; crawlers visibly bleed out
- Combo chains, parry/riposte timing windows, kick, executions, swing interrupts, glancing blows, whiff stamina — all real rule systems, headlessly unit-tested in smoke.mjs
- **Momentum movement**: acceleration/inertia, landing locks and fall damage scaled by drop height, encumbrance tradeoff on heavy armor, aim drag on heavy windups, weapon recoil that differs between armor and flesh hits
- Persistent physics-lite gore: severed limbs and heads tumble, bounce, roll with friction (down stairs too), twitch after settling, and stay for the whole run; blood pools grow under corpses; arterial sprays raycast onto real walls; bleeding enemies smear trails
- **Directional corpse falls** (away from the killing blow, limbs droop mid-fall) and domino knockback between enemies
- Gate Warden 2-phase boss, ambush trigger volumes, ally-flinch reactions, stamina-reading knight AI, heavy-reading rogue sidesteps
- Full extraction loop with persistent gold/stash in localStorage, cursed-item drawback, loadout presets affecting real stats
- AABB collision world with multi-height floors (stairs to the dungeon work), stamina economy, block chip + scaled stamina cost, enemy FSM with telegraphed windups
- Hit-stop scaled by damage, slow-mo on decapitations/executions/parries, screen shake, knockback, hitmarkers, damage vignette, screen blood splatter, swing trail ribbons, FOV punch, strafe roll, landing dip, mouse-lag weapon sway, floating damage numbers, kill popups

**Faked / simplified:**
- Models are real Synty meshes, but they hang on invisible box hitboxes in a
  static pose — all motion is still procedural hitbox rotation (no skeletal
  animation yet); arms are T-pose statics rotated down at the shoulder
- No line-of-sight checks for enemy aggro (distance only) and no navmesh — enemies seek straight and slide along walls
- Melee hit detection is a camera-ray-vs-part-sphere test, not a true weapon-arc sweep
- Deaths are directional tip-overs with drooping limbs, not true ragdolls (gib chunks get gravity+bounce+roll)
- Blood decals/pools are flat dark circles; "fog + torches" carries the mood instead of real lighting/shadows (no shadow maps)
- Found armor during a run is stash loot only — it can be equipped between runs, not mid-run

## Known limitations

- Enemies can occasionally crowd each other in doorways (cheap separation).
- The melee sweep only registers one enemy per swing (nearest along the ray).
- Balance is first-pass; the boss is meant to hurt.

## Сетевая игра (LAN)

Кооперативный MVP: несколько игроков в одной локальной сети спускаются в один
забег, видят анимированных чемпионов друг друга и дерутся с одними и теми же
врагами. Архитектура — host-authoritative: маленький WebSocket-релей
(`server/server.mjs`), первый вошедший в комнату становится хостом и симулирует
врагов. Одиночная игра без mp-параметров не меняется вообще.

### Как запустить

1. **Хост-машина** (одна из игроков):
   ```bash
   npm install        # один раз (подтянет пакет ws)
   npm run mp:server  # релей на 0.0.0.0:8787
   npm run dev:lan    # vite с --host, слушает LAN (порт 5173)
   ```
2. **Друзья** открывают в браузере `http://<LAN-IP-хоста>:5173`
   (IP смотрится через `ipconfig`, например 192.168.1.50).
3. На экране загрузки у всех: секция **ONLINE RAID (LAN)** —
   адрес `ws://<LAN-IP-хоста>:8787`, одна и та же комната (по умолчанию
   `keep`), имя → кнопка **HOST + JOIN RAID**. Первый вошедший в комнату
   становится хостом (симулирует врагов), остальные просто жмут ту же кнопку.
4. Все нажимают **ENTER GRIMHOLD** — и оказываются в одном забеге.

Альтернатива UI: URL-параметры
`http://<IP>:5173/?mp=1&addr=ws://<IP>:8787&room=keep&name=alice` —
подключение произойдёт автоматически.

### Игра через интернет (туннели)

Релей и Vite слушают все интерфейсы, поэтому достаточно пробросить два порта:
`8787` (WebSocket-релей) и `5173` (Vite). Подойдут ngrok, playit.gg, localtunnel
и т.п. — друзья подключаются по выданным адресам (`wss://...` для релея).

### Что синхронизируется

- Позиции, поворот и анимации чемпионов (15 Гц), оружие в руке, смерти;
- враги: хост симулирует ИИ и рассылает снапшоты 10 Гц (id, тип, x/z, yaw,
  animKey, hp, dead), клиенты рендерят прокси и шлют намерения ударов хосту;
- враги выбирают ближайшую живую цель среди всех игроков; урон удалённому
  игроку применяется на его клиенте (его блок/парирование работают локально);
- лут: спавн и подбор авторитетны на хосте, пропадает у всех;
- извлечение индивидуальное — каждый выносит свой лут сам; дружественный огонь
  выключен.

### Текущие ограничения MP (MVP)

- **Отсечение конечностей не синхронизируется** — на клиентах враги целы
  (результат виден по hp/смерти через снапшоты).
- **Миграция хоста без состояния**: если хост вышел, релей назначит нового,
  но симуляция врагов у него пустая — рекомендуется перезайти в забег.
- У клиентов нет локального ИИ врагов вообще (только прокси), поэтому без
  хоста враги стоят.
- Редкая гонка при одновременном подборе одного лута двумя игроками может
  продублировать предмет.
- Реконнекта нет: при обрыве WebSocket нужно переподключиться из меню.

### Проверка

```bash
node tools/mp-test.mjs   # поднимает релей на тестовом порту, два ws-клиента,
                         # проверяет id/host-флаг/релей state/toHost/fromHost/
                         # миграцию хоста; печатает MP TEST OK
```
