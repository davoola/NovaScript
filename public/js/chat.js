// 获取当前用户信息
let currentUser = null;
// 初始化markdown-it实例
let md = null;
// 标记Mermaid是否已初始化
let mermaidInitialized = false;

// 移动端菜单处理
function initializeMobileMenu() {
  // console.log('Initializing mobile menu...');
  const menuBtn = document.querySelector('.menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const mainContent = document.querySelector('.main-content');
  const body = document.body;

  // 清除菜单按钮的事件监听器
  const newMenuBtn = menuBtn.cloneNode(true);
  menuBtn.parentNode.replaceChild(newMenuBtn, menuBtn);

  // console.log('Menu button:', newMenuBtn);
  // console.log('Sidebar:', sidebar);

  // 重新添加事件监听器
  newMenuBtn.addEventListener('click', (e) => {
    // console.log('Menu button clicked');
    e.stopPropagation();
    sidebar.classList.toggle('show');
    if (sidebar.classList.contains('show')) {
      body.style.overflow = 'hidden';
    } else {
      body.style.overflow = '';
    }
  });

  // 点击侧边栏外部时关闭侧边栏
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && 
        !sidebar.contains(e.target) && 
        !newMenuBtn.contains(e.target) && 
        sidebar.classList.contains('show')) {
      sidebar.classList.remove('show');
      body.style.overflow = '';
    }
  });

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('show');
      body.style.overflow = '';
    }
  });

  // 添加触摸滑动支持
  let touchStartX = 0;
  let touchEndX = 0;

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, false);

  document.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].clientX;
    handleSwipe();
  }, false);

  function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;
    if (Math.abs(swipeDistance) > 50) { // 最小滑动距离
      if (swipeDistance > 0 && touchStartX < 30) {
        // 从左向右滑动，且起始点在屏幕左侧
        sidebar.classList.add('show');
        body.style.overflow = 'hidden';
      } else if (swipeDistance < 0 && sidebar.classList.contains('show')) {
        // 从右向左滑动，且侧边栏正在显示
        sidebar.classList.remove('show');
        body.style.overflow = '';
      }
    }
  }
}

// 初始化应用
async function initialize() {
  try {
    // 获取当前用户信息
    const response = await fetch('/api/users/me', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!response.ok) {
      throw new Error('未登录');
    }
    
    currentUser = await response.json();
    // console.log('当前用户信息:', currentUser); // 添加日志
    
    // 设置用户信息
    if (currentUsername && currentUser) {
      // 优先使用昵称，如果没有则使用用户名
      currentUsername.textContent = currentUser.nickname || currentUser.username;
      // 设置当前用户头像
      const userAvatar = document.getElementById('user-avatar');
      if (userAvatar) {
        userAvatar.src = currentUser.avatarUrl || '/images/avatars/default.png';
      }
    }
    
    // 获取用户列表
    const usersResponse = await fetch('/api/users', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!usersResponse.ok) {
      throw new Error('获取用户列表失败');
    }
    
    const users = await usersResponse.json();
    // console.log('获取到的用户列表:', users); // 添加日志
    
    // 过滤掉当前用户
    const otherUsers = users.filter(user => user.id !== currentUser.id);
    
    // 确保userList元素存在
    if (userList) {
      renderUserList(otherUsers);

      // 自动打开第一个用户的聊天
      if (otherUsers.length > 0) {
        const firstUser = otherUsers[0];
        startChat(firstUser.id, firstUser.username, firstUser.nickname || firstUser.username);
      }
    }
  } catch (error) {
    console.error('Error initializing:', error);
    // 如果是未登录错误，重定向到登录页面
    if (error.message === '未登录' || error.message.includes('未登录')) {
      window.location.href = '/login';
    }
  }
}

// 初始化 Socket.IO 连接
function initializeSocket() {
  const socket = io({
    auth: {
      token: localStorage.getItem('token')
    }
  });

  // Socket.IO 事件监听
  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    if (error.message === 'Authentication required' || error.message === 'Invalid token') {
      window.location.href = '/login';
    }
  });

  // 处理用户状态更新
  socket.on('users status update', (users) => {
    if (currentUser) {
      // 过滤掉当前用户
      const otherUsers = users.filter(user => user.id !== currentUser.id);
      renderUserList(otherUsers);
    }
  });

  socket.on('chat history', (messages) => {
    if (!Array.isArray(messages)) return;
    
    messageContainer.innerHTML = '';
    
    // 渲染所有消息
    messages.forEach(message => {
      renderMessage(message, false);
    });

    // 等待所有媒体内容加载完成后滚动
    const mediaElements = messageContainer.querySelectorAll('img, video, audio');
    Promise.all(
      Array.from(mediaElements).map(media => {
        return new Promise((resolve) => {
          if (media.complete || media.readyState >= 2) {
            resolve();
          } else {
            media.addEventListener('load', resolve);
            media.addEventListener('loadedmetadata', resolve);
            media.addEventListener('error', resolve);
          }
        });
      })
    ).then(() => {
      // 确保在所有内容加载完成后滚动到底部
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    });
  });

  socket.on('private message', renderMessage);

  return socket;
}

const socket = initializeSocket();

let currentChat = null;
const messageContainer = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const fileInput = document.getElementById('file-input');
const userList = document.getElementById('user-list');
const currentUsername = document.getElementById('current-username');
const logoutBtn = document.getElementById('logout-btn');
const chatTitle = document.getElementById('chat-title');

// 主题切换功能
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = themeToggle.querySelector('i');

// 从localStorage获取主题设置
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

// 切换主题
themeToggle.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
});

