// Helper function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to get cookie value
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Logout function
async function logout() {
    if (!confirm('Are you sure you want to logout?')) {
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
async function checkAuth() {
    // Don't check auth on login page
    if (window.location.pathname === '/login' || window.location.pathname === '/signup') {
        return false;
    }

    // If we're on the admin page, backend has already validated
    // Trust the backend validation and just update UI
    if (window.location.pathname === '/admin' || window.location.pathname === '/') {
        console.log('On admin page - backend already validated session');
        
        // Try to get user info for display, but don't redirect on failure
        const token = localStorage.getItem('session_token') || 
                      sessionStorage.getItem('session_token') ||
                      getCookie('session_token');
        
        if (token) {
            try {
                const response = await fetch('/api/auth/validate', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.user) {
                        // Check if user is NOT admin - non-admins should not access admin web
                        if (data.user.role !== 'admin') {
                            console.log('Non-admin user detected, redirecting to user web');
                            window.location.href = 'http://localhost:7861/';
                            return false;
                        }
                        
                        // Update username display
                        const usernameEl = document.getElementById('admin-username');
                        if (usernameEl) {
                            usernameEl.textContent = data.user.username;
                        }
                        
                        // Store user ID for tracking
                        localStorage.setItem('last_user_id', data.user.id.toString());
                    }
                }
            } catch (error) {
                console.warn('Could not fetch user info:', error);
                // Don't redirect - backend already validated
            }
        }
        
        return true;
    }

    return true;
}

// Application State
const state = {
    currentPage: 'dashboard',
    documents: [],
    reports: [],
    selectedFiles: [],
    deleteDocId: null,
    currentReportId: null,

    switchPage(page) {
        this.currentPage = page;
        
        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.page === page) {
                item.classList.add('active');
            }
        });

        // Update pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });
        document.getElementById(`${page}-page`).classList.add('active');

        // Update page title
        const pageTitles = {
            'dashboard': 'Dashboard',
            'documents': 'Document Management',
            'reports': 'Report Management'
        };
        document.getElementById('page-title').textContent = pageTitles[page];

        // Load data for the page
        if (page === 'documents') {
            loadDocuments();
            loadDocumentStats();
        } else if (page === 'reports') {
            loadReports();
            loadReportStats();
        } else if (page === 'dashboard') {
            loadDashboardStats();
        }
    },

    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
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
            <i class="${icons[type]}"></i>
            <div class="toast-message">${message}</div>
        `;
        
        document.getElementById('toast-container').appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
    // Check authentication first
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        return;
    }

    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const page = this.dataset.page;
            state.switchPage(page);
        });
    });

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    
    sidebarToggle.addEventListener('click', function() {
        sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('expanded');
    });

    // File input handling
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('upload-area');
    const selectedFilesDiv = document.getElementById('selected-files');
    const uploadBtn = document.getElementById('upload-btn');

    fileInput.addEventListener('change', handleFileSelect);
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    // Upload button
    uploadBtn.addEventListener('click', uploadFiles);

    // Report filter
    const reportFilter = document.getElementById('report-filter');
    if (reportFilter) {
        reportFilter.addEventListener('change', function() {
            loadReports(this.value);
        });
    }

    // Modal close on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('active');
            }
        });
    });

    // Load initial data
    loadDashboardStats();
});

// File handling functions
function handleFileSelect(event) {
    handleFiles(event.target.files);
}

function handleFiles(files) {
    state.selectedFiles = Array.from(files);
    displaySelectedFiles();
}

function displaySelectedFiles() {
    const container = document.getElementById('selected-files');
    const uploadBtn = document.getElementById('upload-btn');
    
    if (state.selectedFiles.length === 0) {
        container.innerHTML = '';
        uploadBtn.style.display = 'none';
        return;
    }

    container.innerHTML = state.selectedFiles.map((file, index) => `
        <div class="file-item">
            <div class="file-item-info">
                <i class="fas fa-file-pdf"></i>
                <span class="file-item-name">${file.name}</span>
                <span class="file-item-size">(${formatFileSize(file.size)})</span>
            </div>
            <button class="file-item-remove" onclick="removeFile(${index})">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');

    uploadBtn.style.display = 'block';
}

