#!/bin/sh
set -e

# 复制用户文件（如果还不存在）
if [ -f /app/data/users.json ]; then
  echo "Users file already exists, skipping copy."
else
  echo "No users file found, please make sure you have mounted it correctly."
  exit 1
fi

# 导入用户到SQLite数据库
if [ -f /app/scripts/import-users.js ]; then
  echo "Importing users to database..."
  node /app/scripts/import-users.js
  echo "Users imported successfully."
else
  echo "Import script not found. Skipping user import."
fi

# 执行CMD命令
exec "$@" 