// 更新主题图标
function updateThemeIcon(theme) {
  themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// 渲染用户列表
function renderUserList(users) {
  if (!users.length) {
    userList.innerHTML = `
      <div class="no-friends">
        <p>暂无好友</p>
      </div>
    `;
    return;
  }

  userList.innerHTML = users
    .map(user => `
      <div class="user-item ${user.status}" data-user-id="${user.id}" data-user-nickname="${user.nickname || user.username}">
        <div class="avatar-container">
          <img src="${user.avatarUrl || '/images/avatars/default.png'}" alt="${user.username}" class="user-avatar">
          <span class="status-indicator ${user.status}"></span>
        </div>
        <div class="user-info">
          <div class="user-name">${user.nickname || user.username}</div>
          <div class="user-status">${user.status === 'online' ? '在线' : '离线'}</div>
        </div>
      </div>
    `)
    .join('');

  // 保持当前聊天的选中状态
  if (currentChat) {
    const activeItem = userList.querySelector(`[data-user-id="${currentChat.id}"]`);
    if (activeItem) {
      activeItem.classList.add('active');
    }
  }

  // 添加点击事件
  userList.querySelectorAll('.user-item').forEach(item => {
    item.addEventListener('click', () => {
      const userId = item.dataset.userId;
      const username = item.querySelector('.user-name').textContent;
      const nickname = item.dataset.userNickname;
      startChat(userId, username, nickname);
    });
  });
}

// 开始聊天
function startChat(userId, username, nickname) {
  // 验证是否是好友
  if (!isFriend(userId)) {
    alert('只能与好友聊天');
    return;
  }

  // 获取用户头像
  const userItem = document.querySelector(`.user-item[data-user-id="${userId}"]`);
  const userAvatar = userItem ? userItem.querySelector('.user-avatar').src : '/images/avatars/default.png';
  
  currentChat = {
    id: userId,
    username: username,
    nickname: nickname || username,
    avatarUrl: userAvatar
  };
  
  chatTitle.textContent = `❤️和 ${nickname || username} 暖心聊天中 ✨`;
  
  // 清空消息容器
  messageContainer.innerHTML = '';
  
  // 发送加入聊天的请求
  socket.emit('join chat', userId);
  
  // 更新选中状态
  document.querySelectorAll('.user-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.userId === userId) {
      item.classList.add('active');
    }
  });

  // 确保DOM更新后滚动到底部
  setTimeout(() => {
    scrollToBottom();
  }, 100);
}

// 检查是否是好友
function isFriend(userId) {
  // 从服务器返回的当前用户数据中获取好友列表
  return currentUser && currentUser.friends && currentUser.friends.includes(userId);
}

// 渲染消息
function renderMessage(message, shouldScroll = true) {
  const isOwn = message.sender === currentUser.id;
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isOwn ? 'own' : 'other'}`;
  
  let content = '';
  let isMediaContent = false;
  
  switch (message.type) {
    case 'text':
      // 先处理数学公式，然后再使用markdown-it渲染
      let processedContent = message.content;
      
      // 尝试直接使用KaTeX渲染数学公式
      try {
        // 处理独行公式 $$...$$
        const displayRegex = /\$\$([\s\S]*?)\$\$/g;
        processedContent = processedContent.replace(displayRegex, (match, formula) => {
          try {
            // console.log('渲染独行公式:', formula);
            return `<div class="katex-display">${window.katex.renderToString(formula.trim(), { displayMode: true })}</div>`;
          } catch (err) {
            console.error('KaTeX渲染独行公式错误:', err);
            return match; // 保持原样
          }
        });
        
        // 处理行内公式 $...$（确保不匹配已处理的独行公式）
        const inlineRegex = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g;
        processedContent = processedContent.replace(inlineRegex, (match, formula) => {
          try {
            // console.log('渲染行内公式:', formula);
            return window.katex.renderToString(formula.trim(), { displayMode: false });
          } catch (err) {
            console.error('KaTeX渲染行内公式错误:', err);
            return match; // 保持原样
          }
        });
      } catch (err) {
        console.error('处理数学公式时出错:', err);
      }
      
      // 使用markdown-it渲染其余内容
      if (md) {
        try {
          content = md.render(processedContent);
          // console.log('Markdown渲染成功');
        } catch (err) {
          console.error('Markdown渲染错误:', err);
          content = processedContent;
        }
      } else {
        content = processedContent;
      }
      break;
    case 'image':
      content = `<img src="${message.content}" alt="图片" class="message-image">`;
      isMediaContent = true;
      break;
    case 'video':
      content = `<video controls src="${message.content}" class="message-video"></video>`;
      isMediaContent = true;
      break;
    case 'audio':
      content = `<audio controls src="${message.content}" class="message-audio"></audio>`;
      isMediaContent = true;
      break;
    case 'file':
      content = `<a href="${message.content}" target="_blank" class="message-file">
        <div class="file-info">
          <div class="file-name">${message.fileName || '未知文件'}</div>
          <div class="file-size">${formatFileSize(parseInt(message.fileSize) || 0)}</div>
        </div>
        <i class="fas fa-file-alt"></i>
      </a>`;
      break;
  }

  // 修改时间戳处理
  const timestamp = new Date(message.timestamp);
  const formattedTime = new Date(timestamp.getTime() + timestamp.getTimezoneOffset() * 60000)
    .toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/\//g, '-');

  // 获取正确的头像URL和昵称
  const avatarUrl = isOwn ? 
    (currentUser.avatarUrl || '/images/avatars/default.png') : 
    (message.senderAvatar || (currentChat && currentChat.avatarUrl) || '/images/avatars/default.png');
  
  const nickname = isOwn ? 
    (currentUser.nickname || currentUser.username) : 
    (message.senderNickname || (currentChat && currentChat.nickname) || (currentChat && currentChat.username) || '用户');

  messageElement.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">
        <img src="${avatarUrl}" alt="头像" class="user-avatar">
      </div>
      <div class="message-nickname">${nickname}</div>
      <div class="message-time">${formattedTime}</div>
    </div>
    <div class="message-content">
      <div class="message-bubble ${isMediaContent ? 'media-content' : ''}">
        ${content}
      </div>
    </div>
  `;
  
  messageContainer.appendChild(messageElement);

  // 处理媒体内容加载
  if (isMediaContent) {
    const mediaElements = messageElement.querySelectorAll('img, video, audio');
    Promise.all(
      Array.from(mediaElements).map(media => {
        return new Promise((resolve) => {
          if (media.complete || media.readyState >= 2) {
            resolve();
          } else {
            media.addEventListener('load', resolve);
            media.addEventListener('loadedmetadata', resolve);
            media.addEventListener('error', resolve);
          }
        });
      })
    ).then(() => {
      if (shouldScroll) {
        scrollToBottom();
      }
    });
  } else if (shouldScroll) {
    scrollToBottom();
  }
  
  // 为代码块添加复制按钮并处理数学公式
  addCopyButtonsToCodeBlocks(messageElement);
  
  // 检查消息中是否包含数学公式
  if (message.type === 'text' && message.content) {
    const hasFormulas = detectMathFormulas(message.content);
    if (hasFormulas) {
      // console.log('消息包含数学公式，已渲染');
    }
  }
}

