// Helper function to get cookie value
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Logout function
async function logout() {
    if (!confirm('Bạn có chắc muốn đăng xuất?')) {
        return;
    }

    try {
        const token = localStorage.getItem('session_token') || 
                      sessionStorage.getItem('session_token') ||
                      getCookie('session_token');
        
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        // Clear local storage and cookies
        localStorage.removeItem('session_token');
        sessionStorage.removeItem('session_token');
        localStorage.removeItem('user_info');
        localStorage.removeItem('last_user_id');
        localStorage.removeItem('savedChatMessages');
        localStorage.removeItem('chatSessionId');
        document.cookie = 'session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

        // Redirect to login
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect anyway
        window.location.href = '/login';
    }
}

// Check authentication on page load
function checkAuth() {
    // Get token from localStorage, sessionStorage, or cookie
    const token = localStorage.getItem('session_token') || 
                  sessionStorage.getItem('session_token') ||
                  getCookie('session_token');
    
    if (!token) {
        window.location.href = '/login';
        return false;
    }

    // Validate session
    fetch('/api/auth/validate', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            window.location.href = '/login';
        } else {
            // Check if user is admin - admins should not access user web
            if (data.user && data.user.role === 'admin') {
                console.log('Admin user detected, redirecting to admin web');
                window.location.href = 'http://localhost:7860/admin';
                return;
            }
            
            // Check if user has changed (different user logged in)
            const lastUserId = localStorage.getItem('last_user_id');
            const currentUserId = data.user.id.toString();
            
            if (lastUserId && lastUserId !== currentUserId) {
                // Different user logged in, clear chat history
                console.log('Different user detected, clearing chat history');
                localStorage.removeItem('savedChatMessages');
                localStorage.removeItem('chatSessionId');
            }
            
            // Store current user ID
            localStorage.setItem('last_user_id', currentUserId);
            
            // Update username display
            if (data.user && data.user.username) {
                const usernameEl = document.getElementById('user-name');
                if (usernameEl) {
                    usernameEl.textContent = data.user.full_name || data.user.username;
                }
            }
        }
    })
    .catch(() => {
        window.location.href = '/login';
    });

    return true;
}

// Application state
const state = {
    documents: [],
    questionCount: 0,
    isTyping: false,
    sessionId: loadSessionId(),
    chatHistory: [],
    lastMessageHasReport: false
};

// API base URL
const API_BASE = window.location.origin + '/api';

// DOM elements
const elements = {
    documentList: document.getElementById('documentList'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendButton: document.getElementById('sendButton'),
    clearChat: document.getElementById('clearChat'),
    totalDocs: document.getElementById('totalDocs'),
    totalQuestions: document.getElementById('totalQuestions'),
    charCount: document.getElementById('charCount'),
    typingIndicator: document.getElementById('typingIndicator'),
    reportModal: document.getElementById('reportModal'),
    reportModalClose: document.getElementById('reportModalClose'),
    reportType: document.getElementById('reportType'),
    reportDetails: document.getElementById('reportDetails'),
    submitReport: document.getElementById('submitReport'),
    toastContainer: document.getElementById('toastContainer')
};

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication first
    if (!checkAuth()) {
        return;
    }

    initializeEventListeners();
    loadDocuments();
    updateStats();
    loadChatHistory(); // Load saved chat history
});

// Generate or load session ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function loadSessionId() {
    let sessionId = localStorage.getItem('chatSessionId');
    if (!sessionId) {
        sessionId = generateSessionId();
        localStorage.setItem('chatSessionId', sessionId);
    }
    return sessionId;
}

// Save individual message to history
function saveMessageToHistory(message) {
    try {
        let savedMessages = JSON.parse(localStorage.getItem('savedChatMessages') || '[]');
        savedMessages.push(message);
        localStorage.setItem('savedChatMessages', JSON.stringify(savedMessages));
    } catch (error) {
        console.error('Error saving message:', error);
    }
}

// Save chat history to localStorage (for backward compatibility)
function saveChatToStorage() {
    try {
        localStorage.setItem('chatHistory', JSON.stringify(state.chatHistory));
    } catch (error) {
        console.error('Error saving chat history:', error);
    }
}