function removeFile(index) {
    state.selectedFiles.splice(index, 1);
    displaySelectedFiles();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function uploadFiles() {
    if (state.selectedFiles.length === 0) {
        state.showToast('Please select files to upload', 'warning');
        return;
    }

    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

    const formData = new FormData();
    state.selectedFiles.forEach(file => {
        formData.append('files', file);
    });

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            state.showToast(`Successfully uploaded ${data.uploaded} file(s)!`, 'success');
            state.selectedFiles = [];
            displaySelectedFiles();
            loadDocuments();
            loadDocumentStats();
        } else {
            state.showToast(data.error || 'Upload failed', 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        state.showToast('Failed to upload files', 'error');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Selected Files';
    }
}

// Dashboard functions
async function loadDashboardStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        // Handle response format: {success: true, stats: {...}}
        const stats = data.stats || data;

        document.getElementById('dash-total-docs').textContent = stats.total_documents || 0;
        document.getElementById('dash-total-storage').textContent = 
            formatBytes(stats.total_storage || 0);
        document.getElementById('dash-pending-reports').textContent = stats.pending_reports || 0;
        document.getElementById('dash-last-upload').textContent = 
            stats.last_upload ? new Date(stats.last_upload).toLocaleString() : 'Never';

        // Update notification badges
        const pendingCount = stats.pending_reports || 0;
        document.getElementById('sidebar-badge').textContent = pendingCount;
        document.getElementById('notification-badge').textContent = pendingCount;
        
        if (pendingCount > 0) {
            document.getElementById('sidebar-badge').style.display = 'inline-block';
        } else {
            document.getElementById('sidebar-badge').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

// Document functions
async function loadDocumentStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        // Handle response format: {success: true, stats: {...}}
        const stats = data.stats || data;

        document.getElementById('doc-total-docs').textContent = stats.total_documents || 0;
        document.getElementById('doc-total-storage').textContent = 
            formatBytes(stats.total_storage || 0);
        document.getElementById('doc-last-upload').textContent = 
            stats.last_upload ? new Date(stats.last_upload).toLocaleString() : 'Never';
    } catch (error) {
        console.error('Error loading document stats:', error);
    }
}

async function loadDocuments() {
    const tbody = document.getElementById('documents-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';

    try {
        const response = await fetch('/api/documents');
        const data = await response.json();

        // Handle the response structure {success: true, documents: [...]}
        const documents = data.documents || data;
        state.documents = documents;

        if (documents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No documents uploaded yet</td></tr>';
            return;
        }

        tbody.innerHTML = documents.map(doc => `
            <tr>
                <td>${doc.id}</td>
                <td><i class="fas fa-file-pdf" style="color: #e74a3b; margin-right: 8px;"></i>${doc.filename}</td>
                <td>${formatFileSize(doc.file_size)}</td>
                <td>${new Date(doc.upload_date).toLocaleString()}</td>
                <td style="text-align: center;">
                    <button class="btn btn-danger btn-sm" onclick="showDeleteConfirm(${doc.id}, '${doc.filename.replace(/'/g, "\\'")}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading documents:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Error loading documents</td></tr>';
    }
}

function showDeleteConfirm(docId, filename) {
    state.deleteDocId = docId;
    document.getElementById('delete-doc-name').textContent = filename;
    state.openModal('delete-modal');
}

async function deleteDocument() {
    if (!state.deleteDocId) return;

    const deleteBtn = event.target;
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

    try {
        const response = await fetch(`/api/documents/${state.deleteDocId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            state.showToast('Document deleted successfully!', 'success');
            state.closeModal('delete-modal');
            loadDocuments();
            loadDocumentStats();
            loadDashboardStats();
        } else {
            state.showToast(data.error || 'Failed to delete document', 'error');
        }
    } catch (error) {
        console.error('Delete error:', error);
        state.showToast('Failed to delete document', 'error');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
        state.deleteDocId = null;
    }
}

// Report functions
async function loadReportStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        // Handle response format: {success: true, stats: {...}}
        const stats = data.stats || data;

        document.getElementById('rep-total-reports').textContent = stats.total_reports || 0;
        document.getElementById('rep-pending-reports').textContent = stats.pending_reports || 0;
        document.getElementById('rep-resolved-reports').textContent = stats.resolved_reports || 0;
    } catch (error) {
        console.error('Error loading report stats:', error);
    }
}