// 添加一个备用的Mermaid渲染方法
function renderMermaidFallback(code) {
  return new Promise((resolve, reject) => {
    try {
      // 创建一个临时的可见容器
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'fixed';
      tempContainer.style.left = '0';
      tempContainer.style.top = '0';
      tempContainer.style.width = '1024px';
      tempContainer.style.height = 'auto';
      tempContainer.style.pointerEvents = 'none';
      tempContainer.style.zIndex = '-1000';
      tempContainer.className = 'mermaid';
      tempContainer.innerHTML = code;
      
      // 确保容器可见且有尺寸
      tempContainer.style.visibility = 'visible';
      tempContainer.style.display = 'block';
      
      document.body.appendChild(tempContainer);
      
      // 给DOM一些时间来计算尺寸
      requestAnimationFrame(() => {
        try {
          // 使用mermaid的init方法
          window.mermaid.init(undefined, tempContainer).then(() => {
            // 获取生成的SVG
            const svg = tempContainer.innerHTML;
            
            // 移除临时容器
            document.body.removeChild(tempContainer);
            
            // 返回SVG内容
            resolve({
              svg: svg,
              bindFunctions: null
            });
          }).catch(err => {
            document.body.removeChild(tempContainer);
            reject(err);
          });
        } catch (err) {
          document.body.removeChild(tempContainer);
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// 渲染Mermaid图表
function renderMermaidDiagrams(container) {
  if (typeof window.mermaid === 'undefined') {
    console.error('Mermaid 库未加载，无法渲染图表');
    return;
  }
  
  // 确保Mermaid已初始化
  if (!mermaidInitialized) {
    initializeMermaid();
  }
  
  try {
    // 查找所有预格式化的mermaid代码块
    const mermaidBlocks = container.querySelectorAll('pre code.language-mermaid, div.language-mermaid');
    
    if (mermaidBlocks.length === 0) {
      return;
    }
    
    // 为每个mermaid代码块创建一个唯一的ID
    mermaidBlocks.forEach((block, index) => {
      const mermaidCode = block.textContent;
      if (!mermaidCode.trim()) {
        console.warn(`Mermaid代码块 #${index + 1} 为空，跳过渲染`);
        return;
      }
      
      const mermaidId = `mermaid-diagram-${Date.now()}-${index}`;
      const parentElement = block.tagName === 'CODE' ? block.parentElement : block;
      
      // 创建一个新的div来放置渲染后的图表
      const diagramContainer = document.createElement('div');
      diagramContainer.className = 'mermaid-diagram';
      diagramContainer.id = mermaidId;
      
      // 确保容器有尺寸和可见性
      diagramContainer.style.display = 'block';
      diagramContainer.style.visibility = 'visible';
      diagramContainer.style.width = '100%';
      diagramContainer.style.minHeight = '100px';
      diagramContainer.style.position = 'relative';
      diagramContainer.style.overflow = 'visible';
      diagramContainer.style.cursor = 'pointer'; // 添加指针样式
      
      // 添加提示文本
      const tooltip = document.createElement('div');
      tooltip.className = 'diagram-tooltip';
      tooltip.textContent = '点击放大查看';
      diagramContainer.appendChild(tooltip);
      
      // 将代码放入容器中
      diagramContainer.innerHTML = mermaidCode;
      
      // 将新的div插入到pre元素之后
      parentElement.parentElement.insertBefore(diagramContainer, parentElement.nextSibling);
      
      // 隐藏原始代码块
      parentElement.style.display = 'none';
      
      // 使用requestAnimationFrame确保DOM已更新
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            // 渲染图表
            renderMermaidFallback(mermaidCode)
              .then(({ svg }) => {
                if (svg) {
                  diagramContainer.innerHTML = svg;
                  diagramContainer.appendChild(tooltip); // 重新添加提示文本
                  
                  // 添加点击放大功能
                  diagramContainer.addEventListener('click', () => {
                    showLargeDiagram(mermaidCode);
                  });
                  
                  if (container.classList.contains('messages')) {
                    scrollToBottom();
                  }
                }
              })
              .catch(err => {
                console.warn(`备用方法渲染失败，尝试标准方法: ${err.message}`);
                
                window.mermaid.render(mermaidId, mermaidCode)
                  .then(({ svg, bindFunctions }) => {
                    diagramContainer.innerHTML = svg;
                    diagramContainer.appendChild(tooltip); // 重新添加提示文本
                    if (bindFunctions) bindFunctions(diagramContainer);
                    
                    // 添加点击放大功能
                    diagramContainer.addEventListener('click', () => {
                      showLargeDiagram(mermaidCode);
                    });
                    
                    if (container.classList.contains('messages')) {
                      scrollToBottom();
                    }
                  })
                  .catch(renderErr => {
                    console.error(`渲染图表 #${index + 1} 时出错:`, renderErr);
                    diagramContainer.innerHTML = `<div class="mermaid-error">图表渲染失败: ${renderErr.message}</div>`;
                  });
              });
          } catch (err) {
            console.error(`处理图表 #${index + 1} 时出错:`, err);
            diagramContainer.innerHTML = `<div class="mermaid-error">图表处理失败: ${err.message}</div>`;
          }
        }, 100);
      });
    });
  } catch (err) {
    console.error('处理Mermaid图表时出错:', err);
  }
}

// 显示大图
function showLargeDiagram(mermaidCode) {
  // 创建全屏模态框
  const modal = document.createElement('div');
  modal.className = 'diagram-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
  modal.style.zIndex = '9999';
  modal.style.display = 'flex';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.padding = '20px';
  
  // 创建内容容器
  const container = document.createElement('div');
  container.className = 'diagram-modal-content';
  container.style.backgroundColor = 'white';
  container.style.padding = '20px';
  container.style.borderRadius = '8px';
  container.style.maxWidth = '90%';
  container.style.maxHeight = '90%';
  container.style.overflow = 'auto';
  container.style.position = 'relative';
  
  // 添加关闭按钮
  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.position = 'absolute';
  closeBtn.style.right = '10px';
  closeBtn.style.top = '10px';
  closeBtn.style.fontSize = '24px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.color = '#333';
  closeBtn.style.zIndex = '1';
  
  // 创建图表容器
  const diagramContainer = document.createElement('div');
  diagramContainer.className = 'mermaid';
  diagramContainer.style.minHeight = '200px';
  
  // 组装模态框
  container.appendChild(closeBtn);
  container.appendChild(diagramContainer);
  modal.appendChild(container);
  document.body.appendChild(modal);
  
  // 渲染大图
  try {
    window.mermaid.render('large-diagram', mermaidCode)
      .then(({ svg }) => {
        diagramContainer.innerHTML = svg;
      })
      .catch(err => {
        console.error('渲染大图时出错:', err);
        diagramContainer.innerHTML = `<div class="mermaid-error">图表渲染失败: ${err.message}</div>`;
      });
  } catch (err) {
    console.error('处理大图时出错:', err);
    diagramContainer.innerHTML = `<div class="mermaid-error">图表处理失败: ${err.message}</div>`;
  }
  
  // 添加关闭事件
  function closeModal() {
    document.body.removeChild(modal);
    document.removeEventListener('keydown', handleEsc);
  }
  
  // ESC键关闭
  function handleEsc(event) {
    if (event.key === 'Escape') {
      closeModal();
    }
  }
  
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  document.addEventListener('keydown', handleEsc);
}

// 为代码块添加复制按钮并处理数学公式和图表
function addCopyButtonsToCodeBlocks(container) {
  // 处理代码块
  const codeBlocks = container.querySelectorAll('pre');
  
  codeBlocks.forEach(block => {
    // 跳过mermaid代码块，它们将被单独处理
    if (block.querySelector('code.language-mermaid')) {
      return;
    }
    
    // 创建复制按钮
    const copyButton = document.createElement('button');
    copyButton.className = 'code-copy-btn';
    copyButton.innerHTML = '<i class="fas fa-copy"></i>';
    copyButton.title = '复制代码';
    
    // 添加点击事件
    copyButton.addEventListener('click', () => {
      const codeText = block.textContent;
      
      copyTextToClipboard(codeText, (success) => {
        // 更新按钮图标以提供反馈
        const originalIcon = copyButton.innerHTML;
        if (success) {
          copyButton.innerHTML = '<i class="fas fa-check"></i>';
        } else {
          copyButton.innerHTML = '<i class="fas fa-times"></i>';
        }
        
        // 2秒后恢复原始图标
        setTimeout(() => {
          copyButton.innerHTML = originalIcon;
        }, 2000);
      });
    });
    
    // 将按钮添加到代码块
    block.appendChild(copyButton);
  });
  
  // 检查数学公式是否已经渲染
  const katexElements = container.querySelectorAll('.katex, .katex-display');
  if (katexElements.length > 0) {
    // console.log(`找到 ${katexElements.length} 个已渲染的数学公式元素`);
  } else {
    // 检查是否有未渲染的数学公式
    const content = container.textContent;
    const hasFormulas = detectMathFormulas(content);
    if (hasFormulas) {
      // console.log('发现未渲染的数学公式，尝试重新渲染');
      
      // 获取消息内容元素
      const messageBubble = container.querySelector('.message-bubble');
      if (messageBubble) {
        const originalContent = messageBubble.innerHTML;
        
        // 处理独行公式
        let processedContent = originalContent;
        try {
          // 处理独行公式 $$...$$
          const displayRegex = /\$\$([\s\S]*?)\$\$/g;
          processedContent = processedContent.replace(displayRegex, (match, formula) => {
            try {
              return `<div class="katex-display">${window.katex.renderToString(formula.trim(), { displayMode: true })}</div>`;
            } catch (err) {
              return match;
            }
          });
          
          // 处理行内公式 $...$
          const inlineRegex = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g;
          processedContent = processedContent.replace(inlineRegex, (match, formula) => {
            try {
              return window.katex.renderToString(formula.trim(), { displayMode: false });
            } catch (err) {
              return match;
            }
          });
          
          // 更新内容
          if (processedContent !== originalContent) {
            messageBubble.innerHTML = processedContent;
            // console.log('重新渲染了数学公式');
          }
        } catch (err) {
          console.error('重新渲染数学公式时出错:', err);
        }
      }
    }
  }
  
  // 渲染Mermaid图表
  renderMermaidDiagrams(container);
}

// 兼容性更好的复制文本方法
function copyTextToClipboard(text, callback) {
  // 创建临时文本区域
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // 设置样式使其不可见
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  textArea.style.opacity = '0';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  let success = false;
  try {
    // 执行复制命令
    success = document.execCommand('copy');
  } catch (err) {
    console.error('复制失败:', err);
  }
  
  // 移除临时元素
  document.body.removeChild(textArea);
  
  // 执行回调
  if (callback) {
    callback(success);
  }
  
  return success;
}

// 添加防抖函数
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// 添加滚动状态变量
let lastScrollTop = 0;
let scrollDirection = 'none';

// 简化滚动到底部的函数
function scrollToBottom() {
  const messageContainer = document.querySelector('.messages');
  if (!messageContainer) return;

  const isMobile = window.innerWidth <= 768;
  
  // 如果当前正在向上滚动，不要打断用户的滚动
  if (scrollDirection === 'up') return;
  
  if (isMobile) {
    messageContainer.scrollTop = messageContainer.scrollHeight;
  } else {
    messageContainer.scrollTo({
      top: messageContainer.scrollHeight,
      behavior: 'smooth'
    });
  }
}

// 修改消息容器的滚动监听
messageContainer.addEventListener('scroll', debounce(() => {
  const currentScrollTop = messageContainer.scrollTop;
  const isMobile = window.innerWidth <= 768;
  
  // 判断滚动方向
  scrollDirection = currentScrollTop > lastScrollTop ? 'down' : 'up';
  lastScrollTop = currentScrollTop;

  // 只在以下情况触发自动滚动：
  // 1. 是向下滚动
  // 2. 距离底部足够近（移动端 20px，PC端 100px）
  const triggerDistance = isMobile ? 20 : 100;
  const isNearBottom = messageContainer.scrollHeight - currentScrollTop - messageContainer.clientHeight < triggerDistance;
  
  if (scrollDirection === 'down' && isNearBottom) {
    scrollToBottom();
  }
}, 150));

// 添加页面加载完成后的滚动处理
document.addEventListener('DOMContentLoaded', () => {
  // 检查库加载状态:
  // console.log('检查库加载状态:');
  // console.log('- markdownit:', typeof window.markdownit !== 'undefined' ? '已加载' : '未加载');
  // console.log('- katex:', typeof window.katex !== 'undefined' ? '已加载' : '未加载');
  // console.log('- markdownitTaskLists:', typeof window.markdownitTaskLists !== 'undefined' ? '已加载' : '未加载');
  // console.log('- mermaid:', typeof window.mermaid !== 'undefined' ? '已加载' : '未加载');
  
  // 初始化移动菜单
  initializeMobileMenu();
  
  try {
    // 初始化markdown-it
    initializeMarkdownIt();
    // console.log('Markdown-it 初始化成功');
    
    // 初始化Mermaid (只初始化一次)
    initializeMermaid();
    // console.log('Mermaid 初始化成功');
    
    // 为图表帮助按钮添加事件监听器
    const diagramHelpBtn = document.querySelector('.diagram-help-btn');
    if (diagramHelpBtn) {
      diagramHelpBtn.addEventListener('click', showDiagramHelp);
      // console.log('图表帮助按钮初始化成功');
    }
    
    // 初始化应用
    initialize().catch(error => {
      console.error('Initialization failed:', error);
    });
    
    // 等待一小段时间确保所有内容都已加载
    setTimeout(() => {
      scrollToBottom();
    }, 500);
  } catch (error) {
    console.error('初始化过程中出错:', error);
  }
});

// 在窗口大小改变时也滚动到底部
window.addEventListener('resize', () => {
  scrollToBottom();
});

// 添加文件大小格式化函数
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 修改文件上传函数
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: formData
    });
    
    if (!response.ok) throw new Error('Upload failed');
    
    const fileInfo = await response.json();
    const messageData = {
      targetUserId: currentChat.id,
      content: fileInfo.url,
      type: fileInfo.mimetype.startsWith('image/') ? 'image' :
            fileInfo.mimetype.startsWith('video/') ? 'video' :
            fileInfo.mimetype.startsWith('audio/') ? 'audio' : 'file',
      fileName: fileInfo.originalName,
      fileSize: fileInfo.size,
      senderAvatar: currentUser.avatarUrl,
      senderNickname: currentUser.nickname || currentUser.username,
      receiverAvatar: currentChat.avatarUrl
    };
    
    socket.emit('private message', messageData);
  } catch (error) {
    console.error('Error uploading file:', error);
    alert('文件上传失败');
  }
}

