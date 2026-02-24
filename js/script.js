let allOrganizations = [];
let allCategories = [];
let currentCategory = 'all';
let activeTags = [];
let favoriteOrgs = new Set(JSON.parse(localStorage.getItem('camppedidos_favorites') || '[]'));

const LOCAL_VOTES_KEY = 'campp_user_votes';
let voteProviderReady = false;
let userVotesCache = {};
let globalVoteSummary = {};
let remoteVotesDisabled = false;
const externalLoadingTasks = new Map();
const voteResyncTimersByOrg = new Map();
const pendingVoteActions = new Map();
const voteSummaryLoadedByOrg = new Set();
const userVoteLoadedByOrg = new Set();
const orgVoteLoadPromises = new Map();
let orgVoteObserver = null;
let renderOrganizationsQueued = false;
let votesInitResolved = false;
let safeAreaListenersBound = false;

const MAX_NAV_SAFE_INSET_PX = 96;
const MAX_TOP_SAFE_INSET_PX = 72;
const SPLASH_MIN_VISIBLE_MS = 900;
const SPLASH_FORCE_HIDE_MS = 9000;
let splashShownAt = 0;
let splashHideRequested = false;
let splashForceTimer = null;

function hasFirebaseVoteConfig() {
  const cfg = window.CAMPP_FIREBASE_CONFIG;
  return !!(cfg && cfg.apiKey && cfg.projectId && cfg.appId);
}

function scheduleOrganizationsRender() {
  if (renderOrganizationsQueued) return;
  renderOrganizationsQueued = true;
  window.requestAnimationFrame(() => {
    renderOrganizationsQueued = false;
    renderOrganizations();
  });
}

function toPxNumber(value) {
  const num = parseFloat(String(value || '').replace('px', '').trim());
  return Number.isFinite(num) ? num : 0;
}

function readRootCssPxVar(name) {
  try {
    return toPxNumber(getComputedStyle(document.documentElement).getPropertyValue(name));
  } catch {
    return 0;
  }
}

function getVisualViewportBottomInset() {
  if (!window.visualViewport) return 0;
  const vv = window.visualViewport;
  const rawInset = window.innerHeight - (vv.height + vv.offsetTop);
  if (!Number.isFinite(rawInset) || rawInset <= 0) return 0;

  // Ignore large deltas caused by keyboard open; keep navbar-safe adjustments only.
  if (rawInset > MAX_NAV_SAFE_INSET_PX) return 0;
  return rawInset;
}

function getVisualViewportTopInset() {
  if (!window.visualViewport) return 0;
  const vv = window.visualViewport;
  const rawInset = vv.offsetTop;
  if (!Number.isFinite(rawInset) || rawInset <= 0) return 0;

  // Ignore outliers unrelated to status bar/cutout.
  if (rawInset > MAX_TOP_SAFE_INSET_PX) return 0;
  return rawInset;
}

function updateSafeAreaInsets() {
  const root = document.documentElement;
  if (!root) return;

  const envTop = readRootCssPxVar('--campp-safe-area-top-env');
  const viewportTop = getVisualViewportTopInset();
  const topInset = Math.max(envTop, viewportTop, 0);
  const envBottom = readRootCssPxVar('--campp-safe-area-bottom-env');
  const viewportBottom = getVisualViewportBottomInset();
  const bottomInset = Math.max(envBottom, viewportBottom, 0);
  root.style.setProperty('--campp-safe-area-top', `${Math.round(topInset)}px`);
  root.style.setProperty('--campp-safe-area-bottom', `${Math.round(bottomInset)}px`);
}

function scheduleSafeAreaRefresh() {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(updateSafeAreaInsets);
    return;
  }
  setTimeout(updateSafeAreaInsets, 0);
}

function setupSafeAreaInsets() {
  if (safeAreaListenersBound) return;
  safeAreaListenersBound = true;

  updateSafeAreaInsets();
  window.addEventListener('resize', scheduleSafeAreaRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleSafeAreaRefresh, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleSafeAreaRefresh, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleSafeAreaRefresh, { passive: true });
  }
}

function showAppSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  splash.classList.remove('campp-splash-hide');
  splashShownAt = Date.now();
  splashHideRequested = false;
  if (splashForceTimer) {
    clearTimeout(splashForceTimer);
  }
  splashForceTimer = setTimeout(() => hideAppSplash(true), SPLASH_FORCE_HIDE_MS);
}

function hideAppSplash(force = false) {
  const splash = document.getElementById('app-splash');
  if (!splash || splashHideRequested) return;

  const elapsed = Date.now() - splashShownAt;
  const waitMs = force ? 0 : Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);

  splashHideRequested = true;
  setTimeout(() => {
    splash.classList.add('campp-splash-hide');
    if (splashForceTimer) {
      clearTimeout(splashForceTimer);
      splashForceTimer = null;
    }
  }, waitMs);
}

function clearVoteLoadState() {
  voteSummaryLoadedByOrg.clear();
  userVoteLoadedByOrg.clear();
  orgVoteLoadPromises.clear();
  if (orgVoteObserver) {
    orgVoteObserver.disconnect();
    orgVoteObserver = null;
  }
}

function shouldUseRemoteVoteData() {
  return voteProviderReady && !remoteVotesDisabled;
}

