with open('server/sourceImports.js', 'r') as f:
    content = f.read()

content = content.replace(
    "const FEISHU_SNAPSHOTS_TABLE_ID = 'tblKIte5bOq24B5q'",
    "const FEISHU_SNAPSHOTS_TABLE_ID = 'tblKIte5bOq24B5q'\nconst FEISHU_EXPERIENCES_TABLE_ID = 'tblwWEYbWbV3WGlH'"
)

with open('server/sourceImports.js', 'w') as f:
    f.write(content)

