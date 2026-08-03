// partnames.js — Synty modular part-name grammar, shared by the character
// creator, the hero model, the parts-index build tool and the smoke test.
// PURE LOGIC (no three.js, no DOM) — safe to import from Node and the browser.
//
// Part names look like:
//   Chr_Head_Male_19            Chr_Head_No_Elements_Female_03
//   Chr_Eyebrow_Female_02       Chr_FacialHair_Male_13
//   Chr_ArmUpperLeft_Male_06    Chr_ShoulderAttachRight_14
//   Chr_Hair_31                 Chr_HeadCoverings_No_Hair_09
//   Chr_BackAttachment_04       Chr_HipsAttachment_05
//
// Slots: a "single" slot owns one part name (head, torso, ...), a "paired"
// slot owns a Left + Right name that cycle together (arms, hands, legs,
// shoulder/elbow/knee attachments). Optional slots may be NONE.

// Legacy alias seen in presets.json: Chr_Female_Eyebrow_XX (does not exist in
// the FBX catalog; the real meshes are Chr_Eyebrow_Female_XX).
export function normalizePartName(name) {
  if (typeof name !== 'string') return name;
  const m = name.match(/^Chr_(Male|Female)_Eyebrow_(\d+)$/);
  if (m) return `Chr_Eyebrow_${m[1]}_${m[2]}`;
  return name;
}

// Order matters: the first matching def wins.
export const SLOT_DEFS = [
  { key: 'head', label: 'HEAD', gendered: true, pair: false, optional: false,
    match: /^Chr_Head_(?:No_Elements_)?(Male|Female)_(\d+)$/ },
  { key: 'eyebrow', label: 'EYEBROWS', gendered: true, pair: false, optional: false,
    match: /^Chr_Eyebrow_(Male|Female)_(\d+)$/ },
  { key: 'hair', label: 'HAIR', gendered: false, pair: false, optional: true,
    match: /^Chr_Hair_(\d+)$/ },
  { key: 'headCovering', label: 'HEAD COVERING', gendered: false, pair: false, optional: true,
    match: /^Chr_HeadCoverings_(No_Hair|No_FacialHair|Base_Hair)_(\d+)$/ },
  { key: 'facialHair', label: 'FACIAL HAIR', gendered: true, pair: false, optional: true,
    match: /^Chr_FacialHair_(Male|Female)_(\d+)$/ },
  { key: 'torso', label: 'TORSO', gendered: true, pair: false, optional: false,
    match: /^Chr_Torso_(Male|Female)_(\d+)$/ },
  { key: 'armUpper', label: 'UPPER ARMS', gendered: true, pair: true, optional: false,
    left: 'Chr_ArmUpperLeft_', right: 'Chr_ArmUpperRight_',
    match: /^Chr_ArmUpper(Left|Right)_(Male|Female)_(\d+)$/ },
  { key: 'armLower', label: 'LOWER ARMS', gendered: true, pair: true, optional: false,
    left: 'Chr_ArmLowerLeft_', right: 'Chr_ArmLowerRight_',
    match: /^Chr_ArmLower(Left|Right)_(Male|Female)_(\d+)$/ },
  { key: 'hand', label: 'HANDS', gendered: true, pair: true, optional: false,
    left: 'Chr_HandLeft_', right: 'Chr_HandRight_',
    match: /^Chr_Hand(Left|Right)_(Male|Female)_(\d+)$/ },
  { key: 'hips', label: 'HIPS', gendered: true, pair: false, optional: false,
    match: /^Chr_Hips_(Male|Female)_(\d+)$/ },
  { key: 'hipsAttachment', label: 'HIP ATTACHMENT', gendered: false, pair: false, optional: true,
    match: /^Chr_HipsAttachment_(\d+)$/ },
  { key: 'leg', label: 'LEGS', gendered: true, pair: true, optional: false,
    left: 'Chr_LegLeft_', right: 'Chr_LegRight_',
    match: /^Chr_Leg(Left|Right)_(Male|Female)_(\d+)$/ },
  { key: 'shoulder', label: 'SHOULDERS', gendered: false, pair: true, optional: true,
    left: 'Chr_ShoulderAttachLeft_', right: 'Chr_ShoulderAttachRight_',
    match: /^Chr_ShoulderAttach(Left|Right)_(\d+)$/ },
  { key: 'elbow', label: 'ELBOWS', gendered: false, pair: true, optional: true,
    left: 'Chr_ElbowAttachLeft_', right: 'Chr_ElbowAttachRight_',
    match: /^Chr_ElbowAttach(Left|Right)_(\d+)$/ },
  { key: 'knee', label: 'KNEES', gendered: false, pair: true, optional: true,
    left: 'Chr_KneeAttachLeft_', right: 'Chr_KneeAttachRight_',
    match: /^Chr_KneeAttach(Left|Right)_(\d+)$/ },
  { key: 'back', label: 'BACK', gendered: false, pair: false, optional: true,
    match: /^Chr_BackAttachment_(\d+)$/ },
];

export function slotDef(key) {
  return SLOT_DEFS.find((s) => s.key === key) || null;
}

// Classify a part name -> { slot, side, gender, nn, variant } or null.
//   side: 'Left' | 'Right' | null (paired slots)
//   gender: 'Male' | 'Female' | null
//   nn: the trailing number string ('06')
//   variant: sub-family for head/headCovering ('No_Elements', 'No_Hair', ...)
export function classifyPart(rawName) {
  const name = normalizePartName(rawName);
  if (typeof name !== 'string') return null;
  for (const def of SLOT_DEFS) {
    const m = name.match(def.match);
    if (!m) continue;
    let side = null, gender = null, nn = null, variant = null;
    if (def.pair) {
      if (def.gendered) { [, side, gender, nn] = m; }
      else { [, side, nn] = m; }
    } else if (def.gendered) {
      [, gender, nn] = m;
      if (def.key === 'head' && /No_Elements/.test(name)) variant = 'No_Elements';
    } else {
      if (def.key === 'headCovering') { [, variant, nn] = m; }
      else { [, nn] = m; }
    }
    return { slot: def.key, side, gender, nn, variant, name };
  }
  return null;
}

// Build the full part name(s) for a slot option.
// For single slots the option IS the full name; for paired slots the option
// is the bare nn and names are left/right prefix (+ gender when gendered).
export function buildSlotNames(def, option, gender) {
  if (option == null) return [];
  if (!def.pair) return [option];
  const mid = def.gendered ? `${gender}_` : '';
  return [`${def.left}${mid}${option}`, `${def.right}${mid}${option}`];
}
