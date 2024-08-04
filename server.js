const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const levenshtein = require('fast-levenshtein');
const spotDataUpload = require('./spotDataUpload'); // Assuming spotDataUpload.js is in the same directory

const app = express();
app.use(bodyParser.json());
app.use(cors());

// MySQL database connection
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

  // Ensure necessary tables exist
  const createLoginInfoTableQuery = `
    CREATE TABLE IF NOT EXISTS login_info (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      dob DATE NOT NULL,
      country VARCHAR(255) NOT NULL
    );
  `;

  const createUsersTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL
    );
  `;

  db.query(createLoginInfoTableQuery, (error) => {
    if (error) {
      console.error('Error creating login_info table:', error);
    } else {
      console.log('login_info table created or already exists.');
    }
  });

  db.query(createUsersTableQuery, (error) => {
    if (error) {
      console.error('Error creating users table:', error);
    } else {
      console.log('users table created or already exists.');
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

// Root route for server status
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Existing spotDataUpload route
app.use('/api', spotDataUpload(db));

// Register route for main page (login_info table)
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

// Register route for database access (users table)
app.post('/register-db', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
  db.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(insertUserQuery, [username, hashedPassword], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Registration successful' });
    });
  });
});

// Login route for main page (login_info table)
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

// Login route for database access (users table)
app.post('/login-db', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
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

// Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
