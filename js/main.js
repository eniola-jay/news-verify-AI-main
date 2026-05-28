/* ============================================================
   main.js — NewsVerify AI
   Handles: text / url / file form submissions, word counter,
            file drag-and-drop, auth modals, spinner management
   ============================================================ */

const API_BASE = '/api';

// ── Utilities ─────────────────────────────────────────────────
function setButtonLoading(btn, loading) {
  const textEl = btn.querySelector('.btn-text');
  const spinEl = btn.querySelector('.btn-spinner');
  if (!textEl || !spinEl) return;
  btn.disabled = loading;
  textEl.classList.toggle('d-none', loading);
  spinEl.classList.toggle('d-none', !loading);
}

function showAlert(message, type = 'danger') {
  const el = document.getElementById('verifyAlert');
  if (!el) return;
  el.className = `alert alert-${type} mt-3`;
  el.innerHTML = `<i class="bi bi-${type === 'danger' ? 'exclamation-triangle' : 'check-circle'} me-2"></i>${message}`;
  el.classList.remove('d-none');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert() {
  const el = document.getElementById('verifyAlert');
  if (el) el.classList.add('d-none');
}

function storeAndRedirect(data) {
  sessionStorage.setItem('latestResult', JSON.stringify(data));
  window.location.href = 'result.html';
}

// ── Word counter ───────────────────────────────────────────────
const textArea = document.getElementById('newsText');
const wordCounter = document.getElementById('textWordCount');
if (textArea && wordCounter) {
  textArea.addEventListener('input', () => {
    const words = textArea.value.trim().split(/\s+/).filter(w => w.length > 0);
    const count = words.length;
    wordCounter.textContent = `${count} word${count !== 1 ? 's' : ''}`;
    wordCounter.style.color = count < 10 && count > 0 ? 'var(--nv-warning)' : '';
  });
}

// ── File drop zone ─────────────────────────────────────────────
const dropZone = document.getElementById('fileDropZone');
const fileInput = document.getElementById('newsFile');
const selectedFileInfo = document.getElementById('selectedFileInfo');
const selectedFileName = document.getElementById('selectedFileName');

if (dropZone && fileInput) {
  // Click on zone opens file dialog
  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) showSelectedFile(file);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['txt', 'pdf'].includes(ext)) {
        showAlert('Only .txt and .pdf files are supported.');
        return;
      }
      // Create a DataTransfer to assign the dropped file to the input
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      showSelectedFile(file);
    }
  });
}

function showSelectedFile(file) {
  if (!selectedFileInfo || !selectedFileName) return;
  selectedFileName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  selectedFileInfo.classList.remove('d-none');
  dropZone.classList.add('has-file');
}

// ── Verify: Text ───────────────────────────────────────────────
const verifyTextBtn = document.getElementById('verifyTextBtn');
if (verifyTextBtn) {
  verifyTextBtn.addEventListener('click', async () => {
    hideAlert();
    const text = document.getElementById('newsText').value.trim();

    if (!text) { showAlert('Please paste some article text first.'); return; }
    if (text.split(/\s+/).filter(w => w).length < 10) {
      showAlert('Please enter at least 10 words for a meaningful analysis.');
      return;
    }

    setButtonLoading(verifyTextBtn, true);
    try {
      const res = await fetch(`${API_BASE}/verify/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed. Please try again.');
      storeAndRedirect(data);
    } catch (err) {
      showAlert(err.message || 'Network error — make sure the server is running.');
    } finally {
      setButtonLoading(verifyTextBtn, false);
    }
  });
}

// ── Verify: URL ────────────────────────────────────────────────
const verifyUrlBtn = document.getElementById('verifyUrlBtn');
if (verifyUrlBtn) {
  verifyUrlBtn.addEventListener('click', async () => {
    hideAlert();
    const url = document.getElementById('newsUrl').value.trim();

    if (!url) { showAlert('Please enter a URL first.'); return; }

    setButtonLoading(verifyUrlBtn, true);
    try {
      const res = await fetch(`${API_BASE}/verify/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyse URL.');
      storeAndRedirect(data);
    } catch (err) {
      showAlert(err.message || 'Network error — make sure the server is running.');
    } finally {
      setButtonLoading(verifyUrlBtn, false);
    }
  });
}

// ── Verify: File ───────────────────────────────────────────────
const verifyFileBtn = document.getElementById('verifyFileBtn');
if (verifyFileBtn) {
  verifyFileBtn.addEventListener('click', async () => {
    hideAlert();
    const file = document.getElementById('newsFile').files[0];

    if (!file) { showAlert('Please select a file first.'); return; }
    if (file.size > 5 * 1024 * 1024) { showAlert('File exceeds the 5 MB limit.'); return; }

    const formData = new FormData();
    formData.append('file', file);

    setButtonLoading(verifyFileBtn, true);
    try {
      const res = await fetch(`${API_BASE}/verify/file`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyse file.');
      storeAndRedirect(data);
    } catch (err) {
      showAlert(err.message || 'Network error — make sure the server is running.');
    } finally {
      setButtonLoading(verifyFileBtn, false);
    }
  });
}

// Auth helpers
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

function escapeAuthText(value) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(value || ''));
  return div.innerHTML;
}

