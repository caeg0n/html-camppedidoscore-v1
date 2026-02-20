const organizations = [
    {
        id: 'eclipse',
        name: 'Eclipse Pizzas e Sanduíches',
        image: 'https://caeg0n.github.io/html-camppedidoseclipse-v1/reference-page-main.png',
        url: 'https://caeg0n.github.io/html-camppedidoseclipse-v1/compras/'
    },
    {
        id: 'bigbrasa',
        name: 'Hamburgueria Big Brasa',
        image: 'https://caeg0n.github.io/html-camppedidosbigbrasa-v1/assets/img/logo2.png',
        url: 'https://caeg0n.github.io/html-camppedidosbigbrasa-v1/compras/'
    }
];

function renderOrganizations() {
    const listContainer = document.getElementById('org-list');
    const countDisplay = document.getElementById('store-count');

    if (!listContainer || !countDisplay) return;

    countDisplay.textContent = organizations.length;

    const cardsHtml = organizations.map(org => {
        // We use a button that triggers a navigation to match the "BUY NOW" look
        return `
            <article class="card">
                <div class="card-img-container" style="background: #111;">
                    <img src="${org.image}" alt="${org.name}" class="card-img" style="object-fit: contain; padding: 20px;" loading="lazy" />
                </div>
                <div class="card-content">
                    <h3 class="card-title">${org.name}</h3>
                </div>
                <a href="${org.url}" class="btn-buy" style="text-align: center; display: block;">VISUALIZAR CARDÁPIO</a>
            </article>
        `;
    }).join('');

    listContainer.innerHTML = cardsHtml;
}

document.addEventListener('DOMContentLoaded', () => {
    renderOrganizations();
});
