// Sidebar paths are relative to the docs root, so the site works under /Nova/ on GitHub Pages.
const root = document.currentScript.src.replace(/sidebar\.js.*$/, '');

fetch(root + 'sidebar.html')
    .then(r => r.text())
    .then(html => {
        const holder = document.getElementById('sidebar-placeholder');
        holder.innerHTML = html;
        holder.querySelectorAll('a[data-href]').forEach(a => a.href = root + a.dataset.href);
        generateTOC();
    })
    .catch(e => console.error('Error loading sidebar:', e));

function generateTOC() {
    const toc = document.getElementById('toc');
    document.querySelectorAll('.content h2, .content h3').forEach(h => {
        if (!h.id) h.id = h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const li = document.createElement('li');
        if (h.tagName === 'H3') li.style.paddingLeft = '12px';
        li.innerHTML = `<a href="#${h.id}">${h.textContent}</a>`;
        toc.appendChild(li);
    });
}
