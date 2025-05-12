import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { marked } from 'marked';
import path from 'path';
import { markedEmoji } from 'marked-emoji';
import emojiToolkit from 'emoji-toolkit';
import NodeCache from 'node-cache';
// 导入数据库服务
import { initDbConnection, closeDbConnection, userService, messageService, isUsersTableEmpty } from './scripts/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// JWT Secret
const JWT_SECRET = 'your-secret-key';

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize users data
// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    fs.mkdir(uploadDir, { recursive: true })
      .then(() => cb(null, uploadDir))
      .catch(err => cb(err));
  },
  filename: function (req, file, cb) {
    // 解码原始文件名
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(originalName));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 限制500MB
  }
});

// 配置 Marked
const renderer = new marked.Renderer();

// 自定义表格渲染器以支持对齐
renderer.table = function(header, body) {
  try {
    // 确保header和body是字符串
    const headerStr = header ? header.toString() : '';
    const bodyStr = body ? body.toString() : '';
    
    // console.log("Table header:", header);
    // console.log("Table body:", body);
    
    return '<div class="table-wrapper"><table class="markdown-table">' 
      + headerStr
      + bodyStr
      + '</table></div>';
  } catch (err) {
    console.error("表格渲染错误:", err);
    return '<div class="error">表格渲染错误</div>';
  }
};

renderer.tablecell = function(content, flags) {
  try {
    // 确保content是字符串
    const contentStr = content ? content.toString() : '';
    
    // 确保flags是一个对象
    flags = flags || {};
    let align = flags.align || '';
    let tag = flags.header ? 'th' : 'td';
    let className = '';
    
    if (align === 'center') {
      className = ' class="text-center"';
    } else if (align === 'right') {
      className = ' class="text-right"';
    } else if (align === 'left') {
      className = ' class="text-left"';
    }
    
    return '<' + tag + className + '>' + contentStr + '</' + tag + '>';
  } catch (err) {
    console.error("表格单元格渲染错误:", err);
    return '<td>错误</td>';
  }
};

// 配置Emoji选项
const emojiOptions = {
  emojis: {
    ':smile:': '😊',
    ':laughing:': '😆',
    ':blush:': '😊',
    ':smiley:': '😃',
    ':relaxed:': '☺️',
    ':heart:': '❤️',
    ':thumbsup:': '👍',
    ':thumbsdown:': '👎',
    ':+1:': '👍',
    ':-1:': '👎',
    ':eyes:': '👀',
    ':sob:': '😭',
    ':joy:': '😂',
    ':clap:': '👏',
    ':fire:': '🔥',
    ':rocket:': '🚀',
    ':warning:': '⚠️',
    ':star:': '⭐',
    ':sparkles:': '✨',
    ':zap:': '⚡',
    ':question:': '❓',
    ':exclamation:': '❗',
    ':check:': '✅',
    ':x:': '❌'
  }
};

marked.setOptions({
  gfm: true,
  breaks: true,
  mangle: false,
  headerIds: true,
  langPrefix: 'language-',
  highlight: function(code, lang) {
    return require('highlight.js').highlightAuto(code).value;
  },
  renderer: renderer,
  extensions: [
    markedEmoji(emojiOptions)
  ]
});

// 初始化数据库连接
await initDbConnection();

// 在应用退出时关闭数据库连接
process.on('SIGINT', async () => {
  console.log('Closing database connection before exit...');
  await closeDbConnection();
  process.exit(0);
});

