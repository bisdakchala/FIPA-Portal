const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database opening error: ' + err.message);
    else console.log('Connected to SQLite database.');
});

function logActivity(userId, username, action, details) {
    db.run(`INSERT INTO activity_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)`,
        [userId || null, username || 'SYSTEM', action, details], function(err) {
            if (!err) {
                io.emit('refresh_logs');
            }
        });
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lrn TEXT UNIQUE,
        first_name TEXT,
        middle_name TEXT,
        last_name TEXT,
        portal_pin TEXT DEFAULT '1234',
        total_bill REAL,
        running_balance REAL
    )`, () => {
        db.run(`ALTER TABLE students ADD COLUMN first_name TEXT`, (err) => {});
        db.run(`ALTER TABLE students ADD COLUMN middle_name TEXT`, (err) => {});
        db.run(`ALTER TABLE students ADD COLUMN last_name TEXT`, (err) => {});
        db.run(`ALTER TABLE students ADD COLUMN portal_pin TEXT DEFAULT '1234'`, (err) => {});
    });

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        or_number TEXT UNIQUE,
        student_id INTEGER,
        cashier_id INTEGER,
        amount_paid REAL,
        new_balance REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(cashier_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        month_name TEXT,
        amount REAL,
        status TEXT DEFAULT 'unpaid',
        paid_date TEXT,
        transaction_id INTEGER,
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(transaction_id) REFERENCES transactions(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
        logActivity(null, 'SYSTEM', 'SYSTEM_START', 'Server initialized and running successfully.');
    });

    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('school_name', 'FIPA Academy')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('starting_month', 'August')`);
    db.run(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'admin123', 'superadmin')`);
});

function getMonthsList(startMonth) {
    const standardMonths = ['June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'May'];
    let startIndex = standardMonths.indexOf(startMonth);
    if (startIndex === -1) startIndex = standardMonths.indexOf('August');
    
    let list = [];
    for (let i = 0; i < 10; i++) {
        list.push(standardMonths[(startIndex + i) % standardMonths.length]);
    }
    return list;
}

app.get('/api/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

app.put('/api/settings', (req, res) => {
    const { school_name, starting_month } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('school_name', ?)`, [school_name]);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('starting_month', ?)`, [starting_month], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(null, 'ADMIN', 'SETTINGS_UPDATED', `School name updated to "${school_name}", starting month to "${starting_month}".`);
        res.json({ success: true });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password_hash = ?`, [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) {
            logActivity(null, username, 'LOGIN_FAILED', 'Failed login attempt with invalid credentials.');
            return res.json({ success: false, error: 'Invalid username or password' });
        }
        logActivity(user.id, user.username, 'LOGIN_SUCCESS', `User ${user.username} logged into the system.`);
        res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
    });
});