function isOrgSummaryLoading(orgId) {
  if (!orgId) return false;
  if (!hasFirebaseVoteConfig()) return false;
  if (!votesInitResolved) return true;
  if (!shouldUseRemoteVoteData()) return false;
  return !voteSummaryLoadedByOrg.has(orgId);
}

function isOrgUserVoteLoading(orgId) {
  if (!orgId) return false;
  if (!hasFirebaseVoteConfig()) return false;
  if (!votesInitResolved) return true;
  if (!shouldUseRemoteVoteData()) return false;
  return !userVoteLoadedByOrg.has(orgId);
}

function isOrgVoteInteractionReady(orgId) {
  if (!orgId) return false;
  if (hasFirebaseVoteConfig() && !voteProviderReady) return false;
  return !isOrgUserVoteLoading(orgId);
}

function isOrgVotePending(orgId) {
  return !!orgId && pendingVoteActions.has(orgId);
}

function getOrgVotePendingMessage(orgId) {
  if (!orgId) return '';
  return pendingVoteActions.get(orgId) || '';
}

function setOrgVotePending(orgId, active, message) {
  if (!orgId) return;
  const loadingKey = `votes:org:${orgId}`;
  if (active) {
    pendingVoteActions.set(orgId, message || 'Atualizando avaliacao...');
    setExternalLoading(loadingKey, true, message || 'Atualizando avaliacao...');
  } else {
    pendingVoteActions.delete(orgId);
    setExternalLoading(loadingKey, false);
  }
}

function clearVoteResyncTimers(orgId) {
  const timers = voteResyncTimersByOrg.get(orgId) || [];
  for (const timerId of timers) {
    clearTimeout(timerId);
  }
  voteResyncTimersByOrg.delete(orgId);
}

function clearAllVoteResyncTimers() {
  for (const orgId of voteResyncTimersByOrg.keys()) {
    clearVoteResyncTimers(orgId);
  }
}