// Load chat history from server
async function loadChatHistory() {
    try {
        // Get token for authentication
        const token = localStorage.getItem('session_token') || 
                      sessionStorage.getItem('session_token') ||
                      getCookie('session_token');
        
        if (!token) {
            console.log('No token available, skipping history load');
            return;
        }

        // Fetch history from server
        const response = await fetch('/api/chat/history?limit=50', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.warn('Failed to load chat history from server');
            return;
        }

        const data = await response.json();
        
        if (data.success && data.history && data.history.length > 0) {
            // Clear welcome message first
            const welcomeMsg = elements.chatMessages.querySelector('.welcome-message');
            if (welcomeMsg) {
                welcomeMsg.remove();
            }
            
            // Restore each message (history is in reverse order, so reverse it)
            const messages = data.history.reverse();
            messages.forEach(chat => {
                // Add user question
                addMessageToChat('user', chat.question);
                // Add AI answer
                addMessageToChat('ai', chat.answer, chat.sources || []);
            });
            
            // Update last message report button
            state.lastMessageHasReport = true;
            
            // Scroll to bottom
            scrollToBottom();
            
            console.log(`✓ Loaded ${messages.length} conversations from server`);
        } else {
            console.log('No chat history found on server');
        }
    } catch (error) {
        console.error('Error loading chat history from server:', error);
    }
}

