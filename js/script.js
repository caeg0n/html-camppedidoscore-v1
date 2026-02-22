let allOrganizations = [];
let allCategories = [];
let currentCategory = 'all';
let activeTags = [];
let favoriteOrgs = new Set(JSON.parse(localStorage.getItem('camppedidos_favorites') || '[]'));

const LOCAL_VOTES_KEY = 'campp_user_votes';
let voteProviderReady = false;
let userVotesCache = {};
let globalVoteSummary = {};

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

function getOrgSummary(orgId) {
  return globalVoteSummary[orgId] || null;
}

function getRatingNumber(org) {
  const summary = getOrgSummary(org.id);
  if (voteProviderReady && summary && summary.count > 0) {
    return summary.avg;
  }
  return parseFloat(org.rating) || 0;
}

function getRatingLabel(org) {
  const summary = getOrgSummary(org.id);
  if (voteProviderReady && summary && summary.count > 0) {
    return toOneDecimal(summary.avg);
  }
  return org.rating;
}

function getReviewsLabel(org) {
  const summary = getOrgSummary(org.id);
  if (voteProviderReady && summary && summary.count > 0) {
    return `${summary.count} voto(s)`;
  }
  return org.reviews;
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

  if (!window.CamppVotes || !window.CAMPP_FIREBASE_CONFIG) {
    userVotesCache = getLocalVotes();
    return;
  }

  try {
    const appKey = window.CAMPP_APP_KEY || 'html-camppedidoscore-v1';
    voteProviderReady = !!window.CamppVotes.init(window.CAMPP_FIREBASE_CONFIG, appKey);
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

  await Promise.all(
    allOrganizations.map(async (org) => {
      try {
        const [summary, userVote] = await Promise.all([
          window.CamppVotes.getStoreSummary(org.id),
          window.CamppVotes.getUserVote(org.id)
        ]);

        summaries[org.id] = summary || { avg: 0, count: 0 };
        if (userVote && userVote > 0) {
          votes[org.id] = userVote;
        }
      } catch (err) {
        console.error(`Failed to refresh votes for ${org.id}:`, err);
      }
    })
  );

  globalVoteSummary = summaries;
  userVotesCache = votes;
}

async function refreshOrgVoteCache(orgId) {
  if (!voteProviderReady) {
    userVotesCache = getLocalVotes();
    return;
  }

  try {
    const [summary, userVote] = await Promise.all([
      window.CamppVotes.getStoreSummary(orgId),
      window.CamppVotes.getUserVote(orgId)
    ]);
    globalVoteSummary[orgId] = summary || { avg: 0, count: 0 };
    if (userVote && userVote > 0) {
      userVotesCache[orgId] = userVote;
    } else {
      delete userVotesCache[orgId];
    }
  } catch (err) {
    console.error(`Failed to refresh vote cache for ${orgId}:`, err);
  }
}

async function init() {
  try {
    const res = await fetch('data.json');
    const data = await res.json();

    allCategories = data.categories || [];
    allOrganizations = data.organizations || [];

    renderCategories();
    renderTags();

    await initializeVotes();
    await refreshAllVoteCaches();

    renderOrganizations();
  } catch (e) {
    console.error('Failed to load CMS data:', e);
    const listContainer = document.getElementById('org-list');
    if (listContainer) {
      listContainer.innerHTML = '<p class="text-red-500">Erro ao carregar os dados.</p>';
    }
  }
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
  let starsHtml = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      starsHtml += '<span class="material-symbols-outlined filled text-[16px]">star</span>';
    } else if (rating >= i - 0.5) {
      starsHtml += '<span class="material-symbols-outlined filled text-[16px]">star_half</span>';
    } else {
      starsHtml += '<span class="material-symbols-outlined text-[16px] opacity-30">star</span>';
    }
  }
  return starsHtml;
}

