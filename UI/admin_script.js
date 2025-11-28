const API_BASE = '/api';

const state = {
    currentPage: 'dashboard',
    documents: [],
    reports: [],
    selectedFiles: [],
    deleteDocId: null,
    currentReportId: null,

    switchPage(page) {
        this.currentPage = page;
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        document.querySelectorAll('.page').forEach(el => {
            el.classList.toggle('active', el.id === `${page}-page`);
        });
        const titles = {
            dashboard: 'Dashboard',
            documents: 'Document Management',
            reports: 'Report Management'
        };
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
            pageTitle.textContent = titles[page] || 'Dashboard';
        }

        if (page === 'documents') {
            loadDocuments();
            loadDocumentStats();
        } else if (page === 'reports') {
            loadReportStats();
            loadReports();
        } else if (page === 'dashboard') {
            loadDashboardStats();
        }
    },

    openModal(id) {
        document.getElementById(id)?.classList.add('active');
    },

    closeModal(id) {
        document.getElementById(id)?.classList.remove('active');
    },

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-times-circle',
            info: 'fas fa-info-circle',
            warning: 'fas fa-exclamation-triangle'
        };
        toast.innerHTML = `
            <i class="${icons[type] || icons.info}"></i>
            <div class="toast-message">${message}</div>
        `;
        document.getElementById('toast-container')?.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

window.state = state;

document.addEventListener('DOMContentLoaded', async () => {
    const authenticated = await checkAuth();
    if (!authenticated) return;

    initializeNavigation();
    initializeFileUpload();
    initializeFilters();
    initializeModals();

    await Promise.all([
        loadDashboardStats(),
        loadDocumentStats(),
        loadDocuments(),
        loadReportStats(),
        loadReports()
    ]);
});

async function checkAuth() {
    try {
        // Use cookie-based session validation. Cookies are set HttpOnly by the server
        // so don't attempt to read them from JS; instead include credentials so the
        // browser sends the cookie and the server can validate it.
        const response = await fetch(`${API_BASE}/auth/validate`, {
            credentials: 'include'
        });

        if (!response.ok) {
            window.location.href = '/login';
            return false;
        }

        const data = await response.json();
        if (!data.success || data.user?.role !== 'admin') {
            window.location.href = '/login';
            return false;
        }

        const usernameEl = document.getElementById('admin-username');
        if (usernameEl) {
            usernameEl.textContent = data.user.full_name || data.user.username;
        }
        localStorage.setItem('last_user_id', data.user.id.toString());
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login';
        return false;
    }
}

function getSessionToken() {
    const value = `; ${document.cookie}`;
    const parts = value.split('; session_token=');
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function initializeNavigation() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggle = document.getElementById('sidebar-toggle');

    toggle?.addEventListener('click', () => {
        sidebar?.classList.toggle('collapsed');
        mainContent?.classList.toggle('expanded');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            state.switchPage(item.dataset.page);
            if (window.innerWidth < 992) {
                sidebar?.classList.add('collapsed');
                mainContent?.classList.add('expanded');
            }
        });
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 992) {
            sidebar?.classList.remove('collapsed');
            mainContent?.classList.remove('expanded');
        }
    });
}

