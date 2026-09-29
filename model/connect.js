const fs = require('node:fs/promises');
const path = require('node:path');
const { scryptSync } = require('node:crypto');

const DATA_FILE = path.join(__dirname, 'hotel-data.json');

const seed = {
  rooms: [
    {
      id: 'room-01', name: 'Phòng Garden', type: 'garden', label: 'VƯỜN NHIỆT ĐỚI',
      description: 'Khoảng trời riêng giữa khu vườn xanh mát.', price: 1850000,
      capacity: 2, size: 32, beds: '1 giường đôi', totalRooms: 8,
      image: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=85',
      featured: false
    },
    {
      id: 'room-02', name: 'Phòng Ocean', type: 'ocean', label: 'HƯỚNG BIỂN',
      description: 'Đón bình minh trên biển ngay từ giường ngủ.', price: 2650000,
      capacity: 2, size: 42, beds: '1 giường king', totalRooms: 6,
      image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=85',
      featured: true
    },
    {
      id: 'room-03', name: 'Biệt thự Mây', type: 'villa', label: 'HỒ BƠI RIÊNG',
      description: 'Không gian biệt lập dành cho những ngày thật chậm.', price: 4950000,
      capacity: 4, size: 86, beds: '2 giường king', totalRooms: 3,
      image: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85',
      featured: false
    }
  ],
  bookings: [],
  users: [],
  sessions: []
};

const adminSalt = '6d61792d726574726561742d64656d6f';
const demoAdmin = {
  id: 'user-demo-admin', email: 'admin@mayretreat.vn', name: 'Quản trị Mây',
  phone: '0900000000', role: 'admin', passwordSalt: adminSalt,
  passwordHash: scryptSync('MayRetreat2026!', Buffer.from(adminSalt, 'hex'), 64).toString('hex'),
  createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString()
};

let writeQueue = Promise.resolve();

async function connect() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
  const database = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  let changed = false;
  for (const key of ['rooms', 'bookings', 'users', 'sessions']) {
    if (!Array.isArray(database[key])) {
      database[key] = seed[key];
      changed = true;
    }
  }
  for (const booking of database.bookings) {
    if (!booking.paymentStatus) { booking.paymentStatus = 'unpaid'; changed = true; }
    if (!booking.paymentMethod) { booking.paymentMethod = 'at_property'; changed = true; }
  }
  if (!database.users.some((user) => user.role === 'admin')) {
    database.users.push(demoAdmin);
    changed = true;
  }
  if (changed) await fs.writeFile(DATA_FILE, JSON.stringify(database, null, 2), 'utf8');
  return DATA_FILE;
}

async function readDatabase() {
  await connect();
  return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}

function writeDatabase(database) {
  writeQueue = writeQueue.then(async () => {
    await connect();
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(database, null, 2), 'utf8');
    await fs.rename(tempFile, DATA_FILE);
  });
  return writeQueue;
}

module.exports = { connect, readDatabase, writeDatabase };
