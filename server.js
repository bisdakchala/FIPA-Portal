const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database initialization
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Database error:', err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_name TEXT,
        starting_month TEXT
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
        portal_pin TEXT,
        total_bill REAL DEFAULT 0,
        running_balance REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        month_name TEXT,
        amount REAL,
        status TEXT DEFAULT 'unpaid',
        paid_date TEXT,
        transaction_id INTEGER,
        FOREIGN KEY(student_id) REFERENCES students(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        or_number TEXT,
        student_id INTEGER,
        cashier_id INTEGER,
        amount_paid REAL,
        new_balance REAL,
        timestamp TEXT,
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(cashier_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Seed default settings and superadmin if empty
    db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO settings (school_name, starting_month) VALUES ('FIPA Academy', 'August')`);
        }
    });

    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO users (username, password_hash, role) VALUES ('admin', 'admin123', 'superadmin')`);
        }
    });
});

// Helper function for logging activity
function logActivity(userId, action, details) {
    db.run(`INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)`, [userId, action, details]);
}

// Frontend Gateway & Standalone Page Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/staff', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'staff.html'));
});

app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// API: Settings
app.get('/api/settings', (req, res) => {
    db.get("SELECT * FROM settings LIMIT 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { school_name: "FIPA Academy", starting_month: "August" });
    });
});

app.put('/api/settings', (req, res) => {
    const { school_name, starting_month } = req.body;
    db.run(`UPDATE settings SET school_name = ?, starting_month = ? WHERE id = 1`, [school_name, starting_month], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(null, 'UPDATE_SETTINGS', `Updated school settings to ${school_name}`);
        res.json({ success: true });
    });
});

// API: Authentication
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password_hash = ?`, [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.json({ success: false, error: 'Invalid username or password' });
        logActivity(user.id, 'LOGIN', `User ${username} logged in successfully`);
        res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
    });
});

// API: Students
app.get('/api/students', (req, res) => {
    db.all(`SELECT * FROM students ORDER BY last_name ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/students', (req, res) => {
    const { lrn, first_name, middle_name, last_name, portal_pin, user_id } = req.body;
    const pin = portal_pin || Math.floor(1000 + Math.random() * 9000).toString();
    const defaultMonthlyFee = 500.00;

    db.get("SELECT starting_month FROM settings LIMIT 1", [], (err, settings) => {
        const startMonth = settings ? settings.starting_month : 'August';
        
        db.run(`INSERT INTO students (lrn, first_name, middle_name, last_name, portal_pin, total_bill, running_balance) VALUES (?, ?, ?, ?, ?, 0, 0)`,
            [lrn, first_name, middle_name || '', last_name, pin], function(err) {
            if (err) return res.status(500).json({ error: 'LRN may already exist.' });
            
            const studentId = this.lastID;
            const months = ['June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
            
            let startIndex = months.indexOf(startMonth);
            if (startIndex === -1) startIndex = 2;
            let orderedMonths = [...months.slice(startIndex), ...months.slice(0, startIndex)];

            let totalBill = 0;
            const stmt = db.prepare(`INSERT INTO bills (student_id, month_name, amount, status) VALUES (?, ?, ?, 'unpaid')`);
            orderedMonths.forEach(m => {
                stmt.run(studentId, m, defaultMonthlyFee);
                totalBill += defaultMonthlyFee;
            });
            stmt.finalize();

            db.run(`UPDATE students SET total_bill = ?, running_balance = ? WHERE id = ?`, [totalBill, totalBill, studentId], () => {
                logActivity(user_id, 'REGISTER_STUDENT', `Registered student ${last_name}, ${first_name} (LRN: ${lrn})`);
                res.json({ success: true, portal_pin: pin });
            });
        });
    });
});

app.get('/api/students/:id', (req, res) => {
    const studentId = req.params.id;
    db.get(`SELECT * FROM students WHERE id = ?`, [studentId], (err, student) => {
        if (err || !student) return res.status(404).json({ error: 'Student not found' });
        db.all(`SELECT * FROM bills WHERE student_id = ? ORDER BY id ASC`, [studentId], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ student, bills });
        });
    });
});

app.put('/api/students/:id/pin', (req, res) => {
    const studentId = req.params.id;
    const { portal_pin } = req.body;
    db.run(`UPDATE students SET portal_pin = ? WHERE id = ?`, [portal_pin, studentId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(null, 'UPDATE_PIN', `Updated portal PIN for student ID ${studentId}`);
        res.json({ success: true });
    });
});

