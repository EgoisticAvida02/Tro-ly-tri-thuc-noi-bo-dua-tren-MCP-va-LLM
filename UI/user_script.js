// Enhanced Technical Assistant - Complete JavaScript
// Version: 2025-11-28-v3 - Fixed initialization order

const API_URL = window.location.origin + '/api';
let currentUser = null;
let currentRole = 'security_engineer'; // SET DEFAULT IMMEDIATELY
let chatHistory = [];
let activeSessionId = localStorage.getItem('chat_session_id') || null;
let selectedDocuments = [];
let newsCache = { role: null, articles: [], fetchedAt: 0 };
let newsRequestController = null;
let latestNewsFetchInFlight = false;
let personalDocsRetryCount = 0;
let newsRetryCount = 0;
const MAX_RETRIES = 3;

// Initialize app on load
document.addEventListener('DOMContentLoaded', function () {
    console.log('=== Technical Assistant Initializing ===');
    console.log('API_URL:', API_URL);
    console.log('Default role:', currentRole);

    // Update role badge immediately
    updateRoleBadge(currentRole);

    // Initialize tab visibility
    document.querySelectorAll('.tab-content').forEach(function (content) {
        if (content.classList.contains('active')) {
            content.style.display = 'block';
        } else {
            content.style.display = 'none';
        }
    });

    // Set up event listeners
    setupEventListeners();

    // Start all data loading immediately - don't wait for anything
    console.log('Starting data loads...');

    // Load user (async, don't wait)
    loadCurrentUser().then(function () {
        console.log('User loaded successfully');
    }).catch(function (e) {
        console.warn('User load failed:', e);
    });

    // Load role (async, don't wait)
    loadUserRole().then(function () {
        console.log('Role loaded successfully');
    }).catch(function (e) {
        console.warn('Role load failed:', e);
    });

    // Load all content immediately with current role
    console.log('Loading company documents...');
    loadCompanyDocuments();

    console.log('Loading personal documents...');
    loadPersonalDocuments();

    console.log('Loading news...');
    loadNews({ force: true });

    console.log('Loading uploads...');
    loadMyUploads();

    console.log('Loading chat history...');
    loadChatHistory();

    console.log('=== Initialization complete ===');
});

function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Section reload buttons
    document.querySelectorAll('.section-refresh').forEach(button => {
        button.addEventListener('click', async () => {
            const target = button.dataset.target;
            button.disabled = true;
            button.classList.add('spinning');
            try {
                if (target === 'personal-docs') {
                    await loadPersonalDocuments();
                } else {
                    await loadCompanyDocuments();
                }
            } finally {
                button.disabled = false;
                button.classList.remove('spinning');
            }
        });
    });

    // Chat input
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendButton');

    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    sendBtn?.addEventListener('click', sendMessage);

    // News actions
    document.getElementById('refreshNews')?.addEventListener('click', refreshNews);
    document.getElementById('fetchLatestNews')?.addEventListener('click', () => fetchLatestNews({ reload: true }));

    // Upload form
    document.getElementById('uploadForm')?.addEventListener('submit', handleUpload);

    // Clear chat
    document.getElementById('clearChat')?.addEventListener('click', clearChat);
    document.getElementById('newsTimeFilter')?.addEventListener('change', () => {
        if (!renderNewsFromCache()) {
            loadNews();
        }
    });

    document.getElementById('clearSelectedDocs')?.addEventListener('click', (event) => {
        event.preventDefault();
        clearSelectedDocuments();
    });

    // Report modal
    document.getElementById('reportModalClose')?.addEventListener('click', closeReportModal);
    document.getElementById('submitReport')?.addEventListener('click', submitReport);
    
    // Close modal when clicking outside
    document.getElementById('reportModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'reportModal') {
            closeReportModal();
        }
    });
}

// Tab Navigation
function switchTab(tabName) {
    console.log('Switching to tab:', tabName);
    const targetTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (!targetTab) {
        console.warn(`Unknown tab requested: ${tabName}`);
        return;
    }

    // Update tab buttons
    document.querySelectorAll('.nav-tab').forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });

    // Update tab content - show matching, hide others
    document.querySelectorAll('.tab-content').forEach(content => {
        const shouldShow = content.id === `${tabName}-tab`;
        if (shouldShow) {
            content.classList.add('active');
            content.style.display = 'block';
            console.log(`Showing tab: ${content.id}`);
        } else {
            content.classList.remove('active');
            content.style.display = 'none';
        }
    });
}

function buildDocKey(type, id, filename) {
    const safeId = id ?? filename ?? 'unknown';
    return `${type}:${safeId}`;
}

function toggleDocumentSelection(docInfo) {
    const key = buildDocKey(docInfo.type, docInfo.id, docInfo.filename);
    const existingIndex = selectedDocuments.findIndex(doc => doc.key === key);

    if (existingIndex >= 0) {
        selectedDocuments.splice(existingIndex, 1);
        updateSelectedDocsUI();
        return false;
    }

    selectedDocuments.push({
        key,
        type: docInfo.type,
        id: docInfo.id,
        filename: docInfo.filename,
        label: docInfo.label
    });
    updateSelectedDocsUI();
    return true;
}

