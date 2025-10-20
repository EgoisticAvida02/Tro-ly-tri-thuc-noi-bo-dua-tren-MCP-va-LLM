// Application state
const state = {
    documents: [],
    questionCount: 0,
    isTyping: false,
    uploadQueue: []
};

// DOM elements
const elements = {
    uploadArea: document.getElementById('uploadArea'),
    fileInput: document.getElementById('fileInput'),
    uploadProgress: document.getElementById('uploadProgress'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    documentList: document.getElementById('documentList'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendButton: document.getElementById('sendButton'),
    clearChat: document.getElementById('clearChat'),
    totalDocs: document.getElementById('totalDocs'),
    totalQuestions: document.getElementById('totalQuestions'),
    charCount: document.getElementById('charCount'),
    typingIndicator: document.getElementById('typingIndicator'),
    documentModal: document.getElementById('documentModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),
    toastContainer: document.getElementById('toastContainer')
};

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    updateStats();
});

// Event listeners
function initializeEventListeners() {
    // File upload events
    elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
    elements.uploadArea.addEventListener('dragover', handleDragOver);
    elements.uploadArea.addEventListener('dragleave', handleDragLeave);
    elements.uploadArea.addEventListener('drop', handleDrop);
    elements.fileInput.addEventListener('change', handleFileSelect);
    
    // Chat events
    elements.chatInput.addEventListener('input', handleChatInput);
    elements.chatInput.addEventListener('keypress', handleKeyPress);
    elements.sendButton.addEventListener('click', sendMessage);
    elements.clearChat.addEventListener('click', clearChatHistory);
    
    // Modal events
    elements.modalClose.addEventListener('click', closeModal);
    elements.documentModal.addEventListener('click', (e) => {
        if (e.target === elements.documentModal) closeModal();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// File upload handling
function handleDragOver(e) {
    e.preventDefault();
    elements.uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    processFiles(files);
}

function processFiles(files) {
    const validFiles = files.filter(file => {
        const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown', 'text/plain'];
        return validTypes.includes(file.type) || file.name.endsWith('.md');
    });
    
    if (validFiles.length === 0) {
        showToast('Vui lòng chọn file có định dạng hợp lệ (PDF, DOCX, MD, TXT)', 'error');
        return;
    }
    
    validFiles.forEach(file => uploadFile(file));
}

function uploadFile(file) {
    const fileId = generateId();
    const fileObj = {
        id: fileId,
        name: file.name,
        size: file.size,
        type: getFileType(file.name),
        uploadDate: new Date(),
        status: 'uploading'
    };
    
    state.documents.push(fileObj);
    updateDocumentList();
    updateStats();
    
    // Simulate upload progress
    simulateUpload(fileId, file.name);
}

function simulateUpload(fileId, fileName) {
    elements.uploadProgress.style.display = 'block';
    let progress = 0;
    
    const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            completeUpload(fileId, fileName);
        }
        
        elements.progressBar.style.setProperty('--progress', `${progress}%`);
        elements.progressBar.style.width = `${progress}%`;
        elements.progressText.textContent = `${Math.round(progress)}%`;
    }, 200);
}

function completeUpload(fileId, fileName) {
    const doc = state.documents.find(d => d.id === fileId);
    if (doc) {
        doc.status = 'ready';
        updateDocumentList();
        showToast(`Đã tải lên thành công: ${fileName}`, 'success');
    }
    
    setTimeout(() => {
        elements.uploadProgress.style.display = 'none';
        elements.progressBar.style.width = '0%';
        elements.progressText.textContent = '0%';
    }, 1000);
}

// Document management
function updateDocumentList() {
    elements.documentList.innerHTML = '';
    
    state.documents.forEach(doc => {
        const docElement = createDocumentElement(doc);
        elements.documentList.appendChild(docElement);
    });
}

function createDocumentElement(doc) {
    const div = document.createElement('div');
    div.className = 'document-item';
    div.innerHTML = `
        <div class="document-icon ${doc.type}">
            <i class="fas fa-file-${getFileIcon(doc.type)}"></i>
        </div>
        <div class="document-info">
            <div class="document-name">${doc.name}</div>
            <div class="document-meta">${formatFileSize(doc.size)} • ${formatDate(doc.uploadDate)}</div>
        </div>
        <div class="document-actions">
            <button onclick="viewDocument('${doc.id}')" title="Xem chi tiết">
                <i class="fas fa-eye"></i>
            </button>
            <button onclick="deleteDocument('${doc.id}')" title="Xóa">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    
    if (doc.status === 'uploading') {
        div.style.opacity = '0.6';
    }
    
    return div;
}

// Chat functionality
function handleChatInput(e) {
    const value = e.target.value;
    const charCount = value.length;
    
    elements.charCount.textContent = `${charCount}/500`;
    elements.sendButton.disabled = charCount === 0 || charCount > 500;
    
    if (charCount > 450) {
        elements.charCount.style.color = '#e53e3e';
    } else {
        elements.charCount.style.color = '#718096';
    }
}

function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!elements.sendButton.disabled) {
            sendMessage();
        }
    }
}

function sendMessage() {
    const message = elements.chatInput.value.trim();
    if (!message) return;
    
    // Add user message
    addMessage(message, 'user');
    
    // Clear input
    elements.chatInput.value = '';
    elements.charCount.textContent = '0/500';
    elements.sendButton.disabled = true;
    
    // Show typing indicator
    showTyping();
    
    // Simulate AI response
    setTimeout(() => {
        hideTyping();
        generateAIResponse(message);
        state.questionCount++;
        updateStats();
    }, 1500 + Math.random() * 2000);
}

function addMessage(content, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const avatar = sender === 'user' ? 
        '<div class="user-avatar"><i class="fas fa-user"></i></div>' :
        '<div class="ai-avatar"><i class="fas fa-robot"></i></div>';
    
    messageDiv.innerHTML = `
        ${sender === 'user' ? '' : avatar}
        <div class="message-content">
            <p>${content}</p>
        </div>
        ${sender === 'user' ? avatar : ''}
    `;
    
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function showTyping() {
    state.isTyping = true;
    elements.typingIndicator.classList.add('show');
}

function hideTyping() {
    state.isTyping = false;
    elements.typingIndicator.classList.remove('show');
}

function clearChatHistory() {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử chat không?')) {
        const welcomeMessage = elements.chatMessages.querySelector('.welcome-message');
        elements.chatMessages.innerHTML = '';
        if (welcomeMessage) {
            elements.chatMessages.appendChild(welcomeMessage);
        }
        
        state.questionCount = 0;
        updateStats();
        showToast('Đã xóa lịch sử trò chuyện', 'info');
    }
}

// Document actions
function viewDocument(documentId) {
    const doc = state.documents.find(d => d.id === documentId);
    if (!doc) return;
    
    elements.modalTitle.textContent = `Chi tiết tài liệu: ${doc.name}`;
    elements.modalBody.innerHTML = `
        <div class="document-details">
            <div class="detail-row">
                <strong>Tên file:</strong> ${doc.name}
            </div>
            <div class="detail-row">
                <strong>Kích thước:</strong> ${formatFileSize(doc.size)}
            </div>
            <div class="detail-row">
                <strong>Loại file:</strong> ${doc.type.toUpperCase()}
            </div>
            <div class="detail-row">
                <strong>Ngày tải lên:</strong> ${formatDate(doc.uploadDate)}
            </div>
            <div class="detail-row">
                <strong>Trạng thái:</strong> ${doc.status === 'ready' ? 'Sẵn sàng' : 'Đang xử lý'}
            </div>
            <div class="detail-row">
                <strong>Mô tả:</strong> ${getDocumentDescription(doc.name)}
            </div>
        </div>
    `;
    
    elements.documentModal.classList.add('show');
}

function deleteDocument(documentId) {
    const doc = state.documents.find(d => d.id === documentId);
    if (!doc) return;
    
    if (confirm(`Bạn có chắc chắn muốn xóa tài liệu "${doc.name}"?`)) {
        state.documents = state.documents.filter(d => d.id !== documentId);
        updateDocumentList();
        updateStats();
        showToast(`Đã xóa tài liệu: ${doc.name}`, 'success');
    }
}

function closeModal() {
    elements.documentModal.classList.remove('show');
}

// Utility functions
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getFileType(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    const typeMap = {
        'pdf': 'pdf',
        'docx': 'docx',
        'doc': 'docx',
        'md': 'md',
        'txt': 'txt'
    };
    return typeMap[extension] || 'txt';
}

function getFileIcon(type) {
    const iconMap = {
        'pdf': 'pdf',
        'docx': 'word',
        'md': 'markdown',
        'txt': 'alt'
    };
    return iconMap[type] || 'alt';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date) {
    return new Intl.DateTimeFormat('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getDocumentDescription(fileName) {
    return 'Tài liệu nội bộ của công ty.';
}

function updateStats() {
    elements.totalDocs.textContent = state.documents.length;
    elements.totalQuestions.textContent = state.questionCount;
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="${icons[type]}"></i>
        <span class="toast-message">${message}</span>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 4000);
}

function handleKeyboardShortcuts(e) {
    if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        elements.chatInput.focus();
    }
    
    if (e.key === 'Escape') {
        closeModal();
    }
}

const style = document.createElement('style');
style.textContent = `
    @keyframes toastSlideOut {
        to { opacity: 0; transform: translateX(100%); }
    }
`;
document.head.appendChild(style);