// 检测消息中的数学公式
function detectMathFormulas(content) {
  const inlineFormulas = content.match(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/g) || [];
  const displayFormulas = content.match(/\$\$([\s\S]*?)\$\$/g) || [];
  
  if (inlineFormulas.length > 0 || displayFormulas.length > 0) {
    // console.log('检测到数学公式:');
    inlineFormulas.forEach((formula, index) => {
      // console.log(`行内公式 ${index + 1}:`, formula);
    });
    displayFormulas.forEach((formula, index) => {
      // console.log(`独行公式 ${index + 1}:`, formula);
    });
    return true;
  }
  
  return false;
}

// 修改发送消息函数
async function sendMessage(content, type = 'text', fileName = null, fileSize = null) {
  if (!currentChat || !content.trim()) return;
  
  // 检测是否包含数学公式
  if (type === 'text') {
    detectMathFormulas(content);
  }
  
  const messageData = {
    targetUserId: currentChat.id,
    content,
    type,
    fileName,
    fileSize,
    senderAvatar: currentUser.avatarUrl,
    senderNickname: currentUser.nickname || currentUser.username,
    receiverAvatar: currentChat.avatarUrl
  };
  
  socket.emit('private message', messageData);
  
  // 发送消息后立即滚动到底部
  setTimeout(() => {
    scrollToBottom();
  }, 100);
}

