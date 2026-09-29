const { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } = require('node:crypto');
const { readDatabase, writeDatabase } = require('../model/connect');

const SESSION_COOKIE = 'may_session';
const SESSION_DAYS = 7;
const ACTIVE_STATUSES = new Set(['confirmed', 'checked_in']);
const STATUS_LABELS = {
  confirmed: 'Đã xác nhận',
  checked_in: 'Đang lưu trú',
  checked_out: 'Đã trả phòng',
  cancelled: 'Đã hủy'
};
const PAYMENT_LABELS = {
  pending: 'Chờ thanh toán demo',
  unpaid: 'Thanh toán tại khách sạn',
  demo_paid: 'Đã thanh toán · demo',
  paid: 'Đã thanh toán'
};

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) {
      const error = new Error('Nội dung gửi lên quá lớn.');
      error.status = 413;
      throw error;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const error = new Error('Dữ liệu không đúng định dạng JSON.');
    error.status = 400;
    throw error;
  }
}

function userView(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
}

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!cookie) return '';
  try { return decodeURIComponent(cookie.slice(prefix.length)); } catch { return ''; }
}

function setSessionCookie(req, res, token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  const secure = req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function digest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function currentUser(req, db) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const session = db.sessions.find((item) => item.tokenHash === digest(token) && Date.parse(item.expiresAt) > Date.now());
  return session ? db.users.find((user) => user.id === session.userId) || null : null;
}

function requireLogin(user, res) {
  if (user) return true;
  json(res, 401, { error: 'Vui lòng đăng nhập để tiếp tục.' });
  return false;
}

function requireAdmin(user, res) {
  if (!requireLogin(user, res)) return false;
  if (user.role === 'admin') return true;
  json(res, 403, { error: 'Chức năng này chỉ dành cho nhân viên quản lý.' });
  return false;
}

function createSession(req, res, db, user) {
  const token = randomBytes(32).toString('base64url');
  db.sessions = db.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now());
  db.sessions.push({
    tokenHash: digest(token), userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  });
  setSessionCookie(req, res, token);
}