function scheduleVoteSummaryResync(orgId) {
  if (!orgId) return;
  clearVoteResyncTimers(orgId);

  const delays = [1200, 3000];
  const timers = delays.map((delay) => setTimeout(async () => {
    if (!voteProviderReady) return;
    try {
      await refreshOrgVoteCache(orgId);
      scheduleOrganizationsRender();
    } catch (err) {
      console.error(`Background vote summary resync failed for ${orgId}:`, err);
    }
  }, delay));

  voteResyncTimersByOrg.set(orgId, timers);
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toSafeInt(value, fallback = 0) {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? fallback : num;
}

function applyOptimisticVoteUpdate(orgId, nextVote) {
  const previousVote = toSafeInt(getUserVote(orgId), 0);
  const normalizedNextVote = Math.max(0, Math.min(5, toSafeInt(nextVote, 0)));

  const current = globalVoteSummary[orgId] || { avg: 0, count: 0, sum: 0 };
  let count = Math.max(0, toSafeInt(current.count, 0));
  let sum = toSafeNumber(current.sum, NaN);
  if (!Number.isFinite(sum)) {
    sum = toSafeNumber(current.avg, 0) * count;
  }

  if (previousVote > 0 && normalizedNextVote === 0) {
    count = Math.max(0, count - 1);
    sum = Math.max(0, sum - previousVote);
  } else if (previousVote > 0 && normalizedNextVote > 0) {
    sum = Math.max(0, sum - previousVote + normalizedNextVote);
  } else if (previousVote === 0 && normalizedNextVote > 0) {
    count += 1;
    sum = Math.max(0, sum + normalizedNextVote);
  }

  const avg = count > 0 ? Number((sum / count).toFixed(4)) : 0;
  globalVoteSummary[orgId] = {
    avg,
    count,
    sum: Math.max(0, Math.round(sum))
  };
  voteSummaryLoadedByOrg.add(orgId);
  userVoteLoadedByOrg.add(orgId);

  if (normalizedNextVote > 0) {
    userVotesCache[orgId] = normalizedNextVote;
  } else {
    delete userVotesCache[orgId];
  }
}

function ensureExternalLoadingBanner() {
  let banner = document.getElementById('external-loading-state');
  if (banner) return banner;

  const body = document.body;
  if (!body) return null;

  banner = document.createElement('div');
  banner.id = 'external-loading-state';
  banner.className = 'pointer-events-none fixed right-4 campp-safe-fixed-bottom z-50 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow-sm shadow-slate-900/10 opacity-0 translate-y-2 transition-all duration-200 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    <span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
    <span data-loading-message="1">Carregando dados externos...</span>
  `;
  body.appendChild(banner);
  return banner;
}

function updateExternalLoadingBanner() {
  const banner = ensureExternalLoadingBanner();
  if (!banner) return;

  if (externalLoadingTasks.size === 0) {
    banner.classList.add('opacity-0', 'translate-y-2');
    return;
  }

  const message = Array.from(externalLoadingTasks.values())[0] || 'Carregando dados externos...';
  const textEl = banner.querySelector('[data-loading-message="1"]');
  if (textEl) {
    textEl.textContent = message;
  }
  banner.classList.remove('opacity-0', 'translate-y-2');
}

function setExternalLoading(key, active, message) {
  if (!key) return;
  if (active) {
    externalLoadingTasks.set(key, message || 'Carregando dados externos...');
  } else {
    externalLoadingTasks.delete(key);
  }
  updateExternalLoadingBanner();
}

function clearExternalLoadingPrefix(prefix) {
  if (!prefix) return;
  let changed = false;
  for (const key of externalLoadingTasks.keys()) {
    if (String(key).startsWith(prefix)) {
      externalLoadingTasks.delete(key);
      changed = true;
    }
  }
  if (changed) {
    updateExternalLoadingBanner();
  }
}

function getLocalVotes() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_VOTES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLocalVote(orgId, stars) {
  const votes = getLocalVotes();
  votes[orgId] = stars;
  localStorage.setItem(LOCAL_VOTES_KEY, JSON.stringify(votes));
}

function clearLocalVote(orgId) {
  const votes = getLocalVotes();
  delete votes[orgId];
  localStorage.setItem(LOCAL_VOTES_KEY, JSON.stringify(votes));
}

function getUserVote(orgId) {
  return userVotesCache[orgId] || 0;
}

function toOneDecimal(value) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function parseReviewsCount(reviewsLabel) {
  if (reviewsLabel == null) return null;
  const text = String(reviewsLabel).trim().toLowerCase();
  if (!text) return null;

  const compactMatch = text.match(/^([\d.,]+)\s*([km])$/);
  if (compactMatch) {
    const base = parseFloat(compactMatch[1].replace(',', '.'));
    if (Number.isNaN(base)) return null;
    if (compactMatch[2] === 'k') return Math.round(base * 1000);
    if (compactMatch[2] === 'm') return Math.round(base * 1000000);
  }

  const plain = text.replace(/[^\d]/g, '');
  if (!plain) return null;
  const asNumber = parseInt(plain, 10);
  if (Number.isNaN(asNumber)) return null;
  return asNumber;
}

function formatVotesCount(count) {
  return `${new Intl.NumberFormat('pt-BR').format(count)} voto(s)`;
}

function getBaseReviewsLabel(org, baseCount) {
  if (org && org.reviews != null && String(org.reviews).trim()) {
    return String(org.reviews).trim();
  }
  if (baseCount != null && baseCount > 0) {
    return `${new Intl.NumberFormat('pt-BR').format(baseCount)} avaliacao(oes)`;
  }
  return '';
}

function getOrgSummary(orgId) {
  return globalVoteSummary[orgId] || null;
}

function isFirestoreOfflineError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  const message = String(err.message || '').toLowerCase();
  return (
    code.includes('unavailable') ||
    code.includes('network-request-failed') ||
    code.includes('permission-denied') ||
    code.includes('unauthenticated') ||
    code.includes('failed-precondition') ||
    message.includes('client is offline') ||
    message.includes('network') ||
    message.includes('app check') ||
    message.includes('appcheck') ||
    message.includes('permission')
  );
}

function disableRemoteVotes(err) {
  voteProviderReady = false;
  globalVoteSummary = {};
  userVotesCache = getLocalVotes();
  votesInitResolved = true;
  clearExternalLoadingPrefix('votes:');
  clearAllVoteResyncTimers();
  pendingVoteActions.clear();
  clearVoteLoadState();
  if (!remoteVotesDisabled) {
    remoteVotesDisabled = true;
    if (err) {
      console.warn('CamppVotes indisponivel. Usando modo local (localStorage).', err.message || err);
    } else {
      console.warn('CamppVotes indisponivel. Usando modo local (localStorage).');
    }
  }
}

function getRatingStats(org) {
  const baseRating = parseFloat(org.rating) || 0;
  const baseCount = parseReviewsCount(org.reviews);
  const summary = getOrgSummary(org.id);
  const preferRemoteVotes = hasFirebaseVoteConfig();

  const hasLiveSummary = !!(voteProviderReady && summary && typeof summary === 'object');
  const liveCount = hasLiveSummary ? (summary.count || 0) : 0;
  const liveAvg = hasLiveSummary ? (summary.avg || 0) : 0;

  if (hasLiveSummary) {
    return {
      avg: liveCount > 0 ? liveAvg : 0,
      count: liveCount,
      reviewsLabel: formatVotesCount(liveCount)
    };
  }

  if (preferRemoteVotes) {
    return {
      avg: 0,
      count: 0,
      reviewsLabel: '--'
    };
  }

  if (baseCount != null && baseCount > 0) {
    return {
      avg: baseRating,
      count: baseCount,
      reviewsLabel: getBaseReviewsLabel(org, baseCount)
    };
  }

  return {
    avg: baseRating,
    count: 0,
    reviewsLabel: org.reviews
  };
}

function getRatingNumber(org) {
  return getRatingStats(org).avg;
}

function getRatingLabel(org) {
  return toOneDecimal(getRatingStats(org).avg);
}

function getReviewsLabel(org) {
  return getRatingStats(org).reviewsLabel;
}

function toggleFavorite(orgId) {
  if (favoriteOrgs.has(orgId)) {
    favoriteOrgs.delete(orgId);
  } else {
    favoriteOrgs.add(orgId);
  }
  localStorage.setItem('camppedidos_favorites', JSON.stringify(Array.from(favoriteOrgs)));
  renderOrganizations();
}

async function initializeVotes() {
  voteProviderReady = false;
  remoteVotesDisabled = false;

  if (!window.CamppVotes || !window.CAMPP_FIREBASE_CONFIG) {
    userVotesCache = getLocalVotes();
    return;
  }

  try {
    const appKey = window.CAMPP_APP_KEY || 'html-camppedidoscore-v1';
    voteProviderReady = !!(await window.CamppVotes.init(window.CAMPP_FIREBASE_CONFIG, appKey));
  } catch (err) {
    console.error('Failed to initialize CamppVotes:', err);
    voteProviderReady = false;
  }

  if (!voteProviderReady) {
    userVotesCache = getLocalVotes();
  }
}

async function refreshAllVoteCaches() {
  if (!voteProviderReady) {
    userVotesCache = getLocalVotes();
    globalVoteSummary = {};
    return;
  }

  const summaries = {};
  const votes = {};

  for (const org of allOrganizations) {
    let summary = null;
    let userVote = null;

    try {
      summary = await window.CamppVotes.getStoreSummary(org.id);
      summaries[org.id] = summary || { avg: 0, count: 0 };
      voteSummaryLoadedByOrg.add(org.id);
    } catch (err) {
      if (isFirestoreOfflineError(err)) {
        disableRemoteVotes(err);
        return;
      }
      console.error(`Failed to refresh store summary for ${org.id}:`, err);
      summaries[org.id] = { avg: 0, count: 0 };
      voteSummaryLoadedByOrg.add(org.id);
    }

    try {
      userVote = await window.CamppVotes.getUserVote(org.id);
      if (userVote && userVote > 0) {
        votes[org.id] = userVote;
      }
      userVoteLoadedByOrg.add(org.id);
    } catch (err) {
      if (isFirestoreOfflineError(err)) {
        console.warn(`User vote unavailable for ${org.id}; keeping summary mode.`, err);
        userVoteLoadedByOrg.add(org.id);
        continue;
      }
      console.error(`Failed to refresh user vote for ${org.id}:`, err);
      userVoteLoadedByOrg.add(org.id);
    }
  }

  globalVoteSummary = summaries;
  userVotesCache = votes;
}

async function refreshOrgVoteCache(orgId) {
  if (!voteProviderReady) {
    userVotesCache = getLocalVotes();
    return;
  }

  try {
    const summary = await window.CamppVotes.getStoreSummary(orgId);
    globalVoteSummary[orgId] = summary || { avg: 0, count: 0 };
    voteSummaryLoadedByOrg.add(orgId);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      disableRemoteVotes(err);
      return;
    }
    console.error(`Failed to refresh vote summary for ${orgId}:`, err);
    globalVoteSummary[orgId] = { avg: 0, count: 0 };
    voteSummaryLoadedByOrg.add(orgId);
  }

  try {
    const userVote = await window.CamppVotes.getUserVote(orgId);
    if (userVote && userVote > 0) {
      userVotesCache[orgId] = userVote;
    } else {
      delete userVotesCache[orgId];
    }
    userVoteLoadedByOrg.add(orgId);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      console.warn(`User vote unavailable for ${orgId}; summary kept.`, err);
      userVoteLoadedByOrg.add(orgId);
      return;
    }
    console.error(`Failed to refresh user vote cache for ${orgId}:`, err);
    userVoteLoadedByOrg.add(orgId);
  }
}

async function ensureOrgVoteCacheLoaded(orgId) {
  if (!orgId || !shouldUseRemoteVoteData()) return;
  if (voteSummaryLoadedByOrg.has(orgId) && userVoteLoadedByOrg.has(orgId)) return;
  if (orgVoteLoadPromises.has(orgId)) {
    return orgVoteLoadPromises.get(orgId);
  }

  const loadPromise = (async () => {
    let hasChanges = false;

    try {
      const summary = await window.CamppVotes.getStoreSummary(orgId);
      globalVoteSummary[orgId] = summary || { avg: 0, count: 0 };
      voteSummaryLoadedByOrg.add(orgId);
      hasChanges = true;
    } catch (err) {
      if (isFirestoreOfflineError(err)) {
        disableRemoteVotes(err);
        return;
      }
      console.error(`Failed to lazy load summary for ${orgId}:`, err);
      globalVoteSummary[orgId] = { avg: 0, count: 0 };
      voteSummaryLoadedByOrg.add(orgId);
      hasChanges = true;
    }

    try {
      const userVote = await window.CamppVotes.getUserVote(orgId);
      if (userVote && userVote > 0) {
        userVotesCache[orgId] = userVote;
      } else {
        delete userVotesCache[orgId];
      }
      userVoteLoadedByOrg.add(orgId);
      hasChanges = true;
    } catch (err) {
      if (isFirestoreOfflineError(err)) {
        console.warn(`User vote lazy load unavailable for ${orgId}; keeping summary mode.`, err);
        userVoteLoadedByOrg.add(orgId);
      } else {
        console.error(`Failed to lazy load user vote for ${orgId}:`, err);
        userVoteLoadedByOrg.add(orgId);
      }
      hasChanges = true;
    }

    if (hasChanges) {
      scheduleOrganizationsRender();
    }
  })();

  orgVoteLoadPromises.set(orgId, loadPromise);
  try {
    await loadPromise;
  } finally {
    orgVoteLoadPromises.delete(orgId);
  }
}

function setupLazyVoteLoading(filteredList) {
  if (!shouldUseRemoteVoteData()) {
    if (orgVoteObserver) {
      orgVoteObserver.disconnect();
      orgVoteObserver = null;
    }
    return;
  }

  const listContainer = document.getElementById('org-list');
  if (!listContainer) return;

  const cards = Array.from(listContainer.querySelectorAll('[data-org-id]'));
  if (cards.length === 0) return;

  const bootstrapIds = (filteredList || [])
    .slice(0, 4)
    .map((org) => org && org.id)
    .filter((id) => !!id);

  bootstrapIds.forEach((orgId) => {
    ensureOrgVoteCacheLoaded(orgId);
  });

  if (!('IntersectionObserver' in window)) {
    cards.forEach((card) => {
      const orgId = card.getAttribute('data-org-id');
      if (orgId) ensureOrgVoteCacheLoaded(orgId);
    });
    return;
  }

  if (!orgVoteObserver) {
    orgVoteObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        if (!(target instanceof Element)) return;
        const orgId = target.getAttribute('data-org-id');
        if (orgId) ensureOrgVoteCacheLoaded(orgId);
        if (orgVoteObserver) {
          orgVoteObserver.unobserve(target);
        }
      });
    }, {
      root: null,
      rootMargin: '250px 0px',
      threshold: 0.01
    });
  } else {
    orgVoteObserver.disconnect();
  }

  cards.forEach((card) => {
    const orgId = card.getAttribute('data-org-id');
    if (!orgId) return;
    if (voteSummaryLoadedByOrg.has(orgId) && userVoteLoadedByOrg.has(orgId)) return;
    orgVoteObserver.observe(card);
  });
}

async function init() {
  setExternalLoading('data:load', true, 'Carregando lojas...');
  renderOrganizationsSkeleton();
  votesInitResolved = false;
  clearVoteLoadState();

  try {
    const data = await loadCoreData();

    allCategories = data.categories || [];
    allOrganizations = data.organizations || [];

    renderCategories();
    renderTags();
    renderOrganizations();

    setExternalLoading('votes:init', true, 'Conectando avaliacoes...');
    await initializeVotes();
    votesInitResolved = true;
    setExternalLoading('votes:init', false);
    if (!voteProviderReady) {
      clearVoteLoadState();
    }
    renderOrganizations();
  } catch (e) {
    console.error('Failed to load CMS data:', e);
    const listContainer = document.getElementById('org-list');
    if (listContainer) {
      listContainer.innerHTML = '<p class="text-red-500">Erro ao carregar os dados.</p>';
    }
  } finally {
    votesInitResolved = true;
    setExternalLoading('data:load', false);
    setExternalLoading('votes:init', false);
    hideAppSplash();
  }
}

function dataCandidates() {
  const candidates = new Set();
  const path = window.location && window.location.pathname ? window.location.pathname : '/';
  const basePath = path.replace(/[^/]*$/, '');

  candidates.add('data.json');
  candidates.add('./data.json');
  if (basePath) {
    candidates.add(`${basePath}data.json`);
  }
  candidates.add('/html-camppedidoscore-v1/data.json');
  candidates.add('html-camppedidoscore-v1/data.json');

  return Array.from(candidates);
}

async function loadCoreData() {
  const candidates = dataCandidates();
  let lastError = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} while loading ${url}`);
        continue;
      }

      const payload = await res.json();
      if (payload && Array.isArray(payload.organizations)) {
        return payload;
      }

      lastError = new Error(`Invalid payload while loading ${url}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Unable to load data.json');
}

function renderCategories() {
  const listContainer = document.getElementById('category-list');
  if (!listContainer) return;

  listContainer.innerHTML = '<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3">Categorias</h3>';

  allCategories.forEach((cat) => {
    const isActive = cat.id === currentCategory;

    const colorClass = isActive
      ? 'bg-primary/10 text-primary font-medium shadow-sm'
      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200';

    const iconStyle = isActive
      ? 'filled text-[20px]'
      : 'group-hover:scale-110 transition-transform text-[20px]';

    const a = document.createElement('a');
    a.href = '#';
    a.className = `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${colorClass}`;
    a.onclick = (e) => {
      e.preventDefault();
      if (currentCategory !== cat.id) {
        currentCategory = cat.id;
        renderCategories();
        renderTags();
        renderOrganizations();
      }
    };

    a.innerHTML = `
      <span class="material-symbols-outlined ${iconStyle}">${cat.icon}</span>
      ${cat.name}
    `;
    listContainer.appendChild(a);
  });
}

function renderTags() {
  const listContainer = document.getElementById('tag-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  const uniqueTags = new Set();
  allOrganizations.forEach((org) => {
    if (currentCategory === 'all' || org.categoryId === currentCategory) {
      (org.tags || []).forEach((tag) => uniqueTags.add(tag));
    }
  });

  activeTags = activeTags.filter((t) => uniqueTags.has(t));

  uniqueTags.forEach((tag) => {
    const isActive = activeTags.includes(tag);

    const baseClass = isActive
      ? 'bg-primary/10 text-primary border-primary/20 shadow-inner'
      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';

    const span = document.createElement('span');
    span.className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border cursor-pointer hover:opacity-80 transition-colors ${baseClass}`;
    span.textContent = tag;

    if (isActive) {
      span.innerHTML = `<span class="material-symbols-outlined text-[14px]">check</span> ${tag}`;
    }

    span.onclick = () => {
      if (isActive) {
        activeTags = activeTags.filter((t) => t !== tag);
      } else {
        activeTags.push(tag);
      }
      renderTags();
      renderOrganizations();
    };

    listContainer.appendChild(span);
  });
}

