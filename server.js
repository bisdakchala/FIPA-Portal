const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// Initialize Database
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        // Settings Table
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Seed default settings if empty
        db.get(`SELECT COUNT(*) as count FROM settings`, (err, row) => {
            if (row && row.count === 0) {
                db.run(`INSERT INTO settings (key, value) VALUES ('school_name', 'FIPA School')`);
                db.run(`INSERT INTO settings (key, value) VALUES ('starting_month', 'June')`);
            }
        });

        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT,
            created_at TEXT
        )`);

        // Seed default admin if table is empty
        db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
            if (row && row.count === 0) {
                const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
                db.run(`INSERT OR IGNORE INTO users (username, password_hash, role, created_at) VALUES ('admin', 'admin123', 'superadmin', ?)`, [now]);
            }
        });

        // Students Table
        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lrn TEXT UNIQUE,
            name TEXT,
            total_bill REAL,
            running_balance REAL
        )`);

        // Bills Table
        db.run(`CREATE TABLE IF NOT EXISTS bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            month_name TEXT,
            amount REAL,
            status TEXT,
            paid_date TEXT,
            transaction_id INTEGER,
            FOREIGN KEY(student_id) REFERENCES students(id)
        )`);

        // Transactions Table
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
    });
}

// Helper function to generate 10-month billing schedule
function generateBills(studentId, startingMonth, callback) {
    const defaultMonthsJune = ['June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
    const defaultMonthsAug = ['August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'May'];
    const defaultMonthsJan = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];

    let months = defaultMonthsJune;
    if (startingMonth === 'August') months = defaultMonthsAug;
    if (startingMonth === 'January') months = defaultMonthsJan;

    const monthlyFee = 1000.00;
    const totalBill = monthlyFee * months.length;

    const stmt = db.prepare(`INSERT INTO bills (student_id, month_name, amount, status) VALUES (?, ?, ?, 'unpaid')`);
    months.forEach(m => {
        stmt.run(studentId, m, monthlyFee);
    });
    stmt.finalize((err) => {
        if (err) return callback(err);
        db.run(`UPDATE students SET total_bill = ?, running_balance = ? WHERE id = ?`, [totalBill, totalBill, studentId], callback);
    });
}

// API Routes

// Settings
app.get('/api/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

app.put('/api/settings', (req, res) => {
    const { school_name, starting_month } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('school_name', ?)`, [school_name]);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('starting_month', ?)`, [starting_month], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password_hash = ?`, [username, password], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (row) {
            res.json({ success: true, user: { id: row.id, username: row.username, role: row.role } });
        } else {
            res.json({ success: false, error: 'Invalid username or password.' });
        }
    });
});

// Users Management
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, username, role, created_at FROM users`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    const { username, password_hash, role } = req.body;
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (row) {
            return res.json({ success: false, error: 'Username already exists. Please choose a different username.' });
        }

        db.run(
            `INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)`,
            [username, password_hash, role || 'cashier', now],
            function(err) {
                if (err) return res.json({ success: false, error: err.message });
                res.json({ success: true, id: this.lastID });
            }
        );
    });
});

app.delete('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// Students Management
app.get('/api/students', (req, res) => {
    db.all(`SELECT * FROM students`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/students', (req, res) => {
    const { lrn, name } = req.body;
    db.get(`SELECT starting_month FROM settings WHERE key = 'starting_month'`, (err, row) => {
        const startingMonth = row ? row.value : 'June';

        db.run(`INSERT INTO students (lrn, name, total_bill, running_balance) VALUES (?, ?, 0, 0)`, [lrn, name], function(err) {
            if (err) return res.json({ success: false, error: err.message });
            const studentId = this.lastID;

            generateBills(studentId, startingMonth, (err) => {
                if (err) return res.json({ success: false, error: err.message });
                res.json({ success: true, id: studentId });
            });
        });
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

// Payments / Transactions
app.post('/api/payments', (req, res) => {
    const { student_id, cashier_id, bill_ids, amount_paid } = req.body;
    if (!bill_ids || bill_ids.length === 0) {
        return res.json({ success: false, error: 'No bills selected for payment.' });
    }

    const currentYear = new Date().getFullYear();

    db.get(`SELECT COUNT(*) as count FROM transactions`, (err, row) => {
        const count = (row ? row.count : 0) + 1;
        const orNumber = `${currentYear}-${String(count).padStart(6, '0')}`;
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

        db.serialize(() => {
            db.run(`BEGIN TRANSACTION`);

            db.run(
                `INSERT INTO transactions (or_number, student_id, cashier_id, amount_paid, new_balance, timestamp) VALUES (?, ?, ?, ?, 0, ?)`,
                [orNumber, student_id, cashier_id, amount_paid, timestamp],
                function(err) {
                    if (err) {
                        db.run(`ROLLBACK`);
                        return res.json({ success: false, error: err.message });
                    }
                    const transactionId = this.lastID;

                    const placeholders = bill_ids.map(() => '?').join(',');
                    const updateBillsQuery = `UPDATE bills SET status = 'paid', paid_date = ?, transaction_id = ? WHERE id IN (${placeholders})`;

                    db.run(updateBillsQuery, [timestamp, transactionId, ...bill_ids], function(err) {
                        if (err) {
                            db.run(`ROLLBACK`);
                            return res.json({ success: false, error: err.message });
                        }

                        db.get(`SELECT SUM(amount) as balance FROM bills WHERE student_id = ? AND status = 'unpaid'`, [student_id], (err, row) => {
                            if (err) {
                                db.run(`ROLLBACK`);
                                return res.json({ success: false, error: err.message });
                            }

                            const newBalance = row.balance || 0;

                            db.run(`UPDATE students SET running_balance = ? WHERE id = ?`, [newBalance, student_id], (err) => {
                                if (err) {
                                    db.run(`ROLLBACK`);
                                    return res.json({ success: false, error: err.message });
                                }

                                db.run(`UPDATE transactions SET new_balance = ? WHERE id = ?`, [newBalance, transactionId], (err) => {
                                    if (err) {
                                        db.run(`ROLLBACK`);
                                        return res.json({ success: false, error: err.message });
                                    }

                                    db.run(`COMMIT`);
                                    res.json({ success: true, or_number: orNumber, new_balance: newBalance });
                                });
                            });
                        });
                    });
                }
            );
        });
    });
});

app.get('/api/transactions', (req, res) => {
    const query = `
        SELECT t.*, s.name as student_name, s.lrn, u.username as cashier_name
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        JOIN users u ON t.cashier_id = u.id
        ORDER BY t.id DESC
    `;
    db.all(query, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/transactions/:id/receipt', (req, res) => {
    const txId = req.params.id;
    db.get(`
        SELECT t.*, s.name as student_name, s.lrn, u.username as cashier_name
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        JOIN users u ON t.cashier_id = u.id
        WHERE t.id = ?
    `, [txId], (err, transaction) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

        db.all(`SELECT * FROM bills WHERE transaction_id = ?`, [txId], (err, bills) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ transaction, bills });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});