// 退出登录
function logout() {
  localStorage.removeItem('token');
  window.location.href = '/login';
}

// 自动调整文本框高度
function adjustTextareaHeight(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

// 事件监听
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (message) {
    sendMessage(message);
    messageInput.value = '';
    messageInput.style.height = 'auto';
  }
});

// 处理输入框事件
messageInput.addEventListener('input', () => {
  adjustTextareaHeight(messageInput);
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (e.shiftKey) {
      // Shift + Enter: 换行
      return;
    } else {
      // Enter: 发送消息
      e.preventDefault();
      const message = messageInput.value.trim();
      if (message) {
        sendMessage(message);
        messageInput.value = '';
        messageInput.style.height = 'auto';
      }
    }
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    uploadFile(file);
    fileInput.value = '';
  }
});

logoutBtn.addEventListener('click', logout);

// Emoji帮助模态框功能
const emojiModal = document.getElementById('emoji-help-modal');
const emojiBtn = document.querySelector('.toolbar-btn.emoji-btn');
const closeBtn = emojiModal.querySelector('.close');

// 打开模态框
emojiBtn.addEventListener('click', function() {
    emojiModal.style.display = 'block';
    // 添加ESC键监听
    document.addEventListener('keydown', closeEmojiModalOnEsc);
});

