/* ============================================================
   history.js — NewsVerify AI
   Loads history from the Flask API (with localStorage fallback),
   renders the table, handles search/filter, pagination, delete.
   ============================================================ */

const API_BASE = '/api';
const PAGE_SIZE = 10;

let allEntries = [];
let filteredEntries = [];
let currentPage = 1;
let pendingDeleteId = null;

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();

  // Delete confirm button
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (pendingDeleteId) executeDelete(pendingDeleteId);
    });
  }
});

// ── Load history ───────────────────────────────────────────────
async function loadHistory() {
  showState('loading');
  try {
    const res = await fetch(`${API_BASE}/history`);
    if (!res.ok) throw new Error('API unavailable');
    allEntries = await res.json();
  } catch {
    // Fallback: read from localStorage (set by main.js on every result)
    const stored = localStorage.getItem('nv_history');
    allEntries = stored ? JSON.parse(stored) : [];
  }

  filteredEntries = [...allEntries];
  renderTable();
}

// ── Filter & search ────────────────────────────────────────────
function filterHistory() {
  const search = (document.getElementById('historySearch')?.value || '').toLowerCase();
  const classification = document.getElementById('filterClassification')?.value || '';
  const inputType = document.getElementById('filterInputType')?.value || '';

  filteredEntries = allEntries.filter(entry => {
    const matchSearch = !search ||
      (entry.preview || '').toLowerCase().includes(search) ||
      (entry.classification || '').toLowerCase().includes(search);
    const matchClass = !classification || entry.classification === classification;
    const matchType = !inputType || entry.inputType === inputType;
    return matchSearch && matchClass && matchType;
  });

  currentPage = 1;
  renderTable();
}

function resetFilters() {
  const s = document.getElementById('historySearch');
  const c = document.getElementById('filterClassification');
  const t = document.getElementById('filterInputType');
  if (s) s.value = '';
  if (c) c.value = '';
  if (t) t.value = '';
  filterHistory();
}

