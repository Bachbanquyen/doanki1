const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
let customers = [];
const tableBody = document.querySelector('#customers-body');
const detailDialog = document.querySelector('#customer-detail-dialog');

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

async function api(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể tải dữ liệu.');
  return data;
}

function renderCustomers() {
  const query = document.querySelector('#customers-query').value.trim().toLocaleLowerCase('vi');
  const visible = customers.filter((customer) => `${customer.name} ${customer.email} ${customer.phone}`.toLocaleLowerCase('vi').includes(query));
  document.querySelector('#customer-result-count').textContent = `${visible.length} khách hàng`;
  document.querySelector('#customers-empty').hidden = visible.length > 0;
  tableBody.innerHTML = visible.map((customer) => `
    <tr>
      <td><strong class="customer-name-cell">${safe(customer.name)}</strong><span class="customer-id-cell">${safe(customer.id.slice(0, 8).toUpperCase())}</span></td>
      <td><a class="customer-contact-link" href="mailto:${safe(customer.email)}">${safe(customer.email)}</a><a class="customer-contact-link customer-phone-link" href="tel:${safe(customer.phone)}">${safe(customer.phone)}</a></td>
      <td>${formatDate(customer.createdAt)}</td>
      <td>${customer.bookingCount}</td>
      <td><span class="customer-active-count">${customer.activeBookings}</span></td>
      <td class="table-price">${money.format(customer.bookingValue)}</td>
      <td><button class="customer-detail-button" type="button" data-customer-id="${safe(customer.id)}">Xem hồ sơ <span>↗</span></button></td>
    </tr>`).join('');
}

async function loadCustomers() {
  try {
    customers = await api('/api/customers');
    document.querySelector('#customer-total').textContent = customers.length;
    document.querySelector('#customer-with-bookings').textContent = customers.filter((customer) => customer.bookingCount > 0).length;
    document.querySelector('#customer-active-bookings').textContent = customers.reduce((total, customer) => total + customer.activeBookings, 0);
    document.querySelector('#customers-updated').textContent = `Cập nhật ${new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    renderCustomers();
  } catch (error) {
    document.querySelector('#customers-page').hidden = true;
    document.querySelector('#customers-denied').hidden = false;
    document.querySelector('#customers-denied p').textContent = error.message.includes('nhân viên') ? error.message : 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại bằng tài khoản quản trị.';
  }
}

async function showCustomer(customerId) {
  try {
    const { customer, bookings } = await api(`/api/customers/${encodeURIComponent(customerId)}`);
    document.querySelector('#detail-name').textContent = customer.name;
    document.querySelector('#detail-id').textContent = `KHÁCH HÀNG · ${customer.id.slice(0, 8).toUpperCase()} · THAM GIA ${formatDate(customer.createdAt)}`;
    const email = document.querySelector('#detail-email');
    email.textContent = customer.email;
    email.href = `mailto:${customer.email}`;
    const phone = document.querySelector('#detail-phone');
    phone.textContent = customer.phone;
    phone.href = `tel:${customer.phone}`;
    document.querySelector('#detail-booking-count').textContent = `${bookings.length} lần`;
    document.querySelector('#detail-no-bookings').hidden = bookings.length > 0;
    document.querySelector('#detail-booking-list').innerHTML = bookings.map((booking) => `
      <article class="customer-booking-detail"><div><strong>${safe(booking.roomName)}</strong><span>${formatDate(booking.checkIn)} → ${formatDate(booking.checkOut)} · ${booking.nights} đêm · ${booking.guests} khách</span></div><div><span class="status-select status-${safe(booking.status)}">${safe(booking.statusLabel)}</span><strong>${money.format(booking.totalPrice)}</strong></div><small>${safe(booking.paymentStatusLabel)}</small></article>`).join('');
    detailDialog.showModal();
  } catch (error) {
    window.alert(error.message);
  }
}

document.querySelector('#customers-query').addEventListener('input', renderCustomers);
document.querySelector('#customers-refresh').addEventListener('click', loadCustomers);
tableBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-customer-id]');
  if (button) showCustomer(button.dataset.customerId);
});
document.querySelector('#customer-detail-close').addEventListener('click', () => detailDialog.close());
detailDialog.addEventListener('click', (event) => { if (event.target === detailDialog) detailDialog.close(); });

async function initialize() {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) {
      location.replace('/?auth=login&return=%2Fcustomers');
      return;
    }
    if (user.role !== 'admin') {
      document.querySelector('#customers-page').hidden = true;
      document.querySelector('#customers-denied').hidden = false;
      return;
    }
    await loadCustomers();
  } catch {
    location.replace('/?auth=login&return=%2Fcustomers');
  }
}

initialize();