function renderStars(ratingValue) {
  const rating = typeof ratingValue === 'number' ? ratingValue : (parseFloat(ratingValue) || 0);
  const normalized = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
  let starsHtml = '';
  for (let i = 1; i <= 5; i++) {
    if (normalized >= i) {
      starsHtml += '<span class="material-symbols-outlined filled text-[16px]">star</span>';
    } else if (normalized >= i - 0.5) {
      starsHtml += '<span class="material-symbols-outlined filled text-[16px]">star_half</span>';
    } else {
      starsHtml += '<span class="material-symbols-outlined text-[16px] opacity-30">star</span>';
    }
  }
  return starsHtml;
}

function renderRatingBadge(org) {
  const waitingSummary = isOrgSummaryLoading(org.id);
  if (waitingSummary) {
    return `
      <div class="flex w-full sm:w-auto min-w-0 sm:min-w-[160px] items-center justify-start sm:justify-end gap-2 rounded-lg bg-slate-100/60 px-2 py-1 text-slate-400 dark:bg-slate-800/50 dark:text-slate-500" aria-busy="true">
        <span class="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
        <span class="inline-block h-3 w-8 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"></span>
        <span class="inline-block h-3 w-16 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"></span>
      </div>
    `;
  }

  const summary = getOrgSummary(org.id);
  const hasLiveSummary = !!(shouldUseRemoteVoteData() && summary && typeof summary === 'object');
  if (hasFirebaseVoteConfig() && !hasLiveSummary) {
    return `
      <div class="flex w-full sm:w-auto min-w-0 sm:min-w-[160px] items-center justify-start sm:justify-end gap-2 rounded-lg bg-slate-100/60 px-2 py-1 text-slate-400 dark:bg-slate-800/50 dark:text-slate-500" aria-live="polite">
        <span class="material-symbols-outlined text-[15px]">info</span>
        <span class="text-xs font-medium">Sem dados Firebase</span>
      </div>
    `;
  }

  return `
    <div class="flex w-full sm:w-auto min-w-0 sm:min-w-[160px] flex-wrap items-center justify-start sm:justify-end gap-1 bg-yellow-400/10 text-yellow-600 dark:text-yellow-500 px-2 py-1 rounded-lg">
      <div class="flex items-center">${renderStars(getRatingNumber(org))}</div>
      <span class="text-sm font-bold ml-1">${getRatingLabel(org)}</span>
      <span class="text-xs text-slate-400 dark:text-slate-500 font-normal">(${getReviewsLabel(org)})</span>
    </div>
  `;
}