// ── Render table ───────────────────────────────────────────────
function renderTable() {
  const count = document.getElementById('resultCount');
  if (count) count.textContent = `${filteredEntries.length} result${filteredEntries.length !== 1 ? 's' : ''}`;

  if (allEntries.length === 0) { showState('empty'); return; }
  if (filteredEntries.length === 0) { showState('noResults'); return; }

  showState('table');

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageEntries = filteredEntries.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  tbody.innerHTML = pageEntries.map((entry, idx) => {
    const rowNum = start + idx + 1;
    const badgeClass = getBadgeClass(entry.classification);
    const typeIcon = getTypeIcon(entry.inputType);
    const scoreColor = getScoreColor(entry.score);

    return `
      <tr>
        <td class="text-muted small">${rowNum}</td>
        <td>
          <div class="history-preview">${escapeHtml(entry.preview || '—')}</div>
        </td>
        <td>
          <span class="score-chip" style="background:${scoreColor}20;color:${scoreColor};">
            <strong>${entry.score ?? '—'}</strong>/100
          </span>
        </td>
        <td><span class="history-badge ${badgeClass}">${entry.classification || '—'}</span></td>
        <td>
          <span class="type-icon"><i class="${typeIcon} me-1"></i>${capitalise(entry.inputType || '—')}</span>
        </td>
        <td class="text-muted small">${entry.date || '—'}<br>${entry.time || ''}</td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-xs btn-outline-primary" title="View result"
                    onclick="viewResult('${entry.id}')">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-xs btn-outline-danger" title="Delete"
                    onclick="promptDelete('${entry.id}')">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  renderPagination();
}

// ── Pagination ─────────────────────────────────────────────────
function renderPagination() {
  const totalPages = Math.ceil(filteredEntries.length / PAGE_SIZE);
  const nav = document.getElementById('paginationNav');
  const list = document.getElementById('paginationList');
  if (!list) return;

  if (totalPages <= 1) { if (nav) nav.classList.add('d-none'); return; }
  if (nav) nav.classList.remove('d-none');

  let html = `
    <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
      <button class="page-link" onclick="goToPage(${currentPage - 1})">
        <i class="bi bi-chevron-left"></i>
      </button>
    </li>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
        <button class="page-link" onclick="goToPage(${i})">${i}</button>
      </li>`;
    } else if (Math.abs(i - currentPage) === 2) {
      html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
    }
  }

  html += `
    <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
      <button class="page-link" onclick="goToPage(${currentPage + 1})">
        <i class="bi bi-chevron-right"></i>
      </button>
    </li>`;

  list.innerHTML = html;
}

function goToPage(page) {
  const totalPages = Math.ceil(filteredEntries.length / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Actions ────────────────────────────────────────────────────
function viewResult(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;
  sessionStorage.setItem('latestResult', JSON.stringify(entry));
  window.location.href = 'result.html';
}

function promptDelete(id) {
  pendingDeleteId = id;
  const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
  modal.show();
}

async function executeDelete(id) {
  // Close modal
  bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'))?.hide();

  try {
    await fetch(`${API_BASE}/history/${id}`, { method: 'DELETE' });
  } catch {
    // Ignore API error — still remove from local state
  }

  allEntries = allEntries.filter(e => e.id !== id);
  filteredEntries = filteredEntries.filter(e => e.id !== id);

  // Keep pagination valid
  const totalPages = Math.ceil(filteredEntries.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

  renderTable();
  pendingDeleteId = null;
}

async function clearAllHistory() {
  if (!confirm('Delete all verification history? This cannot be undone.')) return;
  try {
    await fetch(`${API_BASE}/history`, { method: 'DELETE' });
  } catch { /* offline — clear local */ }
  allEntries = [];
  filteredEntries = [];
  currentPage = 1;
  renderTable();
}

// ── State display ──────────────────────────────────────────────
function showState(state) {
  const states = {
    loading: document.getElementById('historyLoading'),
    empty: document.getElementById('historyEmpty'),
    noResults: document.getElementById('historyNoResults'),
    table: document.getElementById('historyTableWrap'),
  };
  Object.entries(states).forEach(([key, el]) => {
    if (el) el.classList.toggle('d-none', key !== state);
  });
}

// ── Helpers ────────────────────────────────────────────────────
function getBadgeClass(classification) {
  if (classification === 'LIKELY CREDIBLE') return 'badge-credible';
  if (classification === 'UNCERTAIN') return 'badge-uncertain';
  return 'badge-noncredible';
}

function getTypeIcon(type) {
  const icons = { text: 'bi bi-type', url: 'bi bi-link-45deg', file: 'bi bi-file-earmark' };
  return icons[type] || 'bi bi-file-text';
}

function getScoreColor(score) {
  if (score >= 72) return '#1a9e5c';
  if (score >= 48) return '#e6a817';
  return '#d9363e';
}

function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function setAuthButtonLoading(button, loading, loadingText) {
  if (!button) return;
  if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
  button.disabled = loading;
  button.innerHTML = loading
    ? `<span class="spinner-border spinner-border-sm me-2"></span>${loadingText}`
    : button.dataset.defaultHtml;
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('nv_user')) || null;
  } catch {
    return null;
  }
}

function closeModal(id) {
  const modalEl = document.getElementById(id);
  if (!modalEl || typeof bootstrap === 'undefined') return;
  bootstrap.Modal.getOrCreateInstance(modalEl).hide();
}

function updateAuthNav(user = getStoredUser()) {
  const loginNavBtn = document.getElementById('loginNavBtn');
  if (!loginNavBtn) return;

  if (user) {
    loginNavBtn.removeAttribute('data-bs-toggle');
    loginNavBtn.removeAttribute('data-bs-target');
    loginNavBtn.innerHTML = '<i class="bi bi-box-arrow-right me-1"></i>Logout';
    loginNavBtn.onclick = handleLogout;
    return;
  }

  loginNavBtn.setAttribute('data-bs-toggle', 'modal');
  loginNavBtn.setAttribute('data-bs-target', '#loginModal');
  loginNavBtn.innerHTML = '<i class="bi bi-person me-1"></i>Login';
  loginNavBtn.onclick = null;
}

function storeAuthenticatedUser(user) {
  localStorage.setItem('nv_user', JSON.stringify(user));
  updateAuthNav(user);
}

function handleLogout() {
  localStorage.removeItem('nv_user');
  updateAuthNav(null);
}

async function handleLogin() {
  const email = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  const loginBtn = document.getElementById('loginBtn');

  if (!email || !password) {
    alert('Please enter both email and password.');
    return;
  }

  setAuthButtonLoading(loginBtn, true, 'Signing in...');
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');

    storeAuthenticatedUser(data.user);
    closeModal('loginModal');
    document.getElementById('loginPassword').value = '';
    alert(`Welcome back, ${data.user.name}.`);
  } catch (err) {
    alert(err.message || 'Network error. Make sure the Flask server is running.');
  } finally {
    setAuthButtonLoading(loginBtn, false);
  }
}

updateAuthNav();