function removeSelectedDocument(key) {
    const index = selectedDocuments.findIndex(doc => doc.key === key);
    if (index >= 0) {
        selectedDocuments.splice(index, 1);
        updateSelectedDocsUI();
    }
}

function clearSelectedDocuments() {
    if (selectedDocuments.length === 0) return;
    selectedDocuments = [];
    updateSelectedDocsUI();
}

function updateSelectedDocsUI() {
    const bar = document.getElementById('selectedDocsBar');
    const list = document.getElementById('selectedDocsList');
    const clearBtn = document.getElementById('clearSelectedDocs');

    if (!bar || !list) return;

    if (selectedDocuments.length === 0) {
        bar.style.display = 'none';
        list.innerHTML = '';
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
    } else {
        bar.style.display = 'flex';
        list.innerHTML = '';
        selectedDocuments.forEach(doc => {
            const pill = document.createElement('div');
            pill.className = 'selected-doc-pill';

            const icon = document.createElement('i');
            icon.className = `fas ${doc.type === 'personal' ? 'fa-user' : 'fa-building'}`;
            const label = document.createElement('span');
            label.textContent = doc.label;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.innerHTML = '<i class="fas fa-times"></i>';
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                removeSelectedDocument(doc.key);
            });

            pill.appendChild(icon);
            pill.appendChild(label);
            pill.appendChild(removeBtn);
            list.appendChild(pill);
        });

        if (clearBtn) {
            clearBtn.style.display = 'flex';
        }
    }

    syncDocumentSelectionStyles();
}

function syncDocumentSelectionStyles() {
    const selectedKeys = new Set(selectedDocuments.map(doc => doc.key));
    document.querySelectorAll('.document-item').forEach(item => {
        const key = item.dataset.docKey;
        if (!key) return;
        const isSelected = selectedKeys.has(key);
        item.classList.toggle('selected', isSelected);
        const actionBtn = item.querySelector('.doc-action.doc-select');
        if (actionBtn) {
            actionBtn.classList.toggle('selected', isSelected);
            actionBtn.title = isSelected ? 'Selected for chat' : 'Use this document for chat';
            const labelEl = actionBtn.querySelector('span');
            if (labelEl) {
                labelEl.textContent = isSelected ? 'Selected' : 'Use';
            }
        }
    });
}

// User Management
async function loadCurrentUser() {
    try {
        // First try to validate session with backend (uses cookie automatically)
        const response = await fetch('/api/auth/validate', {
            credentials: 'include'
        });

        if (!response.ok) {
            console.warn('Not authenticated (status:', response.status, ')');
            // Set a default user for UI display
            currentUser = 'Guest';
            const displayElement = document.getElementById('username-display') || document.getElementById('user-name');
            if (displayElement) {
                displayElement.textContent = 'Guest User';
            }
            return null;
        }

        const data = await response.json();
        if (data.success && data.user) {
            // Store user info for display
            currentUser = data.user.username;
            localStorage.setItem('user_info', JSON.stringify(data.user));

            const displayElement = document.getElementById('username-display') || document.getElementById('user-name');
            if (displayElement) {
                displayElement.textContent = data.user.full_name || data.user.username;
            }

            console.log('User loaded:', currentUser);
            return currentUser;
        } else {
            console.warn('Invalid session response');
            currentUser = 'Guest';
            return null;
        }
    } catch (error) {
        console.error('Error validating session:', error);
        console.warn('Network error or server not responding');
        currentUser = 'Guest';
        return null;
    }
}

