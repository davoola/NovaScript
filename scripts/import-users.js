import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { DB_PATH, initDbConnection, closeDbConnection, isUsersTableEmpty } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 用户数据文件
const USERS_FILE = join(__dirname, '..', 'data', 'users.json');

/**
 * 从JSON文件导入用户数据到数据库
 */
async function importUsers() {
  try {
    console.log('检查是否需要导入用户数据...');
    
    // 初始化数据库连接
    await initDbConnection();
    
    // 检查用户表是否为空
    const isEmpty = await isUsersTableEmpty();
    if (!isEmpty) {
      console.log('用户表不为空，无需导入数据');
      return true;
    }
    
    console.log('用户表为空，开始导入用户数据...');
    
    // 打开数据库连接
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    // 读取用户数据
    console.log('读取用户数据文件:', USERS_FILE);
    const usersContent = await fs.readFile(USERS_FILE, 'utf8');
    const usersData = JSON.parse(usersContent);
    
    if (!usersData.users || !Array.isArray(usersData.users)) {
      console.error('无效的用户数据格式');
      return false;
    }
    
    console.log(`准备导入 ${usersData.users.length} 个用户记录...`);
    
    // 使用事务确保数据一致性
    await db.exec('BEGIN TRANSACTION');
    
    try {
      // 准备插入用户的语句
      const insertUserStmt = await db.prepare(`
        INSERT INTO users (
          id, username, nickname, password, avatar_url, role, 
          created_at, last_login_at, status, last_status_change
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      // 准备插入好友关系的语句
      const insertFriendshipStmt = await db.prepare(`
        INSERT INTO friendships (user_id, friend_id, created_at)
        VALUES (?, ?, ?)
      `);
      
      // 插入用户数据
      for (const user of usersData.users) {
        await insertUserStmt.run(
          user.id,
          user.username,
          user.nickname,
          user.password,
          user.avatarUrl || user.avatar_url,
          user.role,
          user.createdAt || new Date().toISOString(),
          user.lastLoginAt || null,
          user.status || 'offline',
          user.lastStatusChange || null
        );
        
        // 插入好友关系
        if (user.friends && Array.isArray(user.friends)) {
          for (const friendId of user.friends) {
            await insertFriendshipStmt.run(
              user.id,
              friendId,
              user.createdAt || new Date().toISOString()
            );
          }
        }
      }
      
      // 提交事务
      await db.exec('COMMIT');
      
      // 关闭准备好的语句
      await insertUserStmt.finalize();
      await insertFriendshipStmt.finalize();
      
      console.log('用户数据导入完成');
      
      // 关闭数据库连接
      await db.close();
      return true;
    } catch (error) {
      // 如果出错，回滚事务
      await db.exec('ROLLBACK');
      console.error('用户数据导入失败:', error);
      await db.close();
      return false;
    }
  } catch (error) {
    console.error('导入过程中发生错误:', error);
    return false;
  }
}

// 如果直接运行此脚本
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importUsers()
    .then(success => {
      if (success) {
        console.log('用户数据导入过程完成');
      } else {
        console.error('用户数据导入失败');
      }
      process.exit(success ? 0 : 1);
    });
}

export { importUsers }; 