// ESC键关闭Emoji模态框
function closeEmojiModalOnEsc(event) {
    if (event.key === 'Escape' && emojiModal.style.display === 'block') {
        emojiModal.style.display = 'none';
        // 移除ESC键监听
        document.removeEventListener('keydown', closeEmojiModalOnEsc);
    }
}

// 关闭模态框
closeBtn.addEventListener('click', function() {
    emojiModal.style.display = 'none';
    // 移除ESC键监听
    document.removeEventListener('keydown', closeEmojiModalOnEsc);
});

// 点击模态框外部关闭
window.addEventListener('click', function(event) {
    if (event.target === emojiModal) {
        emojiModal.style.display = 'none';
        // 移除ESC键监听
        document.removeEventListener('keydown', closeEmojiModalOnEsc);
    }
});

// 表情分类切换
const tabButtons = document.querySelectorAll('.emoji-tab-btn');
const emojiPanels = document.querySelectorAll('.emoji-panel');

tabButtons.forEach(button => {
    button.addEventListener('click', function() {
        // 移除所有活动状态
        tabButtons.forEach(btn => btn.classList.remove('active'));
        emojiPanels.forEach(panel => panel.classList.remove('active'));
        
        // 添加当前活动状态
        this.classList.add('active');
        const targetId = this.getAttribute('data-target') + '-panel';
        document.getElementById(targetId).classList.add('active');
    });
});

// 点击表情插入到输入框
document.querySelectorAll('.emoji-item').forEach(item => {
    item.addEventListener('click', function() {
        const emojiCode = this.getAttribute('data-code');
        const messageInput = document.getElementById('message-input');
        const cursorPos = messageInput.selectionStart;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter = messageInput.value.substring(cursorPos);
        
        messageInput.value = textBefore + emojiCode + textAfter;
        messageInput.focus();
        messageInput.selectionStart = cursorPos + emojiCode.length;
        messageInput.selectionEnd = cursorPos + emojiCode.length;
        
        // 关闭模态框
        emojiModal.style.display = 'none';
    });
});

// 初始化markdown-it
function initializeMarkdownIt() {
  // 检查是否已加载所需库
  if (typeof window.markdownit === 'undefined') {
    console.error('Markdown-it 库未加载');
    return;
  }
  
  // 配置markdown-it
  md = window.markdownit({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
    quotes: ['""', '\'\''],
    highlight: function (code, lang) {
      if (!code) return '';
      
      // 特殊处理Mermaid代码块
      if (lang === 'mermaid') {
        return `<div class="language-mermaid">${code}</div>`;
      }
      
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { 
            language: lang,
            ignoreIllegals: true
          }).value;
        } catch (err) {
          console.warn('代码高亮警告:', err);
        }
      }
      
      try {
        return hljs.highlightAuto(code).value;
      } catch (err) {
        console.warn('自动代码高亮警告:', err);
        return code;
      }
    }
  });
  
  // 添加任务列表支持
  try {
    if (window.markdownitTaskLists) {
      md.use(window.markdownitTaskLists, {
        enabled: true,
        label: true,
        labelAfter: true
      });
    }
  } catch (err) {
    console.error('启用任务列表支持时出错:', err);
  }
  
  // 添加数学公式支持
  try {
    if (window.katex && window.texmath) {
      md.use(window.texmath, {
        engine: window.katex,
        delimiters: ['dollars', 'bracks'],
        katexOptions: { macros: { "\\RR": "\\mathbb{R}" } }
      });
    }
  } catch (err) {
    console.error('启用数学公式支持时出错:', err);
  }
  
  // console.log('Markdown-it 初始化完成');
}

