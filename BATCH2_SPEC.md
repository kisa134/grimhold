# BATCH 2 — Глубина дуэли (прикладная спека)

Продолжение после Batch 1 (хитстоп-таблица, материалы, зональная броня, нокбэк,
свист, камера-режиссёр, отдача при парри — все 39 крутилок в панели, тесты
зелёные). Цель батча 2 — превратить парри/стамину/комбо из «есть» в **дуэльный
майнд-гейм** уровня Chivalry/Sekiro, не ломая темп (правило из спек-пачки:
slow-mo только на редких событиях, тряска — от массы удара).

Правило отбора (закон из твоей спек-пачки): фича не меняет бой / не даёт новой
сцены / не усиливает фидбэк / не создаёт выбор → не делаем. Каждая из 5 фич ниже
проходит.

---

## GAP-АНАЛИЗ: что уже есть (не изобретаем заново)

| Система | Где | Статус |
|---|---|---|
| Парри (окно 0.18s) | `combat.js:isParry`, `main.js:466` | есть, даёт riposte (1.5s, ×2 крит) |
| Блок + чип + стамина-война | `player.js`, `enemy.js:663` | есть, guard-break при 0 стамины |
| Комбо 1-2-3 + 3-й ×1.6 | `combat.js:comboNextStage`, `player.js:383` | есть, `_comboSide()` уже чередует slashL/slashR |
| Кик (15 ст, 1.8m, 6 dmg, 1.1s stagger, ломает блок) | `player.js:259` | есть, **нет** wall-splat |
| Стамина врага + regen | `enemy.js:279` (`maxStamina`, `stamina`, regen) | есть, но это «выносливость удара», не posture |
| Рейкаст стен (для крови) | `level.js` (wall raycast) | есть — переиспользуем для wall-splat |
| Slow-mo / hitstop / shake / fovPunch / camKick | Batch 1 | есть, дёргать отсюда |

**Чего нет (строим):** perfect-parry под-окно, posture-бар над головой,
wall-splat кика, sidestep с i-фреймами, flow-множитель комбо.

---

## 1. PERFECT PARRY (узкое окно → бесплатный рипост)

Под-окно внутри текущего `parryWindow` (0.18s). Определяется в `resolveDefense`
(combat.js) — возвращает `'parry'` уже при `blockElapsed ≤ parryWindow`; добавим
`'perfect'` для `blockElapsed ≤ perfectParryWindow`.

| Параметр | Значение | В панели |
|---|---|---|
| perfectParryWindow | 0.10 s | duel |
| эффект | riposte-окно ×2 (3.0 s), sever-бонус +0.4, slow-mo 0.25 scale 0.5 s, бесплатный крит ×2 без истечения | — |
| фидбэк | «PERFECT PARRY» (ярче), белая вспышка сильнее, золотые искры ×2, свой sting | feel |
| обычный парри | как сейчас (riposte 1.5s, ×2, slow-mo 0.35/0.25s) | — |

`combat.js` добавить:
```js
export function isPerfectParry(blockElapsed) {
  return blockElapsed >= 0 && blockElapsed <= CFG.combat.perfectParryWindow;
}
```
`main.js:466` — если `outcome === 'perfect'`: `p.riposteUntil = time + CFG.combat.riposteWindow*2`,
`game.slowmo(0.25, 0.5)`, `UI.killPopup('PERFECT PARRY!', '#fff2a8')`, `audio.rewardSting()`.

---

## 2. POSTURE BAR (Sekiro-lite, война стамины читаема)

Новое поле `enemy.posture` (0..postureMax). Растёт от каждого полученного удара
(масштаб по массе оружия и типу: заблок/паррирован = ×1.5, тяжёлый = ×1.4),
регенит когда вне боя/не в stagger. При `posture ≥ postureMax` → **POSTURE BREAK**:
длинный stagger (×1.6 от обычного) + сразу открывает EXECUTE + рипост-бонус.
Босс: postureMax в 2.5×, во 2-й фазе реген медленнее (фаза-гейт).

| Параметр | Knight | Bandit | Skeleton | Boss |
|---|---|---|---|---|
| postureMax | 100 | 60 | 80 | 250 |
| gainPerHit (sword light) | 8 | 6 | 7 | 10 |
| gainMult blocked/parried | 1.5 | 1.5 | 1.5 | 1.5 |
| gainMult heavy | 1.4 | 1.4 | 1.4 | 1.4 |
| regen /s (вне боя) | 14 | 18 | 12 | 8 |
| breakStagger | 2.2 s | 1.6 s | 1.8 s | 2.0 s |