// API: Payments
app.post('/api/payments', (req, res) => {
    const { student_id, cashier_id, bill_ids, amount_paid } = req.body;
    if (!bill_ids || bill_ids.length === 0) return res.status(400).json({ error: 'No bills selected' });

    const orNumber = 'OR-' + Date.now().toString().slice(-8);
    const timestamp = new Date().toLocaleString();

    db.serialize(() => {
        db.run(`BEGIN TRANSACTION`);

        db.run(`INSERT INTO transactions (or_number, student_id, cashier_id, amount_paid, new_balance, timestamp) VALUES (?, ?, ?, ?, 0, ?)`,
            [orNumber, student_id, cashier_id, amount_paid, timestamp], function(err) {
            if (err) {
                db.run(`ROLLBACK`);
                return res.status(500).json({ error: err.message });
            }
            const txId = this.lastID;

            const placeholders = bill_ids.map(() => '?').join(',');
            db.run(`UPDATE bills SET status = 'paid', paid_date = ?, transaction_id = ? WHERE id IN (${placeholders})`,
                [timestamp, txId, ...bill_ids], (err) => {
                if (err) {
                    db.run(`ROLLBACK`);
                    return res.status(500).json({ error: err.message });
                }

                db.get(`SELECT SUM(amount) as remaining FROM bills WHERE student_id = ? AND status = 'unpaid'`, [student_id], (err, row) => {
                    const newBalance = row && row.remaining ? row.remaining : 0;
                    db.run(`UPDATE students SET running_balance = ? WHERE id = ?`, [newBalance, student_id], (err) => {
                        if (err) {
                            db.run(`ROLLBACK`);
                            return res.status(500).json({ error: err.message });
                        }
                        db.run(`UPDATE transactions SET new_balance = ? WHERE id = ?`, [newBalance, txId], (err) => {
                            if (err) {
                                db.run(`ROLLBACK`);
                                return res.status(500).json({ error: err.message });
                            }
                            db.run(`COMMIT`);
                            logActivity(cashier_id, 'PROCESS_PAYMENT', `Processed payment of AED ${amount_paid} for student ID ${student_id} (OR: ${orNumber})`);
                            res.json({ success: true, or_number: orNumber, new_balance: newBalance });
                        });
                    });
                });
            });
        });
    });
});

// API: Transactions & Receipts
app.get('/api/transactions', (req, res) => {
    const query = `
        SELECT t.*, s.first_name || ' ' || s.last_name as student_name, s.lrn, u.username as cashier_name 
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        JOIN users u ON t.cashier_id = u.id
        ORDER BY t.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/transactions/:id/receipt', (req, res) => {
    const txId = req.params.id;
    const txQuery = `
        SELECT t.*, s.first_name || ' ' || s.last_name as student_name, s.lrn, u.username as cashier_name 
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        JOIN users u ON t.cashier_id = u.id
        WHERE t.id = ?
    `;
    db.get(txQuery, [txId], (err, transaction) => {
        if (err || !transaction) return res.status(404).json({ error: 'Transaction not found' });
        db.all(`SELECT * FROM bills WHERE transaction_id = ?`, [txId], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ transaction, bills });
        });
    });
});

// API: Reports
app.get('/api/reports', (req, res) => {
    const { cashier_id } = req.query;
    let query = `
        SELECT t.*, s.first_name || ' ' || s.last_name as student_name, s.lrn, u.username as cashier_name 
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        JOIN users u ON t.cashier_id = u.id
        WHERE 1=1
    `;
    let params = [];

    if (cashier_id && cashier_id !== 'all') {
        query += ` AND t.cashier_id = ?`;
        params.push(cashier_id);
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let totalCollected = rows.reduce((sum, r) => sum + r.amount_paid, 0);
        res.json({ total_collected: totalCollected, transaction_count: rows.length, transactions: rows });
    });
});

// API: Audit Activity Logs
app.get('/api/logs', (req, res) => {
    const query = `
        SELECT l.*, COALESCE(u.username, 'System') as username 
        FROM activity_logs l
        LEFT JOIN users u ON l.user_id = u.id
        ORDER BY l.id DESC LIMIT 100
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: User Management
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, username, role, created_at FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    const { username, password_hash, role } = req.body;
    db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, [username, password_hash, role], function(err) {
        if (err) return res.status(500).json({ error: 'Username already exists.' });
        logActivity(null, 'CREATE_USER', `Created user account ${username} (${role})`);
        res.json({ success: true });
    });
});

app.delete('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(null, 'DELETE_USER', `Deleted user account ID ${userId}`);
        res.json({ success: true });
    });
});

// API: Parent/Student Portal Lookup
app.get('/api/portal/lookup', (req, res) => {
    const { lrn, pin } = req.query;
    db.get(`SELECT * FROM students WHERE lrn = ? AND portal_pin = ?`, [lrn, pin], (err, student) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!student) return res.json({ error: 'Invalid LRN or Portal PIN. Please try again.' });

        db.all(`SELECT * FROM bills WHERE student_id = ? ORDER BY id ASC`, [student.id], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ student, bills });
        });
    });
});

app.listen(PORT, () => {
    console.log(`FIPA Academy system running on http://localhost:${PORT}`);
});