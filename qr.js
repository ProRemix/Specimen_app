// ============================================================
// QR CODES - liens enregistrés dans le téléphone, affichés un par un
// ou tous ensemble. Générateur : js/vendor/qrcode.js (MIT, K. Arase)
// ============================================================

const KEY = 'robot-qr-links-v1';
const $ = (id) => document.getElementById(id);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(links) {
  try { localStorage.setItem(KEY, JSON.stringify(links)); } catch { /* stockage indisponible */ }
}

function svgFor(text) {
  const qr = window.qrcode(0, 'M');
  window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labelOf = (l) => l.title || l.url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function initQr() {
  let links = load();
  let index = 0;
  let view = 'single';

  const sheet = $('sheet-qr');

  function render() {
    const has = links.length > 0;
    index = Math.min(index, Math.max(0, links.length - 1));
    $('qr-empty').hidden = has;
    $('qr-single').hidden = !has || view !== 'single';
    $('qr-grid').hidden = !has || view !== 'grid';

    if (has && view === 'single') {
      const l = links[index];
      $('qr-big').innerHTML = svgFor(l.url);
      $('qr-title').textContent = labelOf(l);
      $('qr-url').textContent = l.url;
      $('qr-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(links.length).padStart(2, '0')}`;
      $('qr-prev').style.visibility = links.length > 1 ? 'visible' : 'hidden';
      $('qr-next').style.visibility = links.length > 1 ? 'visible' : 'hidden';
    }
    if (has && view === 'grid') {
      $('qr-grid').innerHTML = links.map((l, i) => `
        <figure data-i="${i}">
          <div class="qr-card"><div class="qr-code">${svgFor(l.url)}</div></div>
          <figcaption>${escapeHtml(labelOf(l))}</figcaption>
        </figure>`).join('');
    }

    $('qr-list').innerHTML = links.map((l, i) => `
      <li class="${i === index ? 'current' : ''}" data-i="${i}">
        <div class="qr-li-text">
          <span class="qr-li-title">${escapeHtml(labelOf(l))}</span>
          <span class="mono-small">${escapeHtml(l.url)}</span>
        </div>
        <button class="icon-btn" data-del="${i}" aria-label="Supprimer">×</button>
      </li>`).join('');
  }

  const step = (d) => {
    if (links.length < 2) return;
    index = (index + d + links.length) % links.length;
    render();
  };

  $('btn-qr').addEventListener('click', () => { sheet.hidden = false; render(); });
  sheet.querySelector('[data-close]').addEventListener('click', () => { sheet.hidden = true; });
  $('qr-prev').addEventListener('click', () => step(-1));
  $('qr-next').addEventListener('click', () => step(1));

  // Balayage gauche/droite sur le QR
  let startX = null;
  $('qr-single').addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  $('qr-single').addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    startX = null;
  });

  $('qr-view').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    view = b.dataset.view;
    $('qr-view').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });

  // Toucher un QR de la grille l'ouvre en grand
  $('qr-grid').addEventListener('click', (e) => {
    const f = e.target.closest('figure[data-i]');
    if (!f) return;
    index = Number(f.dataset.i);
    $('qr-view').querySelector('[data-view="single"]').click();
  });

  $('qr-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      links.splice(Number(del.dataset.del), 1);
      save(links);
      render();
      return;
    }
    const li = e.target.closest('li[data-i]');
    if (li) { index = Number(li.dataset.i); render(); }
  });

  $('qr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    let url = $('qr-input-url').value.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    links.push({ url, title: $('qr-input-title').value.trim() });
    save(links);
    index = links.length - 1;
    $('qr-input-url').value = '';
    $('qr-input-title').value = '';
    render();
  });
}