function initializeFileUpload() {
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('upload-area');
    const uploadBtn = document.getElementById('upload-btn');

    fileInput?.addEventListener('change', handleFileSelect);
    uploadBtn?.addEventListener('click', uploadFiles);

    uploadArea?.addEventListener('dragover', event => {
        event.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea?.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea?.addEventListener('drop', event => {
        event.preventDefault();
        uploadArea.classList.remove('drag-over');
        handleFiles(event.dataTransfer.files);
    });
}

function initializeFilters() {
    document.getElementById('report-filter')?.addEventListener('change', event => {
        loadReports(event.target.value);
    });
}

function initializeModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', event => {
            if (event.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

function handleFileSelect(event) {
    handleFiles(event.target.files);
}

function handleFiles(fileList) {
    state.selectedFiles = Array.from(fileList || []);
    displaySelectedFiles();
}

function displaySelectedFiles() {
    const container = document.getElementById('selected-files');
    const uploadBtn = document.getElementById('upload-btn');

    if (!container || !uploadBtn) return;

    if (!state.selectedFiles.length) {
        container.innerHTML = '';
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Selected Files';
        return;
    }

    container.innerHTML = state.selectedFiles.map((file, index) => `
        <div class="file-item">
            <div class="file-item-info">
                <i class="fas fa-file"></i>
                <span class="file-item-name">${file.name}</span>
                <span class="file-item-size">(${formatFileSize(file.size)})</span>
            </div>
            <button class="file-item-remove" onclick="removeFile(${index})">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');

    uploadBtn.disabled = false;
}

function removeFile(index) {
    state.selectedFiles.splice(index, 1);
    displaySelectedFiles();
}

async function uploadFiles() {
    if (!state.selectedFiles.length) {
        state.showToast('Please select files to upload', 'warning');
        return;
    }

    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

    const formData = new FormData();
    state.selectedFiles.forEach(file => formData.append('files', file));

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Upload failed');
        }
        state.showToast(`Uploaded ${data.uploaded || state.selectedFiles.length} file(s)`, 'success');
        state.selectedFiles = [];
        displaySelectedFiles();
        await Promise.all([loadDocuments(), loadDocumentStats(), loadDashboardStats()]);
    } catch (error) {
        console.error('Upload error:', error);
        state.showToast(error.message, 'error');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Selected Files';
    }
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`, { credentials: 'include' });
        const data = await response.json();
        const stats = data.stats || data || {};

        setText('dash-total-docs', stats.total_documents ?? 0);
        setText('dash-total-storage', formatBytes(stats.total_storage || 0));
        setText('dash-pending-reports', stats.pending_reports ?? 0);
        setText('dash-last-upload', stats.last_upload ? formatDate(stats.last_upload) : 'Never');
    updateBadges(stats.pending_reports ?? 0);
    } catch (error) {
        console.error('Dashboard stats error:', error);
    }
}

async function loadDocumentStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`, { credentials: 'include' });
        const data = await response.json();
        const stats = data.stats || data || {};
        setText('doc-total-docs', stats.total_documents ?? 0);
        setText('doc-total-storage', formatBytes(stats.total_storage || 0));
        setText('doc-last-upload', stats.last_upload ? formatDate(stats.last_upload) : 'Never');
    } catch (error) {
        console.error('Document stats error:', error);
    }
}

async function loadDocuments() {
    const tbody = document.getElementById('documents-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';
    try {
        const response = await fetch(`${API_BASE}/documents`, { credentials: 'include' });
        const data = await response.json();
        const documents = Array.isArray(data) ? data : data.documents || [];
        state.documents = documents;

        if (!documents.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No documents found</td></tr>';
            return;
        }

        tbody.innerHTML = documents.map(doc => `
            <tr>
                <td>${doc.id}</td>
                <td>${escapeHtml(doc.original_filename || doc.filename)}</td>
                <td>${formatFileSize(doc.file_size || 0)}</td>
                <td>${formatDate(doc.upload_date)}</td>
                <td style="text-align:center;">
                    <button class="btn btn-danger btn-sm" onclick="showDeleteConfirm(${doc.id}, '${escapeHtml((doc.original_filename || doc.filename).replace(/'/g, "&apos;"))}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Documents error:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Error loading documents</td></tr>';
    }
}

function showDeleteConfirm(docId, name) {
    state.deleteDocId = docId;
    setText('delete-doc-name', name || 'Selected document');
    state.openModal('delete-modal');
}

async function deleteDocument() {
    if (!state.deleteDocId) return;
    const deleteBtn = document.querySelector('#delete-modal .btn-danger');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

    try {
        const response = await fetch(`${API_BASE}/documents/${state.deleteDocId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Failed to delete document');
        }
        state.showToast('Document deleted', 'success');
        state.closeModal('delete-modal');
        state.deleteDocId = null;
        await Promise.all([loadDocuments(), loadDocumentStats(), loadDashboardStats()]);
    } catch (error) {
        console.error('Delete error:', error);
        state.showToast(error.message, 'error');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
    }
}

async function loadReportStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`, { credentials: 'include' });
        const data = await response.json();
        const stats = data.stats || data || {};
        setText('rep-total-reports', stats.total_reports ?? 0);
        setText('rep-pending-reports', stats.pending_reports ?? 0);
        setText('rep-resolved-reports', stats.resolved_reports ?? 0);
    } catch (error) {
        console.error('Report stats error:', error);
    }
}

