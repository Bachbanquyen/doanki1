const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const today = new Date();
today.setHours(0, 0, 0, 0);
const todayValue = toDateInput(today);
const guestView = document.querySelector('#guest-view');
const adminView = document.querySelector('#admin-view');
const customerView = document.querySelector('#customer-view');
const roomGrid = document.querySelector('#room-grid');
const toast = document.querySelector('#toast');
const dialog = document.querySelector('#booking-dialog');
const authDialog = document.querySelector('#auth-dialog');
let allRooms = [];
let shownRooms = [];
let bookingRows = [];
let myBookings = [];
let adminRooms = [];
let currentUser = null;
let chosenRoom = null;
let pendingBookingRoomId = null;
let toastTimer;

function toDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return dateFormat.format(new Date(year, month - 1, day));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể hoàn tất yêu cầu.');
  return data;
}

function showToast(message, kind = 'success') {
  toast.textContent = message;
  toast.className = `toast visible ${kind === 'error' ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4200);
}

function setDefaultDates() {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);
  for (const input of [document.querySelector('#search-checkin'), document.querySelector('#booking-checkin')]) {
    input.min = todayValue;
    input.value = toDateInput(tomorrow);
  }
  for (const input of [document.querySelector('#search-checkout'), document.querySelector('#booking-checkout')]) {
    input.min = toDateInput(dayAfter);
    input.value = toDateInput(dayAfter);
  }
}

function renderRooms(rooms) {
  shownRooms = rooms.filter((room) => room.fitsGuests !== false && room.available > 0);
  const results = document.querySelector('#room-results');
  const hasSearch = Boolean(document.querySelector('#search-form').dataset.active);
  results.textContent = shownRooms.length ? `${String(shownRooms.length).padStart(2, '0')} KHÔNG GIAN ĐANG ĐỢI BẠN` : 'KHÔNG TÌM THẤY PHÒNG PHÙ HỢP';
  document.querySelector('#clear-search').hidden = !hasSearch;
  if (!shownRooms.length) {
    roomGrid.innerHTML = '<div class="no-rooms"><span>✳</span><h3>Chưa tìm thấy phòng phù hợp.</h3><p>Hãy thử từ khóa, số khách hoặc ngày lưu trú khác.</p></div>';
    return;
  }
  roomGrid.innerHTML = shownRooms.map((room, index) => `
    <article class="room-card ${room.featured ? 'featured-room' : ''}">
      <div class="room-photo-wrap"><img class="room-photo" src="${safe(room.image)}" alt="${safe(room.name)} tại Mây Retreat" loading="lazy"><span class="room-tag">${safe(room.label)}</span><span class="room-count">${String(index + 1).padStart(2, '0')} / ${String(shownRooms.length).padStart(2, '0')}</span></div>
      <div class="room-card-body"><div class="room-title-row"><h3>${safe(room.name)}</h3><span class="room-capacity">⌁ ${room.capacity} khách</span></div><p class="room-description">${safe(room.description)}</p><div class="room-specs"><span>${room.size} m²</span><i></i><span>${safe(room.beds)}</span><i></i><span>${room.available} phòng trống</span></div><div class="room-card-bottom"><div class="room-price"><strong>${money.format(room.price)}</strong><span>/ đêm</span></div><button class="room-book" data-room-id="${safe(room.id)}" type="button">Đặt phòng <span>↗</span></button></div></div>
    </article>`).join('');
}

async function loadRooms(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const endpoint = `/api/rooms${params.size ? `?${params}` : ''}`;
  try {
    const rooms = await api(endpoint);
    allRooms = rooms;
    renderRooms(rooms);
  } catch {
    roomGrid.innerHTML = '<div class="no-rooms"><span>✳</span><h3>Mây đang khởi động.</h3><p>Vui lòng làm mới trang sau ít phút.</p></div>';
  }
}

function updateCheckoutMin(checkInInput, checkOutInput) {
  const nextDay = new Date(`${checkInInput.value}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const min = toDateInput(nextDay);
  checkOutInput.min = min;
  if (checkOutInput.value < min) checkOutInput.value = min;
  updateBookingTotal();
}

