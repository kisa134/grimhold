import os, shutil

SRC = 'mfh_tree/Assets/Synty/PolygonFantasyHeroCharacters/Models/ModularCharacter_StaticParts'
DST = '../public/assets/parts'
os.makedirs(DST, exist_ok=True)

# categories we use; male variants + genderless attachments
KEEP_PREFIXES = (
    'Chr_Head_Male_', 'Chr_Head_No_Elements_Male_',
    'Chr_Torso_Male_', 'Chr_Hips_Male_',
    'Chr_ArmUpperLeft_Male_', 'Chr_ArmUpperRight_Male_',
    'Chr_ArmLowerLeft_Male_', 'Chr_ArmLowerRight_Male_',
    'Chr_HandLeft_Male_', 'Chr_HandRight_Male_',
    'Chr_LegLeft_Male_', 'Chr_LegRight_Male_',
    'Chr_Eyebrow_Male_',
    'Chr_HeadCoverings_No_Hair_', 'Chr_HeadCoverings_No_FacialHair_',
    'Chr_ShoulderAttachLeft_', 'Chr_ShoulderAttachRight_',
    'Chr_HelmetAttachment_',
)

n = 0
total = 0
for f in sorted(os.listdir(SRC)):
    if not f.endswith('.fbx'):
        continue
    if f.startswith(KEEP_PREFIXES):
        shutil.copy2(os.path.join(SRC, f), os.path.join(DST, f))
        n += 1
        total += os.path.getsize(os.path.join(DST, f))
print('copied:', n, 'files,', round(total / 1048576, 1), 'MB')