function nightsBetween(checkIn, checkOut) {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function maxConcurrentBookings(bookings, roomId) {
  const events = [];
  for (const booking of bookings) {
    if (booking.roomId !== roomId || !ACTIVE_STATUSES.has(booking.status)) continue;
    events.push([booking.checkIn, 1], [booking.checkOut, -1]);
  }
  events.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  let current = 0;
  let maximum = 0;
  for (const [, change] of events) {
    current += change;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function roomsAvailable(db, room, checkIn, checkOut, ignoreBookingId) {
  const occupied = db.bookings.filter((booking) =>
    booking.roomId === room.id && booking.id !== ignoreBookingId &&
    ACTIVE_STATUSES.has(booking.status) && booking.checkIn < checkOut && booking.checkOut > checkIn
  ).length;
  return room.totalRooms - occupied;
}

function bookingView(booking, room) {
  return {
    ...booking,
    roomName: room?.name || 'Phòng đã xóa',
    statusLabel: STATUS_LABELS[booking.status] || booking.status,
    paymentStatusLabel: PAYMENT_LABELS[booking.paymentStatus] || 'Chưa cập nhật'
  };
}

function roomInput(body, current = {}) {
  const room = {
    name: String(body.name ?? current.name ?? '').trim(),
    type: String(body.type ?? current.type ?? '').trim().toLowerCase(),
    label: String(body.label ?? current.label ?? '').trim(),
    description: String(body.description ?? current.description ?? '').trim(),
    price: Number(body.price ?? current.price),
    capacity: Number(body.capacity ?? current.capacity),
    size: Number(body.size ?? current.size),
    beds: String(body.beds ?? current.beds ?? '').trim(),
    totalRooms: Number(body.totalRooms ?? current.totalRooms),
    image: String(body.image ?? current.image ?? '').trim(),
    featured: body.featured === undefined ? Boolean(current.featured) : Boolean(body.featured)
  };
  const validImage = room.image.startsWith('/') && !room.image.startsWith('//') || /^https:\/\//i.test(room.image);
  if (room.name.length < 2 || room.name.length > 80 || !/^[a-z0-9_-]{2,30}$/.test(room.type) || room.label.length < 2 || room.label.length > 48 || room.description.length < 8 || room.description.length > 300 || !Number.isSafeInteger(room.price) || room.price < 100_000 || room.price > 100_000_000 || !Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 30 || !Number.isInteger(room.size) || room.size < 10 || room.size > 500 || room.beds.length < 2 || room.beds.length > 80 || !Number.isInteger(room.totalRooms) || room.totalRooms < 1 || room.totalRooms > 500 || !validImage || room.image.length > 500) {
    const error = new Error('Vui lòng kiểm tra tên, mô tả, giá, sức chứa, diện tích, số lượng và ảnh phòng.');
    error.status = 400;
    throw error;
  }
  return room;
}

function bookingInput(db, body, ignoreBookingId = null) {
  const room = db.rooms.find((item) => item.id === body.roomId);
  const guestName = String(body.guestName || '').trim().replace(/\s+/g, ' ');
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const guests = Number(body.guests);
  const nights = nightsBetween(body.checkIn, body.checkOut);
  const paymentMethod = body.paymentMethod === 'at_property' ? 'at_property' : body.paymentMethod === 'online_demo' ? 'online_demo' : '';
  if (!room || guestName.length < 2 || guestName.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 160 || phone.replace(/\D/g, '').length < 8 || !Number.isInteger(guests) || guests < 1 || guests > room.capacity || !isIsoDate(body.checkIn) || !isIsoDate(body.checkOut) || nights < 1 || nights > 30 || !paymentMethod) {
    const error = new Error('Vui lòng kiểm tra lại thông tin khách, hạng phòng, ngày, số khách và thanh toán.');
    error.status = 400;
    throw error;
  }
  if (body.checkIn < new Date().toISOString().slice(0, 10)) {
    const error = new Error('Ngày nhận phòng cần từ hôm nay trở đi.');
    error.status = 400;
    throw error;
  }
  if (roomsAvailable(db, room, body.checkIn, body.checkOut, ignoreBookingId) < 1) {
    const error = new Error('Phòng vừa được đặt hết trong thời gian đã chọn.');
    error.status = 409;
    throw error;
  }
  return {
    room, guestName, email, phone, guests, nights,
    checkIn: body.checkIn, checkOut: body.checkOut,
    totalPrice: room.price * nights,
    note: String(body.note || '').trim().slice(0, 500),
    paymentMethod
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const db = await readDatabase();
  const user = currentUser(req, db);

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    return json(res, 200, { user: userView(user) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    if (name.length < 2 || name.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, '').length < 8 || password.length < 10 || password.length > 128) {
      return json(res, 400, { error: 'Nhập tên, email, số điện thoại hợp lệ và mật khẩu từ 10 ký tự.' });
    }
    if (db.users.some((item) => item.email.toLowerCase() === email)) return json(res, 409, { error: 'Email này đã có tài khoản. Hãy đăng nhập.' });
    const salt = randomBytes(16);
    const newUser = {
      id: randomUUID(), name, email, phone, role: 'customer',
      passwordSalt: salt.toString('hex'),
      passwordHash: scryptSync(password, salt, 64).toString('hex'),
      createdAt: new Date().toISOString()
    };
    db.users.push(newUser);
    createSession(req, res, db, newUser);
    await writeDatabase(db);
    return json(res, 201, { user: userView(newUser) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const account = db.users.find((item) => item.email.toLowerCase() === email);
    if (!account || password.length > 128) return json(res, 401, { error: 'Email hoặc mật khẩu chưa chính xác.' });
    const submitted = scryptSync(password, Buffer.from(account.passwordSalt, 'hex'), 64);
    const expected = Buffer.from(account.passwordHash, 'hex');
    if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
      return json(res, 401, { error: 'Email hoặc mật khẩu chưa chính xác.' });
    }
    createSession(req, res, db, account);
    await writeDatabase(db);
    return json(res, 200, { user: userView(account) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = cookieValue(req, SESSION_COOKIE);
    db.sessions = db.sessions.filter((session) => session.tokenHash !== digest(token));
    setSessionCookie(req, res, '', 0);
    await writeDatabase(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/rooms') {
    const { checkIn, checkOut, guests, q } = Object.fromEntries(url.searchParams);
    const needle = String(q || '').trim().toLocaleLowerCase('vi');
    const filtered = db.rooms
      .filter((room) => !needle || `${room.name} ${room.description} ${room.label} ${room.type}`.toLocaleLowerCase('vi').includes(needle))
      .map((room) => ({
        ...room,
        available: checkIn && checkOut ? roomsAvailable(db, room, checkIn, checkOut) : room.totalRooms,
        bookingCount: db.bookings.filter((booking) => booking.roomId === room.id).length,
        fitsGuests: !guests || room.capacity >= Number(guests)
      }));
    return json(res, 200, filtered);
  }

  if (req.method === 'POST' && pathname === '/api/rooms') {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const room = { id: `room-${randomUUID()}`, ...roomInput(body) };
    db.rooms.push(room);
    await writeDatabase(db);
    return json(res, 201, room);
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === 'PATCH' && roomMatch) {
    if (!requireAdmin(user, res)) return;
    const room = db.rooms.find((item) => item.id === roomMatch[1]);
    if (!room) return json(res, 404, { error: 'Không tìm thấy hạng phòng.' });
    const body = await readBody(req);
    const updated = roomInput(body, room);
    if (updated.totalRooms < maxConcurrentBookings(db.bookings, room.id)) {
      return json(res, 409, { error: 'Số phòng mới thấp hơn số phòng đã được xác nhận trong cùng thời gian.' });
    }
    Object.assign(room, updated);
    await writeDatabase(db);
    return json(res, 200, room);
  }

  if (req.method === 'DELETE' && roomMatch) {
    if (!requireAdmin(user, res)) return;
    const index = db.rooms.findIndex((item) => item.id === roomMatch[1]);
    if (index < 0) return json(res, 404, { error: 'Không tìm thấy hạng phòng.' });
    if (db.bookings.some((booking) => booking.roomId === roomMatch[1])) {
      return json(res, 409, { error: 'Không thể xóa hạng phòng đã có lịch sử đặt. Hãy giữ lại để bảo toàn hồ sơ.' });
    }
    db.rooms.splice(index, 1);
    await writeDatabase(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/bookings') {
    if (!requireLogin(user, res)) return;
    const ownBookings = user.role === 'admin' ? db.bookings : db.bookings.filter((booking) => booking.userId === user.id);
    const bookings = [...ownBookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((booking) => bookingView(booking, db.rooms.find((room) => room.id === booking.roomId)));
    return json(res, 200, bookings);
  }

  if (req.method === 'GET' && pathname === '/api/summary') {
    if (!requireAdmin(user, res)) return;
    const today = new Date().toISOString().slice(0, 10);
    const arriving = db.bookings.filter((booking) => booking.checkIn === today && ACTIVE_STATUSES.has(booking.status)).length;
    const staying = db.bookings.filter((booking) => booking.checkIn <= today && booking.checkOut > today && ACTIVE_STATUSES.has(booking.status)).length;
    const active = db.bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status)).length;
    const bookedRooms = db.bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status) && booking.checkIn <= today && booking.checkOut > today).length;
    const totalRooms = db.rooms.reduce((total, room) => total + room.totalRooms, 0);
    const revenue = db.bookings.filter((booking) => booking.paymentStatus === 'paid').reduce((sum, booking) => sum + booking.totalPrice, 0);
    return json(res, 200, { arriving, staying, active, totalRooms, occupancy: totalRooms ? Math.round(bookedRooms / totalRooms * 100) : 0, revenue });
  }

  if (req.method === 'GET' && pathname === '/api/customers') {
    if (!requireAdmin(user, res)) return;
    const needle = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase('vi');
    const customers = db.users.filter((account) => account.role === 'customer').map((account) => {
      const bookings = db.bookings.filter((booking) => booking.userId === account.id);
      return {
        id: account.id, name: account.name, email: account.email, phone: account.phone,
        createdAt: account.createdAt, bookingCount: bookings.length,
        activeBookings: bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status)).length,
        bookingValue: bookings.filter((booking) => booking.status !== 'cancelled').reduce((sum, booking) => sum + booking.totalPrice, 0),
        paidValue: bookings.filter((booking) => booking.paymentStatus === 'paid').reduce((sum, booking) => sum + booking.totalPrice, 0),
        latestBookingAt: bookings.reduce((latest, booking) => booking.createdAt > latest ? booking.createdAt : latest, '')
      };
    }).filter((account) => !needle || `${account.name} ${account.email} ${account.phone}`.toLocaleLowerCase('vi').includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(res, 200, customers);
  }

  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (req.method === 'GET' && customerMatch) {
    if (!requireAdmin(user, res)) return;
    const account = db.users.find((item) => item.id === customerMatch[1] && item.role === 'customer');
    if (!account) return json(res, 404, { error: 'Không tìm thấy khách hàng.' });
    const bookings = db.bookings.filter((booking) => booking.userId === account.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((booking) => bookingView(booking, db.rooms.find((room) => room.id === booking.roomId)));
    return json(res, 200, {
      customer: { id: account.id, name: account.name, email: account.email, phone: account.phone, role: account.role, createdAt: account.createdAt },
      bookings
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/bookings') {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const { room, ...details } = bookingInput(db, body);
    const linkedCustomer = db.users.find((account) => account.role === 'customer' && account.email.toLowerCase() === details.email);
    const booking = {
      id: randomUUID(), userId: linkedCustomer?.id || null, roomId: room.id,
      ...details, status: 'confirmed',
      paymentStatus: details.paymentMethod === 'online_demo' ? 'pending' : 'unpaid',
      createdAt: new Date().toISOString()
    };
    db.bookings.push(booking);
    await writeDatabase(db);
    return json(res, 201, bookingView(booking, room));
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    if (!requireLogin(user, res)) return;
    const body = await readBody(req);
    const { room, ...details } = bookingInput(db, {
      ...body, guestName: user.name, email: user.email, phone: user.phone
    });
    const booking = {
      id: randomUUID(), userId: user.id, roomId: room.id, ...details,
      status: 'confirmed',
      paymentStatus: details.paymentMethod === 'online_demo' ? 'pending' : 'unpaid',
      createdAt: new Date().toISOString()
    };
    db.bookings.push(booking);
    await writeDatabase(db);
    return json(res, 201, bookingView(booking, room));
  }

  const bookingEditMatch = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (req.method === 'PATCH' && bookingEditMatch) {
    if (!requireAdmin(user, res)) return;
    const booking = db.bookings.find((item) => item.id === bookingEditMatch[1]);
    if (!booking) return json(res, 404, { error: 'Không tìm thấy đặt phòng.' });
    if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'demo_paid') {
      return json(res, 409, { error: 'Đặt phòng đã thanh toán nên không thể sửa thông tin. Hãy liên hệ khách để xử lý riêng.' });
    }
    const body = await readBody(req);
    const { room, ...details } = bookingInput(db, body, booking.id);
    const linkedCustomer = db.users.find((account) => account.role === 'customer' && account.email.toLowerCase() === details.email);
    Object.assign(booking, details, {
      userId: linkedCustomer?.id || null,
      roomId: room.id,
      paymentStatus: details.paymentMethod === 'online_demo' ? 'pending' : 'unpaid'
    });
    await writeDatabase(db);
    return json(res, 200, bookingView(booking, room));
  }

  const payMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/pay$/);
  if (req.method === 'POST' && payMatch) {
    if (!requireLogin(user, res)) return;
    const booking = db.bookings.find((item) => item.id === payMatch[1] && (user.role === 'admin' || item.userId === user.id));
    if (!booking) return json(res, 404, { error: 'Không tìm thấy đặt phòng của tài khoản này.' });
    if (booking.status === 'cancelled') return json(res, 409, { error: 'Đặt phòng đã hủy, không thể thanh toán.' });
    if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'demo_paid') return json(res, 409, { error: 'Đặt phòng này đã được ghi nhận thanh toán.' });
    if (booking.paymentMethod !== 'online_demo') return json(res, 400, { error: 'Đặt phòng này được chọn thanh toán tại khách sạn.' });
    booking.paymentStatus = 'demo_paid';
    booking.demoPaidAt = new Date().toISOString();
    booking.paymentReference = `DEMO-${randomBytes(5).toString('hex').toUpperCase()}`;
    await writeDatabase(db);
    return json(res, 200, bookingView(booking, db.rooms.find((room) => room.id === booking.roomId)));
  }

  const cancelMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
  if (req.method === 'PATCH' && cancelMatch) {
    if (!requireLogin(user, res)) return;
    const booking = db.bookings.find((item) => item.id === cancelMatch[1] && item.userId === user.id);
    if (!booking) return json(res, 404, { error: 'Không tìm thấy đặt phòng của tài khoản này.' });
    if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'demo_paid') return json(res, 409, { error: 'Đặt phòng đã thanh toán. Vui lòng liên hệ lễ tân để được hỗ trợ.' });
    if (booking.status === 'checked_in' || booking.status === 'checked_out' || booking.checkIn <= new Date().toISOString().slice(0, 10)) {
      return json(res, 409, { error: 'Đặt phòng đã bắt đầu hoặc hoàn tất, không thể tự hủy.' });
    }
    booking.status = 'cancelled';
    await writeDatabase(db);
    return json(res, 200, bookingView(booking, db.rooms.find((room) => room.id === booking.roomId)));
  }

  const statusMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/status$/);
  if (req.method === 'PATCH' && statusMatch) {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const booking = db.bookings.find((item) => item.id === statusMatch[1]);
    if (!booking) return json(res, 404, { error: 'Không tìm thấy đặt phòng.' });
    if (!Object.hasOwn(STATUS_LABELS, body.status)) return json(res, 400, { error: 'Trạng thái không hợp lệ.' });
    if (body.status === 'confirmed') {
      const room = db.rooms.find((item) => item.id === booking.roomId);
      if (!room || roomsAvailable(db, room, booking.checkIn, booking.checkOut, booking.id) < 1) {
        return json(res, 409, { error: 'Phòng không còn trống để xác nhận đặt phòng này.' });
      }
    }
    booking.status = body.status;
    await writeDatabase(db);
    return json(res, 200, bookingView(booking, db.rooms.find((room) => room.id === booking.roomId)));
  }

  const bookingMatch = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (req.method === 'DELETE' && bookingMatch) {
    if (!requireAdmin(user, res)) return;
    const index = db.bookings.findIndex((item) => item.id === bookingMatch[1]);
    if (index < 0) return json(res, 404, { error: 'Không tìm thấy đặt phòng.' });
    db.bookings.splice(index, 1);
    await writeDatabase(db);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Không tìm thấy API.' });
}

module.exports = { handleApi };