function renderVoteWidget(orgId) {
  const userVote = getUserVote(orgId);
  const pending = isOrgVotePending(orgId);
  const waitingUserVote = isOrgUserVoteLoading(orgId);
  const pendingTitle = pending ? (getOrgVotePendingMessage(orgId) || 'Atualizando...') : '';
  const pendingHtml = `
    <span class="inline-flex h-4 w-4 items-center justify-center" title="${pendingTitle}">
      <span class="material-symbols-outlined text-[13px] leading-none transition-opacity ${pending ? 'animate-spin opacity-100 text-red-500' : 'opacity-0'}">progress_activity</span>
    </span>`;

  if (waitingUserVote && !pending) {
    return `
      <div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-400 dark:text-slate-500" aria-busy="true">
        <span>Avalie:</span>
        <div class="flex items-center opacity-60">
          <span class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600">star</span>
          <span class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600">star</span>
          <span class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600">star</span>
          <span class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600">star</span>
          <span class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600">star</span>
        </div>
        <span class="inline-flex h-4 w-4 items-center justify-center">
          <span class="material-symbols-outlined animate-spin text-[13px] leading-none text-red-500">progress_activity</span>
        </span>
      </div>
    `;
  }

  if (hasFirebaseVoteConfig() && !voteProviderReady) {
    return `
      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <span>Avaliação indisponível</span>
        <span class="material-symbols-outlined text-[13px]">wifi_off</span>
      </div>
    `;
  }

  if (userVote > 0) {
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
      starsHtml += `<span class="material-symbols-outlined filled text-[18px] ${i <= userVote ? 'text-yellow-400' : 'text-slate-300 dark:text-slate-600'}" style="cursor:default">star</span>`;
    }
    return `
      <div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
        <span>Sua avaliação:</span>
        <div class="flex items-center">${starsHtml}</div>
        <button type="button"
          class="ml-2 text-slate-400 hover:text-red-400 transition-colors text-[11px] underline ${pending ? 'opacity-50 cursor-wait pointer-events-none' : ''}"
          data-clear-vote="1"
          data-org-id="${orgId}"
          ${pending ? 'disabled aria-disabled="true"' : ''}>(limpar)</button>
        ${pendingHtml}
      </div>`;
  }

  let starsHtml = '';
  for (let i = 1; i <= 5; i++) {
    starsHtml += `<button type="button"
      class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600 transition-colors bg-transparent border-0 p-0 leading-none ${pending ? 'opacity-50 cursor-wait pointer-events-none' : 'cursor-pointer hover:text-yellow-400'}"
      data-org-id="${orgId}" data-star="${i}"
      data-vote-star="1"
      ${pending ? 'disabled aria-disabled="true"' : ''}
      id="vote-star-${orgId}-${i}">star</button>`;
  }

  return `
    <div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-400 dark:text-slate-500" ${pending ? 'aria-busy="true"' : ''}>
      <span>Avalie:</span>
      <div class="flex items-center" id="vote-widget-${orgId}">${starsHtml}</div>
      ${pendingHtml}
    </div>`;
}