async function loadUserRole() {
    try {
        console.log('Loading user role...');
        // Call the /api/user/role endpoint to get technical role
        const response = await fetch(`${API_URL}/user/role`, {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Role response status:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('Role data:', data);

            // Extract role from the response
            if (data.success && data.role) {
                let roleValue = data.role;

                // If roleValue is an object, extract the role_type
                if (roleValue && typeof roleValue === 'object') {
                    currentRole = roleValue.role_type || roleValue.role || 'security_engineer';
                } else if (roleValue && typeof roleValue === 'string') {
                    currentRole = roleValue;
                } else {
                    console.warn('No role found in response, using default');
                    currentRole = 'security_engineer';
                }

                console.log('Current role set to:', currentRole);
                updateRoleBadge(currentRole);
                setNewsStatus('Ready', 'idle');
            } else {
                console.warn('Invalid response structure, using default role');
                currentRole = 'security_engineer';
                updateRoleBadge(currentRole);
            }
        } else {
            console.error('Error loading user role, status:', response.status, '- using default');
            currentRole = 'security_engineer'; // Fallback
            updateRoleBadge(currentRole);
        }
        return currentRole;
    } catch (error) {
        console.error('Error loading user role:', error, '- using default');
        currentRole = 'security_engineer'; // Fallback
        updateRoleBadge(currentRole);
        return currentRole;
    }
}

function updateRoleBadge(role) {
    const badge = document.getElementById('roleBadge');
    const roleText = document.getElementById('userRole');
    const roleNames = {
        'security_engineer': '🔒 Security Engineer',
        'devops_engineer': '⚙️ DevOps Engineer',
        'backend_developer': '🖥️ Backend Developer',
        'frontend_developer': '🎨 Frontend Developer',
        'data_scientist': '📊 Data Scientist',
        'cloud_engineer': '☁️ Cloud Engineer',
        'qa_engineer': '✅ QA Engineer',
        'product_manager': '📋 Product Manager'
    };
    const text = roleNames[role] || role;
    if (roleText) {
        roleText.textContent = text;
    } else if (badge) {
        badge.textContent = text;
    }
}

// Chat Functions
async function sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const message = input.value.trim();

    if (!message) return;

    // Display user message
    displayMessage(message, 'user');
    input.value = '';

    // Show typing indicator
    const typingId = showTypingIndicator();

    try {
        const payload = {
            message,
            user_id: currentUser
        };

        if (activeSessionId) {
            payload.session_id = activeSessionId;
        }

        if (chatHistory.length > 0) {
            payload.chat_history = chatHistory.map(entry => [entry.user, entry.ai]);
        }

        if (selectedDocuments.length > 0) {
            payload.selected_documents = selectedDocuments.map(doc => ({
                type: doc.type,
                id: doc.id,
                filename: doc.filename
            }));
        }

        const response = await fetch(`${API_URL}/chat`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        removeTypingIndicator(typingId);

        const data = await response.json().catch(() => null);

        if (response.ok && data?.success !== false) {
            if (data?.session_id) {
                activeSessionId = data.session_id;
                localStorage.setItem('chat_session_id', activeSessionId);
            }

            displayMessage(data?.response || 'No response provided.', 'ai', data?.sources);
            chatHistory.push({
                user: message,
                ai: data?.response || '',
                sources: data?.sources || []
            });
        } else {
            const errorMessage = data?.error || 'Sorry, I encountered an error processing your request.';
            displayMessage(errorMessage, 'ai');
        }
    } catch (error) {
        removeTypingIndicator(typingId);
        console.error('Chat error:', error);
        displayMessage('Sorry, I couldn\'t connect to the server.', 'ai');
    }
}

async function loadChatHistory(limit = 20) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    try {
        const response = await fetch(`${API_URL}/chat/history?limit=${limit}`, {
            credentials: 'include'
        });

        if (response.status === 401) {
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to load chat history');
        }

        const data = await response.json();
        const history = Array.isArray(data.history) ? data.history : [];

        if (!history.length) {
            return;
        }

        const orderedHistory = history.slice().reverse();
        container.innerHTML = '';
        chatHistory = [];

        orderedHistory.forEach(entry => {
            displayMessage(entry.question, 'user');
            displayMessage(entry.answer, 'ai', entry.sources);
            chatHistory.push({
                user: entry.question,
                ai: entry.answer,
                sources: entry.sources || []
            });
        });
    } catch (error) {
        console.error('Error loading chat history:', error);
    }
}

function displayMessage(text, sender, sources = null) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = sender === 'user' ? 'user-message' : 'ai-message';

    const avatar = document.createElement('div');
    avatar.className = sender === 'user' ? 'user-avatar' : 'ai-avatar';
    const avatarIcon = sender === 'user' ? 'fa-user' : 'fa-robot';
    avatar.innerHTML = `<i class="fas ${avatarIcon}"></i>`;

    const content = document.createElement('div');
    content.className = 'message-content';

    // Format message with markdown-like syntax
    const formattedText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    content.innerHTML = formattedText;

    // Add sources if available
    if (sources && sources.length > 0) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'message-sources';
        sourcesDiv.innerHTML = '<strong>📚 Sources:</strong><br>';
        sources.slice(0, 3).forEach((source, index) => {
            let label = source;
            if (typeof source === 'object' && source !== null) {
                const parts = [];
                if (source.filename) parts.push(source.filename);
                if (source.page) parts.push(`p.${source.page}`);
                label = parts.join(' • ') || source.filename || 'Referenced document';
            }
            sourcesDiv.innerHTML += `<div class="source-item">${index + 1}. ${label}</div>`;
        });
        content.appendChild(sourcesDiv);
    }

    // Add report button for AI messages
    if (sender === 'ai') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        const reportBtn = document.createElement('button');
        reportBtn.className = 'message-report-btn';
        reportBtn.innerHTML = '<i class="fas fa-flag"></i> Report';
        reportBtn.title = 'Report an issue with this response';
        reportBtn.onclick = function() {
            // Get the previous user message for context
            const allMessages = messagesContainer.querySelectorAll('.user-message, .ai-message');
            let userQuestion = '';
            for (let i = allMessages.length - 1; i >= 0; i--) {
                if (allMessages[i] === messageDiv && i > 0) {
                    const prevMsg = allMessages[i - 1];
                    if (prevMsg.classList.contains('user-message')) {
                        userQuestion = prevMsg.querySelector('.message-content')?.textContent || '';
                    }
                    break;
                }
            }
            openReportModalWithContext(userQuestion, text);
        };
        
        actionsDiv.appendChild(reportBtn);
        content.appendChild(actionsDiv);
    }

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    messagesContainer.appendChild(messageDiv);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return null;
    const typingDiv = document.createElement('div');
    typingDiv.className = 'ai-message typing-indicator';
    typingDiv.id = 'typing-' + Date.now();
    typingDiv.innerHTML = `
        <div class="ai-avatar"><i class="fas fa-robot"></i></div>
        <div class="message-content typing-bubble">
            <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return typingDiv.id;
}

function removeTypingIndicator(id) {
    if (!id) return;
    const indicator = document.getElementById(id);
    if (indicator) indicator.remove();
}

// Download document helper
async function downloadDocument(type, id, filename) {
    try {
        const docId = id || filename;
        if (!docId) {
            alert('Cannot download: missing document ID');
            return;
        }

        // Open download in new tab/trigger download
        const downloadUrl = `${API_URL}/download/${docId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_blank';
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('Download error:', error);
        alert('Failed to download document');
    }
}