function updateBookingTotal() {
  if (!chosenRoom) return;
  const checkIn = document.querySelector('#booking-checkin').value;
  const checkOut = document.querySelector('#booking-checkout').value;
  const nights = Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00`) - Date.parse(`${checkIn}T00:00:00`)) / 86_400_000));
  document.querySelector('#booking-price-note').textContent = nights ? `Tổng tiền · ${nights} đêm` : 'Tổng tiền lưu trú';
  document.querySelector('#booking-total-price').textContent = nights ? money.format(chosenRoom.price * nights) : '—';
}

function openAuth(mode = 'login') {
  setAuthTab(mode);
  if (!authDialog.open) authDialog.showModal();
}

function openBooking(roomId) {
  chosenRoom = allRooms.find((room) => room.id === roomId) || shownRooms.find((room) => room.id === roomId);
  if (!chosenRoom) return;
  if (!currentUser) {
    pendingBookingRoomId = roomId;
    openAuth('login');
    return;
  }
  document.querySelector('#booking-room-id').value = chosenRoom.id;
  document.querySelector('#dialog-room-name').textContent = `${chosenRoom.name} · ${money.format(chosenRoom.price)} / đêm`;
  document.querySelector('#dialog-image').style.backgroundImage = `url("${chosenRoom.image.replaceAll('"', '')}")`;
  document.querySelector('#booking-guests').innerHTML = Array.from({ length: chosenRoom.capacity }, (_, index) => `<option value="${index + 1}" ${index === 1 || (chosenRoom.capacity === 1 && index === 0) ? 'selected' : ''}>${index + 1} khách</option>`).join('');
  document.querySelector('#booking-account-note').textContent = `Đặt với ${currentUser.name} · ${currentUser.email}`;
  const searchIn = document.querySelector('#search-checkin').value;
  const searchOut = document.querySelector('#search-checkout').value;
  if (searchIn >= todayValue) document.querySelector('#booking-checkin').value = searchIn;
  if (searchOut > searchIn) document.querySelector('#booking-checkout').value = searchOut;
  updateCheckoutMin(document.querySelector('#booking-checkin'), document.querySelector('#booking-checkout'));
  dialog.showModal();
}

function setAuthTab(mode) {
  const isRegister = mode === 'register';
  document.querySelector('#login-form').hidden = isRegister;
  document.querySelector('#register-form').hidden = !isRegister;
  document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.authTab === mode));
  document.querySelector('#auth-title').innerHTML = isRegister ? 'Bắt đầu kỳ nghỉ<br><em>từ đây nhé.</em>' : 'Rất vui được<br><em>gặp lại bạn.</em>';
  document.querySelector('.auth-intro').textContent = isRegister ? 'Tạo tài khoản để đặt phòng và theo dõi kỳ nghỉ của bạn.' : 'Đăng nhập để đặt phòng và theo dõi kỳ nghỉ của bạn.';
}

function updateAuthButton() {
  const label = document.querySelector('#admin-toggle span:nth-child(2)');
  label.textContent = currentUser ? (currentUser.role === 'admin' ? 'Quản lý' : 'Tài khoản') : 'Đăng nhập';
  document.querySelector('#admin-toggle').setAttribute('aria-label', currentUser ? `${label.textContent}: ${currentUser.name}` : 'Đăng nhập hoặc đăng ký');
}