async function loadReports(status = null) {
    const tbody = document.getElementById('reports-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading...</td></tr>';

    const filter = status || document.getElementById('report-filter')?.value || 'all';
    const params = new URLSearchParams();
    if (filter !== 'all') {
        params.set('status', filter);
    }

    try {
        const response = await fetch(`${API_BASE}/reports?${params.toString()}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Failed to load reports');
        }
        const reports = data.reports || [];
        state.reports = reports;

        if (!reports.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No reports found</td></tr>';
            return;
        }

        tbody.innerHTML = reports.map(report => `
            <tr>
                <td>${report.id}</td>
                <td>${escapeHtml(report.report_type || 'general')}</td>
                <td>${escapeHtml(truncateText(report.description || report.report_reason || '', 80))}</td>
                <td>${formatDate(report.report_date || report.created_at)}</td>
                <td>
                    <span class="status-badge ${report.status === 'resolved' ? 'status-resolved' : 'status-pending'}">
                        ${report.status}
                    </span>
                </td>
                <td style="text-align:center;">
                    <button class="btn btn-primary btn-sm" onclick="viewReport(${report.id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Reports error:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Failed to load reports</td></tr>';
    }
}

async function viewReport(reportId) {
    try {
        const response = await fetch(`${API_BASE}/reports/${reportId}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Failed to load report');
        }
        const report = data.report || data;
        state.currentReportId = reportId;

        const detail = document.getElementById('report-detail-body');
        detail.innerHTML = `
            <div style="margin-bottom:15px;"><strong>Report ID:</strong> ${report.id}</div>
            <div style="margin-bottom:15px;"><strong>Type:</strong> ${escapeHtml(report.report_type || 'general')}</div>
            <div style="margin-bottom:15px;"><strong>User Question:</strong><br>
                <div class="detail-box">${escapeHtml(report.question || 'N/A')}</div>
            </div>
            <div style="margin-bottom:15px;"><strong>AI Answer:</strong><br>
                <div class="detail-box warning">${escapeHtml(report.answer || 'N/A')}</div>
            </div>
            <div style="margin-bottom:15px;"><strong>User Comment:</strong><br>
                <div class="detail-box danger">${escapeHtml(report.user_comment || report.description || 'No additional comment')}</div>
            </div>
            <div style="margin-bottom:15px;"><strong>Status:</strong>
                <span class="status-badge ${report.status === 'resolved' ? 'status-resolved' : 'status-pending'}">${report.status}</span>
            </div>
            ${report.resolution_notes ? `<div style="margin-bottom:15px;"><strong>Resolution Notes:</strong><br><div class="detail-box success">${escapeHtml(report.resolution_notes)}</div></div>` : ''}
        `;

        const resolveBtn = document.getElementById('resolve-btn');
        if (resolveBtn) {
            resolveBtn.style.display = report.status === 'resolved' ? 'none' : 'inline-flex';
        }

        state.openModal('report-modal');
    } catch (error) {
        console.error('View report error:', error);
        state.showToast(error.message, 'error');
    }
}

async function resolveReport() {
    if (!state.currentReportId) return;

    const resolution = prompt('What action did you take to resolve this report?', 'Updated supporting documents');
    if (!resolution) return;

    const resolveBtn = document.getElementById('resolve-btn');
    resolveBtn.disabled = true;
    resolveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        const response = await fetch(`${API_BASE}/reports/${state.currentReportId}/resolve`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution_notes: resolution })
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Failed to resolve report');
        }
        state.showToast('Report resolved', 'success');
        state.closeModal('report-modal');
        state.currentReportId = null;
        await Promise.all([loadReports(), loadReportStats(), loadDashboardStats()]);
    } catch (error) {
        console.error('Resolve error:', error);
        state.showToast(error.message, 'error');
    } finally {
        resolveBtn.disabled = false;
        resolveBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Resolved';
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
    } finally {
        document.cookie = 'session_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;';
        window.location.href = '/login';
    }
}

function updateBadges(pendingReports) {
    const reportBadge = document.getElementById('sidebar-badge');
    const notification = document.getElementById('notification-badge');

    toggleBadge(reportBadge, pendingReports);
    toggleBadge(notification, pendingReports);
}

function toggleBadge(element, value) {
    if (!element) return;
    if (value > 0) {
        element.textContent = value;
        element.style.display = 'inline-block';
    } else {
        element.style.display = 'none';
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes || 1) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(1)} ${sizes[i]}`;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 MB';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function truncateText(text, length) {
    if (!text) return '';
    return text.length > length ? `${text.slice(0, length)}…` : text;
}

function escapeHtml(str = '') {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
