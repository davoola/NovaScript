// Initialize Socket.IO connection with authentication
let socket;

// DOM Elements
const messagesContainer = document.querySelector('.messages-container');
const messageInput = document.querySelector('.message-input');
const sendButton = document.querySelector('.send-btn');
const emojiButton = document.querySelector('.emoji-btn');
const fileButton = document.querySelector('.file-btn');
const previewButton = document.querySelector('.preview-btn');
const logoutButton = document.createElement('button');

// Check authentication
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login';
        return false;
    }
    return token;
}

// Connect to Socket.IO with authentication
function connectSocket() {
    const token = checkAuth();
    if (!token) return;

    socket = io({
        auth: {
            token: token
        }
    });

    // Handle connection errors
    socket.on('connect_error', (error) => {
        if (error.message === 'Authentication required' || error.message === 'Invalid token') {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
    });

    // Handle received messages
    socket.on('chat message', (messageData) => {
        const messageElement = createMessageElement(messageData);
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
}

// Initialize user data
function initializeUser() {
    const userData = localStorage.getItem('user');
    if (userData) {
        const user = JSON.parse(userData);
        document.querySelector('.username').textContent = user.nickname;
        document.querySelector('.user-avatar').src = user.avatarUrl;
    }
}

// Add logout button to chat header
logoutButton.className = 'logout-btn';
logoutButton.textContent = 'Logout';
document.querySelector('.chat-header').appendChild(logoutButton);

// Logout handler
logoutButton.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
});

// Markdown Configuration
const renderer = new marked.Renderer();

// 自定义表格渲染器以支持对齐
renderer.table = function(header, body) {
    // 确保header和body是字符串
    const headerStr = header ? header.toString() : '';
    const bodyStr = body ? body.toString() : '';
    
    return '<div class="table-wrapper"><table class="markdown-table">' 
        + headerStr
        + bodyStr
        + '</table></div>';
};

renderer.tablecell = function(content, flags) {
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
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true,
    renderer: renderer,
    extensions: [
        window.markedEmoji(emojiOptions)
    ]
});

// Initialize Mermaid
mermaid.initialize({ startOnLoad: true });

// Message handling
function sendMessage() {
    const message = messageInput.value.trim();
    if (message && socket) {
        const messageData = {
            content: message,
            timestamp: new Date().toISOString()
        };

        socket.emit('chat message', messageData);
        messageInput.value = '';
    }
}