async function initializeDataDirectory() {
  try {
    // 创建主数据目录
    await fs.mkdir('data', { recursive: true });
    
    // 确保数据库目录存在
    await fs.mkdir('data/db', { recursive: true });
    
  } catch (error) {
    console.error('Error initializing data directory:', error);
  }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// 在线用户映射
const onlineUsers = new Map();
// 用户会话映射
const userSessions = new Map();

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication required'));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error('Invalid token'));
    }
    socket.user = decoded;
    next();
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log('User connected:', socket.user.username);
  
  // 管理用户会话
  if (!userSessions.has(userId)) {
    userSessions.set(userId, new Set());
  }
  userSessions.get(userId).add(socket.id);

  // 更新用户状态为在线
  updateUserStatus(userId, 'online');
  onlineUsers.set(userId, socket);
  broadcastUserStatus(userId);

  socket.on('disconnect', async () => {
    console.log('Socket disconnected:', socket.user.username);
    
    const sessions = userSessions.get(userId);
    if (sessions) {
      sessions.delete(socket.id);
      
      if (sessions.size === 0) {
        userSessions.delete(userId);
        onlineUsers.delete(userId);
        await updateUserStatus(userId, 'offline');
        broadcastUserStatus(userId);
      }
    }
  });

  // 加入私人聊天室
  socket.on('join chat', async (targetUserId) => {
    const chatId = getChatId(socket.user.id, targetUserId);
    socket.join(chatId);
    
    // 使用新的分片加载系统加载最近的80条消息
    try {
      const messages = await loadRecentMessages(chatId, 80);
      socket.emit('chat history', { 
        messages,
        hasMore: messages.length > 0 ? true : false,
        firstMessageId: messages.length > 0 ? messages[0].id : null
      });
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  });

  // 添加加载更多消息的事件处理
  socket.on('load more messages', async (data) => {
    const { targetUserId, beforeMessageId, limit = 50 } = data;
    console.log('收到加载更多消息请求:', { 
      userId: socket.user.id, 
      targetUserId, 
      beforeMessageId, 
      limit 
    });
    
    const chatId = getChatId(socket.user.id, targetUserId);
    console.log(`尝试为聊天 ${chatId} 加载更多消息，起始消息ID: ${beforeMessageId}`);
    
    try {
      // 加载指定消息之前的历史记录
      const messages = await loadMessagesBeforeId(chatId, beforeMessageId, limit);
      console.log(`已为聊天 ${chatId} 加载 ${messages.length} 条更多消息`);
      
      socket.emit('more chat history', messages);
    } catch (error) {
      console.error('Error loading more chat history:', error);
      socket.emit('error', { message: '加载历史消息失败' });
    }
  });

  // 添加自定义的表格解析函数
  function parseMarkdownTable(content) {
    try {
      // 检查是否包含表格
      if (!content.includes('|') || !content.includes('\n')) {
        return content;
      }
      
      // 分割成行
      const lines = content.trim().split('\n');
      if (lines.length < 2) return content;
      
      let headerRow = null;
      let delimiterRow = null;
      let bodyRows = [];
      let inTable = false;
      let tableStartIndex = -1;
      let tableEndIndex = -1;
      
      // 查找表格部分
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 检查是否是分隔行 (---|---|---)
        if (line.match(/^\|?\s*:?-+:?\s*\|[\s\|:?-]*$/)) {
          if (!inTable) {
            inTable = true;
            delimiterRow = line;
            headerRow = lines[i-1].trim();
            tableStartIndex = i-1;
          }
        } 
        // 如果已经在表格中，检查这行是否还是表格的一部分
        else if (inTable) {
          if (line.includes('|')) {
            bodyRows.push(line);
          } else {
            tableEndIndex = i-1;
            break;
          }
        }
      }
      
      // 如果找到了完整的表格
      if (inTable && headerRow && delimiterRow) {
        if (tableEndIndex === -1) tableEndIndex = lines.length - 1;
        
        // 解析标题行
        const headers = parseTableRow(headerRow);
        
        // 解析分隔行，获取对齐信息
        const alignments = parseDelimiterRow(delimiterRow);
        
        // 解析数据行
        const rows = bodyRows.map(row => parseTableRow(row));
        
        // 生成HTML表格
        let tableHtml = '<div class="table-wrapper"><table class="markdown-table">\n<thead>\n<tr>\n';
        
        // 添加表头
        headers.forEach((header, index) => {
          const align = alignments[index] || 'left';
          tableHtml += `<th class="text-${align}">${header}</th>\n`;
        });
        
        tableHtml += '</tr>\n</thead>\n<tbody>\n';
        
        // 添加数据行
        rows.forEach(row => {
          tableHtml += '<tr>\n';
          row.forEach((cell, index) => {
            const align = alignments[index] || 'left';
            tableHtml += `<td class="text-${align}">${cell}</td>\n`;
          });
          tableHtml += '</tr>\n';
        });
        
        tableHtml += '</tbody>\n</table></div>';
        
        // 替换原始内容中的表格部分
        const beforeTable = lines.slice(0, tableStartIndex).join('\n');
        const afterTable = lines.slice(tableEndIndex + 1).join('\n');
        
        // 将内容分为表格前、表格、表格后三部分，只对表格部分使用自定义处理
        let result = '';
        if (beforeTable) {
          result += marked.parse(beforeTable) + '\n';
        }
        
        result += tableHtml + '\n';
        
        if (afterTable) {
          result += marked.parse(afterTable);
        }
        
        return result;
      }
      
      return marked.parse(content);
    } catch (e) {
      console.error("表格解析错误:", e);
      return marked.parse(content);
    }
  }

  // 解析表格行
  function parseTableRow(row) {
    // 移除首尾的 |
    let trimmedRow = row.trim();
    if (trimmedRow.startsWith('|')) {
      trimmedRow = trimmedRow.substring(1);
    }
    if (trimmedRow.endsWith('|')) {
      trimmedRow = trimmedRow.substring(0, trimmedRow.length - 1);
    }
    
    // 分割单元格并清理空白
    return trimmedRow.split('|').map(cell => cell.trim());
  }

  // 解析分隔行，获取对齐信息
  function parseDelimiterRow(row) {
    const cells = parseTableRow(row);
    
    return cells.map(cell => {
      const trimmed = cell.trim();
      
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
        return 'center';
      } else if (trimmed.endsWith(':')) {
        return 'right';
      } else {
        return 'left';
      }
    });
  }

  // 处理私人消息
  socket.on('private message', async (data) => {
    const { targetUserId, content, type, fileName, fileSize } = data;
    
    // 验证好友关系
    try {
      // 使用数据库验证好友关系
      const isFriend = await userService.checkFriendship(socket.user.id, targetUserId);
      
      if (!isFriend) {
        socket.emit('error', { message: '只能与好友聊天' });
        return;
      }
      
      const chatId = getChatId(socket.user.id, targetUserId);
      
      // 处理文本内容
      let processedContent = content;
      if (type === 'text') {
        // 先应用emoji转换，再处理其他Markdown
        if (content.includes(':')) {
          // 应用emoji处理
          const emojiProcessed = processEmojis(content);
          
          // 检查是否包含表格，如果有表格，使用自定义方法处理
          if (emojiProcessed.includes('|') && emojiProcessed.includes('\n')) {
            // console.log("检测到可能的表格内容");
            processedContent = parseMarkdownTable(emojiProcessed);
          } else {
            // 常规Markdown解析
            processedContent = marked.parse(emojiProcessed);
          }
        } else if (content.includes('|') && content.includes('\n')) {
          // console.log("检测到可能的表格内容");
          processedContent = parseMarkdownTable(content);
        } else {
          // 常规Markdown解析
          processedContent = marked.parse(content);
        }
      }
      
      const message = {
        id: Date.now().toString(),
        sender: socket.user.id,
        content: type === 'text' ? processedContent : content,
        type,
        fileName,
        fileSize,
        timestamp: getLocalISOString()
      };

      // 保存消息到数据库
      try {
        // 保存消息
        await saveMessage(chatId, message);
        
        // 获取发送者的用户信息，以获取头像URL
        const sender = await userService.getUserById(socket.user.id);
        
        // 添加发送者的头像信息
        if (sender && sender.avatar_url) {
          message.senderAvatar = sender.avatar_url;
        }
        
        // 发送消息给聊天室
        io.to(chatId).emit('private message', message);
      } catch (error) {
        console.error('Error saving message:', error);
        socket.emit('error', { message: '发送消息失败' });
      }
    } catch (error) {
      console.error('Error handling private message:', error);
      socket.emit('error', { message: '发送消息失败' });
    }
  });

  // Handle chat messages
  socket.on('chat message', (data) => {
    io.emit('chat message', {
      ...data,
      sender: {
        id: socket.user.id,
        username: socket.user.username
      }
    });
  });
});

