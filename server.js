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
const USERS_FILE = 'data/users.json';

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
    fileSize: 50 * 1024 * 1024 // 限制50MB
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

// 初始化聊天记录目录
const CHAT_LOGS_DIR = 'data/chats';
await fs.mkdir(CHAT_LOGS_DIR, { recursive: true });

async function initializeDataDirectory() {
  try {
    await fs.mkdir('data', { recursive: true });
    try {
      await fs.access(USERS_FILE);
    } catch {
      await fs.writeFile(USERS_FILE, JSON.stringify({ users: [] }));
    }
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
    
    // 加载历史消息
    try {
      const chatFile = path.join(CHAT_LOGS_DIR, `${chatId}.json`);
      const history = await fs.readFile(chatFile, 'utf8')
        .then(data => JSON.parse(data))
        .catch(() => ({ messages: [] }));
      socket.emit('chat history', history.messages);
    } catch (error) {
      console.error('Error loading chat history:', error);
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
      const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
      const currentUser = usersData.users.find(u => u.id === userId);
      
      if (!currentUser || !currentUser.friends.includes(targetUserId)) {
        socket.emit('error', { message: '只能与好友聊天' });
        return;
      }
      
      const chatId = getChatId(userId, targetUserId);
      
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

      // 保存消息到文件
      try {
        const chatFile = path.join(CHAT_LOGS_DIR, `${chatId}.json`);
        const history = await fs.readFile(chatFile, 'utf8')
          .then(data => JSON.parse(data))
          .catch(() => ({ messages: [] }));
        
        history.messages.push(message);
        await fs.writeFile(chatFile, JSON.stringify(history, null, 2));
      } catch (error) {
        console.error('Error saving message:', error);
      }

      io.to(chatId).emit('private message', message);
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
  const { username, password, email } = req.body;

  try {
    const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    
    // 检查用户是否已存在
    if (usersData.users.some(u => u.username === username)) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now().toString(),
      username,
      password: hashedPassword,
      email,
      createdAt: getLocalISOString(),
      status: 'offline'
    };

    usersData.users.push(newUser);
    await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2));

    res.status(201).json({ message: '注册成功' });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取用户列表（只返回好友）
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const currentUser = usersData.users.find(u => u.id === req.user.id);
    
    if (!currentUser) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 只返回好友列表中的用户
    const friends = usersData.users.filter(user => 
      currentUser.friends.includes(user.id)
    ).map(({ password, ...user }) => ({
      ...user,
      status: userSessions.has(user.id) ? 'online' : 'offline'
    }));

    res.json(friends);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取当前用户信息
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const user = usersData.users.find(u => u.id === req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Error getting current user:', error);
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
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

// 辅助函数：生成聊天ID
function getChatId(user1Id, user2Id) {
  return [user1Id, user2Id].sort().join('_');
}

// 更新用户状态
async function updateUserStatus(userId, status) {
  try {
    const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const user = usersData.users.find(u => u.id === userId);
    if (user && user.status !== status) {
      user.status = status;
      user.lastStatusChange = getLocalISOString();
      await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2));
    }
  } catch (error) {
    console.error('Error updating user status:', error);
  }
}

// 修改广播用户状态函数，只向好友广播
async function broadcastUserStatus(userId) {
  try {
    const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const currentUser = usersData.users.find(u => u.id === userId);
    
    if (!currentUser) return;
    
    // 获取该用户的所有好友
    const friends = usersData.users.filter(user => 
      currentUser.friends.includes(user.id)
    );
    
    // 向每个好友发送状态更新
    friends.forEach(friend => {
      const friendSocket = onlineUsers.get(friend.id);
      if (friendSocket) {
        const friendsList = usersData.users
          .filter(u => friend.friends.includes(u.id))
          .map(({ password, ...user }) => ({
            ...user,
            status: userSessions.has(user.id) ? 'online' : 'offline'
          }));
        friendSocket.emit('users status update', friendsList);
      }
    });
  } catch (error) {
    console.error('Error broadcasting user status:', error);
  }
}

// 验证好友关系的中间件
function verifyFriendship(req, res, next) {
  const targetUserId = req.body.targetUserId || req.params.targetUserId;
  
  fs.readFile(USERS_FILE, 'utf8')
    .then(data => {
      const usersData = JSON.parse(data);
      const currentUser = usersData.users.find(u => u.id === req.user.id);
      
      if (!currentUser) {
        return res.status(404).json({ message: '用户不存在' });
      }
      
      if (!currentUser.friends.includes(targetUserId)) {
        return res.status(403).json({ message: '只能与好友聊天' });
      }
      
      next();
    })
    .catch(error => {
      console.error('Error verifying friendship:', error);
      res.status(500).json({ message: '服务器错误' });
    });
}

// 修改登录路由
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const usersData = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const user = usersData.users.find(u => u.username === username);

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
      //   user.password = await bcrypt.hash(password, 10);
      //   await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2));
      // }
    }

    if (!isValidPassword) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 更新登录时间和状态
    user.lastLoginAt = getLocalISOString();
    user.status = 'online';
    await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2));

    // 生成 JWT token
    const token = jwt.sign({ 
      id: user.id, 
      username: user.username,
      role: user.role 
    }, JWT_SECRET, { expiresIn: '24h' });

    // 移除密码后发送用户信息
    const { password: _, ...userWithoutPassword } = user;
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