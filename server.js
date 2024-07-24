const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const levenshtein = require('fast-levenshtein');
const bcrypt = require('bcrypt'); // Added bcrypt for hashing passwords
const cors = require('cors'); // Added cors for handling cross-origin requests

const app = express();
app.use(bodyParser.json());
app.use(cors()); // Use cors middleware

const db = mysql.createConnection({
  host: 'rm-2ze8y04111hiut0r60o.mysql.rds.aliyuncs.com',
  user: 'main',
  password: 'Woshishabi2004',
  database: 'mytables',
  connectTimeout: 10000
});

db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
    return;
  }
  console.log('Connected to database.');
});

const knownCategories = [
  'Oil/Barrel', 'Gas/CubicMeter', 'Water/Liter' // Add more categories as needed
];

function getClosestCategory(input) {
  let closestCategory = null;
  let minDistance = Infinity;

  knownCategories.forEach(category => {
    const distance = levenshtein.get(input, category);
    if (distance < minDistance) {
      minDistance = distance;
      closestCategory = category;
    }
  });

  return (minDistance <= 2) ? closestCategory : input;
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      return res.status(500).json({ error: err });
    }

    const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(query, [username, hash], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        res.status(500).json({ error });
      } else {
        res.status(200).json({ message: 'User registered successfully', results });
      }
    });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const query = 'SELECT * FROM users WHERE username = ?';
  db.query(query, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      res.status(500).json({ error });
    } else if (results.length > 0) {
      const user = results[0];
      bcrypt.compare(password, user.password, (err, result) => {
        if (result) {
          res.status(200).json({ message: 'Login successful' });
        } else {
          res.status(401).json({ message: 'Invalid username or password' });
        }
      });
    } else {
      res.status(401).json({ message: 'Invalid username or password' });
    }
  });
});

app.post('/upload', (req, res) => {
  console.log('Received request:', req.body);
  let { name, value } = req.body;

  // Auto-correct the name
  name = getClosestCategory(name);

  // Check if the column exists
  const checkColumnQuery = `
    SELECT COUNT(*) AS count
    FROM information_schema.columns
    WHERE table_schema = 'mytables'
      AND table_name = 'test_table'
      AND column_name = ?`;

  db.query(checkColumnQuery, [name], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results[0].count === 0) {
      // Column does not exist, add it as nullable
      const addColumnQuery = `ALTER TABLE test_table ADD COLUMN ?? VARCHAR(255) DEFAULT NULL`;
      db.query(addColumnQuery, [name], (error, results) => {
        if (error) {
          console.error('Error adding column:', error);
          return res.status(500).json({ error });
        }
        insertValue(name, value, res);
      });
    } else {
      // Column exists, insert value
      insertValue(name, value, res);
    }
  });
});

function insertValue(name, value, res) {
  // Insert a new row or update the value if the column already exists
  const insertQuery = `INSERT INTO test_table (??) VALUES (?)`;
  db.query(insertQuery, [name, value], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      res.status(500).json({ error });
    } else {
      res.status(200).json({ message: 'Data uploaded successfully', results });
    }
  });
}

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