UI: тонкая полоса **над именем** врага (`ui.js`), жёлтая→красная, пустая когда
в регене. Босс — другой цвет (багровый). Полоса = читаемость войны стамин (твоя
спека: «постура над головой»).

`enemy.js` — инициализировать `this.posture=0`; в `takeHit` после урона
`this.posture = min(max, this.posture + gain(dmg,w,heavy,blocked))`; в FSM-апдейте
реген; при пороге `postureBreak()`. `main.js` резолв удара: если `res.postureBroke`
→ `UI.postureBreak(enemy)`, `game.slowmo` мягкий (не ломать темп: 0.45/0.2s).

---

## 3. KICK 2.0 + WALL SPLAT

Кик уже ломает блок (`player.js:259`). Добавляем wall-splat: если при попадании
камня он в `wallSplatDist` от стены (переиспользуем `level.js` wall raycast), —
бонусный stagger + урон + спец-VFX, читаемая «прикладка к стене».

| Параметр | Значение | В панели |
|---|---|---|
| kickCost / range / dmg / stagger | 15 / 1.8 / 6 / 1.1 (как сейчас) | combat |
| wallSplatDist | 1.1 m (рейкаст от врага к ближайшей стене) | combat |
| wallSplatStagger | 2.2 s | combat |
| wallSplatDmg | +14 (сверх 6) | combat |
| wallSplatShake | 0.6 | feel |
| wallSplatVFX | костяной/каменный crunch + dust + screen blood | — |

Логика: в `applyKick` (player.js) после `enemy.takeHit` проверить
`level.wallDistance(enemy.pos) < wallSplatDist` → `enemy.postureBreak()`-подобный
стан + `audio.kick()` уже есть, добавить `audio.wallSplat()` (свист+грух),
`game.shake = 0.6`, `UI.notify('WALL SPLAT!')`.

---

## 4. SIDESTEP с I-FRAMES (честный ответ на красные атаки босса)

Новый инпут — двойной тап A/D (или посвящённая клавиша, напр. **Space/C**).
Быстрый латеральный/назад рывок с коротким окном неуязвимости. Это «честный»
ответ на unparryable red-flash тяжёлые босса (сейчас от них только guard-break).

| Параметр | Значение | В панели |
|---|---|---|
| dodgeKey | double-tap A/D ИЛИ C (назад) | — |
| dodgeCost | 12 стамины | combat |
| dodgeIframeT | 0.20 s (неуязвимость) | combat |
| dodgeCd | 0.5 s | combat |
| dodgeDist | 3.2 m | combat |
| dodgeT | 0.28 s (длительность рывка) | combat |
| dodgeSpeed | dodgeDist/dodgeT | (производный) |
| i-frame VFX | лёгкий motion-blur след + шёпот свиста | — |

`player.js` — состояние `dodgeT`, флаг `invuln` (true пока `dodgeT >
dodgeT-iframeT`). `main.js:damagePlayer` — если `p.invuln` → `return` (поглощён
без урона, без парри/блока). Во время dodge движение перезаписывает WASD на
направление рывка. Спринт-стамина не тратится.

---

## 5. FLOW COMBO (потоковая резьба за чередование направлений)

Текущий комбо `_comboSide()` уже чередует slashL/slashR по стадии. Добавляем
счётчик `flow`: каждый light-удар, чьё направление **отличается** от предыдущего
(чередование L/R/overhead/stab), инкрементит flow; повтор того же направления или
heavy — сбрасывает. Flow даёт множитель урона + маленький метр в HUD.

| Параметр | Значение | В панели |
|---|---|---|
| flowStep | +0.12 за уровень flow | combat |
| flowMax | 4 (множитель до ×1.48) | combat |
| flowDecay | сброс если idle > comboReset (1.0s) | combat |
| flow VFX | микро-искра на каждом alternated-ударе, HUD-метр | feel/ui |