function setView(view) {
  const isAdmin = view === 'admin' && currentUser?.role === 'admin';
  const isCustomer = view === 'customer' && currentUser;
  guestView.hidden = Boolean(isAdmin || isCustomer);
  adminView.hidden = !isAdmin;
  customerView.hidden = !isCustomer;
  document.body.classList.toggle('admin-mode', Boolean(isAdmin || isCustomer));
  const label = document.querySelector('#admin-toggle span:nth-child(2)');
  if (currentUser && (isAdmin || isCustomer)) label.textContent = 'Trang đặt phòng';
  else updateAuthButton();
  if (isAdmin) refreshAdmin();
  if (isCustomer) {
    document.querySelector('#customer-name').textContent = `${currentUser.name.trim().split(/\s+/).slice(-1)[0]}.`;
    refreshCustomer();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderBookings(rows) {
  const search = document.querySelector('#booking-search').value.trim().toLocaleLowerCase('vi');
  const status = document.querySelector('#booking-filter').value;
  const filtered = rows.filter((booking) => {
    const searchable = `${booking.guestName} ${booking.email} ${booking.id} ${booking.roomName}`.toLocaleLowerCase('vi');
    return (!search || searchable.includes(search)) && (status === 'all' || booking.status === status);
  });
  document.querySelector('#booking-count').textContent = `${filtered.length} đặt phòng`;
  document.querySelector('#bookings-empty').hidden = filtered.length > 0;
  document.querySelector('#bookings-body').innerHTML = filtered.map((booking) => {
    const paymentLocked = booking.paymentStatus === 'paid' || booking.paymentStatus === 'demo_paid';
    return `
    <tr>
      <td><strong class="guest-name">${safe(booking.guestName)}</strong><span class="guest-email">${safe(booking.email)}</span></td>
      <td><span class="table-room">${safe(booking.roomName)}</span></td>
      <td><span>${formatDate(booking.checkIn)}</span><small class="date-arrow"> → ${formatDate(booking.checkOut)}</small></td>
      <td>${booking.guests} khách</td>
      <td class="table-price">${money.format(booking.totalPrice)}</td>
      <td><span class="payment-chip payment-${safe(booking.paymentStatus)}">${safe(booking.paymentStatusLabel)}</span></td>
      <td><select class="status-select status-${safe(booking.status)}" aria-label="Trạng thái đặt phòng ${safe(booking.guestName)}" data-status-id="${safe(booking.id)}"><option value="confirmed" ${booking.status === 'confirmed' ? 'selected' : ''}>Đã xác nhận</option><option value="checked_in" ${booking.status === 'checked_in' ? 'selected' : ''}>Đang lưu trú</option><option value="checked_out" ${booking.status === 'checked_out' ? 'selected' : ''}>Đã trả phòng</option><option value="cancelled" ${booking.status === 'cancelled' ? 'selected' : ''}>Đã hủy</option></select></td>
      <td><div class="booking-row-actions"><button class="edit-booking" type="button" data-edit-booking-id="${safe(booking.id)}" aria-label="Sửa đặt phòng ${safe(booking.guestName)}" title="Sửa đặt phòng" ${paymentLocked ? 'disabled' : ''}>✎</button><button class="delete-booking" type="button" data-delete-id="${safe(booking.id)}" aria-label="Xóa đặt phòng ${safe(booking.guestName)}" title="Xóa đặt phòng">×</button></div></td>
    </tr>`;
  }).join('');
}

async function refreshAdmin() {
  if (currentUser?.role !== 'admin') return;
  try {
    const [summary, bookings, rooms] = await Promise.all([api('/api/summary'), api('/api/bookings'), api('/api/rooms')]);
    bookingRows = bookings;
    adminRooms = rooms;
    document.querySelector('#stat-active').textContent = summary.active;
    document.querySelector('#stat-staying').textContent = summary.staying;
    document.querySelector('#stat-occupancy').textContent = summary.occupancy;
    document.querySelector('#stat-revenue').textContent = money.format(summary.revenue);
    renderBookings(bookings);
    renderInventory(rooms);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderInventory(rooms) {
  document.querySelector('#inventory-grid').innerHTML = rooms.map((room) => `
    <article class="inventory-card">
      <div class="inventory-card-heading"><div><span class="room-tag-inline">${safe(room.label)}</span><h3>${safe(room.name)}</h3></div><span class="inventory-capacity">⌁ ${room.capacity} khách</span></div>
      <div class="inventory-room-meta"><span>${money.format(room.price)} / đêm</span><span>${room.size} m² · ${safe(room.beds)}</span></div>
      <div class="inventory-card-foot"><span>${room.totalRooms} phòng · ${room.bookingCount || 0} lượt đặt</span><div class="inventory-actions"><button class="inventory-edit" type="button" data-edit-room-id="${safe(room.id)}">Sửa</button><button class="inventory-delete" type="button" data-delete-room-id="${safe(room.id)}" ${room.bookingCount ? 'disabled title="Không thể xóa hạng phòng đã có lịch sử đặt"' : ''}>Xóa</button></div></div>
    </article>`).join('');
}

function openRoomEditor(roomId = '') {
  const form = document.querySelector('#room-editor-form');
  const room = adminRooms.find((item) => item.id === roomId);
  form.reset();
  form.elements.namedItem('id').value = room?.id || '';
  document.querySelector('#room-editor-title').textContent = room ? 'Sửa hạng phòng' : 'Thêm hạng phòng';
  document.querySelector('#room-editor-submit-label').textContent = room ? 'Lưu thay đổi' : 'Thêm hạng phòng';
  form.elements.namedItem('name').value = room?.name || '';
  form.elements.namedItem('type').value = room?.type || '';
  form.elements.namedItem('label').value = room?.label || '';
  form.elements.namedItem('beds').value = room?.beds || '';
  form.elements.namedItem('description').value = room?.description || '';
  form.elements.namedItem('price').value = room?.price || 1_500_000;
  form.elements.namedItem('totalRooms').value = room?.totalRooms || 1;
  form.elements.namedItem('capacity').value = room?.capacity || 2;
  form.elements.namedItem('size').value = room?.size || 32;
  form.elements.namedItem('image').value = room?.image || '';
  form.elements.namedItem('featured').checked = Boolean(room?.featured);
  document.querySelector('#room-editor-dialog').showModal();
}

function openBookingEditor(bookingId = '') {
  const form = document.querySelector('#booking-editor-form');
  const booking = bookingRows.find((item) => item.id === bookingId);
  form.reset();
  form.elements.namedItem('id').value = booking?.id || '';
  form.elements.namedItem('roomId').innerHTML = adminRooms.map((room) => `<option value="${safe(room.id)}">${safe(room.name)} · ${money.format(room.price)} / đêm</option>`).join('');
  if (booking) {
  form.elements.namedItem('roomId').value = booking.roomId;
    form.elements.namedItem('checkIn').value = booking.checkIn;
    form.elements.namedItem('checkOut').value = booking.checkOut;
    form.elements.namedItem('guests').value = booking.guests;
    form.elements.namedItem('guestName').value = booking.guestName;
    form.elements.namedItem('email').value = booking.email;
    form.elements.namedItem('phone').value = booking.phone;
    form.elements.namedItem('paymentMethod').value = booking.paymentMethod || 'at_property';
    form.elements.namedItem('note').value = booking.note || '';
  } else {
    const firstNight = new Date(today);
    firstNight.setDate(firstNight.getDate() + 1);
    const checkOut = new Date(firstNight);
    checkOut.setDate(checkOut.getDate() + 1);
    form.elements.namedItem('checkIn').value = toDateInput(firstNight);
    form.elements.namedItem('checkOut').value = toDateInput(checkOut);
    form.elements.namedItem('paymentMethod').value = 'at_property';
  }
  const room = adminRooms.find((item) => item.id === form.elements.namedItem('roomId').value);
  form.elements.namedItem('guests').max = room?.capacity || 30;
  document.querySelector('#booking-editor-title').textContent = booking ? 'Sửa đặt phòng' : 'Thêm đặt phòng';
  document.querySelector('#booking-editor-submit-label').textContent = booking ? 'Lưu thay đổi' : 'Tạo đặt phòng';
  document.querySelector('#editor-checkin').min = todayValue;
  const nextDate = new Date(`${document.querySelector('#editor-checkin').value}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + 1);
  document.querySelector('#editor-checkout').min = toDateInput(nextDate);
  document.querySelector('#booking-editor-dialog').showModal();
}

async function refreshCustomer() {
  if (!currentUser || currentUser.role === 'admin') return;
  try {
    myBookings = await api('/api/bookings');
    renderCustomerBookings();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderCustomerBookings() {
  const list = document.querySelector('#my-bookings-list');
  const empty = document.querySelector('#my-bookings-empty');
  empty.hidden = myBookings.length > 0;
  list.innerHTML = myBookings.map((booking) => {
    const canPayDemo = booking.paymentStatus === 'pending' && booking.status !== 'cancelled';
    const canCancel = ['unpaid', 'pending'].includes(booking.paymentStatus) && booking.status === 'confirmed' && booking.checkIn > todayValue;
    return `<article class="my-booking-card">
      <div class="my-booking-image" style="background-image:url('${safe((allRooms.find((room) => room.id === booking.roomId) || {}).image || '')}')"><span>${safe(booking.roomName)}</span></div>
      <div class="my-booking-content"><div class="my-booking-top"><span class="my-booking-id">MÃ ĐẶT PHÒNG · ${safe(booking.id.slice(0, 8).toUpperCase())}</span><span class="status-select status-${safe(booking.status)}">${safe(booking.statusLabel)}</span></div>
        <h3>${formatDate(booking.checkIn)} <i>→</i> ${formatDate(booking.checkOut)}</h3><p>${booking.nights} đêm · ${booking.guests} khách</p>
        <div class="my-booking-payment"><span>${safe(booking.paymentStatusLabel)}</span><strong>${money.format(booking.totalPrice)}</strong></div>
        <div class="my-booking-actions">${canPayDemo ? `<button class="primary-button pay-demo-button" type="button" data-pay-id="${safe(booking.id)}"><span>Xác nhận thanh toán demo</span><span>↗</span></button>` : ''}${canCancel ? `<button class="cancel-booking" type="button" data-cancel-id="${safe(booking.id)}">Hủy đặt phòng</button>` : ''}${booking.paymentReference ? `<small>Mã demo: ${safe(booking.paymentReference)}</small>` : ''}</div>
      </div>
    </article>`;
  }).join('');
}

async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { /* clear local view even when a session has expired */ }
  currentUser = null;
  updateAuthButton();
  setView('guest');
  showToast('Bạn đã đăng xuất.');
}

document.querySelector('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const checkIn = document.querySelector('#search-checkin').value;
  const checkOut = document.querySelector('#search-checkout').value;
  if (checkOut <= checkIn) {
    showToast('Ngày trả phòng cần sau ngày nhận phòng.', 'error');
    return;
  }
  event.currentTarget.dataset.active = 'true';
  await loadRooms({ checkIn, checkOut, guests: document.querySelector('#search-guests').value, q: document.querySelector('#search-query').value.trim() });
  document.querySelector('#rooms').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#clear-search').addEventListener('click', async () => {
  delete document.querySelector('#search-form').dataset.active;
  document.querySelector('#search-guests').value = '2';
  document.querySelector('#search-query').value = '';
  await loadRooms();
});

roomGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-room-id]');
  if (button) openBooking(button.dataset.roomId);
});

document.querySelector('#booking-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUser) {
    dialog.close();
    pendingBookingRoomId = chosenRoom?.id;
    openAuth('login');
    return;
  }
  const form = event.currentTarget;
  const submit = form.querySelector('.booking-submit');
  const values = Object.fromEntries(new FormData(form).entries());
  values.roomId = document.querySelector('#booking-room-id').value;
  values.guests = Number(values.guests);
  const original = submit.innerHTML;
  submit.disabled = true;
  submit.innerHTML = '<span>Đang giữ chỗ…</span><span>◌</span>';
  try {
    const booking = await api('/api/bookings', { method: 'POST', body: JSON.stringify(values) });
    dialog.close();
    form.reset();
    showToast(booking.paymentStatus === 'pending' ? 'Đặt phòng thành công. Vào tài khoản để hoàn tất bước thanh toán demo.' : 'Đặt phòng thành công. Bạn thanh toán tại khách sạn khi nhận phòng.');
    await loadRooms(document.querySelector('#search-form').dataset.active ? {
      checkIn: document.querySelector('#search-checkin').value,
      checkOut: document.querySelector('#search-checkout').value,
      guests: document.querySelector('#search-guests').value,
      q: document.querySelector('#search-query').value.trim()
    } : {});
    if (currentUser.role === 'admin') setView('admin');
    else setView('customer');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
    submit.innerHTML = original;
  }
});

document.querySelector('#booking-checkin').addEventListener('change', () => updateCheckoutMin(document.querySelector('#booking-checkin'), document.querySelector('#booking-checkout')));
document.querySelector('#booking-checkout').addEventListener('change', updateBookingTotal);
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
document.querySelector('#auth-close').addEventListener('click', () => authDialog.close());
authDialog.addEventListener('click', (event) => { if (event.target === authDialog) authDialog.close(); });
document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => setAuthTab(tab.dataset.authTab)));

async function submitAuth(form, endpoint) {
  const button = form.querySelector('button[type=submit]');
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span>Đang xử lý…</span><span>◌</span>';
  const errorNote = form.querySelector('.auth-error');
  if (errorNote) { errorNote.hidden = true; errorNote.textContent = ''; }
  try {
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    currentUser = result.user;
    updateAuthButton();
    authDialog.close();
    form.reset();
    showToast(endpoint.endsWith('register') ? 'Tài khoản đã được tạo. Chào mừng bạn đến Mây!' : `Xin chào ${currentUser.name}, rất vui được gặp bạn.`);
    const requestedReturn = new URLSearchParams(window.location.search).get('return');
    if (requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//')) {
      window.location.assign(requestedReturn);
      return;
    }
    if (pendingBookingRoomId) {
      const roomId = pendingBookingRoomId;
      pendingBookingRoomId = null;
      openBooking(roomId);
    } else {
      setView(currentUser.role === 'admin' ? 'admin' : 'customer');
    }
  } catch (error) {
    if (errorNote) { errorNote.textContent = error.message; errorNote.hidden = false; }
    else showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

document.querySelector('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth(event.currentTarget, '/api/auth/login');
});
document.querySelector('#register-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth(event.currentTarget, '/api/auth/register');
});

document.querySelector('#admin-toggle').addEventListener('click', () => {
  if (!currentUser) { openAuth('login'); return; }
  const viewIsOpen = !adminView.hidden || !customerView.hidden;
  if (viewIsOpen) setView('guest');
  else setView(currentUser.role === 'admin' ? 'admin' : 'customer');
});
document.querySelector('#back-to-site').addEventListener('click', () => setView('guest'));
document.querySelector('#admin-logout').addEventListener('click', signOut);
document.querySelector('#customer-back').addEventListener('click', () => setView('guest'));
document.querySelector('#customer-logout').addEventListener('click', signOut);
document.querySelector('#customer-refresh').addEventListener('click', refreshCustomer);
document.querySelector('#customer-browse').addEventListener('click', () => setView('guest'));
document.querySelector('#refresh-bookings').addEventListener('click', refreshAdmin);
document.querySelector('#booking-search').addEventListener('input', () => renderBookings(bookingRows));
document.querySelector('#booking-filter').addEventListener('change', () => renderBookings(bookingRows));

document.querySelector('#bookings-body').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-status-id]');
  if (!select) return;
  try {
    await api(`/api/bookings/${encodeURIComponent(select.dataset.statusId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
    showToast('Đã cập nhật trạng thái đặt phòng.');
    refreshAdmin();
  } catch (error) {
    showToast(error.message, 'error');
    refreshAdmin();
  }
});

document.querySelector('#bookings-body').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-booking-id]');
  if (editButton) {
    const booking = bookingRows.find((item) => item.id === editButton.dataset.editBookingId);
    if (booking && booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'demo_paid') openBookingEditor(booking.id);
    return;
  }
  const button = event.target.closest('[data-delete-id]');
  if (!button) return;
  const booking = bookingRows.find((item) => item.id === button.dataset.deleteId);
  if (!booking || !window.confirm(`Xóa đặt phòng của ${booking.guestName}?`)) return;
  try {
    await api(`/api/bookings/${encodeURIComponent(button.dataset.deleteId)}`, { method: 'DELETE' });
    showToast('Đã xóa đặt phòng.');
    refreshAdmin();
  } catch (error) { showToast(error.message, 'error'); }
});

document.querySelector('#customer-view').addEventListener('click', async (event) => {
  const payButton = event.target.closest('[data-pay-id]');
  if (payButton) {
    if (!window.confirm('Đây là khoản thanh toán mô phỏng. Hệ thống không trừ tiền thật. Bạn muốn ghi nhận thanh toán demo?')) return;
    payButton.disabled = true;
    try {
      const booking = await api(`/api/bookings/${encodeURIComponent(payButton.dataset.payId)}/pay`, { method: 'POST', body: '{}' });
      showToast(`Đã ghi nhận thanh toán demo ${booking.paymentReference}. Không có khoản tiền thật nào bị trừ.`);
      refreshCustomer();
    } catch (error) { payButton.disabled = false; showToast(error.message, 'error'); }
  }
  const cancelButton = event.target.closest('[data-cancel-id]');
  if (cancelButton) {
    if (!window.confirm('Hủy đặt phòng này?')) return;
    try {
      await api(`/api/bookings/${encodeURIComponent(cancelButton.dataset.cancelId)}/cancel`, { method: 'PATCH', body: '{}' });
      showToast('Đã hủy đặt phòng.');
      refreshCustomer();
      loadRooms();
    } catch (error) { showToast(error.message, 'error'); }
  }
});

document.querySelector('#inventory-grid').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-room-id]');
  if (editButton) { openRoomEditor(editButton.dataset.editRoomId); return; }
  const deleteButton = event.target.closest('[data-delete-room-id]');
  if (!deleteButton || deleteButton.disabled) return;
  const room = adminRooms.find((item) => item.id === deleteButton.dataset.deleteRoomId);
  if (!room || !window.confirm(`Xóa hạng phòng “${room.name}”?`)) return;
  try {
    await api(`/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
    showToast('Đã xóa hạng phòng.');
    await refreshAdmin();
    await loadRooms();
  } catch (error) { showToast(error.message, 'error'); }
});

document.querySelector('#create-room-button').addEventListener('click', () => openRoomEditor());
document.querySelector('#create-booking-button').addEventListener('click', () => openBookingEditor());
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.closeDialog}`).close()));
for (const editor of [document.querySelector('#room-editor-dialog'), document.querySelector('#booking-editor-dialog')]) {
  editor.addEventListener('click', (event) => { if (event.target === editor) editor.close(); });
}

