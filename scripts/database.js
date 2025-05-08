import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 数据库文件路径
const DB_PATH = path.join(__dirname, '..', 'data', 'db', 'chatapp.sqlite');

// 数据库连接实例
let db = null;

/**
 * 初始化数据库连接
 */
async function initDbConnection() {
  if (db) return db;
  
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  
  return db;
}

/**
 * 关闭数据库连接
 */
async function closeDbConnection() {
  if (db) {
    await db.close();
    db = null;
  }
}

/**
 * 检查用户表是否为空
 */
async function isUsersTableEmpty() {
  const db = await initDbConnection();
  const result = await db.get('SELECT COUNT(*) as count FROM users');
  return result.count === 0;
}

/**
 * 用户相关操作
 */
const userService = {
  /**
   * 获取所有用户
   */
  async getAllUsers() {
    const db = await initDbConnection();
    return db.all('SELECT * FROM users');
  },
  
  /**
   * 根据ID获取用户
   */
  async getUserById(userId) {
    const db = await initDbConnection();
    return db.get('SELECT * FROM users WHERE id = ?', userId);
  },
  
  /**
   * 根据用户名获取用户
   */
  async getUserByUsername(username) {
    const db = await initDbConnection();
    return db.get('SELECT * FROM users WHERE username = ?', username);
  },
  
  /**
   * 添加新用户
   */
  async addUser(userData) {
    const db = await initDbConnection();
    
    // 确保使用正确的字段名称
    const avatarUrl = userData.avatar_url || userData.avatarUrl || '/images/avatars/default.png';
    
    const result = await db.run(`
      INSERT INTO users (
        id, username, nickname, password, avatar_url, role, 
        created_at, last_login_at, status, last_status_change
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 
    userData.id,
    userData.username,
    userData.nickname || userData.username,
    userData.password,
    avatarUrl,
    userData.role || 'user',
    userData.createdAt,
    userData.lastLoginAt || null,
    userData.status || 'offline',
    userData.lastStatusChange || null
    );
    
    return result;
  },
  
  /**
   * 更新用户密码
   */
  async updateUserPassword(userId, newPassword) {
    const db = await initDbConnection();
    
    await db.run(
      'UPDATE users SET password = ? WHERE id = ?',
      newPassword, userId
    );
  },
  
  /**
   * 更新用户状态
   */
  async updateUserStatus(userId, status) {
    const db = await initDbConnection();
    const lastStatusChange = new Date().toISOString();
    
    await db.run(
      'UPDATE users SET status = ?, last_status_change = ? WHERE id = ?',
      status, lastStatusChange, userId
    );
    
    return this.getUserById(userId);
  },
  
  /**
   * 更新用户最后登录时间
   */
  async updateLastLogin(userId) {
    const db = await initDbConnection();
    const lastLoginAt = new Date().toISOString();
    
    await db.run(
      'UPDATE users SET last_login_at = ? WHERE id = ?',
      lastLoginAt, userId
    );
  },
  
  /**
   * 获取用户的好友列表
   */
  async getUserFriends(userId) {
    const db = await initDbConnection();
    
    return db.all(`
      SELECT u.* FROM users u
      JOIN friendships f ON u.id = f.friend_id
      WHERE f.user_id = ?
    `, userId);
  },
  
  /**
   * 添加好友关系
   */
  async addFriend(userId, friendId) {
    const db = await initDbConnection();
    const createdAt = new Date().toISOString();
    
    await db.run(
      'INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
      userId, friendId, createdAt
    );
    
    await db.run(
      'INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
      friendId, userId, createdAt
    );
  },
  
  /**
   * 检查好友关系是否存在
   */
  async checkFriendship(userId, friendId) {
    const db = await initDbConnection();
    
    const result = await db.get(
      'SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?',
      userId, friendId
    );
    
    return !!result;
  }
};

/**
 * 消息相关操作
 */
const messageService = {
  /**
   * 保存新消息
   */
  async saveMessage(message) {
    const db = await initDbConnection();
    
    await db.run(`
      INSERT INTO messages (
        id, chat_id, sender_id, content, message_type, 
        file_name, file_size, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, 
    message.id, 
    message.chatId, 
    message.sender, 
    message.content, 
    message.type, 
    message.fileName, 
    message.fileSize, 
    message.timestamp
    );
    
    return message;
  },
  
  /**
   * 获取最近的消息
   */
  async getRecentMessages(chatId, limit = 50) {
    const db = await initDbConnection();
    
    return db.all(`
      SELECT * FROM messages 
      WHERE chat_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `, chatId, limit);
  },
  
  /**
   * 获取指定消息ID之前的消息
   */
  async getMessagesBefore(chatId, beforeMessageId, limit = 30) {
    const db = await initDbConnection();
    
    // 先获取参考消息的时间戳
    const refMessage = await db.get(
      'SELECT timestamp FROM messages WHERE id = ? AND chat_id = ?',
      beforeMessageId, chatId
    );
    
    if (!refMessage) {
      return [];
    }
    
    // 然后获取该时间戳之前的消息
    return db.all(`
      SELECT * FROM messages 
      WHERE chat_id = ? AND timestamp < ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `, chatId, refMessage.timestamp, limit);
  },
  
  /**
   * 根据ID获取消息
   */
  async getMessageById(messageId) {
    const db = await initDbConnection();
    
    return db.get(
      'SELECT * FROM messages WHERE id = ?',
      messageId
    );
  },
  
  /**
   * 获取两个用户之间的聊天ID
   */
  getChatId(user1Id, user2Id) {
    return [user1Id, user2Id].sort().join('_');
  }
};

export { 
  initDbConnection, 
  closeDbConnection, 
  isUsersTableEmpty,
  userService, 
  messageService,
  DB_PATH
}; 