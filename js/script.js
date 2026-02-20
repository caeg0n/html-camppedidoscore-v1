const organizations = [
    {
        id: 'eclipse',
        name: 'Eclipse Pizzas e Sanduíches',
        category: 'Pizzaria',
        location: 'Campinápolis, MT',
        rating: '4.8',
        reviews: '1.2k',
        description: 'O pôr do sol mais charmoso da city. Pizzas, sanduíches, caldos e porções caprichadas.',
        tags: ['Pizzas', 'Lanches', 'Entrega'],
        image: 'https://caeg0n.github.io/html-camppedidoseclipse-v1/reference-page-main.png',
        logo: 'https://caeg0n.github.io/html-camppedidoseclipse-v1/favicon.svg',
        url: 'https://caeg0n.github.io/html-camppedidoseclipse-v1/compras/'
    },
    {
        id: 'bigbrasa',
        name: 'Hamburgueria Big Brasa',
        category: 'Hamburgueria',
        location: 'Campinápolis, MT',
        rating: '4.9',
        reviews: '850',
        description: 'O melhor hambúrguer da cidade. Hambúrgueres artesanais, pastéis e porções feitas com ingredientes selecionados.',
        tags: ['Hambúrguer', 'Artesanal', 'Bebidas'],
        image: 'https://caeg0n.github.io/html-camppedidosbigbrasa-v1/assets/img/logo2.png',
        logo: 'https://caeg0n.github.io/html-camppedidosbigbrasa-v1/favicon.svg',
        url: 'https://caeg0n.github.io/html-camppedidosbigbrasa-v1/compras/'
    }
];

function renderOrganizations() {
    const listContainer = document.getElementById('org-list');
    const countDisplay = document.getElementById('store-count');

    if (!listContainer || !countDisplay) return;

    countDisplay.textContent = organizations.length;

    const cardsHtml = organizations.map((org, idx) => {
        const tagsHtml = org.tags.map(tag =>
            `<span class="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium border border-slate-200 dark:border-slate-700">${tag}</span>`
        ).join('');

        const featuredTag = idx === 0
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
                                <img alt="${org.name} Logo" class="size-10 rounded-full border border-slate-100 dark:border-slate-700 shadow-sm" src="${org.logo}" onerror="this.src='favicon.svg'"/>
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
                        <button class="text-slate-400 hover:text-red-500 transition-colors">
                            <span class="material-symbols-outlined">favorite_border</span>
                        </button>
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
    renderOrganizations();
});
