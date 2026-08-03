import os, shutil, sys

src = sys.argv[1]
out = sys.argv[2]
count = 0
for guid in os.listdir(src):
    d = os.path.join(src, guid)
    pn = os.path.join(d, 'pathname')
    af = os.path.join(d, 'asset')
    if not os.path.isfile(pn):
        continue
    with open(pn, encoding='utf-8', errors='replace') as f:
        path = f.read().strip().split('\n')[0]
    if not os.path.isfile(af):
        continue
    dst = os.path.join(out, path)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(af, dst)
    count += 1
print('rebuilt files:', count)