function renderVoteWidget(orgId) {
  const userVote = getUserVote(orgId);
  if (userVote > 0) {
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
      starsHtml += `<span class="material-symbols-outlined filled text-[18px] ${i <= userVote ? 'text-yellow-400' : 'text-slate-300 dark:text-slate-600'}" style="cursor:default">star</span>`;
    }
    return `
      <div class="mt-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
        <span>Sua avaliação:</span>
        <div class="flex items-center">${starsHtml}</div>
        <button class="ml-2 text-slate-400 hover:text-red-400 transition-colors text-[11px] underline" onclick="clearUserVote('${orgId}')">(limpar)</button>
      </div>`;
  }

  let starsHtml = '';
  for (let i = 1; i <= 5; i++) {
    starsHtml += `<span
      class="material-symbols-outlined text-[22px] text-slate-300 dark:text-slate-600 cursor-pointer transition-colors hover:text-yellow-400"
      data-org-id="${orgId}" data-star="${i}"
      onmouseenter="highlightVoteStars('${orgId}', ${i})"
      onmouseleave="resetVoteStars('${orgId}')"
      onclick="submitVote('${orgId}', ${i})"
      id="vote-star-${orgId}-${i}">star</span>`;
  }

  return `
    <div class="mt-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
      <span>Avalie:</span>
      <div class="flex items-center" id="vote-widget-${orgId}">${starsHtml}</div>
    </div>`;
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
      <article class="glass-card rounded-xl p-4 sm:p-5 flex flex-col md:flex-row gap-5 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 group">
        <div class="w-full md:w-64 h-48 md:h-auto shrink-0 rounded-lg overflow-hidden relative bg-slate-200 dark:bg-slate-800">
          <div class="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-700 group-hover:scale-105" style="background-image: url('${org.image}')"></div>
          ${featuredTag}
        </div>

        <div class="flex flex-col flex-1 justify-between gap-4">
          <div class="space-y-3">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <img alt="${org.name} Logo" class="size-10 rounded-full bg-black border border-slate-100 dark:border-slate-700 shadow-sm" src="${org.logo}" onerror="this.src='favicon.svg'"/>
                <div>
                  <h3 class="text-xl font-bold text-slate-900 dark:text-white leading-tight group-hover:text-primary transition-colors">${org.name}</h3>
                  <div class="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>${org.category}</span>
                    <span class="size-1 bg-slate-300 rounded-full"></span>
                    <span>${org.location}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1 bg-yellow-400/10 text-yellow-600 dark:text-yellow-500 px-2 py-1 rounded-lg">
                <div class="flex items-center">${renderStars(getRatingNumber(org))}</div>
                <span class="text-sm font-bold ml-1">${getRatingLabel(org)}</span>
                <span class="text-xs text-slate-400 dark:text-slate-500 font-normal">(${getReviewsLabel(org)})</span>
              </div>
            </div>

            <p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed line-clamp-2">
              ${org.description}
            </p>

            <div class="flex flex-wrap gap-2">
              ${tagsHtml}
            </div>
            ${renderVoteWidget(org.id)}
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700/50">
            ${favoriteOrgs.has(org.id)
      ? `<button class="text-red-500 hover:text-slate-400 transition-colors" onclick="toggleFavorite('${org.id}')"><span class="material-symbols-outlined filled">favorite</span></button>`
      : `<button class="text-slate-400 hover:text-red-500 transition-colors" onclick="toggleFavorite('${org.id}')"><span class="material-symbols-outlined">favorite_border</span></button>`
    }
            <a class="inline-flex items-center gap-2 bg-primary hover:bg-sky-500 text-white text-sm font-semibold py-2 px-6 rounded-lg transition-all shadow-md shadow-primary/20 hover:shadow-primary/40" href="${org.url}" rel="noopener">
              Ver Cardápio
              <span class="material-symbols-outlined text-[18px]">arrow_outward</span>
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  listContainer.innerHTML = cardsHtml;
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

  if (voteProviderReady) {
    try {
      await window.CamppVotes.upsertVote(orgId, normalized);
      await refreshOrgVoteCache(orgId);
      renderOrganizations();
      return;
    } catch (err) {
      console.error('Remote vote failed, falling back to localStorage:', err);
      voteProviderReady = false;
    }
  }

  saveLocalVote(orgId, normalized);
  userVotesCache = getLocalVotes();
  renderOrganizations();
}

async function clearUserVote(orgId) {
  if (voteProviderReady) {
    try {
      await window.CamppVotes.clearVote(orgId);
      await refreshOrgVoteCache(orgId);
      renderOrganizations();
      return;
    } catch (err) {
      console.error('Remote clear vote failed, falling back to localStorage:', err);
      voteProviderReady = false;
    }
  }

  clearLocalVote(orgId);
  userVotesCache = getLocalVotes();
  renderOrganizations();
}

document.addEventListener('DOMContentLoaded', () => {
  init();
});