function updateAuthNav(user = getStoredUser()) {
  const loginNavBtn = document.getElementById('loginNavBtn') || document.querySelector('[data-bs-target="#loginModal"]');
  const registerNavBtn = document.getElementById('registerNavBtn') || document.querySelector('[data-bs-target="#registerModal"]');
  if (!loginNavBtn || !registerNavBtn) return;

  if (user) {
    const firstName = (user.name || 'Account').split(' ')[0];
    loginNavBtn.removeAttribute('data-bs-toggle');
    loginNavBtn.removeAttribute('data-bs-target');
    loginNavBtn.disabled = true;
    loginNavBtn.innerHTML = `<i class="bi bi-person-check me-1"></i>${escapeAuthText(firstName)}`;

    registerNavBtn.removeAttribute('data-bs-toggle');
    registerNavBtn.removeAttribute('data-bs-target');
    registerNavBtn.innerHTML = '<i class="bi bi-box-arrow-right me-1"></i>Logout';
    registerNavBtn.onclick = handleLogout;
    return;
  }

  loginNavBtn.disabled = false;
  loginNavBtn.setAttribute('data-bs-toggle', 'modal');
  loginNavBtn.setAttribute('data-bs-target', '#loginModal');
  loginNavBtn.innerHTML = '<i class="bi bi-person me-1"></i>Login';

  registerNavBtn.setAttribute('data-bs-toggle', 'modal');
  registerNavBtn.setAttribute('data-bs-target', '#registerModal');
  registerNavBtn.innerHTML = 'Register';
  registerNavBtn.onclick = null;
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

async function handleRegister() {
  const name = document.getElementById('registerUsername')?.value.trim();
  const email = document.getElementById('registerEmail')?.value.trim();
  const password = document.getElementById('registerPassword')?.value;
  const confirm = document.getElementById('registerConfirmPassword')?.value;
  const registerBtn = document.querySelector('#registerModal .btn-primary');

  if (!name || !email || !password || !confirm) {
    alert('Please fill in all fields.');
    return;
  }
  if (password !== confirm) {
    alert('Passwords do not match.');
    return;
  }
  if (password.length < 8) {
    alert('Password must be at least 8 characters.');
    return;
  }

  setAuthButtonLoading(registerBtn, true, 'Creating account...');
  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed.');

    storeAuthenticatedUser(data.user);
    closeModal('registerModal');
    document.getElementById('registerPassword').value = '';
    document.getElementById('registerConfirmPassword').value = '';
    alert('Account created successfully. You are now signed in.');
  } catch (err) {
    alert(err.message || 'Network error. Make sure the Flask server is running.');
  } finally {
    setAuthButtonLoading(registerBtn, false);
  }
}

updateAuthNav();