function renderOrganizationsSkeleton() {
  const listContainer = document.getElementById('org-list');
  const countDisplay = document.getElementById('store-count');
  if (!listContainer || !countDisplay) return;

  countDisplay.textContent = '...';
  const skeletonCard = `
    <article class="glass-card rounded-xl p-4 sm:p-5 flex flex-col md:flex-row gap-5 animate-pulse">
      <div class="w-full md:w-64 h-48 md:h-auto shrink-0 rounded-lg bg-slate-200 dark:bg-slate-800"></div>
      <div class="flex flex-col flex-1 gap-4">
        <div class="space-y-3">
          <div class="h-6 w-56 rounded bg-slate-200 dark:bg-slate-800"></div>
          <div class="h-4 w-40 rounded bg-slate-200 dark:bg-slate-800"></div>
          <div class="h-4 w-full rounded bg-slate-200 dark:bg-slate-800"></div>
          <div class="h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-800"></div>
        </div>
        <div class="h-10 w-40 rounded bg-slate-200 dark:bg-slate-800"></div>
      </div>
    </article>
  `;

  listContainer.innerHTML = `${skeletonCard}${skeletonCard}${skeletonCard}`;
}

function renderOrganizations() {
  const listContainer = document.getElementById('org-list');
  const countDisplay = document.getElementById('store-count');

  if (!listContainer || !countDisplay) return;

  let filteredList = allOrganizations;

  if (currentCategory !== 'all') {
    filteredList = filteredList.filter((o) => o.categoryId === currentCategory);
  }

  if (activeTags.length > 0) {
    filteredList = filteredList.filter((o) => {
      const orgTags = o.tags || [];
      return activeTags.every((t) => orgTags.includes(t));
    });
  }

  filteredList.sort((a, b) => {
    const aFav = favoriteOrgs.has(a.id) ? 1 : 0;
    const bFav = favoriteOrgs.has(b.id) ? 1 : 0;
    return bFav - aFav;
  });

  countDisplay.textContent = filteredList.length;

  if (filteredList.length === 0) {
    listContainer.innerHTML = '<p class="text-slate-500 py-10 text-center">Nenhuma loja encontrada nesta categoria.</p>';
    return;
  }

  const cardsHtml = filteredList.map((org, idx) => {
    const tagsHtml = (org.tags || []).map((tag) =>
      `<span class="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium border border-slate-200 dark:border-slate-700">${tag}</span>`
    ).join('');

    const featuredTag = idx === 0 && currentCategory === 'all'
      ? '<div class="absolute top-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-[10px] font-bold text-white uppercase tracking-wider">Destaque</div>'
      : '';

    return `
      <article class="glass-card rounded-xl p-4 sm:p-5 flex flex-col md:flex-row gap-5 hover:shadow-lg transition-shadow duration-300 group" data-org-id="${org.id}">
        <div class="w-full md:w-64 h-48 md:h-auto shrink-0 rounded-lg overflow-hidden relative bg-slate-200 dark:bg-slate-800">
          <div class="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-700 group-hover:scale-105" style="background-image: url('${org.image}')"></div>
          ${featuredTag}
        </div>

        <div class="flex flex-col flex-1 justify-between gap-4">
          <div class="space-y-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="flex items-center gap-3 min-w-0">
                <img alt="${org.name} Logo" class="size-10 rounded-full bg-black border border-slate-100 dark:border-slate-700 shadow-sm" src="${org.logo}" onerror="this.src='favicon.svg'"/>
                <div class="min-w-0">
                  <h3 class="text-xl font-bold text-slate-900 dark:text-white leading-tight group-hover:text-primary transition-colors break-words">${org.name}</h3>
                  <div class="flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>${org.category}</span>
                    <span class="size-1 bg-slate-300 rounded-full"></span>
                    <span>${org.location}</span>
                  </div>
                </div>
              </div>
              ${renderRatingBadge(org)}
            </div>

            <p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed line-clamp-2">
              ${org.description}
            </p>

            <div class="flex flex-wrap gap-2">
              ${tagsHtml}
            </div>
            ${renderVoteWidget(org.id)}
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-700/50">
            ${favoriteOrgs.has(org.id)
      ? `<button type="button" class="text-red-500 hover:text-slate-400 transition-colors" data-toggle-favorite="1" data-org-id="${org.id}"><span class="material-symbols-outlined filled">favorite</span></button>`
      : `<button type="button" class="text-slate-400 hover:text-red-500 transition-colors" data-toggle-favorite="1" data-org-id="${org.id}"><span class="material-symbols-outlined">favorite_border</span></button>`
    }
            <a class="inline-flex w-full sm:w-auto justify-center items-center gap-2 bg-primary hover:bg-red-600 text-white text-sm font-semibold py-2 px-6 rounded-lg transition-all shadow-md shadow-primary/20 hover:shadow-primary/40" href="${org.url}" rel="noopener">
              Ver Cardápio
              <span class="material-symbols-outlined text-[18px]">arrow_outward</span>
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  listContainer.innerHTML = cardsHtml;
  setupLazyVoteLoading(filteredList);
}

function bindOrganizationInteractions() {
  const listContainer = document.getElementById('org-list');
  if (!listContainer || listContainer.dataset.boundInteractions === '1') return;
  listContainer.dataset.boundInteractions = '1';

  listContainer.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const starEl = target.closest('[data-vote-star="1"]');
    if (starEl) {
      event.preventDefault();
      const orgId = starEl.getAttribute('data-org-id');
      const stars = parseInt(starEl.getAttribute('data-star') || '0', 10);
      if (orgId && !isOrgVotePending(orgId) && isOrgVoteInteractionReady(orgId) && stars >= 1 && stars <= 5) {
        submitVote(orgId, stars);
      }
      return;
    }

    const clearEl = target.closest('[data-clear-vote="1"]');
    if (clearEl) {
      event.preventDefault();
      const orgId = clearEl.getAttribute('data-org-id');
      if (orgId && !isOrgVotePending(orgId) && isOrgVoteInteractionReady(orgId)) {
        clearUserVote(orgId);
      }
      return;
    }

    const favoriteEl = target.closest('[data-toggle-favorite="1"]');
    if (favoriteEl) {
      event.preventDefault();
      const orgId = favoriteEl.getAttribute('data-org-id');
      if (orgId) {
        toggleFavorite(orgId);
      }
    }
  });

  listContainer.addEventListener('mouseover', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const starEl = target.closest('[data-vote-star="1"]');
    if (!starEl) return;
    const orgId = starEl.getAttribute('data-org-id');
    if (!orgId || isOrgVotePending(orgId) || !isOrgVoteInteractionReady(orgId)) return;
    const stars = parseInt(starEl.getAttribute('data-star') || '0', 10);
    if (stars >= 1 && stars <= 5) {
      highlightVoteStars(orgId, stars);
    }
  });

  listContainer.addEventListener('mouseout', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const starEl = target.closest('[data-vote-star="1"]');
    if (!starEl) return;

    const orgId = starEl.getAttribute('data-org-id');
    if (!orgId || isOrgVotePending(orgId) || !isOrgVoteInteractionReady(orgId)) return;

    const related = event.relatedTarget;
    if (related && related.closest && related.closest(`#vote-widget-${orgId}`)) {
      return;
    }

    resetVoteStars(orgId);
  });
}

