# AIGC Canvas — Claude 工作规范

## 每次 git push 前必须执行安全检查

**不得跳过，不得省略任何一项。**

### 检查命令（按顺序执行）

```bash
# 1. 密钥扫描（预期：只有正常变量引用，无真实 key 值）
grep -rn "sk-\|api_key\|secret\|password" \
  --include="*.js" --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude="package-lock.json" \
  | grep -v "process\.env\|localStorage\|\.example\|changeme\|your-\|bcrypt\|hash\|Bearer"

# 2. .env 未入 git（预期：无输出）
git ls-files | grep "\.env$"

# 3. 所有 API 路由有认证（预期：无输出，/health 和 auth 路由已豁免）
grep -n "app\.\(get\|post\|put\|delete\)" backend/index.js \
  | grep -v "authMiddleware\|health\|/api/auth\|/api/admin"

# 4. 前端 build 无密钥（预期：无输出）
cd frontend && npm run build
grep -r "sk-\|DASHSCOPE\|JWT_SECRET\|ADMIN_SECRET" dist/

# 5. 管理接口鉴权（预期：返回 {"error":"无权限"}）
curl -s -X GET http://localhost:3001/api/admin/users
```

### 判断标准

| 检查项 | 通过条件 |
|--------|----------|
| 密钥扫描 | 无真实 `sk-xxx` 等 key 值，只有正常变量名 |
| .env 入 git | **无输出** |
| 路由认证 | **无输出**（所有路由均有 authMiddleware）|
| 前端 build 密钥 | **无输出** |
| 管理接口 | 返回 `{"error":"无权限"}` |

**任何一项不通过，禁止 push，先修复。**

---

## 每次改动后必须

1. 更新 `README.md` 中对应的功能描述 / API 文档 / Changelog
2. 执行上方安全检查（全部 5 项）
3. 提交并推送

## Commit 格式

```
feat: 新功能
fix: 问题修复
refactor: 重构
docs: 文档更新
chore: 依赖/配置更新
```
