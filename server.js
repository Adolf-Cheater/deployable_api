const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const levenshtein = require('fast-levenshtein');
const spotDataUpload = require('./spotDataUpload');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// MySQL connection for 'mytables'
const dbMytables = mysql.createConnection({
  host: 'rm-2ze8y04111hiut0r60o.mysql.rds.aliyuncs.com',
  user: 'main',
  password: 'Woshishabi2004',
  database: 'mytables',
  connectTimeout: 10000
});

// MySQL connection for 'ratemycourse'
const dbRateMyCourse = mysql.createConnection({
  host: 'rm-2ze8y04111hiut0r60o.mysql.rds.aliyuncs.com', // same host
  user: 'main', // same user
  password: 'Woshishabi2004', // same password
  database: 'ratemycourse',
  connectTimeout: 10000
});

dbMytables.connect((err) => {
  if (err) {
    console.error('Database connection to mytables failed:', err.stack);
    return;
  }
  console.log('Connected to mytables database.');

  // Additional setup for mytables, if needed
});

dbRateMyCourse.connect((err) => {
  if (err) {
    console.error('Database connection to ratemycourse failed:', err.stack);
    return;
  }
  console.log('Connected to ratemycourse database.');

  // Additional setup for ratemycourse, if needed
});

// Define queryPromise function
function queryPromise(db, sql, values) {
  return new Promise((resolve, reject) => {
    db.query(sql, values, (error, results) => {
      if (error) {
        console.error('SQL Error:', error);
        console.error('SQL Query:', sql);
        console.error('SQL Values:', values);
        return reject(error);
      }
      resolve(results);
    });
  });
}

// Middleware for the root route
app.get('/', (req, res) => {
  res.send('Server is running');
});

app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  const searchPattern = `%${query}%`;

  try {
    const searchQuery = `
      SELECT 
        co.offeringid,
        c.coursecode,
        CASE 
          WHEN offer.courseTitle IS NOT NULL THEN offer.courseTitle 
          ELSE c.coursename 
        END AS coursename, 
        i.firstname,
        i.lastname,
        d.DepartmentName AS department,
        d.Faculty AS faculty,
        co.academicyear,
        co.semester,
        co.section,
        sr.enrollmentcount,
        sr.responsecount,
        sr.lastupdated,
        sq.QuestionText AS question,
        sq.StronglyDisagree,
        sq.Disagree,
        sq.Neither,
        sq.Agree,
        sq.StronglyAgree,
        sq.Median
      FROM courseofferings co
      JOIN courses c ON co.courseid = c.courseid
      JOIN instructors i ON co.instructorid = i.instructorid
      JOIN departments d ON c.departmentid = d.DepartmentID
      LEFT JOIN spot_ratings sr ON co.offeringid = sr.offeringid
      LEFT JOIN spot_questions sq ON sr.ratingid = sq.ratingid
      LEFT JOIN courseofferdb offer ON CONCAT(offer.courseLetter, offer.courseNumber) = c.coursecode
      WHERE c.coursecode LIKE ? 
      OR c.coursename LIKE ? 
      OR i.firstname LIKE ? 
      OR i.lastname LIKE ?
      OR CONCAT(i.firstname, ' ', i.lastname) LIKE ?
    `;

    console.log('SQL Query:', searchQuery);
    console.log('SQL Values:', [searchPattern, searchPattern, searchPattern, searchPattern, searchPattern]);

    const results = await queryPromise(dbRateMyCourse, searchQuery, [
      searchPattern, 
      searchPattern, 
      searchPattern, 
      searchPattern,
      searchPattern
    ]);

    const formattedResults = results.reduce((acc, row) => {
      let result = acc.find(item => item.offeringid === row.offeringid);
      if (!result) {
        result = {
          offeringid: row.offeringid,
          coursecode: row.coursecode,
          coursename: row.coursename,
          firstname: row.firstname,
          lastname: row.lastname,
          department: row.department,
          faculty: row.faculty,
          academicyear: row.academicyear,
          semester: row.semester,
          section: row.section,
          enrollmentcount: row.enrollmentcount,
          responsecount: row.responsecount,
          lastupdated: row.lastupdated,
          ratings: [],
        };
        acc.push(result);
      }

      if (row.question) {
        result.ratings.push({
          question: row.question,
          stronglydisagree: row.StronglyDisagree,
          disagree: row.Disagree,
          neither: row.Neither,
          agree: row.Agree,
          stronglyagree: row.StronglyAgree,
          median: row.Median,
        });
      }
      return acc;
    }, []);

    res.json(formattedResults);
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  }
});

// Route handling for 'ratemycourse' related data
app.use('/api', spotDataUpload(dbRateMyCourse));

// Register route for main page (login_info table in 'mytables')
app.post('/register', (req, res) => {
  const { username, password, dob, country } = req.body;

  if (!username || !password || !dob || !country) {
    return res.status(400).json({ error: 'Please provide all required fields' });
  }

  const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO login_info (username, password, dob, country) VALUES (?, ?, ?, ?)';
    dbMytables.query(insertUserQuery, [username, hashedPassword, dob, country], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Registration successful' });
    });
  });
});

// Register route for database access (users table in 'mytables')
app.post('/register-db', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    dbMytables.query(insertUserQuery, [username, hashedPassword], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Registration successful' });
    });
  });
});

// Login route for main page (login_info table in 'mytables')
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
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

// Login route for database access (users table in 'mytables')
app.post('/login-db', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
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