function highlightVoteStars(orgId, upTo) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`vote-star-${orgId}-${i}`);
    if (!el) continue;
    if (i <= upTo) {
      el.classList.add('text-yellow-400');
      el.classList.remove('text-slate-300', 'dark:text-slate-600');
    } else {
      el.classList.remove('text-yellow-400');
      el.classList.add('text-slate-300');
    }
  }
}

function resetVoteStars(orgId) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`vote-star-${orgId}-${i}`);
    if (!el) continue;
    el.classList.remove('text-yellow-400');
    el.classList.add('text-slate-300');
  }
}

async function submitVote(orgId, stars) {
  const normalized = Math.max(1, Math.min(5, parseInt(stars, 10) || 0));
  if (!orgId || isOrgVotePending(orgId) || !isOrgVoteInteractionReady(orgId)) return;

  if (voteProviderReady) {
    setOrgVotePending(orgId, true, 'Atualizando avaliacao...');
    renderOrganizations();
    try {
      await window.CamppVotes.upsertVote(orgId, normalized);
      applyOptimisticVoteUpdate(orgId, normalized);
      scheduleVoteSummaryResync(orgId);
      return;
    } catch (err) {
      if (isFirestoreOfflineError(err)) {
        disableRemoteVotes(err);
      } else {
        console.error('Remote vote failed, falling back to localStorage:', err);
        disableRemoteVotes(err);
      }
    } finally {
      setOrgVotePending(orgId, false);
      renderOrganizations();
    }
  }

  if (hasFirebaseVoteConfig()) {
    return;
  }

  saveLocalVote(orgId, normalized);
  userVotesCache = getLocalVotes();
  renderOrganizations();
}

async function clearUserVote(orgId) {
  if (!orgId || isOrgVotePending(orgId) || !isOrgVoteInteractionReady(orgId)) return;

  if (voteProviderReady) {
    setOrgVotePending(orgId, true, 'Removendo avaliacao...');
    renderOrganizations();
    try {
      await window.CamppVotes.clearVote(orgId);
      applyOptimisticVoteUpdate(orgId, 0);
      scheduleVoteSummaryResync(orgId);
      return;
    } catch (err) {
      if (isFirestoreOfflineError(err)) {
        disableRemoteVotes(err);
      } else {
        console.error('Remote clear vote failed, falling back to localStorage:', err);
        disableRemoteVotes(err);
      }
    } finally {
      setOrgVotePending(orgId, false);
      renderOrganizations();
    }
  }

  if (hasFirebaseVoteConfig()) {
    return;
  }

  clearLocalVote(orgId);
  userVotesCache = getLocalVotes();
  renderOrganizations();
}

document.addEventListener('DOMContentLoaded', () => {
  showAppSplash();
  setupSafeAreaInsets();
  bindOrganizationInteractions();
  init();
});