// Routes
app.get('/login', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/chat', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// 添加时间转换辅助函数
function getLocalISOString() {
  const now = new Date();
  return new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString();
}

// 注册路由
app.post('/api/auth/register', async (req, res) => {
  const { username, password, email, nickname } = req.body;

  try {
    // 检查用户是否已存在
    const existingUser = await userService.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户，注意字段名与数据库一致
    const newUser = {
      id: Date.now().toString(),
      username,
      nickname: nickname || username,
      password: hashedPassword,
      avatar_url: '/images/avatars/default.png', // 使用与数据库字段一致的名称
      role: 'user',
      createdAt: new Date().toISOString(),
      status: 'offline'
    };

    // 保存到数据库
    await userService.addUser(newUser);

    res.status(201).json({ message: '注册成功' });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取用户列表（只返回好友）
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    // 从数据库获取用户的好友列表
    const friends = await userService.getUserFriends(req.user.id);
    
    if (!friends) {
      return res.status(404).json({ message: '未找到好友' });
    }

    // 对每个好友，添加在线状态信息
    const friendsWithStatus = friends.map(friend => {
      const friendData = {
        ...friend,
        status: userSessions.has(friend.id) ? 'online' : friend.status || 'offline',
        // 移除密码字段
        password: undefined
      };
      
      // 字段映射，确保与前端期望的字段名一致
      if (friendData.avatar_url) {
        friendData.avatarUrl = friendData.avatar_url;
        delete friendData.avatar_url;
      }
      
      return friendData;
    });

    res.json(friendsWithStatus);
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取当前用户信息
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    // 从数据库获取当前用户信息
    const user = await userService.getUserById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 获取用户的好友列表
    const friends = await userService.getUserFriends(req.user.id);
    
    // 构建响应数据（不包含密码）
    const { password, ...userWithoutPassword } = user;
    
    // 添加好友ID列表到用户对象
    userWithoutPassword.friends = friends.map(friend => friend.id);

    // 字段映射，确保与前端期望的字段名一致
    if (userWithoutPassword.avatar_url) {
      userWithoutPassword.avatarUrl = userWithoutPassword.avatar_url;
      delete userWithoutPassword.avatar_url;
    }

    res.json(userWithoutPassword);
  } catch (error) {
    console.error('获取当前用户信息失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 文件上传路由
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '没有文件上传' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  // 解码原始文件名
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  res.json({
    url: fileUrl,
    originalName: originalName,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// Initialize data directory and start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  await initializeDataDirectory();
  
  // 检查用户表是否为空
  const isEmpty = await isUsersTableEmpty();
  if (isEmpty) {
    console.log('\x1b[33m%s\x1b[0m', '警告: 用户表为空!');
    console.log('\x1b[33m%s\x1b[0m', '请运行以下命令导入用户数据:');
    console.log('\x1b[36m%s\x1b[0m', 'node scripts/import-users.js');
    console.log('\x1b[33m%s\x1b[0m', '或者手动添加用户后再启动应用\n');
  }
  
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (isEmpty) {
      console.log('\x1b[33m%s\x1b[0m', '警告: 应用已启动，但用户表为空，请导入用户数据');
    }
  });
}

startServer();

// 辅助函数：生成聊天ID
function getChatId(user1Id, user2Id) {
  return messageService.getChatId(user1Id, user2Id);
}

// 辅助函数：保存消息到数据库
async function saveMessage(chatId, message) {
  try {
    // 准备消息对象
    const messageToSave = {
      id: message.id,
      chatId: chatId,
      sender: message.sender,
      content: message.content,
      type: message.type,
      fileName: message.fileName,
      fileSize: message.fileSize,
      timestamp: message.timestamp
    };
    
    // 保存到数据库
    await messageService.saveMessage(messageToSave);
    
    return true;
  } catch (error) {
    console.error('Error saving message to database:', error);
    return false;
  }
}

// 辅助函数：加载最近的消息
async function loadRecentMessages(chatId, limit) {
  try {
    // 从数据库加载最近消息
    const messages = await messageService.getRecentMessages(chatId, limit);
    
    if (!messages || messages.length === 0) {
      console.log(`聊天 ${chatId} 没有消息记录`);
      return [];
    }
    
    console.log(`已加载聊天 ${chatId} 的 ${messages.length} 条消息`);
    
    // 处理字段名转换（数据库字段和应用程序对象字段的映射）
    const formattedMessages = [];
    
    for (const msg of messages) {
      // 获取发送者信息，包括头像
      const sender = await userService.getUserById(msg.sender_id);
      
      const formattedMsg = {
        id: msg.id,
        sender: msg.sender_id,
        content: msg.content,
        type: msg.message_type,
        fileName: msg.file_name,
        fileSize: msg.file_size,
        timestamp: msg.timestamp
      };
      
      // 添加发送者头像
      if (sender && sender.avatar_url) {
        formattedMsg.senderAvatar = sender.avatar_url;
      }
      
      formattedMessages.push(formattedMsg);
    }
    
    // 反转消息顺序，使旧消息在前
    return formattedMessages.reverse();
  } catch (error) {
    console.error('加载最近消息失败:', error);
    return [];
  }
}

// 辅助函数：加载指定消息ID之前的消息
async function loadMessagesBeforeId(chatId, beforeMessageId, limit) {
  try {
    // 从数据库加载指定ID之前的消息
    const messages = await messageService.getMessagesBefore(chatId, beforeMessageId, limit);
    
    if (!messages || messages.length === 0) {
      return [];
    }
    
    // 处理字段名转换
    const formattedMessages = [];
    
    for (const msg of messages) {
      // 获取发送者信息，包括头像
      const sender = await userService.getUserById(msg.sender_id);
      
      const formattedMsg = {
        id: msg.id,
        sender: msg.sender_id,
        content: msg.content,
        type: msg.message_type,
        fileName: msg.file_name,
        fileSize: msg.file_size,
        timestamp: msg.timestamp
      };
      
      // 添加发送者头像
      if (sender && sender.avatar_url) {
        formattedMsg.senderAvatar = sender.avatar_url;
      }
      
      formattedMessages.push(formattedMsg);
    }
    
    // 按时间戳排序，从旧到新
    formattedMessages.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
    
    return formattedMessages;
  } catch (error) {
    console.error('加载历史消息失败:', error);
    return [];
  }
}

// 更新用户状态
async function updateUserStatus(userId, status) {
  try {
    // 使用数据库服务更新用户状态
    const user = await userService.updateUserStatus(userId, status);
    
    return user;
  } catch (error) {
    console.error('更新用户状态失败:', error);
    return null;
  }
}

// 修改广播用户状态函数，只向好友广播
async function broadcastUserStatus(userId) {
  try {
    // 获取用户的好友
    const friends = await userService.getUserFriends(userId);
    if (!friends || friends.length === 0) return;
    
    // 获取用户信息
    const user = await userService.getUserById(userId);
    if (!user) return;
    
    // 向每个好友发送状态更新
    for (const friend of friends) {
      const friendSocket = onlineUsers.get(friend.id);
      if (friendSocket) {
        // 获取这个好友的好友列表
        const friendsList = await userService.getUserFriends(friend.id);
        
        // 处理好友列表，添加在线状态信息并移除密码
        const processedFriendsList = friendsList.map(f => {
          const friendData = {
            ...f,
            status: userSessions.has(f.id) ? 'online' : f.status || 'offline',
            password: undefined
          };
          
          // 字段映射，确保与前端期望的字段名一致
          if (friendData.avatar_url) {
            friendData.avatarUrl = friendData.avatar_url;
            delete friendData.avatar_url;
          }
          
          return friendData;
        });
        
        // 发送更新后的好友列表
        friendSocket.emit('users status update', processedFriendsList);
      }
    }
  } catch (error) {
    console.error('广播用户状态时出错:', error);
  }
}

// 验证好友关系的中间件
function verifyFriendship(req, res, next) {
  const userId = req.user.id;
  const friendId = req.params.userId;
  
  userService.checkFriendship(userId, friendId)
    .then(isFriend => {
      if (isFriend) {
        next();
      } else {
        res.status(403).json({ message: '您没有权限与该用户聊天' });
      }
    })
    .catch(error => {
      console.error('验证好友关系时出错:', error);
      res.status(500).json({ message: '服务器错误' });
    });
}

// 修改登录路由
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // 从数据库获取用户
    const user = await userService.getUserByUsername(username);

    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 检查密码是否是bcrypt加密的
    const isBcrypt = user.password.startsWith('$2');
    
    // 验证密码
    let isValidPassword = false;
    if (isBcrypt) {
      // 如果是bcrypt加密的密码，使用bcrypt比较
      isValidPassword = await bcrypt.compare(password, user.password);
    } else {
      // 如果是明文密码，直接比较
      isValidPassword = user.password === password;
      
      // 可选：将明文密码转换为bcrypt加密（建议启用）
      // if (isValidPassword) {
      //   const hashedPassword = await bcrypt.hash(password, 10);
      //   await userService.updateUserPassword(user.id, hashedPassword);
      // }
    }

    if (!isValidPassword) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 更新登录时间和状态
    await userService.updateLastLogin(user.id);
    await userService.updateUserStatus(user.id, 'online');

    // 生成 JWT token
    const token = jwt.sign({ 
      id: user.id, 
      username: user.username,
      role: user.role 
    }, JWT_SECRET, { expiresIn: '24h' });

    // 获取最新的用户信息
    const updatedUser = await userService.getUserById(user.id);

    // 移除密码后发送用户信息
    const { password: _, ...userWithoutPassword } = updatedUser;
    
    // 字段映射，确保与前端期望的字段名一致
    if (userWithoutPassword.avatar_url) {
      userWithoutPassword.avatarUrl = userWithoutPassword.avatar_url;
      delete userWithoutPassword.avatar_url;
    }
    
    res.json({ token, user: userWithoutPassword });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 处理表情符号的函数
function processEmojis(content) {
  if (!content) return '';
  
  // 使用 emoji-toolkit 处理所有表情符号
  // 这将自动处理所有支持的表情符号，而不仅限于emojiOptions中定义的表情
  return emojiToolkit.shortnameToUnicode(content);
}