document.querySelector('#room-editor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  const payload = Object.fromEntries(new FormData(form).entries());
  const id = payload.id;
  delete payload.id;
  payload.price = Number(payload.price);
  payload.totalRooms = Number(payload.totalRooms);
  payload.capacity = Number(payload.capacity);
  payload.size = Number(payload.size);
  payload.featured = form.elements.namedItem('featured').checked;
  submit.disabled = true;
  try {
    await api(id ? `/api/rooms/${encodeURIComponent(id)}` : '/api/rooms', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    document.querySelector('#room-editor-dialog').close();
    showToast(id ? 'Đã cập nhật hạng phòng.' : 'Đã thêm hạng phòng.');
    await refreshAdmin();
    await loadRooms();
  } catch (error) { showToast(error.message, 'error'); }
  finally { submit.disabled = false; }
});

document.querySelector('#booking-editor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  const payload = Object.fromEntries(new FormData(form).entries());
  const id = payload.id;
  delete payload.id;
  payload.guests = Number(payload.guests);
  submit.disabled = true;
  try {
    await api(id ? `/api/bookings/${encodeURIComponent(id)}` : '/api/admin/bookings', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    document.querySelector('#booking-editor-dialog').close();
    showToast(id ? 'Đã cập nhật đặt phòng.' : 'Đã tạo đặt phòng.');
    await refreshAdmin();
    await loadRooms();
  } catch (error) { showToast(error.message, 'error'); }
  finally { submit.disabled = false; }
});

