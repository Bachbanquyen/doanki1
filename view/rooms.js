const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const grid = document.querySelector('#directory-grid');
const empty = document.querySelector('#directory-empty');
let rooms = [];

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function dateValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function setDefaultDates(useQuery = true) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn = new Date(today);
  checkIn.setDate(checkIn.getDate() + 1);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 1);
  const search = useQuery ? new URLSearchParams(location.search) : new URLSearchParams();
  const checkInInput = document.querySelector('#directory-checkin');
  const checkOutInput = document.querySelector('#directory-checkout');
  checkInInput.min = dateValue(today);
  checkInInput.value = search.get('checkIn') || dateValue(checkIn);
  checkOutInput.min = dateValue(checkOut);
  checkOutInput.value = search.get('checkOut') || dateValue(checkOut);
  document.querySelector('#directory-query').value = search.get('q') || '';
  document.querySelector('#directory-guests').value = search.get('guests') || '2';
  return { checkInInput, checkOutInput };
}

function drawRooms() {
  const sort = document.querySelector('#directory-sort').value;
  const result = [...rooms];
  if (sort === 'price-asc') result.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
  document.querySelector('#directory-count').textContent = `${result.length} hạng phòng${result.length === 1 ? '' : ''} dành cho kỳ nghỉ của bạn`;
  empty.hidden = result.length > 0;
  grid.hidden = result.length === 0;
  grid.innerHTML = result.map((room, index) => `
    <article class="directory-card">
      <a class="directory-photo" href="${bookingHref(room.id)}" aria-label="Đặt ${safe(room.name)}">
        <img src="${safe(room.image)}" alt="${safe(room.name)} tại Mây Retreat" loading="lazy">
        <span class="room-tag">${safe(room.label)}</span><span class="directory-photo-index">${String(index + 1).padStart(2, '0')}</span>
      </a>
      <div class="directory-card-body"><div class="directory-card-title"><h3>${safe(room.name)}</h3><span>⌁ ${room.capacity} khách</span></div>
        <p>${safe(room.description)}</p>
        <div class="directory-details"><span>${room.size} m²</span><i></i><span>${safe(room.beds)}</span><i></i><span>${room.available > 0 ? `${room.available} phòng trống` : 'Hết phòng'}</span></div>
        <div class="directory-card-bottom"><div class="room-price"><strong>${money.format(room.price)}</strong><span>/ đêm</span></div>${room.available > 0 ? `<a class="directory-book" href="${bookingHref(room.id)}">Chọn phòng <span>↗</span></a>` : '<span class="directory-sold-out">Hết phòng</span>'}</div>
      </div>
    </article>`).join('');
}

function bookingHref(roomId) {
  const params = new URLSearchParams({
    room: roomId,
    checkIn: document.querySelector('#directory-checkin').value,
    checkOut: document.querySelector('#directory-checkout').value,
    guests: document.querySelector('#directory-guests').value
  });
  return `/?${params}#rooms`;
}

async function searchRooms(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  try {
    const response = await fetch(`/api/rooms${params.size ? `?${params}` : ''}`, { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không tải được danh sách phòng.');
    rooms = result.filter((room) => room.fitsGuests !== false);
    drawRooms();
  } catch (error) {
    grid.hidden = true;
    empty.hidden = false;
    empty.querySelector('h3').textContent = 'Chưa tải được danh sách phòng.';
    empty.querySelector('p').textContent = error.message;
  }
}

document.querySelector('#directory-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const checkIn = document.querySelector('#directory-checkin').value;
  const checkOut = document.querySelector('#directory-checkout').value;
  if (checkOut <= checkIn) {
    document.querySelector('#directory-checkout').setCustomValidity('Ngày trả phòng cần sau ngày nhận phòng.');
    document.querySelector('#directory-checkout').reportValidity();
    return;
  }
  document.querySelector('#directory-checkout').setCustomValidity('');
  searchRooms({
    q: document.querySelector('#directory-query').value.trim(),
    checkIn,
    checkOut,
    guests: document.querySelector('#directory-guests').value
  });
});
document.querySelector('#directory-sort').addEventListener('change', drawRooms);
const { checkInInput, checkOutInput } = setDefaultDates();
checkInInput.addEventListener('change', () => {
  const next = new Date(`${checkInInput.value}T00:00:00`);
  next.setDate(next.getDate() + 1);
  checkOutInput.min = dateValue(next);
  if (checkOutInput.value < checkOutInput.min) checkOutInput.value = checkOutInput.min;
});
document.querySelector('#directory-reset').addEventListener('click', () => {
  document.querySelector('#directory-query').value = '';
  document.querySelector('#directory-guests').value = '2';
  setDefaultDates(false);
  document.querySelector('#directory-sort').value = 'featured';
  searchRooms({
    checkIn: document.querySelector('#directory-checkin').value,
    checkOut: document.querySelector('#directory-checkout').value,
    guests: '2'
  });
});

searchRooms({
  q: document.querySelector('#directory-query').value.trim(),
  checkIn: document.querySelector('#directory-checkin').value,
  checkOut: document.querySelector('#directory-checkout').value,
  guests: document.querySelector('#directory-guests').value
});