// Scroll to bottom helper
function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Event listeners
function initializeEventListeners() {
    // Chat events
    elements.chatInput.addEventListener('input', handleChatInput);
    elements.chatInput.addEventListener('keypress', handleKeyPress);
    elements.sendButton.addEventListener('click', sendMessage);
    elements.clearChat.addEventListener('click', clearChatHistory);
    
    // Modal events
    elements.reportModalClose.addEventListener('click', closeReportModal);
    elements.reportModal.addEventListener('click', (e) => {
        if (e.target === elements.reportModal) closeReportModal();
    });
    elements.submitReport.addEventListener('click', submitReport);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// Chat input handling
function handleChatInput(e) {
    const length = e.target.value.length;
    elements.charCount.textContent = `${length}/500`;
    elements.sendButton.disabled = length === 0 || state.isTyping;
}

function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// Send message with streaming
async function sendMessage() {
    const message = elements.chatInput.value.trim();
    if (!message || state.isTyping) return;
    
    // Add user message to chat
    addMessageToChat('user', message);
    
    // Save user message to history
    const userMsg = { type: 'user', content: message, timestamp: Date.now() };
    saveMessageToHistory(userMsg);
    
    elements.chatInput.value = '';
    elements.charCount.textContent = '0/500';
    elements.sendButton.disabled = true;
    
    // Show typing indicator with animated dots
    state.isTyping = true;
    elements.typingIndicator.style.display = 'inline-flex';
    
    // Add thinking message placeholder
    const thinkingMsgId = 'thinking-' + Date.now();
    addThinkingMessage(thinkingMsgId);
    
    try {
        // Use EventSource for streaming
        const response = await fetch(`${API_BASE}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                session_id: state.sessionId,
                chat_history: state.chatHistory
            })
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let answer = '';
        let sources = null;
        
        // Remove thinking message
        removeThinkingMessage(thinkingMsgId);
        
        // Add AI message container
        const aiMsgId = 'ai-' + Date.now();
        addStreamingMessage(aiMsgId);
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'token') {
                            answer += data.content;
                            updateStreamingMessage(aiMsgId, answer);
                        } else if (data.type === 'done') {
                            sources = data.sources;
                            if (data.session_id) {
                                state.sessionId = data.session_id;
                            }
                            updateStreamingMessage(aiMsgId, answer, sources, true);
                            
                            // Save assistant message to history
                            const assistantMsg = {
                                type: 'assistant',
                                content: answer,
                                sources: sources || [],
                                timestamp: Date.now()
                            };
                            saveMessageToHistory(assistantMsg);
                        } else if (data.type === 'error') {
                            updateStreamingMessage(aiMsgId, `❌ Lỗi: ${data.error}`, null, true);
                        }
                    } catch (e) {
                        // Ignore parsing errors for incomplete chunks
                    }
                }
            }
        }
        
        // Update chat history
        state.chatHistory.push([message, answer]);
        state.questionCount++;
        state.lastMessageHasReport = true;
        
        // Update stats
        updateStats();
        
    } catch (error) {
        console.error('Error sending message:', error);
        removeThinkingMessage(thinkingMsgId);
        addMessageToChat('ai', '❌ Không thể kết nối đến server. Vui lòng thử lại sau.');
    } finally {
        state.isTyping = false;
        elements.typingIndicator.style.display = 'none';
        elements.sendButton.disabled = false;
    }
}

// Add message to chat
function addMessageToChat(sender, message, sources = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = sender === 'user' ? 'user-message' : 'ai-message';
    
    if (sender === 'user') {
        messageDiv.innerHTML = `
            <div class="message-content">
                <p>${escapeHtml(message)}</p>
            </div>
            <div class="user-avatar">
                <i class="fas fa-user"></i>
            </div>
        `;
    } else {
        let sourceHtml = '';
        if (sources && sources.length > 0) {
            sourceHtml = '<div class="sources"><p><strong>📚 Nguồn:</strong></p><ul>';
            sources.forEach(source => {
                const page = source.page ? ` - Trang ${source.page}` : '';
                sourceHtml += `<li>${escapeHtml(source.filename)}${page}</li>`;
            });
            sourceHtml += '</ul></div>';
        }
        
        // Add report button if this is the last message
        const reportButton = state.lastMessageHasReport ? 
            `<button class="report-button" onclick="openReportModal()">
                <i class="fas fa-flag"></i> Báo cáo vấn đề
            </button>` : '';
        
        messageDiv.innerHTML = `
            <div class="ai-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div class="message-content">
                <p>${formatMessage(message)}</p>
                ${sourceHtml}
                ${reportButton}
            </div>
        `;
    }
    
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Add thinking message with animated dots
function addThinkingMessage(msgId) {
    const messageDiv = document.createElement('div');
    messageDiv.id = msgId;
    messageDiv.className = 'ai-message thinking-message';
    messageDiv.innerHTML = `
        <div class="ai-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
            <div class="thinking-dots">
                <span>.</span><span>.</span><span>.</span>
            </div>
        </div>
    `;
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Remove thinking message
function removeThinkingMessage(msgId) {
    const msg = document.getElementById(msgId);
    if (msg) msg.remove();
}

// Add streaming message container
function addStreamingMessage(msgId) {
    const messageDiv = document.createElement('div');
    messageDiv.id = msgId;
    messageDiv.className = 'ai-message';
    messageDiv.innerHTML = `
        <div class="ai-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
            <p></p>
        </div>
    `;
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Update streaming message
function updateStreamingMessage(msgId, text, sources = null, addReport = false) {
    const msg = document.getElementById(msgId);
    if (!msg) return;
    
    const content = msg.querySelector('.message-content');
    let html = `<p>${formatMessage(text)}</p>`;
    
    if (sources && sources.length > 0) {
        html += '<div class="sources"><p><strong>📚 Nguồn:</strong></p><ul>';
        sources.forEach(source => {
            const page = source.page ? ` - Trang ${source.page}` : '';
            html += `<li>${escapeHtml(source.filename)}${page}</li>`;
        });
        html += '</ul></div>';
    }
    
    if (addReport) {
        html += `<button class="report-button" onclick="openReportModal()">
            <i class="fas fa-flag"></i> Báo cáo vấn đề
        </button>`;
    }
    
    content.innerHTML = html;
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Format message (convert markdown-like syntax)
function formatMessage(text) {
    // Convert **bold** to <strong>
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert line breaks
    text = text.replace(/\n/g, '<br>');
    return text;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Clear chat history
async function clearChatHistory() {
    if (!confirm('Bạn có chắc muốn xóa toàn bộ lịch sử trò chuyện?')) return;
    
    try {
        // Get token for authentication
        const token = localStorage.getItem('session_token') || 
                      sessionStorage.getItem('session_token') ||
                      getCookie('session_token');
        
        // Clear chat history on server
        const response = await fetch('/api/chat/clear', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to clear history on server');
        }
        
        // Clear UI
        elements.chatMessages.innerHTML = `
            <div class="welcome-message">
                <div class="ai-avatar">
                    <i class="fas fa-robot"></i>
                </div>
                <div class="message-content">
                    <p>Xin chào! Tôi là trợ lý AI của bạn. Hãy đặt câu hỏi về tài liệu nội bộ, tôi sẽ giúp bạn tìm kiếm thông tin một cách chính xác.</p>
                </div>
            </div>
        `;
        
        state.chatHistory = [];
        state.lastMessageHasReport = false;
        
        // Clear localStorage
        localStorage.removeItem('savedChatMessages');
        localStorage.removeItem('chatHistory');
        
        // Update stats to reflect the cleared chat count
        await updateStats();
        
        showToast('Đã xóa lịch sử trò chuyện', 'success');
        
    } catch (error) {
        console.error('Error clearing chat:', error);
        showToast('Không thể xóa lịch sử', 'error');
    }
}

// Load documents
async function loadDocuments() {
    try {
        const response = await fetch(`${API_BASE}/documents`);
        const data = await response.json();
        
        if (data.success) {
            state.documents = data.documents;
            updateDocumentList();
        }
    } catch (error) {
        console.error('Error loading documents:', error);
        elements.documentList.innerHTML = '<p class="error">Không thể tải danh sách tài liệu</p>';
    }
}

// Update document list
function updateDocumentList() {
    if (state.documents.length === 0) {
        elements.documentList.innerHTML = '<p class="empty">Chưa có tài liệu nào</p>';
        return;
    }
    
    elements.documentList.innerHTML = state.documents.map(doc => {
        const uploadDate = new Date(doc.upload_date).toLocaleDateString('vi-VN');
        const fileSize = formatFileSize(doc.file_size);
        
        return `
            <div class="document-item">
                <div class="document-icon">
                    <i class="fas ${getFileIcon(doc.filename)}"></i>
                </div>
                <div class="document-info">
                    <div class="document-name">${escapeHtml(doc.filename)}</div>
                    <div class="document-meta">${fileSize} • ${uploadDate}</div>
                </div>
                <button class="download-btn" onclick="downloadDocument(${doc.id})" title="Tải xuống">
                    <i class="fas fa-download"></i>
                </button>
            </div>
        `;
    }).join('');
}

// Download document
async function downloadDocument(docId) {
    try {
        window.open(`${API_BASE}/download/${docId}`, '_blank');
        showToast('Đang tải xuống tài liệu...', 'info');
    } catch (error) {
        console.error('Error downloading document:', error);
        showToast('Không thể tải xuống tài liệu', 'error');
    }
}

// Update stats
async function updateStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        if (data.success) {
            elements.totalDocs.textContent = data.stats.total_documents;
            // Show user's question count, not total system questions
            elements.totalQuestions.textContent = data.stats.user_questions || 0;
        }
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Report modal
function openReportModal() {
    elements.reportModal.style.display = 'flex';
    elements.reportDetails.value = '';
}

function closeReportModal() {
    elements.reportModal.style.display = 'none';
}

async function submitReport() {
    const reportType = elements.reportType.value;
    const details = elements.reportDetails.value.trim();
    
    if (!details) {
        showToast('Vui lòng nhập chi tiết vấn đề', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/report`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: state.sessionId,
                report_type: reportType,
                details: details
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            closeReportModal();
            state.lastMessageHasReport = false;
        } else {
            showToast(`Lỗi: ${data.error}`, 'error');
        }
        
    } catch (error) {
        console.error('Error submitting report:', error);
        showToast('Không thể gửi báo cáo', 'error');
    }
}

// Utility functions
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'txt': 'fa-file-alt',
        'md': 'fa-file-alt'
    };
    return icons[ext] || 'fa-file';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + K to focus input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        elements.chatInput.focus();
    }
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span>${message}</span>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
