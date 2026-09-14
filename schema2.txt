CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'cashier', 'superadmin')) NOT NULL DEFAULT 'cashier',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lrn TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    total_bill REAL DEFAULT 10000.0,
    running_balance REAL DEFAULT 10000.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    month_name TEXT NOT NULL,
    amount REAL DEFAULT 1000.0,
    status TEXT CHECK(status IN ('unpaid', 'paid')) DEFAULT 'unpaid',
    paid_date DATETIME,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    cashier_id INTEGER,
    amount_paid REAL NOT NULL,
    new_balance REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (cashier_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT
);