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