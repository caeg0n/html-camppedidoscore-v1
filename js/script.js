let allOrganizations = [];
let allCategories = [];
let currentCategory = 'all';
let activeTags = [];
let favoriteOrgs = new Set(JSON.parse(localStorage.getItem('camppedidos_favorites') || '[]'));

function toggleFavorite(orgId) {
    if (favoriteOrgs.has(orgId)) {
        favoriteOrgs.delete(orgId);
    } else {
        favoriteOrgs.add(orgId);
    }
    localStorage.setItem('camppedidos_favorites', JSON.stringify(Array.from(favoriteOrgs)));
    renderOrganizations();
}

async function init() {
    try {
        // Fetch CMS data from GitHub Pages JSON file
        const res = await fetch('data.json');
        const data = await res.json();

        allCategories = data.categories || [];
        allOrganizations = data.organizations || [];

        renderCategories();
        renderTags();
        renderOrganizations();
    } catch (e) {
        console.error("Failed to load CMS data:", e);
        const listContainer = document.getElementById('org-list');
        if (listContainer) {
            listContainer.innerHTML = `<p class="text-red-500">Erro ao carregar os dados.</p>`;
        }
    }
}

function renderCategories() {
    const listContainer = document.getElementById('category-list');
    if (!listContainer) return;

    // Reset contents
    listContainer.innerHTML = '<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3">Categorias</h3>';

    allCategories.forEach(cat => {
        const isActive = cat.id === currentCategory;

        // Define styling classes based on active state
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
                renderCategories(); // Re-render sidebar to update active state
                renderTags(); // Re-render tags applicable to the new category
                renderOrganizations(); // Re-render cards
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

    // Clear current tags
    listContainer.innerHTML = '';

    // Extract unique tags from organizations matching the current category
    const uniqueTags = new Set();
    allOrganizations.forEach(org => {
        if (currentCategory === 'all' || org.categoryId === currentCategory) {
            (org.tags || []).forEach(tag => uniqueTags.add(tag));
        }
    });

    // Remove active tags that are no longer available in the current category
    activeTags = activeTags.filter(t => uniqueTags.has(t));

    uniqueTags.forEach(tag => {
        const isActive = activeTags.includes(tag);

        const baseClass = isActive
            ? 'bg-primary/10 text-primary border-primary/20 shadow-inner'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';

        const span = document.createElement('span');
        span.className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border cursor-pointer hover:opacity-80 transition-colors ${baseClass}`;
        span.textContent = tag;

        // Add checkmark icon for active tags
        if (isActive) {
            span.innerHTML = `<span class="material-symbols-outlined text-[14px]">check</span> ${tag}`;
        }

        span.onclick = () => {
            if (isActive) {
                activeTags = activeTags.filter(t => t !== tag);
            } else {
                activeTags.push(tag);
            }
            renderTags();
            renderOrganizations();
        };

        listContainer.appendChild(span);
    });
}

function renderOrganizations() {
    const listContainer = document.getElementById('org-list');
    const countDisplay = document.getElementById('store-count');

    if (!listContainer || !countDisplay) return;

    // Filter organizations
    let filteredList = allOrganizations;

    // 1. Filter by category
    if (currentCategory !== 'all') {
        filteredList = filteredList.filter(o => o.categoryId === currentCategory);
    }

    // 2. Filter by active tags (AND logic)
    if (activeTags.length > 0) {
        filteredList = filteredList.filter(o => {
            const orgTags = o.tags || [];
            return activeTags.every(t => orgTags.includes(t));
        });
    }

    // 3. Sort so favorites are always pushed to the top
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
        const tagsHtml = (org.tags || []).map(tag =>
            `<span class="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium border border-slate-200 dark:border-slate-700">${tag}</span>`
        ).join('');

        const featuredTag = idx === 0 && currentCategory === 'all'
            ? `<div class="absolute top-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-[10px] font-bold text-white uppercase tracking-wider">Destaque</div>`
            : '';

        return `
            <article class="glass-card rounded-xl p-4 sm:p-5 flex flex-col md:flex-row gap-5 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 group">
                <!-- Thumbnail -->
                <div class="w-full md:w-64 h-48 md:h-auto shrink-0 rounded-lg overflow-hidden relative bg-slate-200 dark:bg-slate-800">
                    <div class="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-700 group-hover:scale-105" style="background-image: url('${org.image}')"></div>
                    ${featuredTag}
                </div>
                
                <!-- Content -->
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
                                <span class="material-symbols-outlined filled text-[16px]">star</span>
                                <span class="text-sm font-bold">${org.rating}</span>
                                <span class="text-xs text-slate-400 dark:text-slate-500 font-normal">(${org.reviews})</span>
                            </div>
                        </div>
                        
                        <p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed line-clamp-2">
                            ${org.description}
                        </p>
                        
                        <div class="flex flex-wrap gap-2">
                            ${tagsHtml}
                        </div>
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

document.addEventListener('DOMContentLoaded', () => {
    init();
});
