const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.join(__dirname, 'portal.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        db.exec(schemaSql, (err) => {
            if (err) {
                console.error('Error executing schema', err);
            } else {
                console.log('Database tables verified/created successfully.');
                db.run("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'hash123', 'administrator')", (insertErr) => {
                    if (!insertErr) console.log('Sample user verified/inserted.');
                });
            }
        });
    }
});

const server = http.createServer((req, res) => {
    // Handle POST request to add a new user
    if (req.method === 'POST' && req.url === '/api/users') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const { username, password_hash, role } = JSON.parse(body);
            const query = `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`;
            db.run(query, [username, password_hash, role || 'user'], function(err) {
                if (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, id: this.lastID }));
                }
            });
        });
        return;
    }

    // Handle PUT request to update an existing user
    if (req.method === 'PUT' && req.url.startsWith('/api/users/')) {
        const id = req.url.split('/')[3];
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const { username, role } = JSON.parse(body);
            const query = `UPDATE users SET username = ?, role = ? WHERE id = ?`;
            db.run(query, [username, role, id], function(err) {
                if (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, changes: this.changes }));
                }
            });
        });
        return;
    }

    // Handle DELETE request to remove a user
    if (req.method === 'DELETE' && req.url.startsWith('/api/users/')) {
        const id = req.url.split('/')[3];
        const query = `DELETE FROM users WHERE id = ?`;
        db.run(query, [id], function(err) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, changes: this.changes }));
            }
        });
        return;
    }

    // Handle GET request for user data
    if (req.url === '/api/data') {
        db.all("SELECT * FROM users", [], (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rows));
        });
    } else {
        // Serve frontend HTML page
        let filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Server Error');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content, 'utf-8');
            }
        });
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});