document.querySelector('#editor-booking-room').addEventListener('change', (event) => {
  const room = adminRooms.find((item) => item.id === event.target.value);
  const guests = document.querySelector('#booking-editor-form').elements.namedItem('guests');
  guests.max = room?.capacity || 30;
  if (Number(guests.value) > Number(guests.max)) guests.value = guests.max;
});
document.querySelector('#editor-checkin').addEventListener('change', () => {
  const checkIn = document.querySelector('#editor-checkin');
  const checkOut = document.querySelector('#editor-checkout');
  const next = new Date(`${checkIn.value}T00:00:00`);
  next.setDate(next.getDate() + 1);
  checkOut.min = toDateInput(next);
  if (checkOut.value < checkOut.min) checkOut.value = checkOut.min;
});

document.querySelector('#menu-toggle').addEventListener('click', () => document.querySelector('.main-nav').classList.toggle('nav-open'));
document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => document.querySelector('.main-nav').classList.remove('nav-open')));

async function initialize() {
  setDefaultDates();
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkIn')) document.querySelector('#search-checkin').value = params.get('checkIn');
  if (params.get('checkOut')) document.querySelector('#search-checkout').value = params.get('checkOut');
  if (params.get('guests')) document.querySelector('#search-guests').value = params.get('guests');
  if (params.get('q')) document.querySelector('#search-query').value = params.get('q');
  const [, account] = await Promise.all([loadRooms(), api('/api/auth/me').catch(() => ({ user: null }))]);
  currentUser = account.user;
  updateAuthButton();
  if (params.get('auth') === 'login') openAuth('login');
  if (params.get('admin') === '1' && currentUser?.role === 'admin') setView('admin');
  const roomId = params.get('room');
  if (roomId) openBooking(roomId);
}

initialize();