function clearChat() {
    if (confirm('Are you sure you want to clear the chat history?')) {
        const chatContainer = document.getElementById('chatMessages');
        if (!chatContainer) return;
        chatContainer.innerHTML = `
            <div class="welcome-message">
                <div class="ai-avatar"><i class="fas fa-robot"></i></div>
                <div class="message-content">
                    <strong>Welcome to Technical Assistant!</strong><br><br>
                    I can help you with:
                    <ul>
                        <li>Questions about technical news and updates</li>
                        <li>Information from uploaded documents</li>
                        <li>Security vulnerabilities and CVEs</li>
                        <li>Best practices for your role</li>
                    </ul>
                    <em>Try asking: "Are there any new CVEs for Java packages?"</em>
                </div>
            </div>
        `;
        chatHistory = [];

        if (activeSessionId) {
            fetch(`${API_URL}/chat/clear`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ session_id: activeSessionId })
            }).catch(() => { });
        }

        activeSessionId = null;
        localStorage.removeItem('chat_session_id');
    }
}

// News Functions
function setNewsStatus(message, state = 'idle') {
    const statusEl = document.getElementById('newsStatus');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.state = state;
}

function renderNewsFallback(message, actions = []) {
    const newsContainer = document.getElementById('newsFeed');
    if (!newsContainer) return;

    newsContainer.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'news-empty-state';

    const text = document.createElement('p');
    text.textContent = message;
    wrapper.appendChild(text);

    if (Array.isArray(actions) && actions.length > 0) {
        const actionRow = document.createElement('div');
        actionRow.className = 'news-empty-actions';

        actions.forEach(action => {
            if (!action || typeof action.onClick !== 'function') {
                return;
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'retry-btn';
            button.textContent = action.label || 'Try again';
            button.addEventListener('click', action.onClick);
            actionRow.appendChild(button);
        });

        if (actionRow.children.length > 0) {
            wrapper.appendChild(actionRow);
        }
    }

    newsContainer.appendChild(wrapper);
}

function renderNewsFromCache() {
    if (!newsCache.articles.length) {
        return false;
    }
    displayNews(newsCache.articles);
    setNewsStatus('Filtered results', 'idle');
    return true;
}

async function loadNews(options = {}) {
    console.log('>>> loadNews() called with options:', options);
    console.log('>>> currentRole is:', currentRole);

    const { force = false, silent = false } = options;
    const newsContainer = document.getElementById('newsFeed');
    if (!newsContainer) {
        console.warn('newsFeed container not found');
        return;
    }

    // Use default role if not set
    if (!currentRole) {
        console.log('>>> currentRole was empty, setting to security_engineer');
        currentRole = 'security_engineer';
    }

    const cacheIsFresh = !force &&
        newsCache.role === currentRole &&
        newsCache.articles.length > 0 &&
        (Date.now() - newsCache.fetchedAt) < 60_000;

    if (cacheIsFresh) {
        displayNews(newsCache.articles);
        if (!silent) {
            setNewsStatus('Cached', 'idle');
        }
        return;
    }

    if (!silent) {
        newsContainer.innerHTML = '<div class="loading">📰 Loading news...</div>';
    }
    setNewsStatus('Refreshing…', 'busy');

    if (newsRequestController) {
        newsRequestController.abort();
    }
    newsRequestController = new AbortController();

    try {
        const url = `${API_URL}/news/${currentRole}?limit=20`;
        console.log('Fetching news from:', url);

        const response = await fetch(url, {
            credentials: 'include',
            signal: newsRequestController.signal
        });

        console.log('News response status:', response.status);

        if (response.status === 404) {
            // No news for this role yet
            renderNewsFallback('No news available for your role yet.', [
                { label: 'Fetch Latest', onClick: () => fetchLatestNews({ reload: true }) }
            ]);
            setNewsStatus('Empty', 'idle');
            return;
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('News data received:', data);

        newsCache = {
            role: currentRole,
            articles: data.articles || [],
            fetchedAt: Date.now()
        };
        if (!newsCache.articles.length) {
            renderNewsFallback('No news available yet.', [
                { label: 'Fetch Latest', onClick: () => fetchLatestNews({ reload: true }) }
            ]);
            setNewsStatus('Empty', 'idle');
        } else {
            displayNews(newsCache.articles);
            setNewsStatus('Updated', 'success');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }
        console.error('Error loading news:', error);
        if (!silent) {
            renderNewsFallback('Unable to load news - check if server is running', [
                { label: 'Retry', onClick: () => loadNews({ force: true }) }
            ]);
        }
        setNewsStatus('Failed', 'error');
    } finally {
        newsRequestController = null;
    }
}

function displayNews(articles) {
    const newsContainer = document.getElementById('newsFeed');
    if (!newsContainer) return;

    const filteredArticles = filterArticlesByTime(articles);
    const list = filteredArticles || [];

    if (!list || list.length === 0) {
        const currentFilter = document.getElementById('newsTimeFilter')?.value || 'all';
        if (articles && articles.length > 0 && currentFilter !== 'all') {
            renderNewsFallback('No articles match this time filter yet.', [
                {
                    label: 'Show all news',
                    onClick: () => {
                        const filterSelect = document.getElementById('newsTimeFilter');
                        if (filterSelect) {
                            filterSelect.value = 'all';
                        }
                        displayNews(articles);
                    }
                },
                { label: 'Fetch latest news', onClick: () => fetchLatestNews({ reload: true }) }
            ]);
        } else {
            renderNewsFallback('No news available for your role yet.', [
                { label: 'Fetch latest news', onClick: () => fetchLatestNews({ reload: true }) }
            ]);
        }
        return;
    }

    newsContainer.innerHTML = '';

    list.forEach(article => {
        const card = createNewsCard(article);
        newsContainer.appendChild(card);
    });
}

function filterArticlesByTime(articles) {
    const filter = document.getElementById('newsTimeFilter')?.value || 'all';
    if (filter === 'all') return articles;

    const now = new Date();
    return articles.filter(article => {
        if (!article.published_date) return false;
        const published = new Date(article.published_date);
        const diffHours = (now - published) / 3600000;
        if (filter === 'today') {
            return diffHours <= 24;
        }
        if (filter === 'week') {
            return diffHours <= 24 * 7;
        }
        return true;
    });
}

function createNewsCard(article) {
    const card = document.createElement('div');
    card.className = 'news-card';

    const titleText = article.title || 'Untitled';

    if (titleText && (titleText.toLowerCase().includes('cve') ||
        titleText.toLowerCase().includes('vulnerability') ||
        titleText.toLowerCase().includes('critical'))) {
        card.classList.add('critical');
    }

    const title = document.createElement('h4');
    title.className = 'news-title';
    title.textContent = titleText;

    const summary = document.createElement('div');
    summary.className = 'news-summary';
    summary.textContent = buildArticleSnippet(article);

    const meta = document.createElement('div');
    meta.className = 'news-meta';

    const source = document.createElement('div');
    source.className = 'news-source';
    source.innerHTML = `📰 ${resolveArticleSource(article)}`;

    const date = document.createElement('div');
    date.className = 'news-date';
    date.innerHTML = `🕒 ${formatDate(article.published_date)}`;

    meta.appendChild(source);
    meta.appendChild(date);

    const actions = document.createElement('div');
    actions.className = 'news-actions';

    const readBtn = document.createElement('button');
    readBtn.className = 'btn-news-action';
    readBtn.textContent = '🔗 Read Article';
    readBtn.onclick = () => {
        const articleUrl = getArticleUrl(article);
        if (articleUrl) {
            const newWindow = window.open(articleUrl, '_blank');
            if (newWindow) {
                newWindow.opener = null;
            }
        } else {
            alert('No article link available for this item yet.');
        }
    };

    const summarizeBtn = document.createElement('button');
    summarizeBtn.className = 'btn-news-action';
    summarizeBtn.textContent = '✨ Summarize Article';
    summarizeBtn.onclick = () => summarizeNewsArticle(article, summarizeBtn);

    actions.appendChild(readBtn);
    actions.appendChild(summarizeBtn);

    card.appendChild(title);
    card.appendChild(summary);
    card.appendChild(meta);
    card.appendChild(actions);

    return card;
}

function resolveArticleSource(article) {
    return article.source_name || article.source || article.publisher || 'Tech News';
}

function getArticleUrl(article) {
    return article.link || article.url || article.article_url || null;
}

function buildArticleSnippet(article) {
    if (article.summary) return article.summary;
    if (article.content_snippet) return article.content_snippet;
    const content = article.content || '';
    if (!content.trim()) return 'No summary available';
    return content.trim().split(/\s+/).slice(0, 40).join(' ') + '...';
}

async function summarizeNewsArticle(article, buttonEl) {
    if (!article?.id) {
        alert('This article is missing an identifier. Please fetch the latest news again.');
        return;
    }

    const questionText = `Summarize the article "${article.title || 'this update'}"`;

    displayMessage(questionText, 'user');
    const typingId = showTypingIndicator();

    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = '⏳ Summarizing...';
    }

    try {
        const response = await fetch(`${API_URL}/news/summarize/${article.id}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: activeSessionId,
                question: questionText
            })
        });

        const data = await response.json().catch(() => null);
        removeTypingIndicator(typingId);

        if (!response.ok || !data?.success) {
            throw new Error(data?.error || 'Unable to summarize this article.');
        }

        if (data.session_id) {
            activeSessionId = data.session_id;
            localStorage.setItem('chat_session_id', activeSessionId);
        }

        displayMessage(data.summary, 'ai', data.sources);
        chatHistory.push({
            user: questionText,
            ai: data.summary,
            sources: data.sources || []
        });
    } catch (error) {
        console.error('Summarize article error:', error);
        removeTypingIndicator(typingId);
        displayMessage(error.message || 'Unable to summarize this article right now.', 'ai');
        alert(error.message || 'Unable to summarize this article right now.');
    } finally {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = '✨ Summarize Article';
        }
    }
}

async function refreshNews() {
    const btn = document.getElementById('refreshNews');
    if (btn) {
        btn.classList.add('spinning');
        btn.disabled = true;
    }
    setNewsStatus('Refreshing…', 'busy');

    try {
        await loadNews({ force: true });
    } catch (error) {
        console.error('Error refreshing news:', error);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('spinning');
        }
    }
}

async function fetchLatestNews(options = {}) {
    const { silent = false, reload = false } = options;

    if (!currentRole || latestNewsFetchInFlight) {
        if (!currentRole) {
            console.warn('Cannot fetch latest news before role is set');
        }
        return;
    }

    latestNewsFetchInFlight = true;
    const btn = document.getElementById('fetchLatestNews');
    const label = btn?.querySelector('span');
    const originalLabel = label?.textContent;

    if (btn) {
        btn.disabled = true;
        btn.classList.add('active');
    }
    if (label) {
        label.textContent = 'Fetching…';
    }
    setNewsStatus('Fetching latest articles…', 'busy');

    try {
        const response = await fetch(`${API_URL}/news/fetch`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                role: currentRole
            })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(errorText || 'Failed to fetch latest news');
        }

        setNewsStatus('New sources ingested', 'success');
        if (reload) {
            await loadNews({ force: true });
        }
        if (!silent) {
            console.info('News feed refreshed from sources');
        }
    } catch (error) {
        console.error('Error fetching news:', error);
        setNewsStatus('Fetch failed', 'error');
        if (!silent) {
            alert('Unable to fetch the newest news items right now. Please try again shortly.');
        }
    } finally {
        latestNewsFetchInFlight = false;
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('active');
        }
        if (label && originalLabel) {
            label.textContent = originalLabel;
        }
    }
}

function formatDocumentName(name, fallback = 'Untitled document') {
    if (!name || typeof name !== 'string') {
        return fallback;
    }

    let cleaned = name.trim();
    // Remove UUID-style prefixes saved during upload
    cleaned = cleaned.replace(/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}_/, '');
    cleaned = cleaned.replace(/^[0-9a-fA-F]{32}_/, '');
    // Remove common label prefixes like TEAM - , PERSONAL - , COMPANY -
    cleaned = cleaned.replace(/^(team|personal|company)\s*[-_]\s*/i, '');
    cleaned = cleaned.replace(/^(doc|file)\s*[-_]\s*/i, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned || fallback;
}

function createDocumentListItem({ type, id, filename, displayName, metaText, description, onClick }) {
    const item = document.createElement('div');
    const key = buildDocKey(type, id, filename);
    item.className = 'document-item';
    item.dataset.docKey = key;
    item.dataset.docType = type;
    item.dataset.docId = id ?? '';
    item.dataset.docFilename = filename ?? '';

    const header = document.createElement('div');
    header.className = 'document-header';

    const title = document.createElement('div');
    title.className = 'document-title';
    title.textContent = displayName;

    const actions = document.createElement('div');
    actions.className = 'doc-actions';

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'doc-action doc-download';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i><span>Download</span>';
    downloadBtn.title = 'Download document';
    downloadBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        downloadDocument(type, id, filename);
    });

    // Select button for filtered chat
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'doc-action doc-select';
    selectBtn.innerHTML = '<i class="fas fa-reply"></i><span>Use</span>';
    selectBtn.title = 'Use this document for chat';

    selectBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const nowSelected = toggleDocumentSelection({
            type,
            id,
            filename,
            label: displayName
        });
        selectBtn.classList.toggle('selected', nowSelected);
        selectBtn.title = nowSelected ? 'Selected for chat' : 'Use this document for chat';
        const labelEl = selectBtn.querySelector('span');
        if (labelEl) {
            labelEl.textContent = nowSelected ? 'Selected' : 'Use';
        }
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(selectBtn);

    header.appendChild(title);
    header.appendChild(actions);
    item.appendChild(header);

    if (metaText) {
        const meta = document.createElement('div');
        meta.className = 'document-meta';
        meta.textContent = metaText;
        item.appendChild(meta);
    }

    if (description) {
        const desc = document.createElement('div');
        desc.className = 'document-meta';
        desc.textContent = description;
        item.appendChild(desc);
    }

    if (typeof onClick === 'function') {
        item.addEventListener('click', onClick);
    }

    const isSelected = selectedDocuments.some(doc => doc.key === key);
    if (isSelected) {
        item.classList.add('selected');
        selectBtn.classList.add('selected');
        selectBtn.title = 'Selected for chat';
    }

    return item;
}

function renderListError(container, message, retryHandler) {
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'list-error';

    const text = document.createElement('p');
    text.textContent = message;
    wrapper.appendChild(text);

    if (typeof retryHandler === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'retry-btn';
        retryBtn.innerHTML = '<i class="fas fa-redo"></i><span>Try again</span>';
        retryBtn.addEventListener('click', (event) => {
            event.preventDefault();
            retryHandler();
        });
        wrapper.appendChild(retryBtn);
    }

    container.appendChild(wrapper);
}

// Document Functions
async function loadPersonalDocuments() {
    console.log('>>> loadPersonalDocuments() called');
    console.log('>>> currentRole is:', currentRole);

    const container = document.getElementById('personalDocumentList');
    if (!container) {
        console.warn('personalDocumentList container not found');
        return;
    }

    // Use default role if not set
    if (!currentRole) {
        console.log('>>> currentRole was empty, setting to security_engineer');
        currentRole = 'security_engineer';
    }

    container.innerHTML = '<div class="loading">Loading personal documents...</div>';
    console.log('>>> About to fetch personal docs for role:', currentRole);

    try {
        const url = `${API_URL}/user-documents/approved/${encodeURIComponent(currentRole)}`;
        console.log('>>> Fetching personal docs from:', url);

        const response = await fetch(url, {
            credentials: 'include'
        });

        console.log('Personal docs response status:', response.status);

        if (response.status === 404) {
            // No documents for this role is OK
            container.innerHTML = '<div style="text-align:center;color:#858796;font-size:12px;padding:20px;">No personal documents yet</div>';
            return;
        }

        if (response.status === 401) {
            renderListError(container, 'Please login to view documents.', () => window.location.href = '/login.html');
            return;
        }

        if (response.ok) {
            const data = await response.json();
            console.log('Personal docs data:', data);
            displayPersonalDocuments(data.documents || []);
        } else {
            let errText = 'Failed to load';
            try {
                const json = await response.json();
                if (json && json.error) errText = json.error;
            } catch (e) { }
            console.warn('Personal documents load failed:', response.status, errText);
            renderListError(container, errText, loadPersonalDocuments);
        }
    } catch (error) {
        console.error('Error loading personal documents:', error);
        renderListError(container, 'Network error - check if server is running', loadPersonalDocuments);
    }
}

function displayPersonalDocuments(documents) {
    const container = document.getElementById('personalDocumentList');
    if (!container) return;

    if (documents.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#858796;font-size:12px;padding:20px;">No personal documents yet</div>';
        return;
    }

    container.innerHTML = '';

    documents.forEach(doc => {
        const rawName = doc.original_filename || doc.filename || doc.file_name;
        const displayName = formatDocumentName(rawName, 'Untitled document');
        const uploader = doc.uploader_name || doc.uploader_username || `User #${doc.uploaded_by || '—'}`;
        const timestamp = doc.approved_at || doc.created_at || doc.uploaded_at;
        const filename = doc.filename || doc.file_name;

        const item = createDocumentListItem({
            type: 'personal',
            id: doc.id,
            filename,
            displayName,
            metaText: `by ${uploader} • ${formatDate(timestamp)}`,
            description: doc.description,
            onClick: () => {
                const chatInput = document.getElementById('chatInput');
                if (chatInput) {
                    chatInput.value = `What is ${displayName} about?`;
                    chatInput.focus();
                }
            }
        });

        container.appendChild(item);
    });

    syncDocumentSelectionStyles();
}

async function loadMyUploads() {
    const container = document.getElementById('uploadsList');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading...</div>';

    try {
        const response = await fetch(`${API_URL}/user-documents/my`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            displayMyUploads(data.documents || []);
        } else {
            container.innerHTML = '<div class="loading">❌ Failed to load uploads</div>';
        }
    } catch (error) {
        console.error('Error loading my uploads:', error);
        container.innerHTML = '<div class="loading">❌ Error loading uploads</div>';
    }
}

async function loadCompanyDocuments() {
    const container = document.getElementById('documentList');
    if (!container) {
        console.warn('documentList container not found');
        return;
    }
    container.innerHTML = '<div class="loading">Loading documents...</div>';
    console.log('Loading company documents...');

    try {
        const url = `${API_URL}/documents`;
        console.log('Fetching:', url);

        const response = await fetch(url, {
            credentials: 'include'
        });

        console.log('Company docs response status:', response.status);

        if (response.status === 401) {
            renderListError(container, 'Please login', () => window.location.href = '/login.html');
            return;
        }

        if (response.ok) {
            const data = await response.json();
            console.log('Company docs data:', data);
            const docs = data.documents || data || [];
            displayCompanyDocuments(docs);
        } else {
            let errText = 'Failed to load';
            try {
                const json = await response.json();
                if (json && json.error) errText = json.error;
            } catch (e) { }
            renderListError(container, errText, loadCompanyDocuments);
        }
    } catch (error) {
        console.error('Error loading company documents:', error);
        renderListError(container, 'Network error', loadCompanyDocuments);
    }
}

function displayCompanyDocuments(documents) {
    const container = document.getElementById('documentList');
    if (!container) return;

    if (!documents || documents.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#858796;font-size:12px;padding:20px;">No documents found</div>';
        return;
    }

    container.innerHTML = '';

    documents.forEach(doc => {
        const rawName = doc.original_filename || doc.filename || doc.file_name;
        const displayName = formatDocumentName(rawName, 'Untitled document');
        const uploader = doc.uploader_name || doc.uploader_username || `User #${doc.uploaded_by || '—'}`;
        const timestamp = doc.approved_at || doc.created_at || doc.uploaded_at;
        const filename = doc.filename || doc.file_name;

        const item = createDocumentListItem({
            type: 'company',
            id: doc.id,
            filename,
            displayName,
            metaText: `by ${uploader} • ${formatDate(timestamp)}`,
            description: doc.description,
            onClick: () => {
                const chatInput = document.getElementById('chatInput');
                if (chatInput) {
                    chatInput.value = `What is ${displayName} about?`;
                    chatInput.focus();
                }
            }
        });

        container.appendChild(item);
    });

    syncDocumentSelectionStyles();
}

function displayMyUploads(documents) {
    const container = document.getElementById('uploadsList');
    if (!container) return;

    if (documents.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#858796;font-size:12px;padding:15px;">No uploads yet</div>';
        return;
    }

    container.innerHTML = '';

    documents.forEach(doc => {
        const rawName = doc.original_filename || doc.filename || doc.file_name;
        const displayName = formatDocumentName(rawName, 'Untitled upload');
        const statusValue = (doc.status || 'pending').toLowerCase();
        const statusLabel = statusValue.charAt(0).toUpperCase() + statusValue.slice(1);
        const timestamp = doc.created_at || doc.uploaded_at || doc.approved_at;

        const item = document.createElement('div');
        item.className = 'upload-item';
        item.innerHTML = `
            <div>
                ${displayName}
                <span class="status ${statusValue}">${statusLabel}</span>
            </div>
            <div style="font-size:10px;color:#858796;margin-top:3px;">
                ${formatDate(timestamp)}
            </div>
        `;
        container.appendChild(item);
    });
}

async function handleUpload(e) {
    e.preventDefault();

    const fileInput = document.getElementById('fileInput');
    const descInput = document.getElementById('descriptionInput');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!fileInput.files[0]) {
        alert('Please select a file');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('description', descInput.value);
    formData.append('role', currentRole);

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Uploading...';

    try {
        const response = await fetch(`${API_URL}/user-documents/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        if (response.ok) {
            submitBtn.textContent = '✅ Uploaded!';
            fileInput.value = '';
            descInput.value = '';

            setTimeout(() => {
                submitBtn.textContent = '📤 Upload Document';
                submitBtn.disabled = false;
            }, 2000);

            await loadMyUploads();
            alert('Document uploaded successfully! Waiting for admin approval.');
        } else {
            const error = await response.json();
            alert('Upload failed: ' + (error.error || 'Unknown error'));
            submitBtn.textContent = '📤 Upload Document';
            submitBtn.disabled = false;
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Upload failed: Network error');
        submitBtn.textContent = '📤 Upload Document';
        submitBtn.disabled = false;
    }
}

// Utility Functions
function formatDate(dateString) {
    if (!dateString) return 'Unknown';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

function logout() {
    if (!confirm('Are you sure you want to logout?')) {
        return;
    }

    fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
    }).catch(() => { });

    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login.html';
}

// Error handling
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// Report Modal Functions
function openReportModal() {
    const modal = document.getElementById('reportModal');
    if (!modal) return;

    // Get last AI response for reporting context
    const lastEntry = chatHistory[chatHistory.length - 1];
    if (lastEntry) {
        document.getElementById('reportQuestion').value = lastEntry.user || '';
        document.getElementById('reportAnswer').value = lastEntry.ai || '';
    }

    modal.classList.add('show');
}

function openReportModalWithContext(question, answer) {
    const modal = document.getElementById('reportModal');
    if (!modal) return;

    document.getElementById('reportQuestion').value = question || '';
    document.getElementById('reportAnswer').value = answer || '';

    modal.classList.add('show');
}

function closeReportModal() {
    const modal = document.getElementById('reportModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

async function submitReport() {
    const question = document.getElementById('reportQuestion')?.value || '';
    const answer = document.getElementById('reportAnswer')?.value || '';
    const type = document.getElementById('reportType')?.value || 'other';
    const comment = document.getElementById('reportComment')?.value || '';

    if (!comment.trim()) {
        alert('Please add a comment describing the issue.');
        return;
    }

    const btn = document.getElementById('submitReport');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    try {
        const response = await fetch(`${API_URL}/report`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question,
                answer,
                issue_type: type,
                comment,
                session_id: activeSessionId
            })
        });

        if (response.ok) {
            alert('Report submitted. Thank you for the feedback!');
            closeReportModal();
            document.getElementById('reportComment').value = '';
        } else {
            const err = await response.json().catch(() => ({}));
            alert('Failed to submit report: ' + (err.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Report error:', e);
        alert('Network error submitting report.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Submit Report';
        }
    }
}

// Download Chat Transcript
function downloadChatTranscript() {
    if (chatHistory.length === 0) {
        alert('No chat history to download.');
        return;
    }

    let transcript = '=== Chat Transcript ===\n\n';
    chatHistory.forEach((entry, idx) => {
        transcript += `--- Exchange ${idx + 1} ---\n`;
        transcript += `User: ${entry.user}\n\n`;
        transcript += `Assistant: ${entry.ai}\n`;
        if (entry.sources && entry.sources.length > 0) {
            transcript += `Sources: ${entry.sources.map(s => typeof s === 'object' ? s.filename : s).join(', ')}\n`;
        }
        transcript += '\n';
    });

    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