`combat.js` — `flowMult(stage)`; `player.js` — хранить `combo.lastDir`, в
`endAttack` считать flow; `main.js:347` — `mult *= flowMult(p.combo.flow)` для
light-ударов (heavy не получают flow-бонус, но могут его сбросить). HUD: тонкий
метр слева внизу (`ui.js`), 4 сегмента.

---

## ИНТЕГРАЦИОННЫЕ ПРИМЕЧАНИЯ (найдено при чтении main.js/ui.js/enemy.js ДО сборки)

- `UI` — namespace-импорт (`UI.notify`), НЕ привязан к `game.ui`. `game.ui`
  нигде не задаётся. => в `main.js` добавить `game.ui = UI;` и поправить вызовы
  `this.game.ui.*` (из Front 2) на `UI.*`, ИЛИ задать `game.ui = UI` до старта.
  Интегратор решает: проще всего в `main.js` написать `game.ui = UI;` один раз
  после `UI.initUI(game)` — тогда чужие вызовы `this.game.ui.notify` заработают.
- `game.audio` — есть (создаётся в main, дёргается как `game.audio.*`).
  `audio.rewardSting/wallSplat` (Front 3) будут доступны как `game.audio.*`.
- `enemy.pos` — `THREE.Vector3` (строка 234 enemy.js). Wall-splat/Kick зовёт
  `level.wallDistance(enemy.pos)`.
- `ui.js` НЕ импортирует three/camera и не проецирует — проекцию делает
  `main.js`. => контракт `UI.postureBar(enemy, sx, sy)` меняем: интегратор в
  `tick()` проецирует голову врага (`enemy.pos + (0,2,0)`) и передаёт экранные
  x/y; `UI.postureBar` ТОЛЬКО рисует полосу. `UI.flowMeter(flow)` — без проекции.

## API-КОНТРАКТЫ (чтобы файлы не конфликтовали при сборке роем)

- **combat.js** (чистые правила, headless-тесты):
  `isPerfectParry()`, `postureGain(dmg,w,heavy,blocked)`, `flowMult(flow)`,
  константы `PERFECT_PARRY_WINDOW`, `POSTURE_*`, `FLOW_*`.
- **config.js** (CFG-лист): `combat.perfectParryWindow`, `combat.wallSplat*`,
  `combat.dodge*`, `combat.flow*`, `enemies.<type>.postureMax/postureGain/
  postureRegen/postureBreakStagger`.
- **player.js**: состояние `dodgeT/invuln/flow/lastDir`, метод `dodge()`,
  расширить `kick()` wall-splat, `parryJolt` уже есть.
- **enemy.js**: поля `posture`, `postureBroke`, реген в FSM, `postureBreak()`.
- **main.js**: резолв `outcome==='perfect'`, wall-splat после кика,
  `p.invuln` в `damagePlayer`, `flowMult` в `mult`, posture-брейк событие.
- **ui.js**: posture-бар над врагом, flow-метр HUD, попапы PERFECT PARRY /
  WALL SPLAT / POSTURE BREAK.
- **audio.js**: `rewardSting()`, `wallSplat()`, усилить `kick()`.
- **level.js**: экспортировать `wallDistance(pos)` (обёртка над существующим
  wall raycast).
- **panel.js**: авто-UI под новые CFG-ключи (уже генерит из CFG — проверить
  попадание 5 новых групп).

## ГЕЙТЫ (smoke + panel-check + mp)

- `smoke.mjs`: +тесты perfect-parry (blockElapsed 0.05 → perfect; 0.15 → parry;
  0.20 → hit), posture-break (серия ударов → postureBroke=true → execute opens),
  dodge i-frame (урон во время invuln = 0), wall-splat (враг у стены + кик →
  wallSplatStagger), flow (череда L/R/L → flowMult>1, повтор → reset).
- `panel-check.mjs`: новые CFG-ключи (≥ ~22 слайдера) появились в панели.
- `mp-test.mjs`: без регресса (posture/flow/dodge — клиент-локальны, не ломают
  снэпшот).

## ПРАВИЛО ТЕМПА (не нарушаем)

- Slow-mo НОВЫЙ только на: perfect-parry (редко), posture-break босса (редко).
  Обычный парри/кик/комбо — без слоумо (темп The Finals).
- Тряска — только от массы удара (как в Batch 1), wall-splat — выше среднего,
  но не постоянно.
- i-frame не делают игру бесшовной: cd 0.5s + стамина 12 → риск-ре wards.