// 初始化Mermaid
function initializeMermaid() {
  if (typeof window.mermaid === 'undefined') {
    console.error('Mermaid 库未加载');
    return;
  }
  
  // 如果已经初始化过，则不再重复初始化
  if (mermaidInitialized) {
    // console.log('Mermaid 已经初始化过，跳过重复初始化');
    return;
  }
  
  try {
    // 配置Mermaid
    window.mermaid.initialize({
      startOnLoad: false,  // 我们将手动渲染
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',  // 允许点击事件
      logLevel: 'error',  // 只显示错误日志
      fontFamily: 'sans-serif',
      fontSize: 14,
      altFontFamily: 'sans-serif',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
        diagramPadding: 8,
        nodeSpacing: 50,
        rankSpacing: 50,
        padding: 15
      },
      sequence: {
        diagramMarginX: 50,
        diagramMarginY: 10,
        actorMargin: 50,
        width: 150,
        height: 65,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35,
        mirrorActors: false,
        bottomMarginAdj: 1,
        useMaxWidth: true
      },
      gantt: {
        titleTopMargin: 25,
        barHeight: 20,
        barGap: 4,
        topPadding: 50,
        leftPadding: 75,
        gridLineStartPadding: 35,
        fontSize: 11,
        sectionFontSize: 11,
        numberSectionStyles: 4,
        axisFormat: '%Y-%m-%d'
      },
      themeVariables: {
        // 确保在暗色主题下有足够的对比度
        darkMode: document.documentElement.getAttribute('data-theme') === 'dark'
      },
      er: {
        useMaxWidth: true,
        entityPadding: 15,
        entityWidth: 100,
        layoutDirection: 'TB'
      },
      pie: {
        useWidth: 800,
        useMaxWidth: true
      },
      // 添加SVG渲染器配置
      svgDraw: {
        useComputedStyle: true
      },
      // 添加新的渲染配置
      render: {
        useMaxWidth: true,
        maxTextSize: 5000,
        noteFontSize: 14,
        messageFont: 'sans-serif',
        textPlacement: 'fo',
        arrowMarkerAbsolute: false,
        wrap: true
      }
    });
    
    // 标记为已初始化
    mermaidInitialized = true;
    
    // console.log('Mermaid 初始化完成');
    
    // 监听主题变化，更新Mermaid主题
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      window.mermaid.initialize({
        theme: currentTheme === 'dark' ? 'dark' : 'default',
        themeVariables: {
          darkMode: currentTheme === 'dark'
        }
      });
    });
    
    // 添加全局错误处理
    window.addEventListener('error', function(event) {
      if (event.error && event.error.message) {
        if (event.error.message.includes('getBBox') || 
            event.error.message.includes('getBoundingClientRect') ||
            event.error.message.includes('DOMRect')) {
          console.warn('捕获到DOM测量错误，这可能是由于在不可见元素上渲染Mermaid图表导致的');
          event.preventDefault();
        }
      }
    });
    
    // 添加未处理的Promise拒绝处理
    window.addEventListener('unhandledrejection', function(event) {
      if (event.reason && event.reason.message && 
          (event.reason.message.includes('getBBox') || 
           event.reason.message.includes('getBoundingClientRect') ||
           event.reason.message.includes('DOMRect'))) {
        console.warn('捕获到未处理的Promise拒绝，这可能是由于在不可见元素上渲染Mermaid图表导致的');
        event.preventDefault();
      }
    });
    
  } catch (err) {
    console.error('初始化Mermaid时出错:', err);
  }
}

