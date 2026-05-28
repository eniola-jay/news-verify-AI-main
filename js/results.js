/* ============================================================
   results.js — NewsVerify AI
   Reads analysis data from sessionStorage and populates the
   result page. Animates the score ring and score counter.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const raw = sessionStorage.getItem('latestResult');

  if (!raw) {
    showNoDataState();
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    showNoDataState();
    return;
  }

  populateResult(data);
});

// ── Populate all result elements ───────────────────────────────
function populateResult(data) {
  const score = data.score ?? 0;
  const classification = data.classification ?? 'UNKNOWN';
  const confidence = data.confidence ?? '—';
  const positives = data.positives ?? [];
  const negatives = data.negatives ?? [];
  const processingTime = data.processingTime ?? '—';
  const inputType = data.inputType ?? 'text';

  // Score number (animated counter)
  animateCounter('scoreText', 0, score, 1200);

  // Score ring (SVG stroke-dashoffset animation)
  animateScoreRing(score);

  // Classification badge
  const classEl = document.getElementById('classificationBadge');
  if (classEl) {
    classEl.textContent = classification;
    classEl.className = 'score-badge mt-3 ' + getClassificationClass(classification);
  }

  // Confidence badge
  const confEl = document.getElementById('confidenceBadge');
  if (confEl) {
    confEl.textContent = confidence + ' CONFIDENCE';
    confEl.className = 'confidence-badge ' + getConfidenceClass(confidence);
  }

  // Verdict card colour
  const card = document.getElementById('verdictCard');
  if (card) {
    card.classList.add('verdict-' + classification.toLowerCase().replace(/\s+/g, '-'));
  }

  // Headline and summary
  const headlineEl = document.getElementById('resultHeadline');
  const summaryEl = document.getElementById('resultSummary');
  if (headlineEl) headlineEl.textContent = getHeadline(classification, score);
  if (summaryEl) summaryEl.textContent = getSummary(classification, score, positives.length, negatives.length);

  // Meta info
  const typeEl = document.getElementById('inputTypeMeta');
  const timeEl = document.getElementById('processingTime');
  const tsEl = document.getElementById('timestamp');

  if (typeEl) {
    const icons = { text: 'bi-type', url: 'bi-link-45deg', file: 'bi-file-earmark' };
    const icon = icons[inputType] || 'bi-file-text';
    const label = inputType === 'url' ? (data.sourceUrl ? truncate(data.sourceUrl, 40) : 'URL') :
                  inputType === 'file' ? (data.filename || 'File') : 'Pasted Text';
    typeEl.innerHTML = `<i class="bi ${icon} me-1"></i>${label}`;
  }
  if (timeEl) timeEl.innerHTML = `<i class="bi bi-clock me-1"></i>${processingTime}`;
  if (tsEl) tsEl.innerHTML = `<i class="bi bi-calendar3 me-1"></i>${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  // Positive factors list
  const posEl = document.getElementById('positiveFactors');
  if (posEl) {
    posEl.innerHTML = positives.length
      ? positives.map(f => `<li><i class="bi bi-check2 me-2 text-success"></i>${f}</li>`).join('')
      : '<li class="text-muted"><i class="bi bi-dash me-2"></i>No positive indicators detected.</li>';
  }

  // Negative factors list
  const negEl = document.getElementById('negativeFactors');
  if (negEl) {
    negEl.innerHTML = negatives.length
      ? negatives.map(f => `<li><i class="bi bi-exclamation me-2 text-warning"></i>${f}</li>`).join('')
      : '<li class="text-muted"><i class="bi bi-dash me-2"></i>No risk indicators detected.</li>';
  }
}

// ── Score ring animation ───────────────────────────────────────
function animateScoreRing(score) {
  const circle = document.getElementById('scoreCircle');
  if (!circle) return;

  const radius = 52;
  const circumference = 2 * Math.PI * radius; // ~326.7
  const targetOffset = circumference - (score / 100) * circumference;

  // Set ring colour based on score
  circle.style.stroke = getScoreColor(score);

  // Animate with requestAnimationFrame
  const duration = 1400;
  const start = performance.now();
  const startOffset = circumference; // starts at 0% filled

  function frame(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    const currentOffset = startOffset - eased * (startOffset - targetOffset);
    circle.style.strokeDashoffset = currentOffset;
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ── Counter animation ──────────────────────────────────────────
function animateCounter(elementId, from, to, duration) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    el.textContent = Math.round(from + eased * (to - from));
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ── Helpers ────────────────────────────────────────────────────
function getScoreColor(score) {
  if (score >= 72) return '#1a9e5c';
  if (score >= 48) return '#e6a817';
  return '#d9363e';
}

function getClassificationClass(classification) {
  if (classification === 'LIKELY CREDIBLE') return 'badge-credible';
  if (classification === 'UNCERTAIN') return 'badge-uncertain';
  return 'badge-noncredible';
}

function getConfidenceClass(confidence) {
  if (confidence === 'HIGH') return 'conf-high';
  if (confidence === 'MEDIUM') return 'conf-medium';
  return 'conf-low';
}

function getHeadline(classification, score) {
  if (classification === 'LIKELY CREDIBLE') return `This article shows strong credibility indicators (${score}/100).`;
  if (classification === 'UNCERTAIN') return `This article has mixed credibility signals (${score}/100).`;
  return `This article raises significant credibility concerns (${score}/100).`;
}

function getSummary(classification, score, posCount, negCount) {
  if (classification === 'LIKELY CREDIBLE') {
    return `Our analysis identified ${posCount} credibility indicator${posCount !== 1 ? 's' : ''} and ${negCount} risk indicator${negCount !== 1 ? 's' : ''}. The content demonstrates characteristics consistent with credible journalism.`;
  }
  if (classification === 'UNCERTAIN') {
    return `The analysis found mixed signals with ${posCount} credibility indicator${posCount !== 1 ? 's' : ''} and ${negCount} risk indicator${negCount !== 1 ? 's' : ''}. We recommend verifying this content with additional trusted sources.`;
  }
  return `Our analysis flagged ${negCount} risk indicator${negCount !== 1 ? 's' : ''} with only ${posCount} credibility indicator${posCount !== 1 ? 's' : ''}. This content shows patterns common in unreliable sources.`;
}

function truncate(str, maxLen) {
  return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}

function showNoDataState() {
  const card = document.getElementById('verdictCard');
  if (card) {
    card.innerHTML = `
      <div class="text-center py-5">
        <i class="bi bi-exclamation-circle display-4 text-muted mb-3 d-block"></i>
        <h4 class="text-muted">No Result Data Found</h4>
        <p class="text-muted">It looks like you navigated here directly. Please submit an article first.</p>
        <a href="index.html" class="btn btn-primary mt-2">
          <i class="bi bi-search me-2"></i>Verify an Article
        </a>
      </div>`;
  }
}

// ── Share result ───────────────────────────────────────────────
function shareResult() {
  const raw = sessionStorage.getItem('latestResult');
  if (!raw) return;
  const data = JSON.parse(raw);
  const text = `NewsVerify AI scored this article ${data.score}/100 — ${data.classification}. Check it out: ${window.location.href}`;

  if (navigator.share) {
    navigator.share({ title: 'NewsVerify AI Result', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('[onclick="shareResult()"]');
      if (btn) { btn.innerHTML = '<i class="bi bi-check2 me-2"></i>Link copied!'; }
    });
  }
}
