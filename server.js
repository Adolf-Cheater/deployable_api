const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const levenshtein = require('fast-levenshtein');

const app = express();
app.use(bodyParser.json());
app.use(cors());

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

  const createLoginInfoTableQuery = `
    CREATE TABLE IF NOT EXISTS login_info (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      dob DATE NOT NULL,
      country VARCHAR(255) NOT NULL
    );
  `;

  db.query(createLoginInfoTableQuery, (error) => {
    if (error) {
      console.error('Error creating login_info table:', error);
    } else {
      console.log('login_info table created or already exists.');
    }
  });
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

app.post('/register', (req, res) => {
  const { username, password, dob, country } = req.body;

  if (!username || !password || !dob || !country) {
    return res.status(400).json({ error: 'Please provide all required fields' });
  }

  const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
  db.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO login_info (username, password, dob, country) VALUES (?, ?, ?, ?)';
    db.query(insertUserQuery, [username, hashedPassword, dob, country], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Registration successful' });
    });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
  db.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password incorrect' });
    }

    res.status(200).json({ message: 'Login successful' });
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