// 显示图表语法帮助
function showDiagramHelp() {
  const helpContent = `
<h3 style="margin-bottom: 4px; padding-bottom: 8px; border-bottom: 2px solid #ff4444;">流程图和图表语法帮助</h3>
<blockquote>
<p>在消息中使用以下语法创建各种<strong>图表</strong>：</p>
</blockquote>
</br>

<h4>1. 横向流程图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
graph LR
    A[开始] --> B{判断}
    B -->|是| C[处理]
    B -->|否| D[结束]
    C --> D
\`\`\`
</code></pre>

<h4>2. 竖向流程图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
graph TD
    A[开始] --> B{判断}
    B -->|是| C[处理]
    B -->|否| D[结束]
    C --> D
\`\`\`
</code></pre>

<h4>3. 标准流程图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
flowchart TD
    A[开始] --> B[流程1]
    B --> C[流程2]
    C --> D[结束]
\`\`\`
</code></pre>

<h4>4. 标准流程图（横向）</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
flowchart LR
    A[开始] --> B[流程1]
    B --> C[流程2]
    C --> D[结束]
\`\`\`
</code></pre>

<h4>5. UML时序图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
sequenceDiagram
    participant 客户端
    participant 服务器
    客户端->>服务器: 请求数据
    服务器-->>客户端: 返回数据
\`\`\`
</code></pre>

<h4>6. 复杂的UML时序图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
sequenceDiagram
    participant 用户
    participant 客户端
    participant 服务器
    participant 数据库
    用户->>客户端: 输入数据
    客户端->>服务器: 发送请求
    服务器->>数据库: 查询数据
    数据库-->>服务器: 返回结果
    服务器-->>客户端: 响应请求
    客户端-->>用户: 显示结果
\`\`\`
</code></pre>

<h4>7. UML标准时序图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
sequenceDiagram
    autonumber
    actor 用户
    用户->>+客户端: 登录请求
    客户端->>+服务器: 验证凭据
    服务器->>+数据库: 查询用户
    数据库-->>-服务器: 返回用户数据
    服务器-->>-客户端: 验证成功
    客户端-->>-用户: 显示欢迎页面
\`\`\`
</code></pre>

<h4>8. 甘特图</h4>
<pre><code class="language-markdown">
\`\`\`mermaid
gantt
    title 项目计划
    dateFormat  YYYY-MM-DD
    section 阶段1
    需求分析    :a1, 2023-01-01, 7d
    设计        :a2, after a1, 10d
    section 阶段2
    开发        :a3, after a2, 15d
    测试        :a4, after a3, 5d
    部署        :a5, after a4, 2d
\`\`\`
</code></pre>

<p>更多语法和示例请参考 <a href="https://mermaid.js.org/syntax/flowchart.html" target="_blank">Mermaid官方文档</a></p>
`;

  // 创建一个模态框
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  
  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';
  modalContent.style.width = '80%';
  modalContent.style.maxWidth = '800px';
  
  // 先设置内容
  modalContent.innerHTML = helpContent;
  
  // 然后添加关闭按钮
  const closeBtn = document.createElement('span');
  closeBtn.className = 'close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  modalContent.appendChild(closeBtn);
  
  modal.appendChild(modalContent);
  document.body.appendChild(modal);
  
  // ESC键关闭图表帮助模态框
  function closeDiagramHelpOnEsc(event) {
    if (event.key === 'Escape') {
      document.body.removeChild(modal);
      // 移除ESC键监听
      document.removeEventListener('keydown', closeDiagramHelpOnEsc);
    }
  }
  
  // 添加ESC键监听
  document.addEventListener('keydown', closeDiagramHelpOnEsc);
  
  // 点击模态框外部关闭
  window.addEventListener('click', function(event) {
    if (event.target === modal) {
      document.body.removeChild(modal);
      // 移除ESC键监听
      document.removeEventListener('keydown', closeDiagramHelpOnEsc);
    }
  });
  
  // 修改关闭按钮事件
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
    // 移除ESC键监听
    document.removeEventListener('keydown', closeDiagramHelpOnEsc);
  });
  
  // 为代码块添加复制按钮
  setTimeout(() => {
    const codeBlocks = modal.querySelectorAll('pre');
    codeBlocks.forEach(block => {
      // 创建复制按钮
      const copyButton = document.createElement('button');
      copyButton.className = 'code-copy-btn';
      copyButton.innerHTML = '<i class="fas fa-copy"></i>';
      copyButton.title = '复制代码';
      
      // 添加点击事件
      copyButton.addEventListener('click', () => {
        const codeText = block.textContent;
        
        copyTextToClipboard(codeText, (success) => {
          // 更新按钮图标以提供反馈
          const originalIcon = copyButton.innerHTML;
          if (success) {
            copyButton.innerHTML = '<i class="fas fa-check"></i>';
          } else {
            copyButton.innerHTML = '<i class="fas fa-times"></i>';
          }
          
          // 2秒后恢复原始图标
          setTimeout(() => {
            copyButton.innerHTML = originalIcon;
          }, 2000);
        });
      });
      
      // 将按钮添加到代码块
      block.appendChild(copyButton);
    });
  }, 100);
}

// 初始化 Lightbox
function initializeLightbox() {
  // 创建 Lightbox 元素
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML = `
    <div class="lightbox-content">
      <img class="lightbox-image" src="" alt="图片预览">
      <div class="lightbox-nav">
        <button class="lightbox-prev"><i class="fas fa-chevron-left"></i></button>
        <button class="lightbox-next"><i class="fas fa-chevron-right"></i></button>
      </div>
      <button class="lightbox-close">&times;</button>
      <div class="lightbox-counter"></div>
    </div>
  `;
  document.body.appendChild(lightbox);

  let currentImageIndex = 0;
  let images = [];

  // 更新图片列表
  function updateImagesList() {
    images = Array.from(document.querySelectorAll('.message-image, .message-bubble img')).filter(img => 
      !img.closest('.emoji-item') && // 排除表情符号
      !img.closest('.mermaid') && // 排除 mermaid 图表
      img.src && img.src.startsWith('http') // 确保是有效的图片URL
    );
  }

  // 显示指定索引的图片
  function showImage(index) {
    updateImagesList();
    if (images.length === 0) return;

    currentImageIndex = (index + images.length) % images.length;
    const img = images[currentImageIndex];
    const lightboxImg = lightbox.querySelector('.lightbox-image');
    lightboxImg.src = img.src;
    
    // 更新计数器
    const counter = lightbox.querySelector('.lightbox-counter');
    counter.textContent = `${currentImageIndex + 1} / ${images.length}`;
    
    lightbox.classList.add('active');
  }

  // 关闭 Lightbox
  function closeLightbox() {
    lightbox.classList.remove('active');
  }

  // 下一张图片
  function nextImage() {
    showImage(currentImageIndex + 1);
  }

  // 上一张图片
  function prevImage() {
    showImage(currentImageIndex - 1);
  }

  // 事件监听
  document.addEventListener('click', (e) => {
    const clickedImage = e.target.closest('.message-image, .message-bubble img');
    if (clickedImage && 
        !clickedImage.closest('.emoji-item') && 
        !clickedImage.closest('.mermaid')) {
      updateImagesList();
      const index = images.indexOf(clickedImage);
      if (index !== -1) {
        showImage(index);
      }
    }
  });

  // 关闭按钮点击事件
  lightbox.querySelector('.lightbox-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  // 上一张按钮点击事件
  lightbox.querySelector('.lightbox-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    prevImage();
  });

  // 下一张按钮点击事件
  lightbox.querySelector('.lightbox-next').addEventListener('click', (e) => {
    e.stopPropagation();
    nextImage();
  });

  // 点击背景关闭
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  // 键盘事件
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;

    switch (e.key) {
      case 'Escape':
        closeLightbox();
        break;
      case 'ArrowLeft':
        prevImage();
        break;
      case 'ArrowRight':
        nextImage();
        break;
    }
  });
}

// 在页面加载完成后初始化 Lightbox
document.addEventListener('DOMContentLoaded', () => {
  initializeLightbox();
});