// Event Listeners
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Create message element with Markdown support
function createMessageElement(messageData) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    // Convert Markdown to HTML
    const htmlContent = marked.parse(messageData.content);
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="sender">${messageData.sender.username}</span>
            <span class="timestamp">${new Date(messageData.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="message-content">${htmlContent}</div>
    `;

    // Process any Mermaid diagrams
    messageDiv.querySelectorAll('.language-mermaid').forEach((element) => {
        mermaid.render('mermaid-' + Date.now(), element.textContent)
            .then(({ svg }) => {
                element.innerHTML = svg;
            });
    });

    return messageDiv;
}

// Handle file uploads
fileButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx';
    input.multiple = true;
    
    input.onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            if (file.size > 500 * 1024 * 1024) { // 500MB limit
                alert('File size exceeds 500MB limit');
                return;
            }
            // TODO: Implement file upload logic
        });
    };
    
    input.click();
});

// Handle emoji picker
emojiButton.addEventListener('click', () => {
    const modal = document.getElementById('emoji-help-modal');
    if (modal) {
        modal.style.display = 'block';
    }
});

// Handle preview
let isPreviewMode = false;
previewButton.addEventListener('click', () => {
    isPreviewMode = !isPreviewMode;
    if (isPreviewMode) {
        const previewContent = marked.parse(messageInput.value);
        messageInput.style.display = 'none';
        const previewElement = document.createElement('div');
        previewElement.className = 'preview-content';
        previewElement.innerHTML = previewContent;
        messageInput.parentNode.insertBefore(previewElement, messageInput);
    } else {
        const previewElement = document.querySelector('.preview-content');
        if (previewElement) {
            previewElement.remove();
        }
        messageInput.style.display = '';
    }
});

// Initialize the application
function init() {
    if (checkAuth()) {
        connectSocket();
        initializeUser();
    }
}

// 在页面加载完成后初始化表情功能
document.addEventListener('DOMContentLoaded', function() {
    // 重新获取emoji按钮，确保DOM已加载
    const emojiBtn = document.querySelector('.emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', function() {
            const modal = document.getElementById('emoji-help-modal');
            if (modal) {
                modal.style.display = 'block';
            }
        });
    }

    // 初始化表情面板
    initEmojiPanels();
    
    // 初始化关闭按钮事件
    const closeBtn = document.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            const modal = document.getElementById('emoji-help-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    // 初始化表情标签切换
    const tabButtons = document.querySelectorAll('.emoji-tab-btn');
    const panels = document.querySelectorAll('.emoji-panel');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            // 移除所有活动状态
            tabButtons.forEach(btn => btn.classList.remove('active'));
            panels.forEach(panel => panel.classList.remove('active'));
            
            // 添加当前活动状态
            this.classList.add('active');
            const target = this.getAttribute('data-target');
            const targetPanel = document.getElementById(`${target}-panel`);
            if (targetPanel) {
                targetPanel.classList.add('active');
                // 确保面板内容已填充
                const panelType = target;
                switch(panelType) {
                    case 'nature':
                        fillEmojiPanel('nature-panel', natureEmojis);
                        break;
                    case 'food':
                        fillEmojiPanel('food-panel', foodEmojis);
                        break;
                    case 'activities':
                        fillEmojiPanel('activities-panel', activitiesEmojis);
                        break;
                    case 'travel':
                        fillEmojiPanel('travel-panel', travelEmojis);
                        break;
                    case 'objects':
                        fillEmojiPanel('objects-panel', objectsEmojis);
                        break;
                    case 'symbols':
                        fillEmojiPanel('symbols-panel', symbolsEmojis);
                        break;
                }
                targetPanel.classList.add('active');
            }
        });
    });
    
    // 点击模态框外部关闭
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('emoji-help-modal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
});

// 填充表情面板
function fillEmojiPanel(panelId, emojis) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    
    // 清空现有内容
    panel.innerHTML = '';
    
    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    
    emojis.forEach(item => {
        const emojiItem = document.createElement('div');
        emojiItem.className = 'emoji-item';
        emojiItem.innerHTML = `<span class="emoji">${item.emoji}</span>`;
        emojiItem.setAttribute('data-code', item.code);
        
        // 添加点击事件
        emojiItem.addEventListener('click', function() {
            const messageInput = document.getElementById('message-input');
            const emojiCode = this.getAttribute('data-code');
            if (messageInput && emojiCode) {
                const cursorPos = messageInput.selectionStart;
                const textBefore = messageInput.value.substring(0, cursorPos);
                const textAfter = messageInput.value.substring(cursorPos);
                
                messageInput.value = textBefore + emojiCode + textAfter;
                messageInput.focus();
                messageInput.selectionStart = cursorPos + emojiCode.length;
                messageInput.selectionEnd = cursorPos + emojiCode.length;
                
                // 关闭表情模态框
                const emojiModal = document.getElementById('emoji-help-modal');
                if (emojiModal) {
                    emojiModal.style.display = 'none';
                }
            }
        });
        
        grid.appendChild(emojiItem);
    });
    
    panel.appendChild(grid);
}

// 自然类表情
const natureEmojis = [
  { code: ':dog:', emoji: '🐶' },
  { code: ':cat:', emoji: '🐱' },
  { code: ':mouse:', emoji: '🐭' },
  { code: ':hamster:', emoji: '🐹' },
  { code: ':rabbit:', emoji: '🐰' },
  { code: ':fox:', emoji: '🦊' },
  { code: ':bear:', emoji: '🐻' },
  { code: ':panda:', emoji: '🐼' },
  { code: ':koala:', emoji: '🐨' },
  { code: ':tiger:', emoji: '🐯' },
  { code: ':lion:', emoji: '🦁' },
  { code: ':cow:', emoji: '🐮' },
  { code: ':pig:', emoji: '🐷' },
  { code: ':frog:', emoji: '🐸' },
  { code: ':monkey:', emoji: '🐵' },
  { code: ':chicken:', emoji: '🐔' },
  { code: ':penguin:', emoji: '🐧' },
  { code: ':bird:', emoji: '🐦' },
  { code: ':butterfly:', emoji: '🦋' },
  { code: ':flower:', emoji: '🌸' }
];

// 食物类表情
const foodEmojis = [
  { code: ':apple:', emoji: '🍎' },
  { code: ':pizza:', emoji: '🍕' },
  { code: ':hamburger:', emoji: '🍔' },
  { code: ':fries:', emoji: '🍟' },
  { code: ':sushi:', emoji: '🍣' },
  { code: ':ramen:', emoji: '🍜' },
  { code: ':rice:', emoji: '🍚' },
  { code: ':curry:', emoji: '🍛' },
  { code: ':bread:', emoji: '🍞' },
  { code: ':egg:', emoji: '🥚' },
  { code: ':icecream:', emoji: '🍦' },
  { code: ':cake:', emoji: '🍰' },
  { code: ':coffee:', emoji: '☕' },
  { code: ':tea:', emoji: '🍵' },
  { code: ':beer:', emoji: '🍺' },
  { code: ':wine:', emoji: '🍷' },
  { code: ':watermelon:', emoji: '🍉' },
  { code: ':banana:', emoji: '🍌' },
  { code: ':strawberry:', emoji: '🍓' },
  { code: ':grapes:', emoji: '🍇' }
];

// 活动类表情
const activitiesEmojis = [
  { code: ':soccer:', emoji: '⚽' },
  { code: ':basketball:', emoji: '🏀' },
  { code: ':football:', emoji: '🏈' },
  { code: ':baseball:', emoji: '⚾' },
  { code: ':tennis:', emoji: '🎾' },
  { code: ':bowling:', emoji: '🎳' },
  { code: ':golf:', emoji: '⛳' },
  { code: ':dart:', emoji: '🎯' },
  { code: ':game_die:', emoji: '🎲' },
  { code: ':chess:', emoji: '♟️' },
  { code: ':trophy:', emoji: '🏆' },
  { code: ':medal:', emoji: '🏅' },
  { code: ':running:', emoji: '🏃' },
  { code: ':swimming:', emoji: '🏊' },
  { code: ':surfing:', emoji: '🏄' },
  { code: ':skiing:', emoji: '⛷️' },
  { code: ':biking:', emoji: '🚴' },
  { code: ':weight_lifting:', emoji: '🏋️' },
  { code: ':dancing:', emoji: '💃' },
  { code: ':microphone:', emoji: '🎤' }
];

// 旅行类表情
const travelEmojis = [
  { code: ':car:', emoji: '🚗' },
  { code: ':taxi:', emoji: '🚕' },
  { code: ':bus:', emoji: '🚌' },
  { code: ':train:', emoji: '🚂' },
  { code: ':airplane:', emoji: '✈️' },
  { code: ':ship:', emoji: '🚢' },
  { code: ':motorcycle:', emoji: '🏍️' },
  { code: ':bicycle:', emoji: '🚲' },
  { code: ':mountain:', emoji: '⛰️' },
  { code: ':beach:', emoji: '🏖️' },
  { code: ':desert:', emoji: '🏜️' },
  { code: ':island:', emoji: '🏝️' },
  { code: ':hotel:', emoji: '🏨' },
  { code: ':tent:', emoji: '⛺' },
  { code: ':map:', emoji: '🗺️' },
  { code: ':compass:', emoji: '🧭' },
  { code: ':luggage:', emoji: '🧳' },
  { code: ':passport:', emoji: '📔' },
  { code: ':ticket:', emoji: '🎫' },
  { code: ':camera:', emoji: '📸' }
];

// 物品类表情
const objectsEmojis = [
  { code: ':phone:', emoji: '📱' },
  { code: ':computer:', emoji: '💻' },
  { code: ':tv:', emoji: '📺' },
  { code: ':radio:', emoji: '📻' },
  { code: ':camera:', emoji: '📷' },
  { code: ':video_camera:', emoji: '📹' },
  { code: ':book:', emoji: '📚' },
  { code: ':newspaper:', emoji: '📰' },
  { code: ':pencil:', emoji: '✏️' },
  { code: ':pen:', emoji: '🖊️' },
  { code: ':paperclip:', emoji: '📎' },
  { code: ':scissors:', emoji: '✂️' },
  { code: ':key:', emoji: '🔑' },
  { code: ':lock:', emoji: '🔒' },
  { code: ':hammer:', emoji: '🔨' },
  { code: ':wrench:', emoji: '🔧' },
  { code: ':bulb:', emoji: '💡' },
  { code: ':battery:', emoji: '🔋' },
  { code: ':clock:', emoji: '🕐' },
  { code: ':gift:', emoji: '🎁' }
];

// 符号类表情
const symbolsEmojis = [
  { code: ':heart:', emoji: '❤️' },
  { code: ':orange_heart:', emoji: '🧡' },
  { code: ':yellow_heart:', emoji: '💛' },
  { code: ':green_heart:', emoji: '💚' },
  { code: ':blue_heart:', emoji: '💙' },
  { code: ':purple_heart:', emoji: '💜' },
  { code: ':black_heart:', emoji: '🖤' },
  { code: ':broken_heart:', emoji: '💔' },
  { code: ':star:', emoji: '⭐' },
  { code: ':sparkles:', emoji: '✨' },
  { code: ':sun:', emoji: '☀️' },
  { code: ':moon:', emoji: '🌙' },
  { code: ':cloud:', emoji: '☁️' },
  { code: ':rainbow:', emoji: '🌈' },
  { code: ':peace:', emoji: '✌️' },
  { code: ':check:', emoji: '✅' },
  { code: ':x:', emoji: '❌' },
  { code: ':warning:', emoji: '⚠️' },
  { code: ':question:', emoji: '❓' },
  { code: ':exclamation:', emoji: '❗' }
];

// 初始化表情面板
function initEmojiPanels() {
    // 填充所有表情分类面板
    fillEmojiPanel('common-panel', [
        { code: ':smile:', emoji: '😊' },
        { code: ':laughing:', emoji: '😆' },
        { code: ':blush:', emoji: '😊' },
        { code: ':smiley:', emoji: '😃' },
        { code: ':relaxed:', emoji: '☺️' },
        { code: ':heart:', emoji: '❤️' },
        { code: ':thumbsup:', emoji: '👍' },
        { code: ':thumbsdown:', emoji: '👎' },
        { code: ':+1:', emoji: '👍' },
        { code: ':-1:', emoji: '👎' },
        { code: ':eyes:', emoji: '👀' },
        { code: ':sob:', emoji: '😭' },
        { code: ':joy:', emoji: '😂' },
        { code: ':clap:', emoji: '👏' },
        { code: ':fire:', emoji: '🔥' },
        { code: ':rocket:', emoji: '🚀' },
        { code: ':warning:', emoji: '⚠️' },
        { code: ':star:', emoji: '⭐' },
        { code: ':sparkles:', emoji: '✨' },
        { code: ':zap:', emoji: '⚡' }
    ]);
    fillEmojiPanel('nature-panel', natureEmojis);
    fillEmojiPanel('food-panel', foodEmojis);
    fillEmojiPanel('activities-panel', activitiesEmojis);
    fillEmojiPanel('travel-panel', travelEmojis);
    fillEmojiPanel('objects-panel', objectsEmojis);
    fillEmojiPanel('symbols-panel', symbolsEmojis);
}

// 为帮助模态框中的代码示例添加复制按钮
function addCopyButtonsToExamples() {
    const preElements = document.querySelectorAll('.modal-content pre');
    preElements.forEach((pre, index) => {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.title = '复制代码';
        
        copyBtn.addEventListener('click', async () => {
            const code = pre.textContent;
            try {
                await navigator.clipboard.writeText(code);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            } catch (err) {
                console.error('复制失败:', err);
                copyBtn.innerHTML = '<i class="fas fa-times"></i>';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            }
        });
        
        pre.appendChild(copyBtn);
    });
}

// 在帮助模态框显示时添加复制按钮
document.querySelector('.emoji-btn').addEventListener('click', () => {
    // 等待模态框内容加载完成
    setTimeout(addCopyButtonsToExamples, 100);
});

init();