app.get('/api/users', (req, res) => {
    db.all(`SELECT id, username, role, created_at FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: rows });
    });
});

app.post('/api/users', (req, res) => {
    const { username, password_hash, role } = req.body;
    db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, [username, password_hash, role || 'cashier'], function(err) {
        if (err) return res.status(400).json({ success: false, error: err.message });
        logActivity(null, 'ADMIN', 'USER_CREATED', `Created new user account "${username}" with role "${role || 'cashier'}".`);
        res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/users/:id', (req, res) => {
    db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        logActivity(null, 'ADMIN', 'USER_DELETED', `Deleted user account ID ${req.params.id}.`);
        res.json({ success: true });
    });
});

app.get('/api/students', (req, res) => {
    db.all(`SELECT * FROM students ORDER BY last_name ASC, first_name ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/students', (req, res) => {
    const { lrn, first_name, middle_name, last_name, portal_pin, user_id } = req.body;
    const pin = portal_pin || lrn.slice(-4);
    const fullName = `${last_name}, ${first_name}${middle_name ? ' ' + middle_name : ''}`;
    
    db.get(`SELECT username FROM users WHERE id = ?`, [user_id], (err, userRow) => {
        const username = userRow ? userRow.username : 'SYSTEM';

        db.get(`SELECT value FROM settings WHERE key = 'starting_month'`, [], (err, row) => {
            const startMonth = row ? row.value : 'August';
            const months = getMonthsList(startMonth);
            const monthlyFee = 1000.00;
            const totalBill = months.length * monthlyFee;

            db.run(`INSERT INTO students (lrn, first_name, middle_name, last_name, portal_pin, total_bill, running_balance) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [lrn, first_name, middle_name || '', last_name, pin, totalBill, totalBill], function(err) {
                if (err) return res.status(400).json({ success: false, error: err.message });
                
                const studentId = this.lastID;
                const stmt = db.prepare(`INSERT INTO bills (student_id, month_name, amount, status) VALUES (?, ?, ?, 'unpaid')`);
                months.forEach(m => {
                    stmt.run(studentId, m, monthlyFee);
                });
                stmt.finalize(() => {
                    logActivity(user_id || null, username, 'STUDENT_REGISTERED', `Registered student "${fullName}" (LRN: ${lrn}).`);
                    res.json({ success: true, student_id: studentId, portal_pin: pin });
                });
            });
        });
    });
});

app.put('/api/students/:id/pin', (req, res) => {
    const { portal_pin } = req.body;
    if (!portal_pin) return res.status(400).json({ success: false, error: 'PIN cannot be empty.' });

    db.run(`UPDATE students SET portal_pin = ? WHERE id = ?`, [portal_pin, req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        logActivity(null, 'STAFF', 'PIN_UPDATED', `Updated Portal PIN for student ID ${req.params.id}.`);
        res.json({ success: true });
    });
});

app.get('/api/students/:id', (req, res) => {
    const studentId = req.params.id;
    db.get(`SELECT * FROM students WHERE id = ?`, [studentId], (err, student) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!student) return res.status(404).json({ error: 'Student not found' });

        db.all(`SELECT * FROM bills WHERE student_id = ?`, [studentId], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ student, bills });
        });
    });
});

const portalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5,
    message: { error: 'Too many lookup attempts. Please try again after 15 minutes.' }
});

app.get('/api/portal/lookup', portalLimiter, (req, res) => {
    const { lrn, pin } = req.query;
    if (!lrn || !pin) return res.status(400).json({ error: 'Both LRN and Portal PIN are required.' });

    db.get(`SELECT * FROM students WHERE lrn = ? AND portal_pin = ?`, [lrn, pin], (err, student) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!student) {
            logActivity(null, 'PORTAL', 'PORTAL_LOGIN_FAILED', `Failed portal lookup attempt for LRN: ${lrn}`);
            return res.status(404).json({ error: 'Invalid LRN or Portal PIN.' });
        }

        db.all(`SELECT month_name, amount, status, paid_date FROM bills WHERE student_id = ?`, [student.id], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            logActivity(null, 'PORTAL', 'PORTAL_LOGIN_SUCCESS', `Successful portal balance check for LRN: ${lrn}`);
            res.json({ student, bills });
        });
    });
});

app.get('/api/reports', (req, res) => {
    const { period, cashier_id } = req.query;
    let query = `SELECT t.*, u.username, (s.last_name || ', ' || s.first_name) as student_name FROM transactions t LEFT JOIN users u ON t.cashier_id = u.id LEFT JOIN students s ON t.student_id = s.id WHERE 1=1`;
    let params = [];

    if (period === 'daily') {
        query += ` AND date(t.timestamp) = date('now')`;
    } else if (period === 'weekly') {
        query += ` AND strftime('%Y-%W', t.timestamp) = strftime('%Y-%W', 'now')`;
    } else if (period === 'monthly') {
        query += ` AND strftime('%Y-%m', t.timestamp) = strftime('%Y-%m', 'now')`;
    }

    if (cashier_id && cashier_id !== 'all') {
        query += ` AND t.cashier_id = ?`;
        params.push(cashier_id);
    }

    query += ` ORDER BY t.timestamp DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

app.post('/api/payments', (req, res) => {
    const { student_id, cashier_id, bill_ids, amount_paid } = req.body;
    if (!bill_ids || bill_ids.length === 0) return res.status(400).json({ success: false, error: 'No bills selected.' });

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const currentYear = new Date().getFullYear();
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

        db.get(`SELECT running_balance, first_name, last_name, middle_name FROM students WHERE id = ?`, [student_id], (err, row) => {
            if (err || !row) {
                db.run('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Student not found.' });
            }

            const fullName = `${row.last_name}, ${row.first_name}${row.middle_name ? ' ' + row.middle_name : ''}`;
            const newBalance = Math.max(0, row.running_balance - amount_paid);

            db.run(`INSERT INTO transactions (or_number, student_id, cashier_id, amount_paid, new_balance, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
                ['PENDING', student_id, cashier_id, amount_paid, newBalance, timestamp], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ success: false, error: err.message });
                }

                const transactionId = this.lastID;
                const orNumber = `${currentYear}-${String(transactionId).padStart(6, '0')}`;

                db.run(`UPDATE transactions SET or_number = ? WHERE id = ?`, [orNumber, transactionId], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ success: false, error: err.message });
                    }

                    const placeholders = bill_ids.map(() => '?').join(',');
                    
                    db.run(`UPDATE bills SET status = 'paid', paid_date = ?, transaction_id = ? WHERE id IN (${placeholders})`,
                        [timestamp, transactionId, ...bill_ids], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ success: false, error: err.message });
                        }

                        db.run(`UPDATE students SET running_balance = ? WHERE id = ?`, [newBalance, student_id], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ success: false, error: err.message });
                            }

                            db.run('COMMIT');
                            db.get(`SELECT username FROM users WHERE id = ?`, [cashier_id], (err, cashierRow) => {
                                const cashierName = cashierRow ? cashierRow.username : 'CASHIER';
                                logActivity(cashier_id, cashierName, 'PAYMENT_PROCESSED', `Processed payment OR: ${orNumber} amounting to ₱${amount_paid} for student "${fullName}".`);
                                io.emit('refresh_reports');
                                res.json({ success: true, or_number: orNumber, new_balance: newBalance });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/transactions', (req, res) => {
    db.all(`
        SELECT t.*, (s.last_name || ', ' || s.first_name) as student_name, s.lrn, u.username as cashier_name
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        JOIN users u ON t.cashier_id = u.id
        ORDER BY t.id DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/transactions/:id/receipt', (req, res) => {
    const txId = req.params.id;
    db.get(`
        SELECT t.*, u.username as cashier_name, (s.last_name || ', ' || s.first_name) as student_name, s.lrn
        FROM transactions t
        JOIN users u ON t.cashier_id = u.id
        JOIN students s ON t.student_id = s.id
        WHERE t.id = ?
    `, [txId], (err, transaction) => {
        if (err || !transaction) return res.status(404).json({ error: 'Transaction not found' });

        db.all(`SELECT month_name, amount FROM bills WHERE transaction_id = ?`, [txId], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ transaction, bills });
        });
    });
});

app.get('/api/reports/daily', (req, res) => {
    const dateFilter = req.query.date || new Date().toISOString().split('T')[0];
    db.all(`
        SELECT t.id, t.or_number, t.amount_paid, t.timestamp, u.username as cashier_name, (s.last_name || ', ' || s.first_name) as student_name, s.lrn
        FROM transactions t
        JOIN users u ON t.cashier_id = u.id
        JOIN students s ON t.student_id = s.id
        WHERE DATE(t.timestamp) = DATE(?)
    `, [dateFilter], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const totalCollected = rows.reduce((sum, r) => sum + r.amount_paid, 0);
        res.json({ date: dateFilter, total_collected: totalCollected, transaction_count: rows.length, transactions: rows });
    });
});

app.get('/api/logs', (req, res) => {
    db.all(`SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('new_report', (data) => {
        const { cashier_id, total_sales } = data;
        db.run(`INSERT INTO transactions (or_number, student_id, cashier_id, amount_paid, new_balance) VALUES (?, NULL, ?, ?, 0)`, 
            [`SIM-${Date.now().toString().slice(-6)}`, cashier_id, total_sales], function(err) {
            if (!err) {
                io.emit('refresh_reports');
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});