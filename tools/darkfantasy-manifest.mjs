// darkfantasy-manifest.mjs — the single source of truth for which files the
// GRIMHOLD labyrinth-castle map uses from the POLYGON Dark Fantasy source zip.
// Consumed by tools/extract-darkfantasy.mjs (zip -> public/assets/darkfantasy)
// and tools/probe-dims.mjs (measure module bounding boxes).
//
// Paths are zip-internal (under SourceFiles/). Files are extracted FLAT into
// public/assets/darkfantasy/ — every basename here must stay unique.

export const ZIP_PATH = 'C:/Users/HYPERPC/Documents/MYGAME/POLYGON_Dark_Fantasy_SourceFiles_v3.zip';
export const DEST_DIR = 'public/assets/darkfantasy';

// ---- geometry modules (FBX) -------------------------------------------------
export const MODULES = [
  // Base modular kit (walls / pillars / floors / ceilings / stairs / doors)
  'FBX/Buildings/Base/SM_Bld_Base_Wall_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Wall_Half_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Wall_Door_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Wall_Window_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Pillar_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Pillar_02.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Floor_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Ceiling_01.fbx',
  'FBX/Buildings/Base/SM_Bld_Base_Stairs_01.fbx',

  // Hero building pieces (ruins for the bailey, archways, tall windows)
  'FBX/Buildings/SM_Bld_Wall_Ruin_01.fbx',
  'FBX/Buildings/SM_Bld_Wall_Ruin_02.fbx',
  'FBX/Buildings/SM_Bld_Wall_Ruin_03.fbx',
  'FBX/Buildings/SM_Bld_Wall_Archway_01.fbx',
  'FBX/Buildings/SM_Bld_Wall_Window_Tall_01.fbx',
  'FBX/Buildings/SM_Bld_Wall_Window_01.fbx',
  'FBX/Buildings/SM_Bld_Gates_Cemetary_01.fbx',

  // Environment dressing
  'FBX/Environment/SM_Env_Rock_01.fbx',
  'FBX/Environment/SM_Env_Rock_02.fbx',
  'FBX/Environment/SM_Env_Rocks_Small_01.fbx',
  'FBX/Environment/SM_Env_Tree_Dead_01.fbx',
  'FBX/Environment/SM_Env_Tree_Dead_02.fbx',

  // Props — light sources
  'FBX/Props/SM_Prop_Torch_01.fbx',
  'FBX/Props/SM_Prop_Torch_02.fbx',
  'FBX/Props/SM_Prop_Brazier_01.fbx',
  'FBX/Props/SM_Prop_Fire_Pit_01.fbx',
  'FBX/Props/SM_Prop_Candle_01.fbx',
  'FBX/Props/SM_Prop_Candle_Blob_01.fbx',
  'FBX/Props/SM_Prop_Candelabra_01.fbx',

  // Props — loot & ritual
  'FBX/Props/SM_Prop_Chest_01.fbx',
  'FBX/Props/SM_Prop_Altar_Table_01.fbx',
  'FBX/Props/SM_Prop_Ritual_Circle_01.fbx',
  'FBX/Props/SM_Prop_Tabernacle_01.fbx',

  // Props — gothic dressing
  'FBX/Props/SM_Prop_Statue_01.fbx',
  'FBX/Props/SM_Prop_Statue_02.fbx',
  'FBX/Props/SM_Prop_Gargoyle_01.fbx',
  'FBX/Props/SM_Prop_Gallows_01.fbx',
  'FBX/Props/SM_Prop_Gibbet_01.fbx',
  'FBX/Props/SM_Prop_Well_01.fbx',
  'FBX/Props/SM_Prop_Barrel_01.fbx',
  'FBX/Props/SM_Prop_Crate_01.fbx',
  'FBX/Props/SM_Prop_Barricade_01.fbx',
  'FBX/Props/SM_Prop_Skull_Pile_01.fbx',
  'FBX/Props/SM_Prop_Bone_Pile_01.fbx',
  'FBX/Props/SM_Prop_Body_Skeleton_01.fbx',
  'FBX/Props/SM_Prop_Tomb_01.fbx',
  'FBX/Props/SM_Prop_Tomb_Stone_01.fbx',
  'FBX/Props/SM_Prop_Cage_Large_01.fbx',
  'FBX/Props/SM_Prop_Pew_01.fbx',
  'FBX/Props/SM_Prop_Rack_Weapon_01.fbx',
  'FBX/Props/SM_Prop_Table_01.fbx',
  'FBX/Props/SM_Prop_Chair_01.fbx',
  'FBX/Props/SM_Prop_Bookshelf_01.fbx',
  'FBX/Props/SM_Prop_Flag_Dark_01.fbx',
];

// ---- textures ---------------------------------------------------------------
export const TEXTURES = [
  'Textures/Alts/PolygonDarkFantasy_Texture_01_A.png',     // main color atlas
  'Textures/Emissive/PolygonDarkFantasy_Emissive_01_A.png', // emissive (flames, windows)
];

export const ALL_FILES = [...MODULES, ...TEXTURES];