async function loadReports(status = 'all') {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading...</td></tr>';

    try {
        const url = status === 'all' ? '/api/reports' : `/api/reports?status=${status}`;
        const response = await fetch(url);
        const data = await response.json();
        
        // Handle both response formats: {success: true, reports: [...]} or [...]
        const reports = data.reports || data;

        state.reports = reports;

        if (reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No reports found</td></tr>';
            return;
        }

        tbody.innerHTML = reports.map(report => `
            <tr>
                <td>${report.id}</td>
                <td>${report.report_type}</td>
                <td>${truncateText(report.question || report.description, 50)}</td>
                <td>${new Date(report.report_date).toLocaleString()}</td>
                <td>
                    <span class="status-badge ${report.status === 'pending' ? 'status-pending' : 'status-resolved'}">
                        ${report.status}
                    </span>
                </td>
                <td style="text-align: center;">
                    <button class="btn btn-primary btn-sm" onclick="viewReport(${report.id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading reports:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Error loading reports</td></tr>';
    }
}

function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

async function viewReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}`);
        const data = await response.json();
        
        // Handle both response formats: {success: true, report: {...}} or {...}
        const report = data.report || data;

        state.currentReportId = reportId;

        const detailBody = document.getElementById('report-detail-body');
        detailBody.innerHTML = `
            <div style="margin-bottom: 15px;">
                <strong>Report ID:</strong> ${report.id}
            </div>
            <div style="margin-bottom: 15px;">
                <strong>Type:</strong> <span class="status-badge status-pending">${report.report_type || report.report_reason}</span>
            </div>
            <div style="margin-bottom: 15px;">
                <strong>User's Question:</strong><br>
                <div style="background-color: #f8f9fc; padding: 10px; border-radius: 5px; margin-top: 5px;">
                    ${report.question || 'N/A'}
                </div>
            </div>
            <div style="margin-bottom: 15px;">
                <strong>AI's Answer:</strong><br>
                <div style="background-color: #fff3cd; padding: 10px; border-radius: 5px; margin-top: 5px; max-height: 200px; overflow-y: auto;">
                    ${report.answer || 'N/A'}
                </div>
            </div>
            <div style="margin-bottom: 15px;">
                <strong>User's Comment:</strong><br>
                <div style="background-color: #f8d7da; padding: 10px; border-radius: 5px; margin-top: 5px;">
                    ${report.user_comment || report.description || 'No additional comment'}
                </div>
            </div>
            <div style="margin-bottom: 15px;">
                <strong>Reported Date:</strong> ${new Date(report.report_date || report.created_at).toLocaleString()}
            </div>
            <div style="margin-bottom: 15px;">
                <strong>Status:</strong> 
                <span class="status-badge ${report.status === 'pending' ? 'status-pending' : 'status-resolved'}">
                    ${report.status}
                </span>
            </div>
            ${report.status === 'pending' ? `
                <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-left: 4px solid #2196F3; border-radius: 5px;">
                    <strong>💡 Resolution Actions:</strong>
                    <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                        <li><strong>Upload better documents:</strong> Add more comprehensive or updated documents to improve answers</li>
                        <li><strong>Check document quality:</strong> Review if existing documents contain the correct information</li>
                        <li><strong>Update/delete outdated docs:</strong> Remove or replace documents with incorrect information</li>
                        <li><strong>Re-index documents:</strong> Delete and re-upload documents if they were processed incorrectly</li>
                        <li><strong>Improve document format:</strong> Ensure documents are text-searchable (not image-only PDFs)</li>
                    </ul>
                </div>
            ` : ''}
            ${report.resolution_notes ? `
                <div style="margin-bottom: 15px; margin-top: 15px;">
                    <strong>Resolution Notes:</strong><br>
                    <div style="background-color: #d4edda; padding: 10px; border-radius: 5px; margin-top: 5px;">
                        ${report.resolution_notes}
                    </div>
                    ${report.resolved_by ? `<div style="margin-top: 5px; font-size: 12px; color: #666;">Resolved by: ${report.resolved_by} on ${new Date(report.resolved_at).toLocaleString()}</div>` : ''}
                </div>
            ` : ''}
        `;

        const resolveBtn = document.getElementById('resolve-btn');
        if (report.status === 'resolved') {
            resolveBtn.style.display = 'none';
        } else {
            resolveBtn.style.display = 'inline-flex';
        }

        state.openModal('report-modal');
    } catch (error) {
        console.error('Error loading report details:', error);
        state.showToast('Failed to load report details', 'error');
    }
}

async function resolveReport() {
    if (!state.currentReportId) return;

    // Prompt admin for resolution notes
    const resolutionActions = [
        '✅ Uploaded better/updated documents',
        '✅ Removed incorrect/outdated documents',
        '✅ Re-indexed documents',
        '✅ Verified information is now correct',
        '✅ Improved document quality (converted image PDFs)',
        '❌ Cannot fix - Information not available',
        '❌ Cannot fix - Out of scope',
        '✏️ Custom note...'
    ];

    const actionList = resolutionActions.map((action, i) => `${i + 1}. ${action}`).join('\n');
    const selection = prompt(
        `What action did you take to resolve this report?\n\n${actionList}\n\nEnter number (1-${resolutionActions.length}) or write custom note:`,
        ''
    );

    if (!selection) return; // User cancelled

    let resolution_notes;
    const selectionNum = parseInt(selection);
    
    if (selectionNum >= 1 && selectionNum <= resolutionActions.length) {
        if (selectionNum === resolutionActions.length) {
            // Custom note
            resolution_notes = prompt('Enter your resolution note:', '');
            if (!resolution_notes) return;
        } else {
            resolution_notes = resolutionActions[selectionNum - 1];
        }
    } else {
        // Treat as custom text
        resolution_notes = selection;
    }

    const resolveBtn = document.getElementById('resolve-btn');
    resolveBtn.disabled = true;
    resolveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        const response = await fetch(`/api/reports/${state.currentReportId}/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                resolution_notes: resolution_notes
            })
        });

        const data = await response.json();

        if (response.ok) {
            state.showToast('Report marked as resolved!', 'success');
            state.closeModal('report-modal');
            loadReports();
            loadReportStats();
            loadDashboardStats();
        } else {
            state.showToast(data.error || 'Failed to resolve report', 'error');
        }
    } catch (error) {
        console.error('Resolve error:', error);
        state.showToast('Failed to resolve report', 'error');
    } finally {
        resolveBtn.disabled = false;
        resolveBtn.innerHTML = '<i class="fas fa-check"></i> Mark as Resolved';
        state.currentReportId = null;
    }
}
